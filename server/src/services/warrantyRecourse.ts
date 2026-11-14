// A documentary, contestable claim against the original executor.
// This service NEVER withholds contractor payouts, debits ledger_entries,
// executes transfers or labels an unreviewed allegation as an established debt.
import type { Db, Queryable } from '../db/index.ts';
import type { Notifier } from './notify.ts';
import { bad, conflict, forbidden, notFound, type AuthUser } from '../http/router.ts';
import { maskPhones } from '../util.ts';

type RecoursePosition = 'acknowledged' | 'contested';
type ReviewOutcome = 'documented_for_review' | 'insufficient_basis' | 'external_legal_review';
const staff = (u: AuthUser) => u.roles.includes('admin') || u.roles.includes('moderator');
const admin = (u: AuthUser) => u.roles.includes('admin');

export class WarrantyRecourseService {
  constructor(private db: Db, private notifier: Notifier, private now: () => Date) {}

  private clean(v: string, min = 20, max = 2000) {
    const value = maskPhones(v.trim()).text;
    if (value.length < min || value.length > max)
      throw bad('recourse_explanation','Необходимы подробности и документальное основание');
    return value;
  }
  private async log(q: Queryable, id: string, actorId: string, event: string, data: unknown) {
    await q.query(
      'insert into warranty_recourse_events(case_id,actor_id,event,details) values ($1,$2,$3,$4::jsonb)',
      [id,actorId,event,JSON.stringify(data)]);
  }
  private async audit(q: Queryable, user: AuthUser, action: string, id: string, data: unknown) {
    await q.query('insert into audit_log(actor_id,action,target,data) values ($1,$2,$3,$4)',
      [user.id,action,id,data]);
  }
  private async load(q: Queryable, id: string, lock = false) {
    const r=await q.one<any>(
      `select c.*, e.amount_kopecks as actual_expense, e.job_id,
          w.status as warranty_status,w.decision as warranty_decision,
          w.performer_id as warranty_original_performer,
          j.original_performer_id as job_original_performer
        from warranty_recourse_cases c
          join warranty_platform_expenses e on e.id=c.expense_id
          join warranty_rework_jobs j on j.id=e.job_id
          join warranty_claims w on w.id=c.warranty_claim_id
        where c.id=$1${lock?' for update of c':''}`,[id]);
    if (!r) throw notFound('Требование по гарантийному случаю не найдено');
    return r;
  }
  private visible(u: AuthUser, c: any) {
    return staff(u) || c.original_performer_id === u.id;
  }
  private currentBasis(c: any) {
    if (c.warranty_status !== 'decision_recorded' ||
        c.warranty_decision !== 'repair_by_alternative' ||
        c.original_performer_id !== c.warranty_original_performer ||
        c.original_performer_id !== c.job_original_performer)
      throw conflict('recourse_under_appeal','Гарантийное основание обжалуется или изменилось');
  }

  async view(user: AuthUser, id: string) {
    const c=await this.load(this.db,id);
    if (!this.visible(user,c)) throw forbidden();
    const [events,receipts]=await Promise.all([
      this.db.query<any>(
        'select event,details,actor_id,created_at from warranty_recourse_events where case_id=$1 order by id',
        [id]),
      this.db.query<any>(
        'select id,amount_kopecks,bank_reference,received_at,recorded_at from warranty_recourse_receipts where case_id=$1 order by recorded_at,id',
        [id]),
    ]);
    const recovered=receipts.reduce((sum,r)=>sum+Number(r.amount_kopecks),0);
    return {id:c.id,expenseId:c.expense_id,warrantyClaimId:c.warranty_claim_id,
      originalPerformerId:c.original_performer_id,
      proposedAmountKopecks:c.proposed_amount_kopecks,
      recoveredKopecks:recovered,
      remainingProposedKopecks:c.proposed_amount_kopecks-recovered,
      claimIsNotEnforceableDebt:true,
      autoDeductionEnabled:false,
      status:c.status,performerPosition:c.performer_position,
      contractualBasis:c.contractual_basis,evidenceSummary:c.evidence_summary,
      performerExplanation:c.performer_explanation,
      reviewOutcome:c.review_outcome,reviewReason:c.review_reason,
      openedAt:c.opened_at,respondedAt:c.responded_at,reviewedAt:c.reviewed_at,
      events:events.map(e=>({event:e.event,actorId:e.actor_id,createdAt:e.created_at,
        details:admin(user)?e.details:
          e.event==='received_payment'?{amountKopecks:e.details.amountKopecks}:e.details})),
      receipts:receipts.map(r=>({id:r.id,amountKopecks:r.amount_kopecks,
        receivedAt:r.received_at,
        ...(admin(user)?{bankReference:r.bank_reference}: {})})),
    };
  }

  async mine(user: AuthUser) {
    return this.db.query(
      `select id,expense_id,warranty_claim_id,proposed_amount_kopecks,status,opened_at
        from warranty_recourse_cases
        where $1::boolean or original_performer_id=$2
        order by opened_at desc limit 100`,[staff(user),user.id]);
  }

  /** Notify the actual executor of the POTENTIAL claim. The admin attests
   * documentary grounds; it is NOT an approved fine, accepted debt or hold.
   */
  async open(user: AuthUser, expenseId: string, p: {
    amountKopecks: number; contractualBasis: string; evidenceSummary: string;
  }) {
    if (!admin(user)) throw forbidden('Требование может оформить только администратор');
    const basis=this.clean(p.contractualBasis);
    const evidence=this.clean(p.evidenceSummary);
    const result=await this.db.tx(async q=>{
      const expense=await q.one<any>(
        `select e.*, j.claim_id,j.original_performer_id,j.funding_source,
                 j.status as job_status,w.status as claim_status,
                 w.decision,w.performer_id as claimed_performer
           from warranty_platform_expenses e
             join warranty_rework_jobs j on j.id=e.job_id
             join warranty_claims w on w.id=j.claim_id
          where e.id=$1 for update of e`,[expenseId]);
      if (!expense) throw notFound('Расход платформы не найден');
      if (expense.funding_source!=='platform' || expense.job_status!=='client_confirmed' ||
          expense.claim_status!=='decision_recorded' ||
          expense.decision!=='repair_by_alternative' ||
          expense.original_performer_id!==expense.claimed_performer)
        throw conflict('recourse_unverified','Гарантийное основание ещё не подтверждено');
      if (!Number.isInteger(p.amountKopecks) || p.amountKopecks<=0 ||
          p.amountKopecks>expense.amount_kopecks)
        throw bad('recourse_amount','Заявленная сумма не может превышать фактический расход');
      if (expense.original_performer_id===user.id)
        throw forbidden('Нельзя предъявлять требование к самому себе');
      const previous=await q.one<any>(
        'select * from warranty_recourse_cases where expense_id=$1',[expenseId]);
      if (previous) {
        if (previous.proposed_amount_kopecks===p.amountKopecks &&
          previous.contractual_basis===basis&&previous.evidence_summary===evidence)
          return {id:previous.id,created:false,performerId:previous.original_performer_id};
        throw conflict('recourse_exists','По этому расходу уже есть требование');
      }
      const row=await q.one<{id:string}>(
        `insert into warranty_recourse_cases(
            expense_id,warranty_claim_id,original_performer_id,proposed_amount_kopecks,
            contractual_basis,evidence_summary,opened_by)
          values ($1,$2,$3,$4,$5,$6,$7) returning id`,
        [expenseId,expense.claim_id,expense.original_performer_id,
          p.amountKopecks,basis,evidence,user.id]);
      if (!row) throw new Error('Cannot create recourse case');
      await this.log(q,row.id,user.id,'notified',
        {amountKopecks:p.amountKopecks,claimId:expense.claim_id});
      await this.audit(q,user,'warranty.recourse_open',row.id,
        {expenseId,originalPerformerId:expense.original_performer_id,
          amountKopecks:p.amountKopecks});
      return {id:row.id,created:true,performerId:expense.original_performer_id};
    });
    if (result.created) await this.notifier.notify([result.performerId],
      {type:'warranty',recourseId:result.id},
      {kind:'normal',title:'Запрос пояснений по гарантийным расходам',
        body:'TrackSOS направил расчёт и основание возможного требования. Вы вправе возразить; автоматического удержания нет.',
        data:{recourseId:result.id}}).catch(e=>console.error('[recourse-notify]',e));
    return this.view(user,result.id);
  }

  async respond(user:AuthUser,id:string,position:RecoursePosition,note:string){
    const explanation=this.clean(note);
    await this.db.tx(async q=>{
      const c=await this.load(q,id,true);
      if (c.original_performer_id!==user.id)throw forbidden('Ответить может только исходный исполнитель');
      this.currentBasis(c);
      if (c.status==='withdrawn'||c.status==='reviewed')
        throw conflict('recourse_closed','Дело уже рассмотрено или отозвано');
      if (c.performer_position===position&&c.performer_explanation===explanation)return;
      if (c.performer_position)
        throw conflict('recourse_already_responded','Позиция зафиксирована; дополнения через поддержку');
      const state=position==='contested'?'contested':'acknowledged';
      await q.query(
        `update warranty_recourse_cases set status=$2,performer_position=$3,
            performer_explanation=$4,responded_at=$5,updated_at=$5 where id=$1`,
        [id,state,position,explanation,this.now()]);
      await this.log(q,id,user.id,position,{explanation});
    });
    return this.view(user,id);
  }

  /** Review documents without a bank debit or an automatic enforceable debt. */
  async review(user:AuthUser,id:string,outcome:ReviewOutcome,note:string){
    if (!staff(user))throw forbidden();
    const reason=this.clean(note);
    await this.db.tx(async q=>{
      const c=await this.load(q,id,true);
      this.currentBasis(c);
      if (c.status==='withdrawn'||c.status==='reviewed')
        throw conflict('recourse_closed','Дело уже рассмотрено или отозвано');
      if (c.opened_by===user.id&&c.performer_position==='contested')
        throw forbidden('Возражение рассматривает другой сотрудник');
      if (c.original_performer_id===user.id)throw forbidden();
      await q.query(
        `update warranty_recourse_cases set status='reviewed',
            review_outcome=$2,review_reason=$3,reviewed_by=$4,reviewed_at=$5,
            updated_at=$5 where id=$1`,[id,outcome,reason,user.id,this.now()]);
      await this.log(q,id,user.id,'reviewed',
        {outcome,reason,autoDeduction:false});
      await this.audit(q,user,'warranty.recourse_review',id,{outcome});
    });
    return this.view(user,id);
  }

  async withdraw(user:AuthUser,id:string,note:string){
    if (!admin(user))throw forbidden();
    const reason=this.clean(note);
    await this.db.tx(async q=>{
      const c=await this.load(q,id,true);
      if (c.status==='withdrawn')return;
      await q.query(
        "update warranty_recourse_cases set status='withdrawn',updated_at=$2 where id=$1",
        [id,this.now()]);
      await this.log(q,id,user.id,'withdrawn',{reason});
      await this.audit(q,user,'warranty.recourse_withdraw',id,{reason});
    });
    return this.view(user,id);
  }

  /** Admin records an ALREADY received external transfer, never a debit.
   * Receipts require explicit performer acknowledgement and unchanged verdict.
   */
  async recordReceived(user:AuthUser,id:string,p:{
    amountKopecks:number;bankReference:string;receivedAt:string;
  }){
    if (!admin(user))throw forbidden();
    const reference=p.bankReference.trim();
    const at=new Date(p.receivedAt);
    if (reference.length<5||reference.length>120||
        !Number.isFinite(at.getTime())||at.getTime()>this.now().getTime())
      throw bad('recourse_proof','Укажите действительные реквизиты уже полученного платежа');
    const result=await this.db.tx(async q=>{
      const c=await this.load(q,id,true);
      this.currentBasis(c);
      if (c.performer_position!=='acknowledged' || c.status==='withdrawn' ||
          c.review_outcome==='insufficient_basis')
        throw conflict('recourse_not_payable','Нет признанного основания для добровольного погашения');
      if (!Number.isInteger(p.amountKopecks)||p.amountKopecks<=0)
        throw bad('recourse_amount','Укажите сумму поступления');
      const previous=await q.one<any>(
        'select * from warranty_recourse_receipts where bank_reference=$1',[reference]);
      if (previous) {
        if (previous.case_id===id&&previous.amount_kopecks===p.amountKopecks &&
            new Date(previous.received_at).getTime()===at.getTime())
          return {id:previous.id,created:false};
        throw conflict('recourse_receipt_conflict','Банковское подтверждение уже использовано');
      }
      const sum=await q.one<{total:string}>(
        'select coalesce(sum(amount_kopecks),0)::text as total from warranty_recourse_receipts where case_id=$1',
        [id]);
      if (Number(sum?.total??0)+p.amountKopecks>c.proposed_amount_kopecks)
        throw conflict('recourse_overpaid','Сумма больше заявленного документального требования');
      const row=await q.one<{id:string}>(
        `insert into warranty_recourse_receipts(
            case_id,amount_kopecks,bank_reference,received_at,confirmed_by)
           values($1,$2,$3,$4,$5) returning id`,
        [id,p.amountKopecks,reference,at,user.id]);
      if (!row)throw new Error('Cannot record recourse receipt');
      await q.query(
        `insert into warranty_recourse_receipt_ledger(receipt_id,account,amount_kopecks)
          values ($1,'platform',$2),($1,'warranty_recourse_received',$3)`,
        [row.id,p.amountKopecks,-p.amountKopecks]);
      await this.log(q,id,user.id,'received_payment',
        {amountKopecks:p.amountKopecks,bankReference:reference});
      await this.audit(q,user,'warranty.recourse_received',id,
        {receiptId:row.id,amountKopecks:p.amountKopecks,bankReference:reference});
      return {id:row.id,created:true};
    });
    return {id:result.id,caseId:id,recorded:true,duplicate:!result.created};
  }
}
