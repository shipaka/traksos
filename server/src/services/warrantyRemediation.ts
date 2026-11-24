import type {Db,Queryable} from '../db/index.ts';
import type {Notifier} from './notify.ts';
import {bad,conflict,forbidden,notFound,type AuthUser} from '../http/router.ts';
import {performerKindFor} from '../domain/dispatch.ts';
import {maskPhones} from '../util.ts';

const isStaff=(u:AuthUser)=>u.roles.includes('admin')||u.roles.includes('moderator');
const isAdmin=(u:AuthUser)=>u.roles.includes('admin');

export class WarrantyRemediationService {
  constructor(private db:Db,private notifier:Notifier,private now:()=>Date){}

  private async event(q:Queryable,id:string,actorId:string,event:string,data:unknown){
    await q.query(
      'insert into warranty_rework_events(job_id,actor_id,event,data) values($1,$2,$3,$4::jsonb)',
      [id,actorId,event,JSON.stringify(data)]);
  }
  private async audit(q:Queryable,actorId:string,action:string,id:string,data:unknown){
    await q.query('insert into audit_log(actor_id,action,target,data) values($1,$2,$3,$4)',
      [actorId,action,id,data]);
  }
  private sanitize(x:string,max=2000){
    const value=maskPhones(x.trim()).text;
    if(value.length<10||value.length>max)throw bad('warranty_remedy_note','Опишите работу подробнее');
    return value;
  }
  private async load(id:string,q:Queryable=this.db,lock:boolean|'share'=false){
    const job=await q.one<any>(
      `select j.*,c.filed_by,c.decision,c.status as claim_status,c.performer_id as liable_performer
         from warranty_rework_jobs j join warranty_claims c on c.id=j.claim_id
        where j.id=$1${lock==='share'?' for share of j,c':lock?' for update':''}`,[id]);
    if(!job)throw notFound('Гарантийный выезд не найден');
    return job;
  }
  private currentDecision(j:any){
    const expected=j.funding_source==='platform'?'repair_by_alternative':'repair_by_original';
    if(j.claim_status!=='decision_recorded'||j.decision!==expected)
      throw conflict('warranty_decision_changed','Из-за обжалования или изменения решения исправление приостановлено');
  }
  /** Historical filed_by never grants a former fleet driver permanent rights. */
  private async currentClaimant(q:Queryable,orderId:string,clientId:string,filedBy:string,
    userId:string,lock=false){
    if(filedBy!==userId||clientId===userId)return false;
    const row=await q.one<{ok:number}>(
      `select 1 as ok from orders o join users u on u.id=$3
         join vehicles v on v.owner_id=u.owner_id and v.driver_id=u.id
        where o.id=$1 and o.client_id=$2 and u.owner_id=o.client_id
          and 'driver'=any(u.roles) and (o.vehicle_id is null or v.id=o.vehicle_id)
        limit 1${lock?' for share of o,u,v':''}`,
      [orderId,clientId,userId]);
    return !!row;
  }
  private async canRead(q:Queryable,u:AuthUser,j:any){
    if(isStaff(u)||[j.client_id,j.performer_id,j.original_performer_id].includes(u.id))
      return true;
    return this.currentClaimant(q,j.original_order_id,j.client_id,j.filed_by,u.id,true);
  }
  async view(user:AuthUser,id:string){
    return this.db.tx(q=>this.readView(q,user,id));
  }
  private async readView(q:Queryable,user:AuthUser,id:string){
    const j=await this.load(id,q,'share');
    if(!await this.canRead(q,user,j))throw forbidden();
    const [events,expense]=await Promise.all([
      q.query<any>('select event,data,actor_id,created_at from warranty_rework_events where job_id=$1 order by id',[id]),
      q.one<any>('select amount_kopecks,bank_reference,transferred_at,recorded_at from warranty_platform_expenses where job_id=$1',[id]),
    ]);
    return {id:j.id,claimId:j.claim_id,sourceOrderId:j.original_order_id,
      caseRootId:j.case_root_id,clientId:j.client_id,performerId:j.performer_id,
      originalPerformerId:j.original_performer_id,fundingSource:j.funding_source,
      authorizedBudgetKopecks:j.budget_kopecks,clientChargeKopecks:0,
      status:j.status,task:j.task_description,report:j.report,
      authorizedAt:j.authorized_at,clientApprovedAt:j.client_approved_at,acceptedAt:j.accepted_at,
      reportedAt:j.reported_at,confirmedAt:j.confirmed_at,
      expenseRecorded:!!expense,
      expense:isAdmin(user)?expense:null,
      // Bank references belong only in the admin's financial proof view.
      // The common event timeline must not leak them to the client or workers.
      events:events.map(e=>({event:e.event,
        data:e.event==='expense_recorded'&&!isAdmin(user)
          ? {amountKopecks:e.data?.amountKopecks} : e.data,
        actorId:e.actor_id,createdAt:e.created_at}))};
  }
  async forClaim(user:AuthUser,claimId:string){
    return this.db.tx(async q=>{
    const c=await q.one<any>('select * from warranty_claims where id=$1 for share',[claimId]);
    if(!c)throw notFound('Претензия не найдена');
    const jobs=await q.query<{id:string;performer_id:string}>(
      'select id,performer_id from warranty_rework_jobs where claim_id=$1 order by authorized_at,id',
      [claimId]);
    const claimParty=isStaff(user)||[c.client_id,c.performer_id].includes(user.id)||
      await this.currentClaimant(q,c.order_id,c.client_id,c.filed_by,user.id,true);
    if(!claimParty&&!jobs.some(j=>j.performer_id===user.id))throw forbidden();
    const allowed=jobs.filter(j=>claimParty||j.performer_id===user.id);
    const views=[];
    for(const j of allowed)views.push(await this.readView(q,user,j.id));
    return views;
    });
  }

  /** An admin offers a nonbillable task only after a reviewed decision.
   * No standard orders, capture intents, customer invoices or payouts created.
   */
  async offer(user:AuthUser,claimId:string,p:{performerId:string;budgetKopecks:number;task:string}){
    if(!isAdmin(user))throw forbidden('Бюджет и гарантийное назначение подтверждает администратор');
    const task=this.sanitize(p.task);
    const notice={kind:'normal' as const,title:'Гарантийное исправление',
      body:'Есть отдельное исправительное задание. Клиент не оплачивает его повторно.'};
    const result=await this.db.tx(async q=>{
      const claim=await q.one<any>('select * from warranty_claims where id=$1 for update',[claimId]);
      if(!claim)throw notFound('Претензия не найдена');
      if(claim.status!=='decision_recorded'||
         !['repair_by_original','repair_by_alternative'].includes(claim.decision))
        throw conflict('warranty_not_authorized','Требуется мотивированное решение по исправлению');
      if([claim.client_id,claim.filed_by,claim.performer_id].includes(user.id))
        throw forbidden('Нельзя назначать исправление по собственной претензии');
      const original=claim.decision==='repair_by_original';
      if(original && p.performerId!==claim.performer_id)
        throw conflict('warranty_wrong_performer','Исправляет исходный исполнитель');
      if(!original && p.performerId===claim.performer_id)
        throw conflict('warranty_wrong_performer','Нужен другой независимый исполнитель');
      if((original&&p.budgetKopecks!==0)||
         (!original&&(!Number.isInteger(p.budgetKopecks)||p.budgetKopecks<1||p.budgetKopecks>100_000_000)))
        throw bad('warranty_budget','Для исходного исполнителя сумма ноль, для альтернативного нужен утверждённый лимит');
      const old=await q.one<any>(
        "select * from warranty_rework_jobs where claim_id=$1 and status not in ('declined','client_declined') for update",[claimId]);
      if(old){
        if(old.performer_id===p.performerId&&old.budget_kopecks===p.budgetKopecks&&old.task_description===task)
          return {id:old.id,created:false,recipients:[] as string[]};
        throw conflict('warranty_job_exists','Исправление уже согласовано, повторное назначение запрещено');
      }
      const o=await q.one<any>('select service from orders where id=$1',[claim.order_id]);
      if(!o)throw notFound('Исходный заказ не найден');
      const worker=await q.one<any>(
        `select p.kind,p.verification,p.paused,u.status
           from performer_profiles p join users u on u.id=p.user_id
          where p.user_id=$1 for update`,[p.performerId]);
      if(!worker||worker.verification!=='approved'||worker.status!=='active'||
         worker.paused||worker.kind!==performerKindFor(o.service))
        throw conflict('warranty_performer_unavailable','Исполнитель не проверен или не подходит для услуги');
      const funding=original?'performer_in_kind':'platform';
      const inserted=await q.one<{id:string}>(
        `insert into warranty_rework_jobs(
            claim_id,original_order_id,case_root_id,client_id,performer_id,
            original_performer_id,funding_source,budget_kopecks,task_description,
            authorized_by,authorized_at)
          values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning id`,
        [claimId,claim.order_id,claim.case_root_id,claim.client_id,p.performerId,
         claim.performer_id,funding,p.budgetKopecks,task,user.id,this.now()]);
      if(!inserted)throw new Error('Cannot create warranty rework job');
      await this.event(q,inserted.id,user.id,'offered',
        {performerId:p.performerId,budgetKopecks:p.budgetKopecks,funding});
      await this.audit(q,user.id,'warranty.rework_offer',inserted.id,
        {claimId,sourceOrderId:claim.order_id,budgetKopecks:p.budgetKopecks,funding});
      const recipients=[...new Set<string>([claim.client_id,p.performerId])];
      for(const recipient of recipients)
        await q.query('insert into notifications(user_id,kind,title,body,data) values ($1,$2,$3,$4,$5)',
          [recipient,'warranty',notice.title,notice.body,{claimId,jobId:inserted.id}]);
      return {id:inserted.id,created:true,recipients};
    });
    if(result.created){
      await this.notifier.deliverStored(result.recipients,
        {type:'warranty',claimId,jobId:result.id},
        {...notice,data:{claimId,jobId:result.id}}).catch(e=>console.warn('[warranty-job-push]',e));
    }
    return this.view(user,result.id);
  }
  /** The client must agree to the specific proposed remedy BEFORE the
   *  assigned performer is allowed to start. A refund request is never
   *  silently converted into a repair.
   */
  async clientApproval(user:AuthUser,id:string,approve:boolean){
    await this.db.tx(async q=>{
      const j=await this.load(id,q,true);
      if(j.client_id!==user.id &&
         !await this.currentClaimant(q,j.original_order_id,j.client_id,j.filed_by,user.id,true))
        throw forbidden();
      this.currentDecision(j);
      if(j.status==='client_declined'&&!approve)return;
      if(j.client_approved_at&&approve)return;
      if(j.status!=='offered'||j.client_approved_at)
        throw conflict('warranty_client_approval_closed','Способ исправления уже согласован или отклонён');
      if(approve){
        await q.query('update warranty_rework_jobs set client_approved_at=$2,updated_at=$2 where id=$1',
          [id,this.now()]);
        await this.event(q,id,user.id,'client_approved',{clientChargeKopecks:0});
      }else{
        await q.query("update warranty_rework_jobs set status='client_declined',updated_at=$2 where id=$1",
          [id,this.now()]);
        await this.event(q,id,user.id,'client_declined',{});
      }
    });
    return this.view(user,id);
  }

  async respond(user:AuthUser,id:string,accept:boolean){
    await this.db.tx(async q=>{
      const j=await this.load(id,q,true);
      if(j.performer_id!==user.id)throw forbidden('Ответить может назначенный исполнитель');
      this.currentDecision(j);
      if(accept&&!j.client_approved_at)
        throw conflict('warranty_client_approval_needed','Клиент ещё не согласовал способ исправления');
      const status=accept?'accepted':'declined';
      if(j.status===status)return;
      if(j.status!=='offered')throw conflict('warranty_job_state','Предложение уже обработано');
      const now=this.now();
      await q.query('update warranty_rework_jobs set status=$2,accepted_at=$3,updated_at=$4 where id=$1',
        [id,status,accept?now:null,now]);
      await this.event(q,id,user.id,status,{});
    });
    return this.view(user,id);
  }
  async reportDone(user:AuthUser,id:string,report:string){
    const text=this.sanitize(report);
    await this.db.tx(async q=>{
      const j=await this.load(id,q,true);
      if(j.performer_id!==user.id)throw forbidden();
      this.currentDecision(j);
      if(j.status==='reported_done'&&j.report===text)return;
      if(j.status!=='accepted')throw conflict('warranty_job_state','Работа ещё не принята или уже подтверждена');
      await q.query(
        "update warranty_rework_jobs set status='reported_done',report=$2,reported_at=$3,updated_at=$3 where id=$1",
        [id,text,this.now()]);
      await this.event(q,id,user.id,'reported_done',{report:text});
    });
    return this.view(user,id);
  }
  async clientConfirm(user:AuthUser,id:string){
    await this.db.tx(async q=>{
      const j=await this.load(id,q,true);
      if(j.client_id!==user.id &&
         !await this.currentClaimant(q,j.original_order_id,j.client_id,j.filed_by,user.id,true))
        throw forbidden();
      this.currentDecision(j);
      if(j.status==='client_confirmed')return;
      if(j.status!=='reported_done')throw conflict('warranty_job_state','Исполнитель ещё не сообщил об исправлении');
      await q.query(
        "update warranty_rework_jobs set status='client_confirmed',confirmed_at=$2,updated_at=$2 where id=$1",
        [id,this.now()]);
      await this.event(q,id,user.id,'client_confirmed',
        {clientChargeKopecks:0});
    });
    return this.view(user,id);
  }
  /** Explicit proof of an ALREADY EXECUTED external bank transfer.
   * Never invokes a bank and never debits any performer balance.
   */
  async recordPlatformExpense(user:AuthUser,id:string,p:{
    amountKopecks:number;bankReference:string;transferredAt:string;
  }){
    if(!isAdmin(user))throw forbidden();
    const ref=p.bankReference.trim();
    if(ref.length<5||ref.length>120)throw bad('bank_proof','Укажите подтверждение банковского перевода');
    const date=new Date(p.transferredAt);
    if(!Number.isFinite(date.getTime())||date.getTime()>this.now().getTime())
      throw bad('bank_proof','Некорректная дата фактического перевода');
    const result=await this.db.tx(async q=>{
      const j=await this.load(id,q,true);
      this.currentDecision(j);
      if(j.status!=='client_confirmed'||j.funding_source!=='platform')
        throw conflict('warranty_not_payable','Расход площадки возможен только после принятой альтернативной помощи');
      if(!Number.isInteger(p.amountKopecks)||p.amountKopecks<=0||
         p.amountKopecks>j.budget_kopecks)
        throw bad('warranty_expense_amount','Расход превышает утверждённый лимит');
      const existing=await q.one<any>('select * from warranty_platform_expenses where job_id=$1',[id]);
      if(existing){
        if(existing.amount_kopecks===p.amountKopecks&&existing.bank_reference===ref&&
           new Date(existing.transferred_at).getTime()===date.getTime())
          return {id:existing.id,created:false};
        throw conflict('warranty_expense_exists','Расход уже зарегистрирован с другим подтверждением');
      }
      const e=await q.one<{id:string}>(
        `insert into warranty_platform_expenses(
           job_id,amount_kopecks,bank_reference,transferred_at,recorded_by)
         values($1,$2,$3,$4,$5) returning id`,[id,p.amountKopecks,ref,date,user.id]);
      if(!e)throw new Error('Cannot record warranty expense');
      // Separate double-entry journal: no unrelated order or performer account.
      await q.query(
        `insert into warranty_platform_expense_ledger(expense_id,account,amount_kopecks)
         values ($1,'platform',$2),($1,'warranty_expense',$3)`,
        [e.id,-p.amountKopecks,p.amountKopecks]);
      await this.event(q,id,user.id,'expense_recorded',
        {amountKopecks:p.amountKopecks,bankReference:ref,transferredAt:date});
      await this.audit(q,user.id,'warranty.platform_expense',id,
        {expenseId:e.id,amountKopecks:p.amountKopecks,bankReference:ref});
      return {id:e.id,created:true};
    });
    return {id:result.id,jobId:id,recorded:true,duplicate:!result.created};
  }
}
