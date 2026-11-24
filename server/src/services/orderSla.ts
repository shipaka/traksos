// Stalled order-stage guardrail. No automatic penalties, charges or cancellations.
import type { Db } from '../db/index.ts';
import type { AuthUser } from '../http/router.ts';
import { bad, forbidden, notFound } from '../http/router.ts';
import type { OrdersService } from './orders.ts';
import type { Notifier } from './notify.ts';

export const STAGE_LIMIT_MINUTES = {
  searching: 15, awaiting_owner: 30, accepted: 20, en_route: 120,
  arrived: 60, working: 240, awaiting_confirmation: 120,
} as const;
export type MonitoredStage = keyof typeof STAGE_LIMIT_MINUTES;
export const STAGE_NAMES: Record<MonitoredStage,string> = {
  searching:'Поиск исполнителя', awaiting_owner:'Подтверждение владельца',
  accepted:'Ожидание выезда', en_route:'Дорога к клиенту', arrived:'На месте',
  working:'Выполнение работы', awaiting_confirmation:'Подтверждение суммы клиентом',
};
const STAGE_COLUMN:Record<MonitoredStage,string> = {
  searching:'dispatch_started_at',awaiting_owner:'created_at',accepted:'accepted_at',
  en_route:'en_route_at',arrived:'arrived_at',working:'work_started_at',
  awaiting_confirmation:'amount_proposed_at',
};
const PERFORMER_STAGES:MonitoredStage[]=['accepted','en_route','arrived','working'];
type StageOrder = {
  id:string; number:number; service:string; status:string; is_sos:boolean;
  client_id:string; created_by:string; performer_id:string|null;
  created_at:string|Date; dispatch_started_at:string|Date|null;
  accepted_at:string|Date|null; en_route_at:string|Date|null;
  arrived_at:string|Date|null; work_started_at:string|Date|null;
  amount_proposed_at:string|Date|null; auction_until:string|Date|null;
};
const FIELDS=Object.keys(STAGE_COLUMN) as MonitoredStage[];

export function overdueOrderStage(o:StageOrder, now:Date):
  {stage:MonitoredStage; started:Date; due:Date}|null {
  if (!Object.prototype.hasOwnProperty.call(STAGE_COLUMN,o.status)) return null;
  const stage=o.status as MonitoredStage;
  const raw=o[STAGE_COLUMN[stage] as keyof StageOrder];
  if (!raw) return null;
  const started=new Date(raw as Date|string);
  if (!Number.isFinite(started.getTime()) || started>now) return null;
  // Auction tick owns the active auction; never interfere with a live round.
  if (stage==='searching' && o.auction_until &&
      new Date(o.auction_until).getTime()>now.getTime()-120_000) return null;
  const limit=stage==='searching' && o.is_sos?7:STAGE_LIMIT_MINUTES[stage];
  const due=new Date(started.getTime()+limit*60_000);
  return due<=now?{stage,started,due}:null;
}

export class OrderSlaService {
  constructor(private db:Db,private orders:OrdersService,private notifier:Notifier,
    private now:()=>Date=()=>new Date()) {}
  async tick() {
    const now=this.now();
    // Filter actual overdue stages before LIMIT so an old, still-working
    // backlog cannot starve newer overdue orders. The SQL uses the same
    // thresholds as overdueOrderStage and preserves timestamp precision.
    const startedSql="(case o.status "+FIELDS.map(stage=>
      "when '"+stage+"' then o."+STAGE_COLUMN[stage]).join(" ")+" end)";
    const limitSql="(case when o.status='searching' and o.is_sos then 7 "+
      FIELDS.map(stage=>"when o.status='"+stage+"' then "+STAGE_LIMIT_MINUTES[stage]).join(" ")+" end)";
    const fields="id,number,service,status,is_sos,client_id,created_by,performer_id,created_at,"+
      "dispatch_started_at,accepted_at,en_route_at,arrived_at,work_started_at,amount_proposed_at,auction_until";
    const rows=await this.db.query<{id:string}>(
      "select o.id from orders o where status=any($1::text[])"+
      " and "+startedSql+" + "+limitSql+" * interval '1 minute' <= $2::timestamptz"+
      " and (o.status<>'searching' or o.auction_until is null or o.auction_until <= $2::timestamptz-interval '2 minutes')"+
      " and not exists(select 1 from order_sla_incidents i where i.order_id=o.id and i.stage=o.status"+
      " and i.stage_started_at="+startedSql+")"+
      " order by "+startedSql+",o.id limit 300",[FIELDS,now]);
    let raised=0;
    for(const candidate of rows) {
      const incident=await this.db.tx(async q=>{
        const o=await q.one<StageOrder>("select "+fields+" from orders where id=$1 for update",[candidate.id]);
        if(!o)return null;
        const late=overdueOrderStage(o,now);
        if(!late)return null;
        const {stage}=late;
        const minutes=stage==='searching'&&o.is_sos?7:STAGE_LIMIT_MINUTES[stage];
        const column=STAGE_COLUMN[stage];
        // Use the locked PostgreSQL timestamp, not a JS Date round-trip:
        // microseconds are part of the unique incident key.
        const inserted=await q.one<{id:string}>(
          'insert into order_sla_incidents(order_id,stage,stage_started_at,due_at,performer_id)' +
          ' select id,$2,'+column+','+column+" + $3::int * interval '1 minute',performer_id from orders"+
          ' where id=$1 and status=$2 and '+column+" + $3::int * interval '1 minute' <= $4::timestamptz"+
          ' on conflict (order_id,stage,stage_started_at) do nothing returning id',
          [o.id,stage,minutes,now]);
        if(!inserted)return null;
        const currentDriver=o.created_by!==o.client_id ? await q.one<{id:string}>(
          `select u.id from orders ord join users u on u.id=$2
             join vehicles v on v.owner_id=u.owner_id and v.driver_id=u.id
            where ord.id=$1 and ord.created_by=u.id and ord.client_id=u.owner_id
              and u.status='active' and u.deleted_at is null
              and 'driver'=any(u.roles) and (ord.vehicle_id is null or v.id=ord.vehicle_id)
            limit 1 for share of u,v`,[o.id,o.created_by]) : null;
        const participants=[...new Set([o.client_id,currentDriver?.id,o.performer_id]
          .filter((x):x is string=>!!x))];
        // Both durable inbox and optional transport use the same live recipients.
        const active=await q.query<{id:string}>(
          "select id from users where status='active' and deleted_at is null "+
          "and (id=any($1::uuid[]) or 'admin'=any(roles)) order by id for share",
          [participants]);
        const recipients=active.map(a=>a.id);
        const title='Проверьте этап заявки №'+o.number;
        const body=STAGE_NAMES[stage]+': превышен контрольный интервал. Причина требует проверки.';
        const message={kind:'normal' as const,title,body,data:{orderId:o.id}};
        await q.query(
          'insert into notifications(user_id,kind,title,body,data)' +
          ' select id,$2,$3,$4,$5::jsonb from users where id=any($1::uuid[])',
          [recipients,'order_sla',title,body,JSON.stringify({orderId:o.id,incidentId:inserted.id})]);
        return {id:inserted.id,recipients,o,stage,message};
      });
      if(!incident)continue;
      raised++;
      const {o,stage,message}=incident;
      await this.notifier.deliverStored(incident.recipients,
        {type:'order_sla',orderId:o.id,incidentId:incident.id,stage},message).catch(e=>
        console.warn('[order-sla push]',(e as Error).message));
      if(stage==='searching' && !o.auction_until) {
        await this.orders.ringNext(o.id).catch(e=>
          console.warn('[order-sla recovery]',o.id,(e as Error).message));
      }
    }
    return raised;
  }
  async report(days=30) {
    const from=new Date(this.now().getTime()-Math.min(365,Math.max(1,days))*86_400_000);
    const [incidents,repeat]=await Promise.all([
      this.db.query(
        'select i.id,i.order_id,i.stage,i.stage_started_at,i.due_at,i.opened_at,' +
        ' i.performer_id,i.review_state,i.review_note,i.reviewed_at,' +
        ' o.number,o.status as current_status,o.service,o.is_sos,u.name as performer_name' +
        ' from order_sla_incidents i join orders o on o.id=i.order_id' +
        ' left join users u on u.id=i.performer_id where i.opened_at >= $1' +
        " order by (i.review_state in ('open','investigating')) desc,i.opened_at desc limit 250",
        [from]),
      this.db.query(
        'select i.performer_id,u.name as performer_name,' +
        " count(*) filter(where i.review_state='confirmed' and i.stage=any($2::text[]))::int as confirmed," +
        " count(*) filter(where i.review_state in ('open','investigating')" +
        " and i.stage=any($2::text[]))::int as pending" +
        ' from order_sla_incidents i join users u on u.id=i.performer_id' +
        ' where i.opened_at >= $1 and i.performer_id is not null group by i.performer_id,u.name' +
        ' having count(*) filter(where i.stage=any($2::text[]))>0' +
        ' order by confirmed desc,pending desc limit 100',
        [new Date(this.now().getTime()-30*86_400_000),PERFORMER_STAGES]),
    ]);
    return {days,incidents,repeat,thresholdMinutes:STAGE_LIMIT_MINUTES};
  }
  async review(actor:AuthUser,id:string,state:'investigating'|'confirmed'|'excused',note:string) {
    if(!actor.roles.includes('admin'))throw forbidden();
    const reason=note.trim();
    if(reason.length<10)throw bad('review_reason','Причина и доказательства — от 10 символов');
    return this.db.tx(async q=>{
      const admin=await q.one<{id:string}>(
        "select id from users where id=$1 and status='active' and deleted_at is null "+
        "and 'admin'=any(roles) for share",[actor.id]);
      if(!admin)throw forbidden();
      const incident=await q.one<{stage:string;performer_id:string|null}>(
        'select stage,performer_id from order_sla_incidents where id=$1 for update',[id]);
      if(!incident)throw notFound('Инцидент не найден');
      await q.query(
        'update order_sla_incidents set review_state=$2,review_note=$3,reviewed_by=$4,reviewed_at=$5 where id=$1',
        [id,state,reason,actor.id,this.now()]);
      await q.query('insert into audit_log(actor_id,action,target,data) values($1,$2,$3,$4)',
        [actor.id,'order_sla.review',id,{state,reason,stage:incident.stage,performerId:incident.performer_id}]);
      return {ok:true,id,state};
    });
  }
}
