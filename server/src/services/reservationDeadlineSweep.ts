import type {Db,Queryable} from '../db/index.ts';

type Row={id:string;client_id:string;performer_id:string;status:string;agreement_version:number;
  starts_at:Date|string;ends_at:Date|string;move_state:string|null;move_starts_at:Date|string|null;
  move_ends_at:Date|string|null;review_required_at:Date|string|null};
type Due='proposal_expired'|'move_expired'|'review_required';
const expired=(value:Date|string|null,now:Date)=>value!==null&&new Date(value)<=now;

/** Internal, unlinked draft only. No live order or financial side effects.
 * Lock each negotiation row and never wait for another worker's row.
 * Confirmation/transfer operations serialize on that same row; this sweep
 * does not create or extend any reserved span. A failed audit/outbox write
 * rolls back the entire batch. Not registered in the production scheduler.
 */
export class ReservationDeadlineSweep {
  constructor(private db:Db,private now:()=>Date){}
  private async record(q:Queryable,old:Row,next:Row,type:Due,now:Date){
    const details=JSON.stringify({version:next.agreement_version,observedAt:now,
      originalStart:old.starts_at,originalEnd:old.ends_at,
      pendingStart:old.move_starts_at,pendingEnd:old.move_ends_at});
    const e=await q.one<{id:string}>(`insert into performer_time_reservation_events
      (reservation_id,actor_id,event_type,before_status,after_status,details)
      values($1,null,$2,$3,$4,$5::jsonb) returning id::text as id`,[old.id,type,old.status,next.status,details]);
    if(!e)throw new Error('Deadline event missing');
    await q.query(`insert into performer_reservation_alerts(event_id,reservation_id,user_id,agreement_version)
      select $1::bigint,$2,recipient,$3 from (select distinct unnest($4::uuid[]) as recipient) recipients`,
      [e.id,old.id,next.agreement_version,[old.client_id,old.performer_id]]);
  }
  async sweep(limit=50):Promise<{expiredProposals:number;expiredMoves:number;reviewRequired:number}>{
    const bounded=Number.isFinite(limit)?Math.min(100,Math.max(1,Math.trunc(limit))):50;
    const now=this.now();
    return this.db.tx(async q=>{
      const rows=await q.query<Row>(`select * from performer_time_reservations
        where agreement_version>0 and order_id is null and (
          (status in ('proposed','selected') and starts_at<=$1) or
          (status='confirmed' and move_state is not null and
            (move_starts_at<=$1 or starts_at<=$1)) or
          (status='confirmed' and ends_at<=$1 and review_required_at is null))
        order by least(starts_at,coalesce(move_starts_at,starts_at)),id
        limit $2 for update skip locked`,[now,bounded]);
      const counts={expiredProposals:0,expiredMoves:0,reviewRequired:0};
      for(const row of rows){
        let type:Due;let next:Row|null;
        if((row.status==='proposed'||row.status==='selected')&&expired(row.starts_at,now)){
          type='proposal_expired';
          next=await q.one<Row>(`update performer_time_reservations set status='cancelled',
            cancelled_at=$2,cancellation_reason='Истекло время неподтверждённого предложения',
            updated_at=$2,agreement_version=agreement_version+1 where id=$1 returning *`,[row.id,now]);
          counts.expiredProposals++;
        }else if(row.status==='confirmed'&&row.review_required_at===null&&expired(row.ends_at,now)){
          // An overdue confirmed slot requires human review. Never set a
          // work/payment/completion status on the basis of a clock.
          // Clear any pending move that can no longer be confirmed.
          type='review_required';
          next=await q.one<Row>(`update performer_time_reservations set review_required_at=$2,
            move_state=null,move_starts_at=null,move_ends_at=null,move_actor_id=null,
            updated_at=$2,agreement_version=agreement_version+1 where id=$1 returning *`,[row.id,now]);
          counts.reviewRequired++;
        }else if(row.status==='confirmed'&&row.move_state&&
          (expired(row.move_starts_at,now)||expired(row.starts_at,now))){
          type='move_expired';
          next=await q.one<Row>(`update performer_time_reservations set
            move_state=null,move_starts_at=null,move_ends_at=null,move_actor_id=null,
            updated_at=$2,agreement_version=agreement_version+1 where id=$1 returning *`,[row.id,now]);
          counts.expiredMoves++;
        }else continue;
        if(!next)throw new Error('Deadline update missing');
        await this.record(q,row,next,type,now);
      }
      return counts;
    });
  }
}
