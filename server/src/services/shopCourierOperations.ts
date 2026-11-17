import type {Db} from '../db/index.ts';
import type {Router,AuthedCtx} from '../http/router.ts';

type Run={
 id:string;status:string;display_name:string;created_at:Date;
 dispatch_approved_at:Date|null;accepted_at:Date|null;departed_at:Date|null;
 stop_count:number;failed_count:number;oldest_arrival:Date|null;
 supplier_issue:boolean
};
type Code='supplier_dispute'|'return_waiting'|'handoff_waiting'|
  'approved_waiting'|'warehouse_waiting'|'route_stalled'|'draft_waiting';
const hints:Record<Code,string>={
 supplier_dispute:'Поставщик требует разбирательства. Проверьте склад и возможность продолжить рейс.',
 return_waiting:'Невручённые посылки ожидают возврата на склад и подтверждения администратором.',
 handoff_waiting:'Курьер ожидает вручения больше 45 минут. Уточните ситуацию с получателем.',
 approved_waiting:'Утверждённый рейс больше 30 минут не принят курьером.',
 warehouse_waiting:'Забор на складе длится больше часа. Проверьте комплектность и документы.',
 route_stalled:'Рейс находится в доставке больше 6 часов. Проверьте статус и связь.',
 draft_waiting:'Черновик больше двух часов не получил складское/финансовое утверждение.'
};
const delay=(d:Date|null,now:number)=>d==null?0:Math.max(0,Math.floor((now-new Date(d).getTime())/60000));

/** Admin-only observation. Reading this never advances status, sends warnings,
 * penalizes couriers or exposes any customer, stop or GPS coordinates. */
export function registerShopCourierOperationsRoutes(r:Router,db:Db){
 r.get('/api/admin/shop/courier-operations', ['admin'],async(_c:AuthedCtx)=>{
  const summary=await db.one<{
    active:number;drafts:number;approved:number;in_delivery:number;returning:number
  }>(
   "select count(*)::int as active,"+
   "count(*) filter(where status='planned' and dispatch_approved_at is null)::int as drafts,"+
   "count(*) filter(where dispatch_approved_at is not null)::int as approved,"+
   "count(*) filter(where status='delivering')::int as in_delivery,"+
   "count(*) filter(where status='returning')::int as returning "+
   "from shop_courier_runs where status in "+
   "('planned','accepted','collecting','delivering','returning')");
  const rows=await db.query<Run>(
   "select r.id,r.status,r.created_at,r.dispatch_approved_at,r.accepted_at,r.departed_at,"+
   "p.display_name,"+
   "(select count(*)::int from shop_courier_stops s where s.run_id=r.id) as stop_count,"+
   "(select count(*)::int from shop_courier_stops s "+
   "where s.run_id=r.id and s.status='failed') as failed_count,"+
   "(select min(s.arrived_at) from shop_courier_stops s "+
   "where s.run_id=r.id and s.status='at_door') as oldest_arrival,"+
   "exists(select 1 from shop_courier_stops s "+
   "join shop_supplier_order_issues i on i.shop_order_id=s.shop_order_id "+
   "where s.run_id=r.id and i.needs_review=true) as supplier_issue "+
   "from shop_courier_runs r "+
   "join shop_couriers p on p.user_id=r.courier_id "+
   "where r.status in ('planned','accepted','collecting','delivering','returning') "+
   "order by r.created_at asc limit 2000");
  const now=Date.now();
  const flags:{runId:string;courier:string;status:string;code:Code;
    minutes:number;stopCount:number;failedCount:number;hint:string}[]=[];
  for(const x of rows){
   const age=delay(x.created_at,now);
   const add=(code:Code,minutes:number)=>flags.push({
    runId:x.id,courier:x.display_name,status:x.status,code,minutes,
    stopCount:x.stop_count,failedCount:x.failed_count,hint:hints[code]
   });
   if(x.supplier_issue)add('supplier_dispute',age);
   if(x.status==='returning')add('return_waiting',age);
   if(x.oldest_arrival&&delay(x.oldest_arrival,now)>45)
    add('handoff_waiting',delay(x.oldest_arrival,now));
   if(x.status==='planned'&&x.dispatch_approved_at&&
      delay(x.dispatch_approved_at,now)>30)
    add('approved_waiting',delay(x.dispatch_approved_at,now));
   if(['accepted','collecting'].includes(x.status)&&
      delay(x.accepted_at,now)>60)
    add('warehouse_waiting',delay(x.accepted_at,now));
   if(x.status==='delivering'&&delay(x.departed_at,now)>360)
    add('route_stalled',delay(x.departed_at,now));
   if(x.status==='planned'&&!x.dispatch_approved_at&&age>120)
    add('draft_waiting',age);
  }
  const priorities:Code[]=['supplier_dispute','return_waiting','handoff_waiting',
    'route_stalled','approved_waiting','warehouse_waiting','draft_waiting'];
  flags.sort((a,b)=>priorities.indexOf(a.code)-priorities.indexOf(b.code)||
    b.minutes-a.minutes||a.runId.localeCompare(b.runId));
  return {
   generatedAt:new Date(now).toISOString(),
   totals:{active:summary?.active??0,drafts:summary?.drafts??0,
     approved:summary?.approved??0,inDelivery:summary?.in_delivery??0,
     returning:summary?.returning??0},
   alerts:flags.slice(0,50),
   moreAlerts:flags.length>50,
   capped:rows.length===2000,
   warning:'Это контрольные сроки, а не SLA. Автоматические штрафы и ETA не рассчитываются. Доступно только администратору.'
  };
 });
}
