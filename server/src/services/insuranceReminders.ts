import type { Db } from '../db/index.ts';
import type { Notifier } from './notify.ts';

const windows = [
  { days: 30, column: 'reminder_30_sent_at' },
  { days: 7, column: 'reminder_7_sent_at' },
  { days: 1, column: 'reminder_1_sent_at' },
] as const;

/** The reminder marker and durable inbox must commit together. */
export async function sendInsuranceReminders(db: Db, notifier: Notifier) {
  for (const { days, column } of windows) {
    let cursor: string | null = null;
    for (;;) {
      const due: Array<{ id: string; owner_id: string }> = await db.query(
        `select r.id, r.owner_id
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
        const stored = await db.tx(async q => {
          // Recheck the current policy, ownership, consent and plate under
          // locks. A concurrent renewal, opt-out or scheduler must serialize.
          const current = await q.one<{owner_id:string;plate:string|null;policy_expires_on:string}>(
            `select r.owner_id, v.plate, r.policy_expires_on::text
               from vehicle_service_requests r
               join vehicles v on v.id=r.vehicle_id and v.owner_id=r.owner_id
               join users u on u.id=r.owner_id
              where r.id=$1 and r.owner_id=$3::uuid and r.kind='insurance'
                and r.status='completed' and r.${column} is null
                and r.policy_expires_on=current_date + $2::int
                and u.insurance_reminders_enabled=true
              for update of r for share of v,u`, [item.id,days,item.owner_id]);
          if (!current) return null;
          const message = {
            kind: 'normal' as const, title: 'Срок страховки',
            body: `Страховка автомобиля ${current.plate || ''} заканчивается через ${days} дн. (${current.policy_expires_on}).`,
            data: {requestId:item.id,days:String(days)},
          };
          await q.query(`update vehicle_service_requests set ${column}=now() where id=$1`,[item.id]);
          await q.query(
            'insert into notifications(user_id,kind,title,body,data) values ($1,$2,$3,$4,$5)',
            [current.owner_id,'insurance_expiry',message.title,message.body,message.data]);
          return {ownerId:current.owner_id,message};
        });
        if (!stored) continue;
        // No network work in the transaction. If the process stops here,
        // the inbox and marker already agree; a retry cannot duplicate it.
        try {
          await notifier.deliverStored([stored.ownerId],
            {type:'insurance_expiry',requestId:item.id,days},stored.message);
        } catch (error) {
          console.warn('[insurance reminder delivery]',error instanceof Error?error.message:String(error));
        }
      }
      if(due.length<500)break;
      cursor=due[due.length-1].id;
    }
  }
}
