import type { Db, Queryable } from '../db/index.ts';
import { bad, conflict, forbidden, notFound } from '../http/router.ts';
import type { OrdersService } from './orders.ts';

type Span={startsAt:string;endsAt:string};
type Row={
  id:string;client_id:string;performer_id:string;order_id:string|null;
  starts_at:Date|string;ends_at:Date|string;
  requested_starts_at:Date|string|null;requested_ends_at:Date|string|null;
  agreement_version:number;status:string;request_key:string|null;
  selected_by:string|null;decided_by:string|null;
  move_state:'proposed'|'selected'|null;
  move_starts_at:Date|string|null;move_ends_at:Date|string|null;
  move_actor_id:string|null;
};
type Actor={id:string};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function identifier(id:string){
  if(typeof id!=='string'||!uuid.test(id))throw bad('bad_reservation_id','Неверный идентификатор');
}
function instant(value:string){
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/.test(value))
    throw bad('bad_reservation_time','Укажите точное время UTC');
  const d=new Date(value);
  if(!Number.isFinite(d.getTime())||d.toISOString()!==(value.length===20?value.slice(0,-1)+'.000Z':value))
    throw bad('bad_reservation_time','Укажите существующую дату и время');
  return d;
}
function span(input:Span){
  const start=instant(input.startsAt),end=instant(input.endsAt);
  if(end<=start||end.getTime()-start.getTime()>48*3600_000)
    throw bad('bad_reservation_time','Интервал должен быть положительным и не более 48 часов');
  return [start,end] as const;
}
function version(value:number){
  if(!Number.isSafeInteger(value)||value<1)throw bad('bad_reservation_version','Обновите запись');
}
function same(a:Date|string|null,b:Date){return a!==null&&new Date(a).getTime()===b.getTime();}

/**
 * Internal draft only: no HTTP routes, no order assignment, no financial
 * changes. Operates exclusively on managed, unlinked negotiation rows.
 * Future planned-order integration must authorize the real order/vehicle
 * and bind its ID before exposing these operations.
 */
export class ReservationAgreement {
  constructor(private db:Db,private orders:Pick<OrdersService,'busyWith'>,private now:()=>Date){}
  private future(start:Date){
    if(start<=this.now())throw conflict('reservation_expired','Время записи уже наступило');
  }
  private async lockProfile(q:Queryable,id:string){
    const p=await q.one<{kind:string}>('select kind from performer_profiles where user_id=$1 for update',[id]);
    if(!p||!['master','tow'].includes(p.kind))throw forbidden('Нет действующего профиля выездного исполнителя');
    return p;
  }
  private async parties(q:Queryable,clientId:string,performerId:string){
    // The profile lock is also taken by immediate accept/choose. Read
    // current roles and active status, not stale role claims from a token.
    const c=await q.one("select 1 from users where id=$1 and status='active' and 'client'=any(roles) and owner_id is null and not ('driver'=any(roles)) for share",[clientId]);
    const p=await q.one("select 1 from users where id=$1 and status='active' and (('master'=any(roles)) or ('tow'=any(roles))) for share",[performerId]);
    if(!c||!p||clientId===performerId)throw forbidden('Участники записи недоступны');
    const blocked=await q.one(`select 1 from performer_blocks where client_id=$1 and performer_id=$2
      union all select 1 from client_prefs where client_id=$1 and performer_id=$2 and pref='hide' limit 1`,[clientId,performerId]);
    if(blocked)throw forbidden('Исполнитель недоступен для этой записи');
  }
  private async event(q:Queryable,row:Row,actor:string,type:string,before:string|null,details:unknown={}){
    const event=await q.one<{id:string}>(`insert into performer_time_reservation_events
      (reservation_id,actor_id,event_type,before_status,after_status,details)
      values($1,$2,$3,$4,$5,$6::jsonb) returning id::text as id`,[row.id,actor,type,before,row.status,JSON.stringify(details)]);
    if(!event)throw new Error('Reservation event was not persisted');
    // Only the other participant needs a notification. Retries that return
    // the existing version never enqueue another event.
    const recipient=actor===row.client_id?row.performer_id:row.client_id;
    await q.query(`insert into performer_reservation_alerts(event_id,reservation_id,user_id,agreement_version)
      values($1::bigint,$2,$3,$4)`,[event.id,row.id,recipient,row.agreement_version]);
  }
  private async locked<T>(id:string,actor:Actor,side:'client'|'performer'|'either',work:(q:Queryable,row:Row)=>Promise<T>):Promise<T>{
    identifier(id);identifier(actor.id);
    return this.db.tx(async q=>{
      const pre=await q.one<Row>('select * from performer_time_reservations where id=$1',[id]);
      if(!pre||pre.agreement_version===0||pre.order_id!==null)throw notFound('Запись не найдена');
      if((side==='client'&&actor.id!==pre.client_id)||(side==='performer'&&actor.id!==pre.performer_id)||
        (side==='either'&&actor.id!==pre.client_id&&actor.id!==pre.performer_id))throw forbidden();
      await this.lockProfile(q,pre.performer_id);
      const row=await q.one<Row>('select * from performer_time_reservations where id=$1 for update',[id]);
      if(!row||row.order_id!==null||row.agreement_version===0||row.performer_id!==pre.performer_id||row.client_id!==pre.client_id)
        throw conflict('reservation_changed','Обновите запись');
      return work(q,row);
    });
  }
  private changed(row:Row,expected:number){
    if(row.agreement_version!==expected)throw conflict('reservation_changed','Время или статус изменились — обновите запись');
  }
  async request(actor:Actor,performerId:string,input:Span,key:string){
    identifier(actor.id);identifier(performerId);
    if(typeof key!=='string'||! /^[A-Za-z0-9_-]{16,100}$/.test(key))
      throw bad('bad_reservation_key','Нужен ключ повторного запроса');
    const [start,end]=span(input);
    return this.db.tx(async q=>{
      await this.lockProfile(q,performerId);
      await this.parties(q,actor.id,performerId);
      const old=await q.one<Row>('select * from performer_time_reservations where client_id=$1 and request_key=$2',[actor.id,key]);
      const matches=(r:Row)=>r.agreement_version>0&&r.order_id===null&&r.performer_id===performerId&&same(r.requested_starts_at,start)&&same(r.requested_ends_at,end);
      if(old){
        if(!matches(old))throw conflict('reservation_key_reused','Ключ уже использован для другой записи');
        return old;
      }
      this.future(start);
      const row=await q.one<Row>(`insert into performer_time_reservations
        (performer_id,client_id,starts_at,ends_at,requested_starts_at,requested_ends_at,request_key,agreement_version)
        values($1,$2,$3,$4,$3,$4,$5,1)
        on conflict (client_id,request_key) where request_key is not null do nothing returning *`,
        [performerId,actor.id,start,end,key]);
      if(!row){
        const existing=await q.one<Row>('select * from performer_time_reservations where client_id=$1 and request_key=$2',[actor.id,key]);
        if(!existing||!matches(existing))throw conflict('reservation_key_reused','Ключ уже использован для другой записи');
        return existing;
      }
      await this.event(q,row,actor.id,'requested',null,{startsAt:start,endsAt:end});
      return row;
    });
  }
  // Master's explicit acceptance of the offered interval or counteroffer.
  // A changed interval advances the version, invalidating the client's stale UI.
  async select(actor:Actor,id:string,expected:number,input:Span){
    version(expected);const [start,end]=span(input);
    return this.locked(id,actor,'performer',async(q,row)=>{
      await this.parties(q,row.client_id,row.performer_id);
      if(row.status==='selected'&&row.agreement_version===expected+1&&same(row.starts_at,start)&&same(row.ends_at,end))return row;
      this.changed(row,expected);
      if(!['proposed','selected'].includes(row.status))throw conflict('reservation_state','Запись уже изменилась');
      this.future(start);
      const next=(await q.one<Row>(`update performer_time_reservations set status='selected',
        starts_at=$2,ends_at=$3,selected_by=$4,selected_at=$5,updated_at=$5,
        agreement_version=agreement_version+1 where id=$1 returning *`,[id,start,end,actor.id,this.now()]))!;
      await this.event(q,next,actor.id,'performer_selected',row.status,{startsAt:start,endsAt:end});
      return next;
    });
  }
  // Final client confirmation of EXACTLY the version selected by the master.
  async confirm(actor:Actor,id:string,expected:number){
    version(expected);
    try{
      return await this.locked(id,actor,'client',async(q,row)=>{
        await this.parties(q,row.client_id,row.performer_id);
        if(row.status==='confirmed'&&row.agreement_version===expected+1&&row.decided_by===actor.id)return row;
        this.changed(row,expected);
        if(row.status!=='selected'||row.selected_by!==row.performer_id)throw conflict('reservation_state','Мастер ещё не согласовал время');
        this.future(new Date(row.starts_at));
        if(await this.orders.busyWith(q,row.performer_id,null))
          throw conflict('performer_busy','Текущий выезд не завершён; время пока нельзя подтвердить');
        const next=(await q.one<Row>(`update performer_time_reservations set status='confirmed',
          decided_by=$2,decision_at=$3,updated_at=$3,agreement_version=agreement_version+1 where id=$1 returning *`,
          [id,actor.id,this.now()]))!;
        await this.event(q,next,actor.id,'client_confirmed',row.status);
        return next;
      });
    }catch(e){
      if((e as {code?:string})?.code==='23P01')throw conflict('reservation_overlap','Это время уже занято подтверждённой записью');
      throw e;
    }
  }

  // A confirmed reservation stays confirmed, with its original reserved_span,
  // throughout negotiation. Client requests; master selects or counteroffers;
  // master may also initiate a selected proposal. Neither action moves the slot.
  async proposeMove(actor:Actor,id:string,expected:number,input:Span){
    version(expected);const [start,end]=span(input);
    return this.locked(id,actor,'either',async(q,row)=>{
      await this.parties(q,row.client_id,row.performer_id);
      const state=actor.id===row.performer_id?'selected':'proposed';
      if(row.status==='confirmed'&&row.agreement_version===expected+1&&
        row.move_state===state&&row.move_actor_id===actor.id&&
        same(row.move_starts_at,start)&&same(row.move_ends_at,end))return row;
      this.changed(row,expected);
      if(row.status!=='confirmed')throw conflict('reservation_state','Перенос доступен только для подтверждённой записи');
      this.future(new Date(row.starts_at));
      this.future(start);
      if(same(row.starts_at,start)&&same(row.ends_at,end))
        throw bad('reservation_same_time','Выберите другое время');
      const next=(await q.one<Row>(`update performer_time_reservations set
        move_state=$2,move_starts_at=$3,move_ends_at=$4,move_actor_id=$5,
        updated_at=$6,agreement_version=agreement_version+1
        where id=$1 returning *`,[id,state,start,end,actor.id,this.now()]))!;
      await this.event(q,next,actor.id,state==='selected'?'move_performer_selected':'move_client_requested',row.status,
        {startsAt:start,endsAt:end,previousStart:row.starts_at,previousEnd:row.ends_at,version:next.agreement_version});
      return next;
    });
  }

  // Client accepts the exact replacement selected by the performer.
  // Updating the same row avoids a moment with zero or two reservations.
  // The exclusion constraint checks the new span against ALL other confirmed
  // spans; rollback preserves the old interval and pending proposal on conflict.
  async confirmMove(actor:Actor,id:string,expected:number){
    version(expected);
    try{
      return await this.locked(id,actor,'client',async(q,row)=>{
        await this.parties(q,row.client_id,row.performer_id);
        // A generic confirmed row is NOT proof of a successful retry. Check
        // the version-specific event persisted in the same transaction.
        if(row.status==='confirmed'&&row.agreement_version===expected+1&&row.move_state===null){
          const prior=await q.one(`select 1 from performer_time_reservation_events
            where reservation_id=$1 and actor_id=$2 and event_type='move_confirmed'
            and details->>'version'=$3 limit 1`,[id,actor.id,String(expected+1)]);
          if(prior)return row;
        }
        this.changed(row,expected);
        if(row.status!=='confirmed'||row.move_state!=='selected'||row.move_actor_id!==row.performer_id||
          !row.move_starts_at||!row.move_ends_at)
          throw conflict('reservation_state','Мастер ещё не согласовал новое время');
        this.future(new Date(row.starts_at));
        this.future(new Date(row.move_starts_at));
        if(await this.orders.busyWith(q,row.performer_id,null))
          throw conflict('performer_busy','Текущий выезд не завершён; перенос пока нельзя подтвердить');
        const next=(await q.one<Row>(`update performer_time_reservations set
          starts_at=move_starts_at,ends_at=move_ends_at,
          move_state=null,move_starts_at=null,move_ends_at=null,move_actor_id=null,
          selected_by=$2,selected_at=$3,decided_by=$4,decision_at=$3,updated_at=$3,
          agreement_version=agreement_version+1 where id=$1 returning *`,
          [id,row.performer_id,this.now(),actor.id]))!;
        await this.event(q,next,actor.id,'move_confirmed',row.status,
          {previousStart:row.starts_at,previousEnd:row.ends_at,startsAt:next.starts_at,endsAt:next.ends_at,version:next.agreement_version});
        return next;
      });
    }catch(e){
      if((e as {code?:string})?.code==='23P01')throw conflict('reservation_overlap','Новое время занято; исходная запись сохранена');
      throw e;
    }
  }

  // Withdraw only the proposed move, never the appointment itself.
  async withdrawMove(actor:Actor,id:string,expected:number){
    version(expected);
    return this.locked(id,actor,'either',async(q,row)=>{
      if(row.status==='confirmed'&&row.agreement_version===expected+1&&row.move_state===null){
        const prior=await q.one(`select 1 from performer_time_reservation_events
          where reservation_id=$1 and actor_id=$2 and event_type='move_withdrawn'
          and details->>'version'=$3 limit 1`,[id,actor.id,String(expected+1)]);
        if(prior)return row;
      }
      this.changed(row,expected);
      if(row.status!=='confirmed'||!row.move_state)
        throw conflict('reservation_state','Нет предложения переноса');
      const next=(await q.one<Row>(`update performer_time_reservations set
        move_state=null,move_starts_at=null,move_ends_at=null,move_actor_id=null,
        updated_at=$2,agreement_version=agreement_version+1 where id=$1 returning *`,[id,this.now()]))!;
      await this.event(q,next,actor.id,'move_withdrawn',row.status,{version:next.agreement_version});
      return next;
    });
  }

  // Only this negotiation is released; a blocked pair may still cancel.
  async cancel(actor:Actor,id:string,expected:number,reason:string){
    version(expected);
    if(typeof reason!=='string'||reason.trim().length<5||reason.trim().length>300)throw bad('bad_reservation_reason','Укажите причину от 5 до 300 символов');
    return this.locked(id,actor,'either',async(q,row)=>{
      if(row.status==='cancelled'&&row.agreement_version===expected+1)return row;
      this.changed(row,expected);
      if(!['proposed','selected','confirmed'].includes(row.status))throw conflict('reservation_state','Запись уже завершена');
      const next=(await q.one<Row>(`update performer_time_reservations set status='cancelled',cancelled_at=$2,
        cancellation_reason=$3,updated_at=$2,move_state=null,move_starts_at=null,move_ends_at=null,move_actor_id=null,
        agreement_version=agreement_version+1 where id=$1 returning *`,[id,this.now(),reason.trim()]))!;
      await this.event(q,next,actor.id,'cancelled',row.status,{reason:reason.trim()});
      return next;
    });
  }
}
