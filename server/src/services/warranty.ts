// Quality complaints about completed work. NOT price disputes.
// Decisions never debit a performer, execute a refund or create a second paid SOS.
import type { Db, Queryable } from '../db/index.ts';
import type { Notifier } from './notify.ts';
import { bad, conflict, forbidden, notFound, type AuthUser } from '../http/router.ts';
import { maskPhones } from '../util.ts';

export type RequestedWarrantyRemedy =
  | 'rework' | 'alternative' | 'partial_refund' | 'full_refund' | 'assessment';
export type WarrantyPosition =
  | 'offer_rework' | 'contest_fault' | 'needs_evidence' | 'unavailable';
export type WarrantyDecision =
  | 'not_fault' | 'repair_by_original' | 'repair_by_alternative'
  | 'partial_refund' | 'full_refund' | 'needs_external_review';

const isStaff = (u: AuthUser) => u.roles.includes('admin') || u.roles.includes('moderator');

export class WarrantyClaimsService {
  constructor(private db: Db, private notifier: Notifier, private now: () => Date) {}

  private safe(text: string) { return maskPhones(text.trim()).text; }

  private async record(q: Queryable, id: string, actorId: string, event: string, data: unknown) {
    await q.query(
      'insert into warranty_claim_events(claim_id,actor_id,event,data) values($1,$2,$3,$4::jsonb)',
      [id,actorId,event,JSON.stringify(data)]);
  }

  private canSee(user: AuthUser, claim: any) {
    return isStaff(user) || [claim.client_id,claim.filed_by,claim.performer_id].includes(user.id);
  }

  private async staffIds() {
    const mods=await this.db.query<{id:string}>(
      "select id from users where roles && '{moderator}'::text[]");
    if (mods.length) return mods.map(r=>r.id);
    return (await this.db.query<{id:string}>(
      "select id from users where roles && '{admin}'::text[]")).map(r=>r.id);
  }

  /** Customer chooses their remedy; a complaint does not itself prove fault. */
  async open(user: AuthUser, orderId: string, p: {
    defect: string; requestedRemedy: RequestedWarrantyRemedy; evidence?: string;
  }) {
    const defect=this.safe(p.defect);
    const evidence=p.evidence ? this.safe(p.evidence) : null;
    if (defect.length<10 || defect.length>2000) throw bad('warranty_description','Опишите недостаток подробнее');
    if (evidence && evidence.length>2000) throw bad('warranty_evidence','Описание доказательств слишком длинное');
    const result=await this.db.tx(async q=>{
      // Serialize duplicate client clicks with the order record.
      const o=await q.one<any>('select * from orders where id=$1 for update',[orderId]);
      if (!o) throw notFound('Заказ не найден');
      if (o.client_id!==user.id && o.created_by!==user.id)
        throw forbidden('Гарантийную претензию подаёт участник заказа со стороны клиента');
      if (o.status!=='completed' || !o.performer_id)
        throw conflict('warranty_not_completed','Качество можно оспорить после завершения выполненной работы');
      const existing=await q.one<any>('select * from warranty_claims where order_id=$1',[orderId]);
      if (existing) {
        if (existing.filed_by===user.id &&
            existing.defect_description===defect &&
            existing.requested_remedy===p.requestedRemedy &&
            existing.evidence_description===(evidence??null))
          return {id:existing.id,created:false};
        throw conflict('warranty_already_open','Претензия по работе уже открыта. Дополните её доказательствами.');
      }
      const row=await q.one<{id:string;number:number}>(
        `insert into warranty_claims(order_id,case_root_id,client_id,filed_by,performer_id,
          defect_description,evidence_description,requested_remedy)
         values($1,$2,$3,$4,$5,$6,$7,$8) returning id,number`,
        [orderId,o.case_root_id??o.id,o.client_id,user.id,o.performer_id,
         defect,evidence,p.requestedRemedy]);
      if (!row) throw new Error('Warranty claim insert failed');
      await this.record(q,row.id,user.id,'opened',
        {requestedRemedy:p.requestedRemedy,defect,evidence});
      await q.query('insert into audit_log(actor_id,action,target,data) values($1,$2,$3,$4)',
        [user.id,'warranty.open',row.id,{orderId,requestedRemedy:p.requestedRemedy}]);
      return {id:row.id,created:true,number:row.number,performerId:o.performer_id};
    });
    if (result.created) {
      await this.notifier.notify([...(await this.staffIds()),result.performerId!],
        {type:'warranty',claimId:result.id,orderId},
        {kind:'normal',title:`Претензия к качеству №${result.number}`,
          body:'Поступило обращение по завершённой услуге. Необходимо проверить факты.',
          data:{claimId:result.id,orderId}})
        .catch(e=>console.error('[warranty-intake-notify]',e));
    }
    return this.view(user,result.id);
  }

  async mine(user: AuthUser) {
    const rows=await this.db.query<any>(
      `select c.id,c.number,c.order_id,c.case_root_id,c.requested_remedy,c.status,
               c.decision,c.created_at,c.updated_at,o.number as order_number
          from warranty_claims c join orders o on o.id=c.order_id
         where c.client_id=$1 or c.filed_by=$1 or c.performer_id=$1
         order by c.created_at desc limit 100`,[user.id]);
    return rows.map(r=>({id:r.id,number:r.number,orderId:r.order_id,
      caseRootId:r.case_root_id,orderNumber:r.order_number,requestedRemedy:r.requested_remedy,
      status:r.status,decision:r.decision,createdAt:r.created_at,updatedAt:r.updated_at}));
  }

  async queue(user: AuthUser, status?:string) {
    if (!isStaff(user)) throw forbidden();
    return this.db.query(
      `select c.id,c.number,c.order_id,c.case_root_id,c.client_id,c.performer_id,
               c.status,c.requested_remedy,c.defect_description,c.performer_position,
               c.decision,c.created_at,c.updated_at,o.number as order_number
          from warranty_claims c join orders o on o.id=c.order_id
         where ($1::text is null or c.status=$1)
         order by case c.status when 'appealed' then 0 when 'submitted' then 1
                when 'reviewing' then 2 else 3 end, c.created_at
         limit 200`,[status??null]);
  }

  /** Participants see only the claim, order number and evidence notes, NOT
   *  another account's private documents, personal number or payment details.
   */
  async view(user: AuthUser, id: string) {
    const c=await this.db.one<any>(
      `select c.*,o.number as order_number,o.service as order_service,
               o.status as order_status
          from warranty_claims c join orders o on o.id=c.order_id where c.id=$1`,[id]);
    if (!c) throw notFound('Претензия не найдена');
    if (!this.canSee(user,c)) throw forbidden();
    const events=await this.db.query<{actor_id:string;event:string;data:any;created_at:Date}>(
      'select actor_id,event,data,created_at from warranty_claim_events where claim_id=$1 order by id',[id]);
    return {
      id:c.id,number:c.number,orderId:c.order_id,orderNumber:c.order_number,
      orderService:c.order_service,caseRootId:c.case_root_id,
      clientId:c.client_id,performerId:c.performer_id,
      defect:c.defect_description,evidence:c.evidence_description,
      requestedRemedy:c.requested_remedy,status:c.status,
      performerPosition:c.performer_position,performerExplanation:c.performer_explanation,
      decision:c.decision,decisionNote:c.decision_note,decidedAt:c.decided_at,
      appealedAt:c.appealed_at,appealCount:c.appeal_count,
      fulfilment:'not_started', // no payment or rework can be executed here
      events:events.map(e=>({actorId:e.actor_id,event:e.event,data:e.data,createdAt:e.created_at})),
      createdAt:c.created_at,updatedAt:c.updated_at,
    };
  }

  /** Evidence notes extend the factual record without altering the original.
   *  Real photos/documents remain in the existing access-controlled services.
   */
  async addEvidence(user: AuthUser, id:string, text:string) {
    const note=this.safe(text);
    if (note.length<5 || note.length>2000) throw bad('evidence','Опишите доказательство');
    await this.db.tx(async q=>{
      const c=await q.one<any>('select * from warranty_claims where id=$1 for update',[id]);
      if (!c) throw notFound('Претензия не найдена');
      if (!this.canSee(user,c)) throw forbidden();
      await this.record(q,id,user.id,'evidence_added',{note});
      await q.query('update warranty_claims set updated_at=$2 where id=$1',[id,this.now()]);
    });
    return this.view(user,id);
  }

  /** An executor may explain or disagree, never decide their own liability. */
  async respond(user:AuthUser,id:string,position:WarrantyPosition,note:string) {
    const explanation=this.safe(note);
    if (explanation.length<10 || explanation.length>2000)
      throw bad('warranty_response','Исполнитель должен пояснить свою позицию');
    await this.db.tx(async q=>{
      const c=await q.one<any>('select * from warranty_claims where id=$1 for update',[id]);
      if (!c) throw notFound('Претензия не найдена');
      if (c.performer_id!==user.id) throw forbidden('Отвечает только фактический исполнитель');
      if (c.status==='decision_recorded')
        throw conflict('warranty_decided','Решение уже зафиксировано; можно подать апелляцию');
      await q.query(
        `update warranty_claims set performer_position=$2,performer_explanation=$3,
          performer_responded_at=$4,updated_at=$4 where id=$1`,
        [id,position,explanation,this.now()]);
      await this.record(q,id,user.id,'performer_responded',{position,note:explanation});
    });
    return this.view(user,id);
  }

  async beginReview(user:AuthUser,id:string) {
    if (!isStaff(user)) throw forbidden();
    await this.db.tx(async q=>{
      const c=await q.one<any>('select * from warranty_claims where id=$1 for update',[id]);
      if (!c) throw notFound('Претензия не найдена');
      if (c.client_id===user.id || c.filed_by===user.id || c.performer_id===user.id)
        throw forbidden('Участник не может проверять собственную претензию');
      if (!['submitted','appealed','reviewing'].includes(c.status))
        throw conflict('warranty_decided','Дождитесь апелляции или откройте новое обращение');
      if (c.status!=='reviewing') {
        await q.query("update warranty_claims set status='reviewing',updated_at=$2 where id=$1",
          [id,this.now()]);
        await this.record(q,id,user.id,'review_started',{});
      }
    });
    return this.view(user,id);
  }

  /** A decision is a recorded finding, NOT a completed refund or paid rework.
   *  Financial execution requires a separately audited path and legal basis.
   */
  async decide(user:AuthUser,id:string,decision:WarrantyDecision,note:string) {
    if (!isStaff(user)) throw forbidden();
    const reason=this.safe(note);
    if (reason.length<20 || reason.length>3000)
      throw bad('warranty_decision_reason','Нужны факты и мотивировка решения');
    await this.db.tx(async q=>{
      const c=await q.one<any>('select * from warranty_claims where id=$1 for update',[id]);
      if (!c) throw notFound('Претензия не найдена');
      if (c.client_id===user.id || c.filed_by===user.id || c.performer_id===user.id)
        throw forbidden('Нельзя выносить решение по собственному заказу');
      if (!['submitted','reviewing','appealed'].includes(c.status))
        throw conflict('warranty_decided','Решение уже зафиксировано');
      if (c.appeal_count>0 && c.decided_by===user.id)
        throw forbidden('Апелляцию рассматривает другой сотрудник');
      await q.query(
        `update warranty_claims set status='decision_recorded',decision=$2,decision_note=$3,
          decided_by=$4,decided_at=$5,updated_at=$5 where id=$1`,
        [id,decision,reason,user.id,this.now()]);
      await this.record(q,id,user.id,'decision_recorded',
        {decision,note:reason,requiresSeparateExecution:true});
      await q.query('insert into audit_log(actor_id,action,target,data) values($1,$2,$3,$4)',
        [user.id,'warranty.decision',id,{decision,note:reason}]);
    });
    const c=await this.db.one<{client_id:string;filed_by:string;performer_id:string;order_id:string}>(
      'select client_id,filed_by,performer_id,order_id from warranty_claims where id=$1',[id]);
    if (c) await this.notifier.notify(
      [c.client_id,c.filed_by,c.performer_id],
      {type:'warranty',claimId:id,orderId:c.order_id},
      {kind:'normal',title:'Рассмотрена претензия к качеству',
        body:'Решение зафиксировано. Возврат или повторный выезд не оформляются автоматически.',
        data:{claimId:id,orderId:c.order_id}})
      .catch(e=>console.error('[warranty-decision-notify]',e));
    return this.view(user,id);
  }

  /** A party may challenge a finding. Preserve the original decision in
   *  the immutable event log; an independent staff member must re-review.
   */
  async appeal(user:AuthUser,id:string,text:string) {
    const reason=this.safe(text);
    if (reason.length<20 || reason.length>2000)
      throw bad('warranty_appeal_reason','Опишите причины несогласия с решением');
    await this.db.tx(async q=>{
      const c=await q.one<any>('select * from warranty_claims where id=$1 for update',[id]);
      if (!c) throw notFound('Претензия не найдена');
      if (![c.client_id,c.filed_by,c.performer_id].includes(user.id))
        throw forbidden('Апелляцию подаёт участник выполненного заказа');
      if (c.status!=='decision_recorded' || c.appeal_count>0)
        throw conflict('warranty_appeal_unavailable','Повторную претензию можно направить в поддержку');
      await q.query(
        `update warranty_claims set status='appealed',appeal_count=appeal_count+1,
           appealed_by=$2,appealed_at=$3,updated_at=$3 where id=$1`,
        [id,user.id,this.now()]);
      await this.record(q,id,user.id,'decision_appealed',{reason});
      await q.query('insert into audit_log(actor_id,action,target,data) values($1,$2,$3,$4)',
        [user.id,'warranty.appeal',id,{reason}]);
    });
    await this.notifier.notify(await this.staffIds(),
      {type:'warranty',claimId:id},
      {kind:'normal',title:'Обжалование гарантийного решения',
        body:'Требуется повторная проверка другим сотрудником.',data:{claimId:id}})
      .catch(e=>console.error('[warranty-appeal-notify]',e));
    return this.view(user,id);
  }
}
