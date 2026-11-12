// Admin control of unmet demand, alerts to workers, and scheduled commission campaigns.
// All demand figures are derived from the original orders, including closed ones.
import type { Db } from '../db/index.ts';
import type { AuthUser } from '../http/router.ts';
import { bad, notFound } from '../http/router.ts';

const SERVICES = ['electric','diag','air','autonomy','tyre','tow','consult','ecu'] as const;
const AUDIENCES = ['master','tow','service','all_workers'] as const;
export type Audience = typeof AUDIENCES[number];

export class OpsService {
  constructor(private db: Db, private now: () => Date = () => new Date()) {}

  async demand(days = 7, waitMinutes = 15) {
    const since = new Date(this.now().getTime() - Math.min(365, Math.max(1, days)) * 86_400_000);
    const [summary, hourly, byService, incidents] = await Promise.all([
      this.db.one<any>(`select count(*)::int as total,
          count(*) filter (where status='completed')::int as completed,
          count(*) filter (where status='no_performer')::int as unfilled,
          count(*) filter (where status='cancelled' and accepted_at is null)::int as cancelled_before_acceptance,
          count(*) filter (where status='searching' and created_at < $2::timestamptz - $3::int * interval '1 minute')::int as waiting_now,
          count(*) filter (where accepted_at is not null and accepted_at > created_at + $3::int * interval '1 minute')::int as accepted_late,
          count(*) filter (where accepted_at is null and status='no_performer')::int as never_accepted,
          round(avg(extract(epoch from accepted_at-created_at))/60.0,1) filter (where accepted_at is not null) as average_accept_minutes
        from orders where created_at >= $1`,
        [since, this.now(), waitMinutes]),
      this.db.query<any>(`select extract(hour from created_at at time zone 'Europe/Moscow')::int as hour,
          count(*)::int as total,
          count(*) filter (where status='no_performer')::int as unfilled,
          count(*) filter (where status='cancelled' and accepted_at is null)::int as cancelled_before_acceptance,
          count(*) filter (where status='searching' and created_at < $2::timestamptz - $3::int * interval '1 minute')::int as waiting_now,
          count(*) filter (where accepted_at > created_at + $3::int * interval '1 minute')::int as accepted_late
        from orders where created_at >= $1
        group by 1 order by 1`, [since, this.now(), waitMinutes]),
      this.db.query<any>(`select service,
          count(*)::int as total,
          count(*) filter (where status='completed')::int as completed,
          count(*) filter (where status='no_performer')::int as unfilled,
          count(*) filter (where status='cancelled' and accepted_at is null)::int as cancelled_before_acceptance,
          count(*) filter (where status='searching' and created_at < $2::timestamptz - $3::int * interval '1 minute')::int as waiting_now,
          count(*) filter (where accepted_at > created_at + $3::int * interval '1 minute')::int as accepted_late
        from orders where created_at >= $1 group by service order by unfilled desc, total desc`,
        [since, this.now(), waitMinutes]),
      this.db.query<any>(`select o.id, o.number, o.service, o.status, o.is_sos, o.zone_id,
          o.address, o.created_at, o.accepted_at, o.cancelled_at, o.cancel_reason,
          extract(epoch from (coalesce(o.accepted_at,o.cancelled_at,$2::timestamptz)-o.created_at))/60.0 as elapsed_minutes,
          r.state as review_state, r.note as review_note, r.reviewed_at
        from orders o left join order_ops_reviews r on r.order_id=o.id
        where o.created_at >= $1
          and (o.status='no_performer'
            or (o.status='cancelled' and o.accepted_at is null)
            or (o.status='searching' and o.created_at < $2::timestamptz - $3::int * interval '1 minute')
            or o.accepted_at > o.created_at + $3::int * interval '1 minute')
        order by case when o.status='searching' then 0 when o.status='no_performer' then 1 else 2 end,
          o.is_sos desc, o.created_at desc limit 250`,
        [since, this.now(), waitMinutes]),
    ]);
    return { days, waitMinutes, timezone: 'Europe/Moscow', summary, hourly, byService, incidents };
  }

  async review(actor: AuthUser, orderId: string, state: 'open' | 'investigating' | 'resolved', note: string) {
    const result = await this.db.tx(async q => {
      const o = await q.one<{ id: string }>('select id from orders where id=$1', [orderId]);
      if (!o) throw notFound('Заявка не найдена');
      await q.query(`insert into order_ops_reviews(order_id,state,note,reviewed_by)
        values ($1,$2,$3,$4) on conflict (order_id) do update set
          state=excluded.state,note=excluded.note,reviewed_by=excluded.reviewed_by,reviewed_at=now()`,
        [orderId,state,note,actor.id]);
      await q.query(`insert into audit_log(actor_id,action,target,data)
        values ($1,'ops.review',$2,$3)`,[actor.id,orderId,{state,note}]);
      return {ok:true, orderId, state, note};
    });
    return result;
  }

  async announcements(audience?: Audience, includeHistory = false, service?: string) {
    const rows = await this.db.query<any>(`select id,audience,service,title,body,starts_at,ends_at,published,created_at
      from worker_announcements
      where ($1::boolean or (published=true and starts_at <= $2 and ends_at > $2))
        and ($3::text is null or audience in ($3,'all_workers'))
        and ($4::text is null or service is null or service=$4)
      order by created_at desc limit 100`,
      [includeHistory,this.now(),audience??null,service??null]);
    return rows;
  }

  async publish(actor: AuthUser,p: {
    audience:Audience; service?:string|null; title:string;body:string;
    startsAt:string;endsAt:string;published:boolean;
  }) {
    if (!AUDIENCES.includes(p.audience)) throw bad('bad_audience','Неизвестная аудитория');
    if (p.service && !SERVICES.includes(p.service as any)) throw bad('bad_service','Неизвестный тип услуги');
    const start = new Date(p.startsAt), end = new Date(p.endsAt);
    if (!Number.isFinite(+start)||!Number.isFinite(+end)||end<=start) throw bad('bad_dates','Проверьте даты');
    if (end.getTime()-start.getTime()>90*86_400_000) throw bad('too_long','Объявление не длиннее 90 дней');
    return this.db.tx(async q => {
      const row=await q.one<any>(`insert into worker_announcements(audience,service,title,body,starts_at,ends_at,published,created_by)
        values ($1,$2,$3,$4,$5,$6,$7,$8) returning id,audience,service,title,body,starts_at,ends_at,published`,
        [p.audience,p.service??null,p.title,p.body,start,end,p.published,actor.id]);
      await q.query(`insert into audit_log(actor_id,action,target,data) values($1,'ops.announcement',$2,$3)`,
        [actor.id,row.id,{audience:p.audience,service:p.service,published:p.published,startsAt:p.startsAt,endsAt:p.endsAt}]);
      return row;
    });
  }

  async setAnnouncementPublished(actor:AuthUser,id:string,published:boolean) {
    return this.db.tx(async q=>{
      const row=await q.one<any>(`update worker_announcements set published=$2,updated_at=now()
        where id=$1 returning id,published,title`,[id,published]);
      if(!row)throw notFound('Объявление не найдено');
      await q.query(`insert into audit_log(actor_id,action,target,data) values ($1,'ops.announcement.status',$2,$3)`,
        [actor.id,id,{published}]);
      return row;
    });
  }

  async setCampaignEnabled(actor:AuthUser,id:string,enabled:boolean) {
    return this.db.tx(async q=>{
      await q.query(`select pg_advisory_xact_lock(hashtext('commission-campaigns'))`);
      const campaign=await q.one<any>(`select id,service,starts_at,ends_at,enabled
        from commission_campaigns where id=$1 for update`,[id]);
      if(!campaign)throw notFound('Акция не найдена');
      if(enabled){
        const clash=await q.one<{id:string}>(`select id from commission_campaigns
          where id<>$1 and enabled and starts_at<$3 and ends_at>$2
            and (service=$4 or service is null or $4::text is null) limit 1`,
          [id,campaign.starts_at,campaign.ends_at,campaign.service]);
        if(clash)throw bad('campaign_overlap','Временные интервалы акций пересекаются');
        if(new Date(campaign.ends_at)<=this.now())throw bad('expired','Истёкшую акцию включать нельзя');
      }
      const row=await q.one<any>(`update commission_campaigns set enabled=$2,updated_at=now()
        where id=$1 returning id,enabled,service,commission_pct::float as commission_pct`,[id,enabled]);
      await q.query(`insert into audit_log(actor_id,action,target,data) values ($1,'ops.campaign.status',$2,$3)`,
        [actor.id,id,{enabled}]);
      return row;
    });
  }

  async activeCampaigns() {
    return this.db.query<any>(`select id,service,commission_pct::float as commission_pct,
      starts_at,ends_at,reason from commission_campaigns
      where enabled and starts_at <= $1 and ends_at > $1
      order by commission_pct,ends_at limit 25`,[this.now()]);
  }

  async campaigns() {
    return this.db.query<any>(`select id,service,commission_pct::float as commission_pct,
      starts_at,ends_at,enabled,reason,created_at from commission_campaigns order by created_at desc limit 100`);
  }

  async campaign(actor:AuthUser,p:{
    service?:string|null;commissionPct:number;startsAt:string;endsAt:string;enabled:boolean;reason:string;
  }) {
    if(p.service&&!SERVICES.includes(p.service as any)) throw bad('bad_service','Неизвестная услуга');
    const start=new Date(p.startsAt),end=new Date(p.endsAt);
    if(!Number.isFinite(+start)||!Number.isFinite(+end)||end<=start) throw bad('bad_dates','Проверьте даты');
    if(end.getTime()-start.getTime()>31*86_400_000) throw bad('too_long','Акция не длиннее 31 дня');
    if(start.getTime()<this.now().getTime()-60_000) throw bad('past','Акцию нельзя назначить задним числом');
    return this.db.tx(async q=>{
      // Explicit overlap prevention: no ambiguous competing discounts for same service.
      await q.query(`select pg_advisory_xact_lock(hashtext('commission-campaigns'))`);
      if(p.enabled){
        const clash=await q.one<{id:string}>(`select id from commission_campaigns
          where enabled and starts_at<$2 and ends_at>$1 and
          (service=$3 or service is null or $3::text is null) limit 1`,[start,end,p.service??null]);
        if(clash)throw bad('campaign_overlap','На это время уже назначена акция по комиссии');
      }
      const row=await q.one<any>(`insert into commission_campaigns(service,commission_pct,starts_at,ends_at,enabled,reason,created_by)
        values($1,$2,$3,$4,$5,$6,$7) returning id,service,commission_pct::float as commission_pct,starts_at,ends_at,enabled,reason`,
        [p.service??null,p.commissionPct,start,end,p.enabled,p.reason,actor.id]);
      await q.query(`insert into audit_log(actor_id,action,target,data) values($1,'ops.campaign',$2,$3)`,
        [actor.id,row.id,row]);
      return row;
    });
  }

  /** Called at order creation. Only dispatch work; consultations have their own fee. */
  async commissionFor(service:string, at:Date) {
    if(service==='consult')return null;
    return this.db.one<{id:string;commission_pct:number}>(`select id,commission_pct::float as commission_pct
      from commission_campaigns where enabled and starts_at <= $1 and ends_at > $1
      and (service=$2 or service is null)
      order by (service is not null) desc,starts_at desc limit 1`,[at,service]);
  }
}
