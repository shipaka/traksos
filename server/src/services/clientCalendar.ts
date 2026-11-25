import type { Db } from '../db/index.ts';
import { bad, forbidden, type AuthUser } from '../http/router.ts';

const DAY = 86400_000;
function dayValue(value: string | null): number {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw bad('bad_calendar_range', 'Укажите даты ГГГГ-ММ-ДД');
  const instant = Date.parse(value + 'T00:00:00Z');
  if (!Number.isFinite(instant) || new Date(instant).toISOString().slice(0, 10) !== value || value < '1900-01-01' || value > '9999-12-30')
    throw bad('bad_calendar_range', 'Укажите существующую дату');
  return instant;
}

/** Read-only customer calendar. No booking or availability is created here.
 * Days are Moscow civil dates; the last requested day is inclusive.
 * Use the same live fleet linkage as the existing customer booking/order lists.
 */
export async function clientCalendar(db: Db, user: AuthUser, from: string | null, to: string | null) {
  if (!user.roles.some(role => role === 'client' || role === 'driver')) throw forbidden();
  const first = dayValue(from), last = dayValue(to);
  if (last < first || last - first >= 62 * DAY) throw bad('bad_calendar_range', 'Выберите период до 62 дней');
  // One statement/snapshot: a revoked driver assignment cannot authorize a subsequent read.
  // No addresses, personal contacts, private notes, prices or performer profiles are returned.
  const items = await db.query(`
    select * from (
      select 'service' as kind, b.id, b.number, b.status, b.need as service,
        b.vehicle_id, b.vehicle->>'brand' as brand, b.vehicle->>'model' as model,
        to_char(b.when_day, 'YYYY-MM-DD') as day, b.when_time as requested_time,
        case when b.status='expected' then b.accept_time else null end as confirmed_time,
        null::timestamptz as starts_at, null::timestamptz as ends_at,
        case when b.status='expected' then 'confirmed'
             when b.status in ('cancelled','declined') then b.status
             else 'pending' end as confirmation,
        null::uuid as order_id, null::text as order_status
      from service_bookings b
      where b.when_day between $2::date and $3::date
        and b.status in ('new','clarify','expected','cancelled','declined')
        and (b.client_id=$1 or (b.created_by=$1 and exists (
          select 1 from users u join vehicles v on v.owner_id=u.owner_id and v.driver_id=u.id
          where u.id=$1 and 'driver'=any(u.roles) and u.owner_id=b.client_id and v.id=b.vehicle_id
        )))
      union all
      select 'roadside' as kind, r.id, o.number, r.status, o.service,
        o.vehicle_id, o.brand, o.model,
        to_char(r.starts_at at time zone 'Europe/Moscow', 'YYYY-MM-DD') as day,
        null::text as requested_time, null::text as confirmed_time,
        r.starts_at, r.ends_at,
        case when r.status='confirmed' then 'confirmed' when r.status in ('cancelled','completed') then r.status else 'pending' end,
        o.id as order_id, o.status as order_status
      from performer_time_reservations r join orders o on o.id=r.order_id and o.client_id=r.client_id
      where r.starts_at < (($3::date + 1)::timestamp at time zone 'Europe/Moscow')
        and r.ends_at > ($2::date::timestamp at time zone 'Europe/Moscow')
        and (o.client_id=$1 or (o.created_by=$1 and exists (
          select 1 from users u join vehicles v on v.owner_id=u.owner_id and v.driver_id=u.id
          where u.id=$1 and 'driver'=any(u.roles) and u.owner_id=o.client_id and v.id=o.vehicle_id
        )))
        -- Do not call a cancelled or otherwise terminal order a live appointment.
        and (r.status in ('cancelled','completed') or o.status not in ('cancelled','completed','no_performer'))
    ) calendar
    order by day, coalesce(confirmed_time, requested_time, ''), starts_at nulls first, kind, id
    limit 501`, [user.id, from, to]);
  return { timezone: 'Europe/Moscow', from, to, items: items.slice(0, 500), truncated: items.length > 500 };
}
