import type { Db } from '../db/index.ts';
import type { Notifier } from './notify.ts';

const windows = [
  { days: 30, column: 'reminder_30_sent_at' },
  { days: 7, column: 'reminder_7_sent_at' },
  { days: 1, column: 'reminder_1_sent_at' },
] as const;

/** Run daily; atomically claim each reminder before publishing it. */
export async function sendInsuranceReminders(db: Db, notifier: Notifier) {
  for (const { days, column } of windows) {
    const due = await db.query<{ id: string; owner_id: string; plate: string | null; policy_expires_on: string }>(
      `select r.id, r.owner_id, v.plate, r.policy_expires_on::text
         from vehicle_service_requests r
         join vehicles v on v.id=r.vehicle_id
         join users u on u.id=r.owner_id
        where r.kind='insurance' and r.status='completed'
          and u.insurance_reminders_enabled=true
          and r.${column} is null
          and r.policy_expires_on=current_date + $1::int
        limit 500`, [days]);
    for (const item of due) {
      const claimed = await db.one(
        `update vehicle_service_requests set ${column}=now()
         where id=$1 and ${column} is null and policy_expires_on=current_date + $2::int
         returning id`, [item.id, days]);
      if (!claimed) continue;
      await notifier.notify([item.owner_id], { type: 'insurance_expiry', requestId: item.id, days },
        { title: 'Срок страховки', body: `Страховка автомобиля ${item.plate || ''} заканчивается через ${days} дн. (${item.policy_expires_on}).`,
          data: { requestId: item.id, days: String(days) } });
    }
  }
}
