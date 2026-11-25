import type {Db} from '../db/index.ts';
import type {Notifier} from './notify.ts';

const messages:Record<string,string>={
  requested:'Получено предложение времени. Оно ещё не подтверждено.',
  performer_selected:'Мастер предложил время. Требуется подтверждение клиента.',
  client_confirmed:'Время согласовано обеими сторонами.',
  move_client_requested:'Запрошен перенос. Исходная запись пока сохранена.',
  move_performer_selected:'Предложено новое время. Исходная запись пока сохранена.',
  move_confirmed:'Новое время согласовано обеими сторонами.',
  move_withdrawn:'Предложение переноса отозвано. Исходная запись сохранена.',
  cancelled:'Запись отменена.',
  proposal_expired:'Время неподтверждённого предложения истекло. Новая запись требует согласования.',
  move_expired:'Предложение переноса истекло. Исходная запись не отменена.',
  review_required:'Согласованный интервал закончился. Проверьте фактическое состояние записи; выполнение не подтверждено.',
};
type Alert={
  eventId:string;reservationId:string;userId:string;version:number;
  currentVersion:number;eventType:string;eventMatches:boolean;recipientAllowed:boolean;expired:boolean;
};
const title='Обновление записи';

/**
 * Internal draft worker, deliberately NOT registered in production tick.
 * Persist inbox and acknowledge intent in one DB transaction. External
 * delivery after commit is best effort, with no precise time, address,
 * cancellation reason, phone or vehicle information in push.
 * When planned-order routes are added, replace the unlinked-only ACL with
 * the same live owner/driver/vehicle checks as those routes.
 */
export class ReservationAlerts {
  constructor(private db:Db,private notifier:Pick<Notifier,'deliverStored'>,private now:()=>Date){}
  async flush(limit=50):Promise<number>{
    const bounded=Number.isFinite(limit)?Math.min(100,Math.max(1,Math.trunc(limit))):50;
    const stored=await this.db.tx(async q=>{
      const rows=await q.query<Alert>(`select
        a.event_id::text as "eventId",a.reservation_id as "reservationId",a.user_id as "userId",
        a.agreement_version as version,r.agreement_version as "currentVersion",
        e.event_type as "eventType",
        (e.reservation_id=r.id and (
         ((e.actor_id=r.client_id and a.user_id=r.performer_id) or
          (e.actor_id=r.performer_id and a.user_id=r.client_id))
         or (e.actor_id is null and e.event_type in ('proposal_expired','move_expired','review_required')
          and a.user_id in (r.client_id,r.performer_id)))) as "eventMatches",
        (r.order_id is null and u.status='active' and u.deleted_at is null and
          ((a.user_id=r.client_id and 'client'=any(u.roles) and u.owner_id is null
             and not ('driver'=any(u.roles)))
           or (a.user_id=r.performer_id and ('master'=any(u.roles) or 'tow'=any(u.roles))))) as "recipientAllowed",
        ((r.status in ('proposed','selected') and r.starts_at<=$2)
          or (r.move_state is not null and r.move_starts_at<=$2)) as expired
        from performer_reservation_alerts a
        join performer_time_reservations r on r.id=a.reservation_id
        join performer_time_reservation_events e on e.id=a.event_id
        join users u on u.id=a.user_id
        where a.handled_at is null
        order by a.created_at,a.event_id,a.user_id limit $1
        for update of a,r skip locked`,[bounded,this.now()]);
      const result:{eventId:string;reservationId:string;userId:string;body:string;version:number}[]=[];
      for(const row of rows){
        const body=Object.hasOwn(messages,row.eventType)?messages[row.eventType]:undefined;
        const current=!!body&&row.eventMatches===true&&row.recipientAllowed===true&&
          row.version===row.currentVersion&&row.expired===false;
        if(current&&body){
          // No user-supplied strings or private request contents in inbox.
          const data=JSON.stringify({reservationId:row.reservationId,eventId:row.eventId,version:row.version});
          await q.query(`insert into notifications(user_id,kind,title,body,data)
            values($1,'reservation',$2,$3,$4::jsonb)`,[row.userId,title,body,data]);
          result.push({eventId:row.eventId,reservationId:row.reservationId,userId:row.userId,body,version:row.version});
        }
        await q.query(`update performer_reservation_alerts set handled_at=$3,outcome=$4
          where event_id=$1::bigint and user_id=$2`,[row.eventId,row.userId,this.now(),current?'stored':'obsolete']);
      }
      return result;
    });
    for(const item of stored){
      // The inbox is already durable. Send only generic invalidation via
      // realtime/push, since state can change again after COMMIT.
      await this.notifier.deliverStored([item.userId],{type:'reservation',reservationId:item.reservationId,version:item.version},
        {kind:'normal',title,body:'Статус записи изменился. Проверьте актуальное состояние в кабинете.',
          data:{reservationId:item.reservationId,eventId:item.eventId}})
        .catch(()=>console.warn('[reservation alert] best-effort delivery failed'));
    }
    return stored.length;
  }
}
