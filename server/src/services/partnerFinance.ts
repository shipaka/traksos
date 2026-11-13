import type {Db} from '../db/index.ts';
import type {AuthUser} from '../http/router.ts';
import {forbidden,bad,notFound} from '../http/router.ts';

export class PartnerFinance {
  constructor(private db:Db){}
  async recordAccrual(staff:AuthUser,requestId:string,amountKopecks:number,note:string) {
    if(!staff.roles?.includes('admin'))throw forbidden('Начисления подтверждает администратор');
    if(!Number.isSafeInteger(amountKopecks)||amountKopecks<=0||!note.trim())
      throw bad('invalid_accrual','Укажите сумму в копейках и основание начисления');
    return this.db.tx(async q=>{
      const request=await q.one<{id:string;kind:string;assigned_to:string|null;status:string}>(
        'select id,kind,assigned_to,status from vehicle_service_requests where id=$1 for update',[requestId]);
      if(!request||!request.assigned_to||request.status!=='completed')
        throw notFound('Нет завершённой заявки с назначенным партнёром');
      const existing=await q.one<{id:string}>(
        `select id from partner_finance_entries where request_id=$1 and entry_type='accrual' limit 1`,[requestId]);
      if(existing)throw bad('duplicate_accrual','Начисление по заявке уже создано');
      const entry=await q.one<any>(
        `insert into partner_finance_entries(partner_id,request_id,kind,amount_kopecks,entry_type,note,created_by)
         values ($1,$2,$3,$4,'accrual',$5,$6) returning *`,
        [request.assigned_to,request.id,request.kind,amountKopecks,note.trim(),staff.id]);
      await q.query('insert into audit_log(actor_id,action,target,data) values ($1,$2,$3,$4)',
        [staff.id,'partner_finance.accrual',requestId,{amountKopecks,partnerId:request.assigned_to}]);
      return entry;
    });
  }

  async recordPayout(staff:AuthUser,requestId:string,amountKopecks:number,reference:string) {
    if(!staff.roles?.includes('admin'))throw forbidden('Выплаты подтверждает администратор');
    if(!Number.isSafeInteger(amountKopecks)||amountKopecks<=0||reference.trim().length<3)
      throw bad('invalid_payout','Укажите положительную сумму и подтверждение фактической выплаты');
    return this.db.tx(async q=>{
      // Serializes payout and reversal operations for one service request.
      const request=await q.one<{id:string;kind:string;assigned_to:string|null}>(
        'select id,kind,assigned_to from vehicle_service_requests where id=$1 for update',[requestId]);
      if(!request?.assigned_to)throw notFound('Заявка с назначенным партнёром не найдена');
      const totals=await q.one<{balance:string}>(
        `select coalesce(sum(case when entry_type='accrual' then amount_kopecks
                                   else -amount_kopecks end),0)::text as balance
         from partner_finance_entries where request_id=$1 and partner_id=$2`,
        [requestId,request.assigned_to]);
      if(BigInt(totals?.balance??'0')<BigInt(amountKopecks))
        throw bad('insufficient_partner_balance','Сумма превышает подтверждённый остаток по заявке');
      const duplicate=await q.one<{id:string}>(
        `select id from partner_finance_entries
         where request_id=$1 and entry_type='payout' and note=$2 limit 1`,
        [requestId,reference.trim()]);
      if(duplicate)throw bad('duplicate_payout','Выплата с таким подтверждением уже зарегистрирована');
      const entry=await q.one<any>(
        `insert into partner_finance_entries(partner_id,request_id,kind,amount_kopecks,entry_type,note,created_by)
         values ($1,$2,$3,$4,'payout',$5,$6) returning *`,
        [request.assigned_to,requestId,request.kind,amountKopecks,reference.trim(),staff.id]);
      await q.query('insert into audit_log(actor_id,action,target,data) values ($1,$2,$3,$4)',
        [staff.id,'partner_finance.payout',requestId,{amountKopecks,reference:reference.trim()}]);
      return entry;
    });
  }

  async recordReversal(staff:AuthUser,requestId:string,amountKopecks:number,reason:string) {
    if(!staff.roles?.includes('admin'))throw forbidden('Корректировки подтверждает администратор');
    if(!Number.isSafeInteger(amountKopecks)||amountKopecks<=0||reason.trim().length<3)
      throw bad('invalid_reversal','Укажите сумму и обоснование корректировки');
    return this.db.tx(async q=>{
      const request=await q.one<{id:string;kind:string;assigned_to:string|null}>(
        'select id,kind,assigned_to from vehicle_service_requests where id=$1 for update',[requestId]);
      if(!request?.assigned_to)throw notFound('Заявка с назначенным партнёром не найдена');
      const totals=await q.one<{balance:string}>(
        `select coalesce(sum(case when entry_type='accrual' then amount_kopecks
                                   else -amount_kopecks end),0)::text as balance
         from partner_finance_entries where request_id=$1 and partner_id=$2`,
        [requestId,request.assigned_to]);
      if(BigInt(totals?.balance??'0')<BigInt(amountKopecks))
        throw bad('reversal_exceeds_balance','Нельзя уменьшить начисление больше невыплаченного остатка');
      const entry=await q.one<any>(
        `insert into partner_finance_entries(partner_id,request_id,kind,amount_kopecks,entry_type,note,created_by)
         values ($1,$2,$3,$4,'reversal',$5,$6) returning *`,
        [request.assigned_to,requestId,request.kind,amountKopecks,reason.trim(),staff.id]);
      await q.query('insert into audit_log(actor_id,action,target,data) values ($1,$2,$3,$4)',
        [staff.id,'partner_finance.reversal',requestId,{amountKopecks,reason:reason.trim()}]);
      return entry;
    });
  }

  async mine(user:AuthUser) {
    if(!user.roles?.includes('insurer'))throw forbidden('Нет доступа к финансам партнёра');
    const entries=await this.db.query<{
      id:string;kind:'insurance'|'inspection';entry_type:'accrual'|'reversal'|'payout';
      amount_kopecks:string|number;request_id:string;note:string|null;created_at:string
    }>(`select id,kind,entry_type,amount_kopecks::text as amount_kopecks,request_id,note,created_at
        from partner_finance_entries where partner_id=$1 order by created_at desc limit 200`,[user.id]);
    // Aggregate over the full ledger, not just the last 200 rows shown in history.
    const totals=await this.db.query<{kind:string;accrued:string;paid:string;balance:string}>(`
      select kind,
        coalesce(sum(case when entry_type='accrual' then amount_kopecks
                          when entry_type='reversal' then -amount_kopecks else 0 end),0)::text as accrued,
        coalesce(sum(case when entry_type='payout' then amount_kopecks else 0 end),0)::text as paid,
        coalesce(sum(case when entry_type='accrual' then amount_kopecks
                          else -amount_kopecks end),0)::text as balance
      from partner_finance_entries where partner_id=$1 group by kind`,[user.id]);
    return {entries,totals};
  }
}
