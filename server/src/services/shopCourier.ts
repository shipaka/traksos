import { z } from 'zod';
import {randomBytes,randomInt,scryptSync,timingSafeEqual} from 'node:crypto';
import type { Db, Queryable } from '../db/index.ts';
import type { Router, AuthedCtx, AuthUser } from '../http/router.ts';
import { parse, bad, forbidden, notFound, conflict, HttpError } from '../http/router.ts';
import type { Notifier } from './notify.ts';
import { addressDeclaredInSpb } from './shopRegion.ts';
import { warehouseProgress } from './shopWarehouse.ts';
import {planCourierRoute} from './shopCourierRoute.ts';
import {supplierReceiptReadiness} from './shopSupplierReceiving.ts';

/** Only an admin can grant a courier entitlement; no public courier signup. */
const id=z.string().uuid();
const isAdmin=(u:AuthUser)=>u.roles.includes('admin');
function admin(u:AuthUser){if(!isAdmin(u))throw forbidden();}
async function courier(db:Db,user:AuthUser) {
  if(!user.roles.includes('courier'))throw forbidden('Кабинет доступен только курьерам TrakSOS');
  const p=await db.one<{user_id:string;active:boolean;location_consent:boolean}>(
    'select user_id,active,location_consent from shop_couriers where user_id=$1',[user.id]);
  if(!p?.active)throw forbidden('Доступ курьера не подтверждён');
  return p;
}
type Run={id:string;courier_id:string;status:string;pickup_address:string;city_code:string;
  active_stop_id:string|null;dispatch_approved_at:Date|null;packing_required:boolean;
  supplier_receipt_required:boolean;pickup_lat:number|null;pickup_lng:number|null;
  route_planning:string;route_direct_km:number|null};
async function myRun(db:Db,c:AuthedCtx) {
  await courier(db,c.user);
  const run=await db.one<Run>('select * from shop_courier_runs where id=$1',[parse(id,c.params.id)]);
  if(!run || run.courier_id!==c.user.id || !run.dispatch_approved_at ||
    ['completed','cancelled'].includes(run.status))throw notFound('Маршрут не найден');
  return run;
}
async function runSummary(db:Db,run:Run) {
  const stops=await db.query<any>(
    "select st.id,st.seq,st.status,so.id as shop_order_id,so.number,so.items,so.address,so.comment,ac.lat as stop_lat,ac.lng as stop_lng, "+
    "u.name as recipient_name,(h.verified_at is not null) as handoff_verified from shop_courier_stops st "+
    "left join shop_delivery_handoffs h on h.stop_id=st.id "+ 
    "left join shop_delivery_address_checks ac on ac.shop_order_id=st.shop_order_id "+ 
    "join shop_orders so on so.id=st.shop_order_id join users u on u.id=so.client_id "+
    "where st.run_id=$1 order by st.seq",[run.id]);
  return {id:run.id,status:run.status,cityCode:run.city_code,pickupAddress:run.pickup_address,
    pickupLat:run.pickup_lat,pickupLng:run.pickup_lng,
    routePlanning:run.route_planning,directKm:run.route_direct_km,
    routeDisclaimer:run.route_planning==='coordinate_heuristic'
      ?'Порядок рассчитан по прямым расстояниям между проверенными точками; нет учёта дорог, пробок и ETA'
      :'Недостаточно координат склада или получателей: порядок задан диспетчером вручную',
    packingRequired:run.packing_required,
    activeStopId:run.active_stop_id,
    stops:stops.map(x=>({id:x.id,seq:x.seq,status:x.status,orderNumber:x.number,
       handoffVerified:Boolean(x.handoff_verified),
      recipientName:['delivered','failed'].includes(x.status)?null:(x.recipient_name??'Получатель'),
      address:['delivered','failed'].includes(x.status)?null:x.address,
      lat:['delivered','failed'].includes(x.status)?null:x.stop_lat,
      lng:['delivered','failed'].includes(x.status)?null:x.stop_lng,
      items:Array.isArray(x.items)?x.items.map((item:any)=>({
        name:String(item.name??'Товар'),brand:item.brand??null,article:item.article??null,
        qty:Number(item.qty??0)
      })):[],comment:['delivered','failed'].includes(x.status)?null:(x.comment??null)}))};
}
async function alert(db:Db,notify:Notifier,shopOrderId:string,body:string) {
  const row=await db.one<{client_id:string;created_by:string;number:number}>(
    'select client_id,created_by,number from shop_orders where id=$1',[shopOrderId]);
  if(!row)return;
  await notify.notify([row.client_id,row.created_by],{type:'shop',shopOrderId},
    {kind:'normal',title:'Доставка заказа №'+row.number,body,data:{shopOrderId}});
}
/** Advance to the next client without disclosing the previous GPS fix.
 * A failed stop leaves the route in "returning" until warehouse receipt. */
async function advanceRun(q:Queryable,runId:string){
  const state=await q.one<{pending:number;failed:number}>(
    "select count(*) filter(where status in ('collected','at_door','awaiting_pickup'))::int as pending,"+
    "count(*) filter(where status='failed')::int as failed "+
    "from shop_courier_stops where run_id=$1",[runId]);
  await q.query('delete from shop_courier_live_positions where run_id=$1',[runId]);
  if((state?.pending??0)===0){
    const status=(state?.failed??0)>0?'returning':'completed';
    await q.query(
      'update shop_courier_runs set status=$2,active_stop_id=null,'+
      "completed_at=case when $2='completed' then now() else completed_at end where id=$1",
      [runId,status]);
    return status;
  }
  const next=await q.one<{id:string}>(
    "select id from shop_courier_stops where run_id=$1 and status in ('collected','at_door') "+
    "order by seq limit 1",[runId]);
  await q.query('update shop_courier_runs set active_stop_id=$2 where id=$1',[runId,next?.id??null]);
  return 'delivering';
}

type DeliveryPhase='planned'|'accepted'|'collected'|'dispatched'|'arrived'|
  'handoff_verified'|'delivered'|'failed'|'returned'|'route_cancelled';
async function recordDelivery(q:Queryable,orderId:string,runId:string,
  status:DeliveryPhase,actorId:string){
  await q.query(
    'insert into shop_delivery_events(shop_order_id,run_id,status,actor_id) values($1,$2,$3,$4)',
    [orderId,runId,status,actorId]);
}
const DELIVERY_MESSAGES:Record<DeliveryPhase,string>={
  planned:'Доставка предварительно запланирована; маршрут ещё требует утверждения',
  accepted:'Курьер принял маршрут',
  collected:'Посылка забрана на складе',
  dispatched:'Курьер выехал со склада',
  arrived:'Курьер прибыл к получателю',
  handoff_verified:'Код передачи посылки проверен',
  delivered:'Получение подтверждено',
  failed:'Не удалось вручить посылку; диспетчер уточнит дальнейшие действия',
  returned:'Посылка возвращена на склад',
  route_cancelled:'Запланированный маршрут отменён, заказ ожидает переназначения'
};

export function registerShopCourierRoutes(r:Router,db:Db,notifier:Notifier) {
  r.get('/api/courier/profile',true,async(c:AuthedCtx)=>{
    await courier(db,c.user);
    const profile=await db.one<{display_name:string;vehicle_label:string|null;active:boolean;location_consent:boolean}>(
      'select display_name,vehicle_label,active,location_consent from shop_couriers where user_id=$1',[c.user.id]);
    return {displayName:profile?.display_name??'Курьер',vehicleLabel:profile?.vehicle_label??null,
      active:true,locationConsent:profile?.location_consent??false,
      gpsNote:'Передача координат доступна только в активной доставке и требует отдельного согласия'};
  });
  r.post('/api/admin/shop/couriers',['admin'],async(c:AuthedCtx)=>{
    const b=parse(z.object({userId:id,displayName:z.string().trim().min(2).max(80),
      vehicleLabel:z.string().trim().max(100).optional()}),c.body);
    const u=await db.one<{id:string;roles:string[];status:string}>('select id,roles,status from users where id=$1',[b.userId]);
    if(!u || u.status!=='active')throw notFound('Аккаунт не найден');
    if(u.roles.length!==1 || u.roles[0]!=='client')
      throw conflict('courier_requires_dedicated_account','Для курьера нужен отдельный личный аккаунт без других ролей');
    // Converting a customer with real orders would remove their consumer access.
    const used=await db.one<{n:number}>(
      "select (select count(*) from shop_orders where client_id=$1 or created_by=$1)::int + "+
      "(select count(*) from orders where client_id=$1 or created_by=$1)::int + "+
      "(select count(*) from vehicles where owner_id=$1 or driver_id=$1)::int as n",[b.userId]);
    if((used?.n??0)>0)throw conflict('account_has_customer_data','Аккаунт используется клиентом. Создайте отдельный аккаунт курьера');
    await db.tx(async q=>{
      await q.query('update users set roles=$2 where id=$1',[b.userId,['courier']]);
      await q.query('insert into shop_couriers(user_id,display_name,vehicle_label,created_by) values($1,$2,$3,$4)',
        [b.userId,b.displayName,b.vehicleLabel??null,c.user.id]);
      await q.query('insert into audit_log(actor_id,action,target,data) values($1,$2,$3,$4)',
        [c.user.id,'shop.courier_granted',b.userId,{displayName:b.displayName}]);
    });
    return {userId:b.userId,active:true};
  });
  r.get('/api/admin/shop/couriers',['admin'],async()=>{
    return {couriers:await db.query(
      "select p.user_id,p.display_name,p.vehicle_label,(p.active and u.status='active') as active,p.created_at, "+
      "(exists(select 1 from shop_courier_runs r where r.courier_id=p.user_id "+
      "and r.status in ('planned','accepted','collecting','delivering','returning'))) as busy "+
      "from shop_couriers p join users u on u.id=p.user_id order by p.created_at desc limit 100")};
  });
  r.post('/api/admin/shop/delivery-addresses/:id/verify',['admin'],async(c:AuthedCtx)=>{
    const shopOrderId=parse(id,c.params.id);
    const b=parse(z.object({cityCode:z.literal('spb'),evidence:z.string().trim().min(10).max(500),
      lat:z.number().min(-90).max(90).optional(),lng:z.number().min(-180).max(180).optional()}),c.body);
    if((b.lat==null)!==(b.lng==null))throw bad('coords_incomplete','Укажите обе координаты или ни одной');
    return db.tx(async q=>{
    // Lock the order consistently with single-route and bulk route creation.
    // A change to a verified address after route planning would silently
    // invalidate both the stop sequence and the map/navigation coordinates.
    const o=await q.one<{delivery:string;status:string;address:string|null}>(
      'select delivery,status,address from shop_orders where id=$1 for update',[shopOrderId]);
    if(!o || o.delivery!=='delivery' || !o.address)throw notFound('Заказ с адресной доставкой не найден');
    if(!addressDeclaredInSpb(o.address))
      throw conflict('delivery_outside_region','Курьерская доставка доступна только по адресам Санкт-Петербурга');
    if(!['confirmed','ready'].includes(o.status))throw conflict('not_ready','Адрес подтверждается после согласования заказа');
    const assigned=await q.one<{id:string}>(
      'select id from shop_courier_stops where shop_order_id=$1 limit 1',[shopOrderId]);
    if(assigned)throw conflict('route_address_locked',
      'Адрес включён в маршрут. Сначала отмените незапущенный рейс или согласуйте отдельный возврат');
    await q.query("insert into shop_delivery_address_checks(shop_order_id,city_code,reviewed_by,review_note,lat,lng) "+
      "values($1,$2,$3,$4,$5,$6) on conflict(shop_order_id) do update set "+
      "city_code=excluded.city_code,reviewed_by=excluded.reviewed_by,review_note=excluded.review_note,"+
      "lat=excluded.lat,lng=excluded.lng,reviewed_at=now()",
      [shopOrderId,b.cityCode,c.user.id,b.evidence,b.lat??null,b.lng??null]);
    await q.query('insert into audit_log(actor_id,action,target,data) values($1,$2,$3,$4)',
      [c.user.id,'shop.delivery_address_verified',shopOrderId,{city:'spb',evidence:b.evidence}]);
    return {verified:true,cityCode:'spb'};
    });
  });
  r.post('/api/admin/shop/courier-runs',['admin'],async(c:AuthedCtx)=>{
    const b=parse(z.object({courierId:id,pickupAddress:z.string().trim().min(10).max(300),
      pickupLat:z.number().min(-90).max(90).optional(),
      pickupLng:z.number().min(-180).max(180).optional(),
      orderIds:z.array(id).min(1).max(50),packingRequired:z.boolean().default(false),
      traceabilityRequired:z.boolean().default(false),
      supplierReceiptRequired:z.boolean().default(false)}),c.body);
    if(new Set(b.orderIds).size!==b.orderIds.length)throw bad('duplicate_orders','Заказ повторяется в маршруте');
    if((b.pickupLat==null)!==(b.pickupLng==null))
      throw bad('warehouse_coords_incomplete','Укажите обе координаты склада');
    if(b.traceabilityRequired&&!b.packingRequired)throw bad('trace_requires_packing',
      'Прослеживаемость GTIN допускается только вместе со складской сверкой');
    if(b.supplierReceiptRequired&&!b.packingRequired)
      throw bad('receipt_requires_packing','Приёмка поставщика требует обязательной складской комплектации');
    if(!addressDeclaredInSpb(b.pickupAddress))
      throw conflict('warehouse_outside_region','Склад отправления должен быть подтверждён в Санкт-Петербурге');
    const courierProfile=await db.one<{active:boolean}>(
      "select c.active from shop_couriers c join users u on u.id=c.user_id "+
      "where c.user_id=$1 and u.status='active'",[b.courierId]);
    if(!courierProfile?.active)throw notFound('Курьер не активен');
    const run=await db.tx(async q=>{
      // Serialize planning per courier. One driver cannot pick up a second
      // route while the previous parcels are being returned to warehouse.
      await q.query('select pg_advisory_xact_lock(hashtext($1))',['shop-courier:'+b.courierId]);
      const busy=await q.one<{id:string}>(
        "select id from shop_courier_runs where courier_id=$1 "+
        "and status in ('planned','accepted','collecting','delivering','returning') limit 1",
        [b.courierId]);
      if(busy)throw conflict('courier_busy','У курьера есть незакрытый маршрут, включая возврат на склад');
      const orders=await q.query<{id:string;status:string;delivery:string;verified:boolean;
        supplier_status:string|null;stop_lat:number|null;stop_lng:number|null}>(
        "select so.id,so.status,so.delivery,(ac.shop_order_id is not null) as verified,ev.status as supplier_status, "+
        "ac.lat as stop_lat,ac.lng as stop_lng "+
        "from shop_orders so left join shop_delivery_address_checks ac on ac.shop_order_id=so.id "+
        "left join lateral(select status from shop_supplier_order_events e where e.shop_order_id=so.id "+
        "order by e.event_time desc,e.id desc limit 1) ev on true "+
        "where so.id=any($1::uuid[]) for update of so",[b.orderIds]);
      if(orders.length!==b.orderIds.length || orders.some(x=>x.status!=='ready'||x.delivery!=='delivery'||!x.verified))
        throw conflict('orders_not_ready','Нужны собранные заказы с проверенными адресами Санкт-Петербурга');
      if(orders.some(x=>x.supplier_status==='cancelled'))
        throw conflict('supplier_cancelled','Поставщик отменил заказ. Проверьте причину и наличие, прежде чем создавать рейс.');
      const assigned=await q.one<{shop_order_id:string}>(
        'select shop_order_id from shop_courier_stops where shop_order_id=any($1::uuid[]) limit 1',
        [b.orderIds]);
      if(assigned)throw conflict('order_already_assigned','Один из заказов уже находится в другом курьерском рейсе');
      const byId=new Map(orders.map(order=>[order.id,order]));
      const routePlan=planCourierRoute(
        b.pickupLat==null||b.pickupLng==null?null:{lat:b.pickupLat,lng:b.pickupLng},
        b.orderIds.map(orderId=>({id:orderId,lat:byId.get(orderId)?.stop_lat??NaN,
          lng:byId.get(orderId)?.stop_lng??NaN})));
      const result=await q.one<Run>(
        "insert into shop_courier_runs(courier_id,created_by,pickup_address, "+
        "pickup_lat,pickup_lng,route_planning,route_direct_km, "+
        "packing_required,traceability_required,supplier_receipt_required) "+
        "values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning *",
        [b.courierId,c.user.id,b.pickupAddress,b.pickupLat??null,b.pickupLng??null,
         routePlan.planning,routePlan.directKm,b.packingRequired,b.traceabilityRequired,
         b.supplierReceiptRequired]);
      if(!result)throw new Error('Courier run insert failed');
      for(let i=0;i<routePlan.orderedIds.length;i++) {
        await q.query('insert into shop_courier_stops(run_id,shop_order_id,seq) values($1,$2,$3)',
          [result.id,routePlan.orderedIds[i],i+1]);
        await recordDelivery(q,routePlan.orderedIds[i],result.id,'planned',c.user.id);
      }
      await q.query('insert into audit_log(actor_id,action,target,data) values($1,$2,$3,$4)',
        [c.user.id,'shop.courier_run_created',result.id,{stops:b.orderIds.length,packingRequired:b.packingRequired,traceabilityRequired:b.traceabilityRequired,
          supplierReceiptRequired:b.supplierReceiptRequired,routePlanning:routePlan.planning,
          directKm:routePlan.directKm}]);
      return result;
    });
    // The courier will be notified only after an admin approves the route economics.
    return {id:run.id,status:run.status,stops:b.orderIds.length,
      routePlanning:run.route_planning,directKm:run.route_direct_km,
      packingRequired:b.packingRequired,traceabilityRequired:b.traceabilityRequired,
      supplierReceiptRequired:b.supplierReceiptRequired};
  });
  // Cancel a planned route only BEFORE anyone collects a parcel. Do not
  // silently erase completed/ongoing delivery movements or financial records.
  r.post('/api/admin/shop/courier-runs/:id/cancel',['admin'],async(c:AuthedCtx)=>{
    const routeId=parse(id,c.params.id);
    const {reason}=parse(z.object({reason:z.string().trim().min(20).max(700)}),c.body);
    const result=await db.tx(async q=>{
      const run=await q.one<Run>(
        'select * from shop_courier_runs where id=$1 for update',[routeId]);
      if(!run)throw notFound('Рейс не найден');
      if(run.status!=='planned')
        throw conflict('run_already_started',
          'Рейс уже принят или выполняется: необходима отдельная процедура возврата со склада');
      const stops=await q.query<{shop_order_id:string;status:string}>(
        'select shop_order_id,status from shop_courier_stops where run_id=$1 order by seq for update',[routeId]);
      if(stops.some(x=>x.status!=='awaiting_pickup'))
        throw conflict('parcel_already_collected','Нельзя аннулировать рейс после забора товаров');
      await q.query('delete from shop_courier_live_positions where run_id=$1',[routeId]);
      for(const st of stops)
        await recordDelivery(q,st.shop_order_id,routeId,'route_cancelled',c.user.id);
      await q.query('delete from shop_courier_stops where run_id=$1',[routeId]);
      await q.query(
        "update shop_courier_runs set status='cancelled',cancelled_at=now(),cancelled_by=$2,"+
        "cancellation_reason=$3,active_stop_id=null,dispatch_approved_at=null "+
        "where id=$1",[routeId,c.user.id,reason]);
      await q.query('insert into audit_log(actor_id,action,target,data) values($1,$2,$3,$4)',
        [c.user.id,'shop.courier_route_cancelled',routeId,
          {reason,orderIds:stops.map(x=>x.shop_order_id)}]);
      return {id:routeId,status:'cancelled',releasedOrders:stops.length,
        courierId:run.courier_id,wasApproved:Boolean(run.dispatch_approved_at)};
    });
    if(result.wasApproved)
      notifier.live([result.courierId],{type:'courier_route_cancelled',runId:routeId});
    return {id:result.id,status:result.status,releasedOrders:result.releasedOrders};
  });

  r.get('/api/admin/shop/courier-runs',['admin'],async()=>{
    return {runs:await db.query(
      "select r.id,r.courier_id,p.display_name as courier_name,r.status,r.created_at, "+
      "(select count(*)::int from shop_courier_stops s where s.run_id=r.id) as stops "+
      "from shop_courier_runs r join shop_couriers p on p.user_id=r.courier_id "+
      "order by r.created_at desc limit 100")};
  });
  r.get('/api/courier/runs',true,async(c:AuthedCtx)=>{
    await courier(db,c.user);
    const rows=await db.query<Run>(
      "select * from shop_courier_runs where courier_id=$1 and dispatch_approved_at is not null and status in ('planned','accepted','collecting','delivering','returning') "+
      "order by created_at desc limit 10",[c.user.id]);
    return {runs:rows.map(x=>({id:x.id,status:x.status,cityCode:x.city_code,stopCount:null}))};
  });
  r.get('/api/courier/runs/:id',true,async(c:AuthedCtx)=>runSummary(db,await myRun(db,c)));
  r.post('/api/courier/runs/:id/accept',true,async(c:AuthedCtx)=>{
    const run=await myRun(db,c);
    const issues=await db.one<{n:number}>(
      "select count(*)::int as n from shop_courier_stops st "+
      "join shop_supplier_order_issues i on i.shop_order_id=st.shop_order_id "+
      "where st.run_id=$1 and i.needs_review=true",[run.id]);
    if((issues?.n??0)>0)
      throw conflict('supplier_issue_open','Есть новое разбирательство поставщика. Дождитесь решения диспетчера');
    if(run.supplier_receipt_required){
      const stops=await db.query<{shop_order_id:string}>(
        'select shop_order_id from shop_courier_stops where run_id=$1',[run.id]);
      if(!stops.length||!(await Promise.all(stops.map(x=>
          supplierReceiptReadiness(db,x.shop_order_id)))).every(x=>x.ready))
        throw conflict('supplier_receipt_incomplete','Не все запчасти физически приняты от поставщика');
    }
    const updated=await db.tx(async q=>{
      const saved=await q.one('update shop_courier_runs set status=$2,accepted_at=now() where id=$1 and status=$3 returning id,status',
        [run.id,'accepted','planned']);
      if(!saved)throw conflict('invalid_state','Маршрут уже принят или завершён');
      const orders=await q.query<{shop_order_id:string}>(
        'select shop_order_id from shop_courier_stops where run_id=$1',[run.id]);
      for(const o of orders)await recordDelivery(q,o.shop_order_id,run.id,'accepted',c.user.id);
      return saved;
    });
    return updated;
  });
  r.post('/api/courier/runs/:id/stops/:stopId/collect',true,async(c:AuthedCtx)=>{
    const run=await myRun(db,c);
    if(!['accepted','collecting'].includes(run.status))throw conflict('invalid_state','Маршрут не на этапе забора');
    const stopId=parse(id,c.params.stopId);
    const result=await db.tx(async q=>{
      const st=await q.one<{status:string}>('select status from shop_courier_stops where id=$1 and run_id=$2 for update',
        [stopId,run.id]);
      if(!st)throw notFound('Остановка не найдена');
      if(st.status==='collected')return {status:'collected'};
      if(st.status!=='awaiting_pickup')throw conflict('invalid_state','Эта позиция уже обработана');
      const r=await q.one("select so.status from shop_courier_stops st join shop_orders so on so.id=st.shop_order_id where st.id=$1",
        [stopId]) as {status:string}|null;
      if(r?.status!=='ready')throw conflict('order_status_changed','Заказ нельзя забирать до согласования');
      const issue=await q.one('select 1 from shop_supplier_order_issues i '+
        'join shop_courier_stops st on st.shop_order_id=i.shop_order_id '+
        'where st.id=$1 and i.needs_review=true',[stopId]);
      if(issue)throw conflict('supplier_issue_open',
        'Поставщик отменил или приостановил заказ. Сверьте наличие с диспетчером');
      if(run.supplier_receipt_required){
        const orderId=await q.one<{shop_order_id:string}>(
          'select shop_order_id from shop_courier_stops where id=$1',[stopId]);
        if(!orderId||(await supplierReceiptReadiness(q,orderId.shop_order_id)).ready===false)
          throw conflict('supplier_receipt_incomplete',
            'Документ физической приёмки поставщика не подтверждает полное количество');
      }
      if(run.packing_required){
        const packing=await warehouseProgress(q,run.id);
        const thisParcel=packing.stops.find(x=>x.id===stopId);
        if(!thisParcel?.lines.length||thisParcel.lines.some(x=>!x.verified))
          throw conflict('packing_incomplete',
            'Состав посылки изменился или не был полностью сверен на складе');
      }
      await q.query("update shop_courier_stops set status='collected',collected_at=now() where id=$1",[stopId]);
      const order=await q.one<{shop_order_id:string}>(
        'select shop_order_id from shop_courier_stops where id=$1',[stopId]);
      if(order)await recordDelivery(q,order.shop_order_id,run.id,'collected',c.user.id);
      await q.query("update shop_courier_runs set status='collecting' where id=$1 and status='accepted'",[run.id]);
      return {status:'collected'};
    });
    return result;
  });
  r.post('/api/courier/runs/:id/start',true,async(c:AuthedCtx)=>{
    const run=await myRun(db,c);
    if(!['collecting','accepted'].includes(run.status))throw conflict('invalid_state','Маршрут уже отправлен');
    const affected=await db.tx(async q=>{
      await q.query('select id from shop_courier_runs where id=$1 for update',[run.id]);
      const stats=await q.one<{total:number;ready:number}>(
        "select count(*)::int as total,count(*) filter(where status='collected')::int as ready "+
        "from shop_courier_stops where run_id=$1",[run.id]);
      if(!stats?.total || stats.total!==stats.ready)
        throw conflict('pickup_incomplete','Проверьте все пакеты перед выездом');
      const unverified=await q.one<{n:number}>(
        "select count(*)::int as n from shop_courier_stops st "+
        "join shop_supplier_order_issues i on i.shop_order_id=st.shop_order_id "+
        "where st.run_id=$1 and i.needs_review=true",[run.id]);
      if((unverified?.n??0)>0)
        throw conflict('supplier_issue_open','Один из заказов отменён поставщиком. Выезд приостановлен');
      const r=await q.query<{id:string}>(
        "update shop_orders so set status='shipped',updated_at=now() from shop_courier_stops st "+
        "where st.shop_order_id=so.id and st.run_id=$1 and so.status='ready' returning so.id",[run.id]);
      if(r.length!==stats.total)throw conflict('order_status_changed','Статус одного из заказов изменился');
      const first=await q.one<{id:string}>(
        'select id from shop_courier_stops where run_id=$1 order by seq limit 1',[run.id]);
      await q.query("update shop_courier_runs set status='delivering',departed_at=now(),active_stop_id=$2 where id=$1",
        [run.id,first?.id??null]);
      for(const order of r)await recordDelivery(q,order.id,run.id,'dispatched',c.user.id);
      return r;
    });
    for(const x of affected)await alert(db,notifier,x.id,'Курьер выехал со склада');
    return {status:'delivering',orders:affected.length};
  });
  r.post('/api/courier/runs/:id/stops/:stopId/arrive',true,async(c:AuthedCtx)=>{
    const run=await myRun(db,c);
    if(run.status!=='delivering')throw conflict('invalid_state','Маршрут не в доставке');
    const stopId=parse(id,c.params.stopId);
    const row=await db.tx(async q=>{
      const result=await q.one<{shop_order_id:string}>(
        "update shop_courier_stops set status='at_door',arrived_at=now() "+
        "where id=$1 and run_id=$2 and status='collected' and "+
        "exists(select 1 from shop_courier_runs r where r.id=$2 and r.active_stop_id=$1) returning shop_order_id",
        [stopId,run.id]);
      if(!result)throw conflict('invalid_stop','Остановка недоступна');
      await recordDelivery(q,result.shop_order_id,run.id,'arrived',c.user.id);
      return result;
    });
    await alert(db,notifier,row.shop_order_id,'Курьер прибыл по адресу; подтвердите получение в TrakSOS');
    return {status:'at_door'};
  });
  r.post('/api/courier/runs/:id/stops/:stopId/report-failure',true,async(c:AuthedCtx)=>{
    const run=await myRun(db,c);
    const stopId=parse(id,c.params.stopId);
    const {reason}=parse(z.object({reason:z.string().trim().min(20).max(500)}),c.body);
    const result=await db.tx(async q=>{
      const current=await q.one<{id:string;status:string;active_stop_id:string|null}>(
        'select id,status,active_stop_id from shop_courier_runs where id=$1 for update',[run.id]);
      if(current?.status!=='delivering'||current.active_stop_id!==stopId)
        throw conflict('invalid_stop','Действие разрешено только на текущей остановке');
      const failure=await q.one<{shop_order_id:string}>(
        "update shop_courier_stops set status='failed',failed_reason=$3 "+
        "where id=$1 and run_id=$2 and status in ('collected','at_door') returning shop_order_id",
        [stopId,run.id,reason]);
      if(!failure)throw conflict('invalid_stop','Остановка уже обработана');
      await q.query('delete from shop_delivery_handoffs where stop_id=$1',[stopId]);
      await recordDelivery(q,failure.shop_order_id,run.id,'failed',c.user.id);
      const nextStatus=await advanceRun(q,run.id);
      await q.query('insert into audit_log(actor_id,action,target,data) values($1,$2,$3,$4)',
        [c.user.id,'shop.courier_handoff_failed',failure.shop_order_id,
          {routeId:run.id,stopId,reason}]);
      return {status:'failed',runStatus:nextStatus,orderId:failure.shop_order_id};
    });
    await alert(db,notifier,result.orderId,
      'Курьер не смог вручить заказ. Диспетчер уточнит доставку или возврат.');
    return {status:result.status,runStatus:result.runStatus,
      message:'Товар остаётся у курьера до подтверждённого возврата на склад'};
  });

  r.post('/api/admin/shop/courier-runs/:id/confirm-warehouse-return',['admin'],async(c:AuthedCtx)=>{
    const routeId=parse(id,c.params.id);
    const {evidence}=parse(z.object({evidence:z.string().trim().min(25).max(1000)}),c.body);
    const result=await db.tx(async q=>{
      const run=await q.one<Run>(
        'select * from shop_courier_runs where id=$1 for update',[routeId]);
      if(!run)throw notFound('Рейс не найден');
      if(run.status!=='returning')
        throw conflict('return_not_ready','Нельзя подтвердить возврат до завершения объезда');
      const failed=await q.query<{id:string;shop_order_id:string}>(
        "select id,shop_order_id from shop_courier_stops where run_id=$1 and status='failed' for update",
        [routeId]);
      if(failed.length===0)throw conflict('no_failed_parcels','Нет посылок для возврата');
      const orders=await q.query<{id:string}>(
        "update shop_orders o set status='ready',updated_at=now() "+
        "from shop_courier_stops st where st.shop_order_id=o.id and st.run_id=$1 "+
        "and st.status='failed' and o.status='shipped' returning o.id",[routeId]);
      if(orders.length!==failed.length)
        throw conflict('order_status_changed','Статусы заказов нужно сверить вручную');
      for(const o of orders)
        await recordDelivery(q,o.id,routeId,'returned',c.user.id);
      // Preserve the parcels' entire history in the restricted audit trail;
      // remove the unique order assignment so a second delivery can be planned.
      await q.query("delete from shop_courier_stops where run_id=$1 and status='failed'",[routeId]);
      await q.query("update shop_courier_runs set status='completed',completed_at=now(),"+
        "active_stop_id=null where id=$1",[routeId]);
      await q.query('delete from shop_courier_live_positions where run_id=$1',[routeId]);
      await q.query('insert into audit_log(actor_id,action,target,data) values($1,$2,$3,$4)',
        [c.user.id,'shop.courier_warehouse_return_confirmed',routeId,
          {orderIds:orders.map(x=>x.id),evidence}]);
      return {status:'completed',returnedOrders:orders.map(x=>x.id)};
    });
    for(const orderId of result.returnedOrders)
      await alert(db,notifier,orderId,'Неудачная доставка завершена возвратом на склад. Новый способ получения будет согласован отдельно.');
    return {status:result.status,returnedCount:result.returnedOrders.length,
      refundAutomaticallyCompleted:false};
  });

  /** A fresh code is created only by the buyer, only at the currently active
   * arrival stop. The raw six digits are returned ONCE, never logged or stored.
   * Re-issue invalidates earlier tokens; 30-second cooldown blocks harassment. */
  r.post('/api/shop/orders/:id/delivery-code',true,async(c:AuthedCtx)=>{
    const orderId=parse(id,c.params.id);
    const code=String(randomInt(0,1_000_000)).padStart(6,'0');
    const salt=randomBytes(16).toString('hex');
    const hash=scryptSync(code,salt,32).toString('hex');
    const result=await db.tx(async q=>{
      const target=await q.one<{stop_id:string;client_id:string;created_by:string;status:string;
        run_status:string;active_stop_id:string|null}>(
        "select st.id as stop_id,so.client_id,so.created_by,st.status,"+
        "r.status as run_status,r.active_stop_id from shop_orders so "+
        "join shop_courier_stops st on st.shop_order_id=so.id "+
        "join shop_courier_runs r on r.id=st.run_id "+
        "where so.id=$1 for update of st",[orderId]);
      if(!target||(target.client_id!==c.user.id&&target.created_by!==c.user.id))
        throw notFound('Заказ не найден');
      if(target.status!=='at_door'||target.run_status!=='delivering'||
        target.active_stop_id!==target.stop_id)
        throw conflict('not_at_door','Курьер должен прибыть к текущему получателю');
      const prev=await q.one<{cooldown:boolean;verified_at:Date|null}>(
        "select (issued_at>now()-interval '30 seconds') as cooldown,verified_at "+
        'from shop_delivery_handoffs where stop_id=$1 for update',
        [target.stop_id]);
      if(prev?.verified_at)throw conflict('already_verified','Код уже проверен курьером');
      if(prev?.cooldown)
        throw conflict('retry_later','Повторный код можно запросить через 30 секунд');
      const issued=await q.one<{expires_at:Date}>(
        "insert into shop_delivery_handoffs(stop_id,code_salt,code_hash,issued_at,expires_at,attempts) "+
        "values($1,$2,$3,now(),now()+interval '10 minutes',0) "+
        "on conflict(stop_id) do update set code_salt=excluded.code_salt,"+
        "code_hash=excluded.code_hash,issued_at=excluded.issued_at,"+
        "expires_at=excluded.expires_at,attempts=0,verified_at=null,verified_by=null "+
        "returning expires_at",
        [target.stop_id,salt,hash]);
      return {expiresAt:issued?.expires_at};
    });
    return {code,expiresAt:result.expiresAt,validMinutes:10,
      warning:'Показывайте код только курьеру при фактической передаче вашей посылки'};
  });

  /** Courier must be at the active stop. A wrong guess is permanently counted
   * in its own committed transaction (throwing from tx would roll it back). */
  r.post('/api/courier/runs/:id/stops/:stopId/verify-handoff',true,async(c:AuthedCtx)=>{
    const run=await myRun(db,c);
    const stopId=parse(id,c.params.stopId);
    const input=parse(z.object({code:z.string().regex(/^\d{6}$/)}),c.body);
    const result=await db.tx(async q=>{
      const current=await q.one<{shop_order_id:string;status:string;run_status:string;
        active_stop_id:string|null}>(
        "select st.shop_order_id,st.status,r.status as run_status,r.active_stop_id "+
        "from shop_courier_stops st join shop_courier_runs r on r.id=st.run_id "+
        "where st.id=$1 and st.run_id=$2 for update of st",
        [stopId,run.id]);
      if(!current||current.status!=='at_door'||current.run_status!=='delivering'||
        current.active_stop_id!==stopId)
        throw conflict('not_active_stop','Код можно проверять только у текущего получателя');
      const proof=await q.one<{code_salt:string;code_hash:string;expired:boolean;
        attempts:number;verified_at:Date|null}>(
        'select code_salt,code_hash,(expires_at<=now()) as expired,attempts,verified_at '+ 
        'from shop_delivery_handoffs where stop_id=$1 for update',[stopId]);
      if(!proof)return {ok:false,reason:'Клиент ещё не создал код передачи'};
      if(proof.verified_at)return {ok:false,reason:'Код уже использован'};
      if(proof.attempts>=5)return {ok:false,reason:'Попытки исчерпаны. Клиент должен создать новый код'};
      if(proof.expired)
        return {ok:false,reason:'Код истёк. Клиент должен создать новый'};
      const received=scryptSync(input.code,proof.code_salt,32);
      const expected=Buffer.from(proof.code_hash,'hex');
      const valid=expected.length===received.length&&timingSafeEqual(expected,received);
      if(!valid){
        await q.query('update shop_delivery_handoffs set attempts=attempts+1 where stop_id=$1',[stopId]);
        return {ok:false,reason:'Неверный код передачи'};
      }
      await q.query(
        'update shop_delivery_handoffs set verified_at=now(),verified_by=$2 where stop_id=$1',
        [stopId,c.user.id]);
      await recordDelivery(q,current.shop_order_id,run.id,'handoff_verified',c.user.id);
      return {ok:true,orderId:current.shop_order_id};
    });
    if(!result.ok)throw conflict('handoff_code_rejected',result.reason);
    await alert(db,notifier,result.orderId!,
      'Код посылки проверен курьером. Подтвердите получение только после осмотра товара.');
    return {verified:true,requiresBuyerConfirmation:true};
  });

  r.post('/api/shop/orders/:id/confirm-delivery',true,async(c:AuthedCtx)=>{
    const orderId=parse(id,c.params.id);
    const result=await db.tx(async q=>{
      const row=await q.one<{id:string;status:string;client_id:string;created_by:string;run_id:string}>(
        "select so.id,so.status,so.client_id,so.created_by,st.run_id "+
        "from shop_orders so join shop_courier_stops st on st.shop_order_id=so.id "+
        "where so.id=$1 for update of so",[orderId]);
      if(!row || (row.client_id!==c.user.id && row.created_by!==c.user.id))
        throw notFound('Заказ не найден');
      if(row.status==='done')return {status:'done'};
      if(row.status!=='shipped')throw conflict('invalid_state','Заказ ещё не доставлен');
      const stop=await q.one<{id:string}>(
        "update shop_courier_stops set status='delivered',delivered_at=now() "+
        "where shop_order_id=$1 and status='at_door' "+
         "and exists(select 1 from shop_delivery_handoffs h "+
         "where h.stop_id=shop_courier_stops.id and h.verified_at is not null) "+
         "returning id",[orderId]);
      if(!stop)throw conflict('handoff_unconfirmed','Нужны прибытие курьера и проверенный одноразовый код получателя');
      await q.query("update shop_orders set status='done',updated_at=now() where id=$1",[orderId]);
      await recordDelivery(q,orderId,row.run_id,'delivered',c.user.id);
      await q.query('delete from shop_delivery_handoffs where stop_id=$1',[stop.id]);
      await advanceRun(q,row.run_id);
      return {status:'done'};
    });
    await alert(db,notifier,orderId,'Получение подтверждено');
    return result;
  });
  r.put('/api/courier/location-consent',true,async(c:AuthedCtx)=>{
    await courier(db,c.user);
    const b=parse(z.object({enabled:z.boolean()}),c.body);
    await db.tx(async q=>{
      await q.query('update shop_couriers set location_consent=$2,updated_at=now() where user_id=$1',[c.user.id,b.enabled]);
      if(!b.enabled)await q.query("delete from shop_courier_live_positions p using shop_courier_runs r "+
        "where p.run_id=r.id and r.courier_id=$1",[c.user.id]);
    });
    return {enabled:b.enabled};
  });
  r.put('/api/courier/runs/:id/position',true,async(c:AuthedCtx)=>{
    // Check courier identity first; the permission and live-run state are
    // revalidated under row locks to avoid a race with revoked GPS consent.
    await courier(db,c.user);
    const run=await myRun(db,c);
    const b=parse(z.object({
      lat:z.number().min(-90).max(90),
      lng:z.number().min(-180).max(180),
      accuracyMeters:z.number().int().min(1).max(500)
    }),c.body);
    const updated=await db.tx(async q=>{
      const profile=await q.one<{active:boolean;location_consent:boolean}>(
        'select active,location_consent from shop_couriers where user_id=$1 for update',[c.user.id]);
      if(!profile?.active || !profile.location_consent)
        throw forbidden('GPS отключён: требуется отдельное согласие курьера');
      const current=await q.one<{status:string;active_stop_id:string|null}>(
        'select status,active_stop_id from shop_courier_runs where id=$1 for update',[run.id]);
      if(current?.status!=='delivering'||!current.active_stop_id)
        throw forbidden('Координаты доступны только во время активной доставки');
      return q.one<{updated_at:Date}>(
        "insert into shop_courier_live_positions(run_id,lat,lng,accuracy_m) values($1,$2,$3,$4) "+
        "on conflict(run_id) do update set lat=excluded.lat,lng=excluded.lng,accuracy_m=excluded.accuracy_m,updated_at=now() "+
        "where shop_courier_live_positions.updated_at < now()-interval '15 seconds' returning updated_at",
        [run.id,b.lat,b.lng,b.accuracyMeters]);
    });
    return {updated:Boolean(updated),updatedAt:updated?.updated_at??null};
  });
  r.get('/api/shop/orders/:id/delivery-history',true,async(c:AuthedCtx)=>{
    const orderId=parse(id,c.params.id);
    const o=await db.one<{client_id:string;created_by:string}>(
      'select client_id,created_by from shop_orders where id=$1',[orderId]);
    if(!o||(o.client_id!==c.user.id&&o.created_by!==c.user.id))
      throw notFound('Заказ не найден');
    const events=await db.query<{id:string;status:DeliveryPhase;event_time:Date}>(
      'select e.id::text as id,e.status,e.event_time from shop_delivery_events e '+
      'where e.shop_order_id=$1 order by e.id desc limit 100',[orderId]);
    return {events:events.reverse().map(x=>({
      id:x.id,status:x.status,at:x.event_time,
      title:DELIVERY_MESSAGES[x.status]
    }))};
  });
  r.get('/api/shop/orders/:id/courier',true,async(c:AuthedCtx)=>{
    const orderId=parse(id,c.params.id);
    const owner=await db.one<{client_id:string;created_by:string}>(
      'select client_id,created_by from shop_orders where id=$1',[orderId]);
    if(!owner||(owner.client_id!==c.user.id&&owner.created_by!==c.user.id))
      throw notFound('Доставка не найдена');
    const row=await db.one<{client_id:string;created_by:string;status:string;stop_status:string;run_id:string;leg_active:boolean;handoff_verified:boolean;approved_at:Date|null}>(
      "select o.client_id,o.created_by,r.status,s.status as stop_status,r.id as run_id,r.dispatch_approved_at as approved_at, \n       (exists(select 1 from shop_delivery_handoffs h where h.stop_id=s.id and h.verified_at is not null)) as handoff_verified, "+
      "(r.active_stop_id=s.id) as leg_active "+
      "from shop_orders o join shop_courier_stops s on s.shop_order_id=o.id "+
      "join shop_courier_runs r on r.id=s.run_id where o.id=$1",[orderId]);
    // A draft route is not an assigned delivery until a real admin approves
    // warehouse and financial readiness. Never promise the buyer a courier
    // while the parcel still awaits supplier documents.
    if(!row||!row.approved_at)return {status:'awaiting_assignment',runStatus:null,location:null,live:false,etaMinutes:null,handoffVerified:false};
    const live=row.status==='delivering' && row.leg_active &&
      ['collected','at_door'].includes(row.stop_status);
    const position=live?await db.one<{lat:number;lng:number;accuracy_m:number;updated_at:Date}>(
      "select lat,lng,accuracy_m,updated_at from shop_courier_live_positions "+
      "where run_id=$1 and updated_at>now()-interval '2 minutes'",[row.run_id]):null;
    // No other customers, route stop list, courier private phone or off-duty locations.
    return {status:row.stop_status,runStatus:row.status,handoffVerified:Boolean(row.handoff_verified),
      location:position?{lat:position.lat,lng:position.lng,accuracyMeters:position.accuracy_m,
        updatedAt:position.updated_at}:null,
      live:Boolean(position),etaMinutes:null};
  });
}
