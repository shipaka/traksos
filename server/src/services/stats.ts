// Статистика площадки для админа: то, по чему проверяются цели первых трёх месяцев из плана запуска.
// Все суммы — копейки; периоды — по московскому времени.

import type { Db } from '../db/index.ts';

const TZ = `'Europe/Moscow'`;

export class StatsService {
  constructor(private db: Db, private now: () => Date) {}

  /** Короткая сводка «Сейчас в ТракSOS» — видят все: сколько исполнителей на линии и заявок за сутки */
  async live() {
    const since = new Date(this.now().getTime() - 86_400_000);
    return this.db.one(
      `select (select count(*)::int from performer_profiles where kind='master' and verification='approved' and line_status in ('online','on_call','on_job')) as masters_online,
              (select count(*)::int from performer_profiles where kind='tow' and verification='approved' and line_status in ('online','on_call','on_job')) as tow_online,
              (select count(*)::int from orders where created_at >= $1) as orders_24h,
              (select count(*)::int from orders where status in ('accepted','en_route','arrived','working','awaiting_confirmation')) as in_work,
              (select count(*)::int from orders where status='completed' and completed_at >= $1) as done_24h`, [since]);
  }

  async overview(days = 30) {
    const since = new Date(this.now().getTime() - days * 86_400_000);
    const p = [since];
    const [totals, byDay, byService, cancels, speed, money, people, top, repeat, zones, brands] = await Promise.all([
      this.db.one(
        `select count(*)::int as created,
                count(*) filter (where status='completed')::int as completed,
                count(*) filter (where status='cancelled')::int as cancelled,
                count(*) filter (where status='no_performer')::int as no_performer,
                count(*) filter (where status in ('searching','accepted','en_route','arrived','working','awaiting_confirmation'))::int as active,
                count(*) filter (where is_sos)::int as sos,
                count(*) filter (where night)::int as night
           from orders where created_at >= $1`, p),
      this.db.query(
        `select to_char(date_trunc('day', created_at at time zone ${TZ}), 'YYYY-MM-DD') as day,
                count(*)::int as created, count(*) filter (where status='completed')::int as completed,
                count(*) filter (where status='no_performer')::int as no_performer
           from orders where created_at >= $1 group by 1 order by 1`, p),
      this.db.query(
        `select service, count(*)::int as created, count(*) filter (where status='completed')::int as completed,
                coalesce(avg(coalesce(call_out_amount,0) + coalesce(work_amount,0)) filter (where status='completed'), 0)::int as avg_check
           from orders where created_at >= $1 group by service order by created desc`, p),
      this.db.query(
        `select coalesce(cancel_stage, 'searching') as stage, count(*)::int as n from orders
          where status='cancelled' and created_at >= $1 group by 1 order by n desc`, p),
      this.db.one(
        `select percentile_cont(0.5) within group (order by extract(epoch from accepted_at - created_at)) filter (where accepted_at is not null) as accept_median_s,
                percentile_cont(0.5) within group (order by extract(epoch from arrived_at - accepted_at)) filter (where arrived_at is not null) as arrive_median_s,
                count(*) filter (where accepted_at - created_at <= interval '5 minutes')::int as accepted_5min,
                count(*) filter (where accepted_at is not null)::int as accepted
           from orders where created_at >= $1`, p),
      this.db.one(
        `select coalesce(sum(amount) filter (where account='platform'), 0)::int as platform_income,
                coalesce(sum(amount) filter (where account='platform' and kind in ('refund','adjustment')), 0)::int as platform_costs,
                coalesce(-sum(amount) filter (where account='client' and kind='payment'), 0)::int as online_turnover,
                coalesce(sum(amount) filter (where account='client' and kind='refund'), 0)::int as refunds
           from ledger_entries where created_at >= $1`, p),
      this.db.one(
        `select (select count(*)::int from users where created_at >= $1) as new_users,
                (select count(*)::int from performer_profiles where verification='approved') as performers_approved,
                (select count(*)::int from performer_profiles where line_status in ('online','on_call','on_job')) as performers_online,
                (select count(*)::int from performer_profiles where verification='pending' and submitted_at is not null) as verification_queue,
                (select count(*)::int from users where company_inn is not null) as companies,
                (select count(*)::int from support_tickets where status='open') as support_open`, p),
      this.db.query(
        `select u.id, u.name, u.rating::float as rating, count(*)::int as completed,
                coalesce(sum(coalesce(o.call_out_amount,0) + coalesce(o.work_amount,0)), 0)::int as turnover
           from orders o join users u on u.id=o.performer_id
          where o.status='completed' and o.completed_at >= $1 group by u.id order by completed desc limit 10`, p),
      this.db.one(
        `with c as (select client_id, count(*) n from orders where status='completed' group by client_id)
         select count(*)::int as clients, count(*) filter (where n >= 2)::int as returned from c
          where client_id in (select client_id from orders where status='completed' and completed_at >= $1)`, p),
      this.db.query(
        `select zone_id, count(*)::int as created, count(*) filter (where status='no_performer')::int as no_performer
           from orders where created_at >= $1 group by zone_id order by created desc`, p),
      // Спрос по маркам и моделям: какие машины чаще ломаются и кого из мастеров не хватает
      this.db.query(
        `select coalesce(brand, 'не указана') as brand, coalesce(model, '') as model, count(*)::int as created,
                count(*) filter (where status='no_performer')::int as no_performer, round(avg(year))::int as avg_year
           from orders where created_at >= $1 group by 1, 2 order by created desc limit 30`, p),
    ]);
    const t = totals!;
    const closed = t.completed + t.cancelled + t.no_performer;
    return {
      days, since,
      totals: t,
      rates: {
        completion: closed ? round(t.completed / closed) : null,
        noPerformer: t.created ? round(t.no_performer / t.created) : null,
        accepted5min: speed!.accepted ? round(speed!.accepted_5min / speed!.accepted) : null,
        repeat: repeat!.clients ? round(repeat!.returned / repeat!.clients) : null,
      },
      speed: {
        acceptMedianMin: speed!.accept_median_s == null ? null : Math.round(Number(speed!.accept_median_s) / 6) / 10,
        arriveMedianMin: speed!.arrive_median_s == null ? null : Math.round(Number(speed!.arrive_median_s) / 60),
      },
      money: money!, people: people!, byDay, byService, cancels, top, zones, brands,
    };
  }

  /** Сводка для админа: сегодня, деньги за месяц, работа, качество */
  async summary() {
    const now = this.now();
    const msk = new Date(now.getTime() + 3 * 3600_000);
    const dayStart = new Date(Date.UTC(msk.getUTCFullYear(), msk.getUTCMonth(), msk.getUTCDate()) - 3 * 3600_000);
    const monthStart = new Date(Date.UTC(msk.getUTCFullYear(), msk.getUTCMonth(), 1) - 3 * 3600_000);
    const r = await this.db.one<any>(
      `select (select count(*)::int from orders where created_at >= $1) as orders_today,
              (select count(*)::int from performer_profiles where kind<>'tow' and verification='approved' and line_status in ('online','on_call','on_job')) as masters_online,
              (select count(*)::int from performer_profiles where kind='tow' and verification='approved' and line_status in ('online','on_call','on_job')) as tow_online,
              (select count(*)::int from mod_cases where status='open' and kind='dispute') as disputes_open,
              (select count(*)::int from mod_cases where status='open') as mod_open,
              (select count(*)::int from support_tickets where status='open') as support_open,
              (select coalesce(sum(total - refunded_amount), 0)::int from payments where status in ('captured','partially_refunded') and updated_at >= $2) as paid_month,
              (select coalesce(sum(amount), 0)::int from ledger_entries where account='platform' and created_at >= $2) as platform_month,
              (select coalesce(sum(b), 0)::int from (select sum(amount) as b from ledger_entries where account='performer' group by performer_id) x where b > 0) as to_payout,
              (select coalesce(sum(total), 0)::int from payments where status='held') as frozen,
              (select count(*)::int from orders where status='awaiting_confirmation') as awaiting_confirmation,
              (select coalesce(sum(d), 0)::int from (select -sum(amount) as d from ledger_entries where kind in ('cash_commission','cash_commission_paid') group by performer_id) x where d > 0) as cash_debts,
              (select percentile_cont(0.5) within group (order by extract(epoch from arrived_at - accepted_at)) from orders where arrived_at is not null and created_at >= $2) as arrive_median_s,
              (select count(*)::int from orders where service='consult' and status='completed' and created_at >= $2) as consults,
              (select count(distinct consult_of)::int from orders where consult_of is not null and created_at >= $2) as consults_to_visit,
              (select count(*)::int from users where created_at >= $2 and owner_id is null and roles @> '{client}') as new_clients,
              (select count(*)::int from order_events where type='performer_dropped' and created_at >= $2) as drops_month,
              (select count(*)::int from orders where status='completed' and completed_at >= $2) as completed_month,
              (select round(avg(rating)::numeric, 2)::float from users where rating is not null and roles && '{master,tow}') as performers_rating`,
      [dayStart, monthStart]);
    const rep = await this.db.one<{ clients: number; returned: number }>(
      `with c as (select client_id, count(*) n from orders where status='completed' group by client_id)
       select count(*)::int as clients, count(*) filter (where n >= 2)::int as returned from c`);
    return {
      today: { orders: r.orders_today, mastersOnline: r.masters_online, towOnline: r.tow_online, disputesOpen: r.disputes_open, modOpen: r.mod_open, supportOpen: r.support_open },
      money: { paidMonth: r.paid_month, platformMonth: r.platform_month, toPayout: r.to_payout, frozen: r.frozen, awaitingConfirmation: r.awaiting_confirmation, cashDebts: r.cash_debts },
      work: { mastersOnline: r.masters_online, towOnline: r.tow_online, arriveMedianMin: r.arrive_median_s == null ? null : Math.round(Number(r.arrive_median_s) / 60),
        consultToVisit: r.consults ? round(r.consults_to_visit / r.consults) : null, newClients: r.new_clients },
      quality: { disputesOpen: r.disputes_open, dropsMonth: r.drops_month, completedMonth: r.completed_month, performersRating: r.performers_rating,
        repeat: rep?.clients ? round(rep.returned / rep.clients) : null },
    };
  }

  /** Живые заявки с последними событиями */
  async liveOrders() {
    const rows = await this.db.query(
      `select o.id, o.number, o.service, o.status, o.is_sos, o.created_at, o.address, o.estimate->>'zoneName' as zone,
              cl.name as client_name, pf.name as performer_name
         from orders o left join users cl on cl.id=o.client_id left join users pf on pf.id=o.performer_id
        where o.status in ('awaiting_owner','searching','accepted','en_route','arrived','working','awaiting_confirmation')
        order by o.is_sos desc, o.created_at limit 100`);
    const ids = rows.map((r: any) => r.id);
    const ev = ids.length ? await this.db.query<{ order_id: string; type: string; created_at: Date }>(
      `select order_id, type, created_at from (select e.*, row_number() over (partition by order_id order by created_at desc) rn from order_events e where order_id = any($1::uuid[])) x where rn <= 5 order by created_at desc`, [ids]) : [];
    return rows.map((r: any) => ({ ...r, events: ev.filter((e) => e.order_id === r.id).map((e) => ({ type: e.type, at: e.created_at })) }));
  }
}

const round = (x: number) => Math.round(x * 1000) / 1000;
