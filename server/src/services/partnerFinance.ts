import type {Db} from '../db/index.ts';
import type {AuthUser} from '../http/router.ts';
import {forbidden} from '../http/router.ts';

export class PartnerFinance {
  constructor(private db:Db){}
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
