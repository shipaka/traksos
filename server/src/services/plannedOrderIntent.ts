import type {Db,Queryable} from '../db/index.ts';
import {bad,conflict,forbidden,notFound} from '../http/router.ts';

type Actor={id:string};
type Input={vehicleId:string;service:string;startsAt:string;endsAt:string;requestKey:string};
type Intent={id:string;owner_id:string;created_by:string;vehicle_id:string;service:string;
  starts_at:Date|string;ends_at:Date|string;request_key:string;version:number;
  status:'awaiting_owner'|'owner_allowed'|'rejected';decided_by:string|null};
type User={id:string;roles:string[];owner_id:string|null;status:string;deleted_at:Date|null;fleet:any};
type Vehicle={id:string;owner_id:string;driver_id:string|null};
const allowedServices=new Set(['electric','diag','air','autonomy','tyre','hydraulics','tow']);
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function id(value:string){if(typeof value!=='string'||!uuid.test(value))throw bad('bad_planned_id','Неверный идентификатор');}
function instant(value:string){
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/.test(value))
    throw bad('bad_planned_time','Укажите время UTC');
  const d=new Date(value);
  if(!Number.isFinite(d.getTime())||d.toISOString()!==(value.length===20?value.slice(0,-1)+'.000Z':value))
    throw bad('bad_planned_time','Укажите существующую дату и время');
  return d;
}
function validVersion(v:number){if(!Number.isSafeInteger(v)||v<1)throw bad('bad_planned_version','Обновите запрос');}
function isOwner(u:User|null){return !!u&&u.status==='active'&&!u.deleted_at&&u.roles.includes('client')&&!u.roles.includes('driver')&&u.owner_id===null;}
function isDriver(u:User|null,v:Vehicle){return !!u&&u.status==='active'&&!u.deleted_at&&u.roles.includes('driver')&&u.owner_id===v.owner_id&&v.driver_id===u.id;}

/**
 * Internal intent only, no HTTP routes. Owner permission here is not consent
 * to a tariff, reservation, payment, or actual order. Require fresh checks
 * at the future conversion boundary. No implicit SOS bypass.
 */
export class PlannedOrderIntentService{
  constructor(private db:Db,private now:()=>Date){}
  private async lockVehicle(q:Queryable,vehicleId:string){
    const v=await q.one<Vehicle>('select id,owner_id,driver_id from vehicles where id=$1 for share',[vehicleId]);
    if(!v)throw notFound('Машина не найдена');
    return v;
  }
  private async lockUsers(q:Queryable,ids:string[]){
    const rows=await q.query<User>('select id,roles,owner_id,status,deleted_at,fleet from users where id=any($1::uuid[]) order by id for share',[ids]);
    return new Map(rows.map(u=>[u.id,u]));
  }
  private permitted(owner:User,actor:User,vehicle:Vehicle,service:string){
    if(!isOwner(owner)||(!isOwner(actor)&&!isDriver(actor,vehicle))||
       (actor.id!==owner.id&&!isDriver(actor,vehicle)))throw forbidden('Нет доступа к машине автопарка');
    if(actor.id!==owner.id&&owner.fleet?.allow?.[service==='tow'?'tow':'repair']===false)
      throw forbidden('Владелец не разрешил такой вид обращения');
  }
  private async event(q:Queryable,row:Intent,actor:string,type:string){
    await q.query('insert into planned_order_intent_events(intent_id,actor_id,version,event_type) values($1,$2,$3,$4)',
      [row.id,actor,row.version,type]);
  }
  async request(actor:Actor,input:Input){
    id(actor.id);id(input.vehicleId);
    if(!allowedServices.has(input.service))throw bad('bad_planned_service','Услуга не поддерживает плановый выезд');
    if(typeof input.requestKey!=='string'||!/^[A-Za-z0-9_-]{16,100}$/.test(input.requestKey))
      throw bad('bad_planned_key','Нужен ключ повторного запроса');
    const start=instant(input.startsAt),end=instant(input.endsAt);
    if(end<=start||end.getTime()-start.getTime()>48*3600_000)throw bad('bad_planned_time','Неверный интервал');
    return this.db.tx(async q=>{
      const v=await this.lockVehicle(q,input.vehicleId);
      const users=await this.lockUsers(q,[actor.id,v.owner_id]);
      const owner=users.get(v.owner_id),author=users.get(actor.id);
      if(!owner||!author)throw forbidden();
      this.permitted(owner,author,v,input.service);
      const matches=(r:Intent)=>r.owner_id===v.owner_id&&r.vehicle_id===v.id&&r.service===input.service&&
        new Date(r.starts_at).getTime()===start.getTime()&&new Date(r.ends_at).getTime()===end.getTime();
      const existing=await q.one<Intent>('select * from planned_order_intents where created_by=$1 and request_key=$2',[actor.id,input.requestKey]);
      if(existing){
        if(!matches(existing))throw conflict('planned_key_reused','Ключ использован для другого обращения');
        return existing;
      }
      if(start<=this.now())throw conflict('planned_expired','Желаемое время уже наступило');
      const created=await q.one<Intent>(`insert into planned_order_intents
        (owner_id,created_by,vehicle_id,service,starts_at,ends_at,request_key,created_at,updated_at)
        values($1,$2,$3,$4,$5,$6,$7,$8,$8) on conflict(created_by,request_key) do nothing returning *`,
        [v.owner_id,actor.id,v.id,input.service,start,end,input.requestKey,this.now()]);
      if(!created){
        const old=await q.one<Intent>('select * from planned_order_intents where created_by=$1 and request_key=$2',[actor.id,input.requestKey]);
        if(!old||!matches(old))throw conflict('planned_key_reused','Ключ использован для другого обращения');
        return old;
      }
      await this.event(q,created,actor.id,'requested');
      return created;
    });
  }
  async decide(actor:Actor,intentId:string,expected:number,allow:boolean){
    id(actor.id);id(intentId);validVersion(expected);
    if(typeof allow!=='boolean')throw bad('bad_planned_decision','Выберите решение');
    return this.db.tx(async q=>{
      const initial=await q.one<Intent>('select * from planned_order_intents where id=$1 and owner_id=$2',[intentId,actor.id]);
      if(!initial)throw notFound('Обращение не найдено');
      const v=await this.lockVehicle(q,initial.vehicle_id);
      const users=await this.lockUsers(q,[initial.owner_id,initial.created_by]);
      const owner=users.get(initial.owner_id),author=users.get(initial.created_by);
      if(!owner||!isOwner(owner)||v.owner_id!==owner.id)throw forbidden('Владелец машины изменился');
      // Rejection can close an obsolete driver request. Permission cannot.
      if(allow){
        if(!author)throw forbidden();
        this.permitted(owner,author,v,initial.service);
      }
      const row=await q.one<Intent>('select * from planned_order_intents where id=$1 for update',[intentId]);
      if(!row||row.owner_id!==initial.owner_id||row.vehicle_id!==initial.vehicle_id||row.created_by!==initial.created_by)
        throw conflict('planned_changed','Обновите обращение');
      const status=allow?'owner_allowed':'rejected';
      if(row.status===status&&row.version===expected+1&&row.decided_by===actor.id)return row;
      if(row.version!==expected||row.status!=='awaiting_owner')throw conflict('planned_changed','Обновите обращение');
      if(allow&&new Date(row.starts_at)<=this.now())throw conflict('planned_expired','Желаемое время уже наступило');
      const updated=await q.one<Intent>(`update planned_order_intents set status=$2,decided_by=$3,decision_at=$4,
        updated_at=$4,version=version+1 where id=$1 returning *`,[row.id,status,actor.id,this.now()]);
      if(!updated)throw new Error('Planned intent decision missing');
      await this.event(q,updated,actor.id,status);
      return updated;
    });
  }
}
