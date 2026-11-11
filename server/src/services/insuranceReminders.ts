import type { Db } from '../db/index.ts';
import type { Notifier } from './notify.ts';

const windows = [
  { days: 30, column: 'reminder_30_sent_at' },
  { days: 7, column: 'reminder_7_sent_at' },
  { days: 1, column: 'reminder_1_sent_at' },
] as const;

/** Claim reminders atomically; release a claim if notification persistence fails. */
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
      const claimed = await db.one<{ claimed_at: Date }>(
        `update vehicle_service_requests set ${column}=now()
         where id=$1 and ${column} is null and policy_expires_on=current_date + $2::int
         returning ${column} as claimed_at`, [item.id, days]);
      if (!claimed) continue;
      try {
        await notifier.notify([item.owner_id], { type: 'insurance_expiry', requestId: item.id, days },
          { kind: 'normal', title: 'Срок страховки', body: `Страховка автомобиля ${item.plate || ''} заканчивается через ${days} дн. (${item.policy_expires_on}).`,
            data: { requestId: item.id, days: String(days) } });
      } catch (error) {
        // Never leave a failed notification permanently marked as sent.
        // Only release our own claim, not a newer one or a renewed policy's reminder.
        await db.one(
          `update vehicle_service_requests set ${column}=null
           where id=$1 and ${column}=$2 and policy_expires_on=$3::date
           returning id`,
          [item.id, claimed.claimed_at, item.policy_expires_on],
        );
        throw error;
      }
    }
  }
}
