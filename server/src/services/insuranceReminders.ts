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
    // Cursor paging avoids permanently skipping reminders beyond the first
    // 500 policies due on a single date. UUID ordering is stable and bounded.
    let cursor: string | null = null;
    for (;;) {
      const due: Array<{ id: string; owner_id: string; plate: string | null; policy_expires_on: string }> = await db.query<{ id: string; owner_id: string; plate: string | null; policy_expires_on: string }>(
        `select r.id, r.owner_id, v.plate, r.policy_expires_on::text
           from vehicle_service_requests r
           join vehicles v on v.id=r.vehicle_id and v.owner_id=r.owner_id
           join users u on u.id=r.owner_id
          where r.kind='insurance' and r.status='completed'
            and u.insurance_reminders_enabled=true
            and r.${column} is null
            and r.policy_expires_on=current_date + $1::int
            and ($2::uuid is null or r.id>$2::uuid)
          order by r.id limit 500`, [days,cursor]);
      for (const item of due) {
        // The selection above is only a hint: consent, status, ownership and
        // policy expiry can change before an UPDATE gets its row lock.
        const claimed = await db.one<{ claimed_at: Date }>(
          `update vehicle_service_requests r set ${column}=now()
           where r.id=$1 and r.owner_id=$3::uuid and r.kind='insurance'
             and r.status='completed' and r.${column} is null
             and r.policy_expires_on=current_date + $2::int
             and exists (
               select 1 from vehicles v join users u on u.id=r.owner_id
                where v.id=r.vehicle_id and v.owner_id=r.owner_id
                  and u.insurance_reminders_enabled=true
             )
           returning r.${column} as claimed_at`, [item.id,days,item.owner_id]);
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
      if(due.length<500)break;
      cursor=due[due.length-1].id;
    }
  }
}
