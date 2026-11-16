import { z } from 'zod';
import type { Db } from '../db/index.ts';
import type { Router, AuthedCtx, AuthUser } from '../http/router.ts';
import { parse, bad, forbidden, notFound, conflict, HttpError } from '../http/router.ts';
import type { Notifier } from './notify.ts';
import { addressDeclaredInSpb } from './shopRegion.ts';

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
type Run={id:string;courier_id:string;status:string;pickup_address:string;city_code:string;dispatch_approved_at:Date|null};
async function myRun(db:Db,c:AuthedCtx) {
  await courier(db,c.user);
  const run=await db.one<Run>('select * from shop_courier_runs where id=$1',[parse(id,c.params.id)]);
  if(!run || run.courier_id!==c.user.id || !run.dispatch_approved_at)throw notFound('Маршрут не найден');
  return run;
}
async function runSummary(db:Db,run:Run) {
  const stops=await db.query<any>(
    "select st.id,st.seq,st.status,so.id as shop_order_id,so.number,so.items,so.address,so.comment, "+
    "u.name as recipient_name from shop_courier_stops st "+
    "join shop_orders so on so.id=st.shop_order_id join users u on u.id=so.client_id "+
    "where st.run_id=$1 order by st.seq",[run.id]);
  return {id:run.id,status:run.status,cityCode:run.city_code,pickupAddress:run.pickup_address,
    stops:stops.map(x=>({id:x.id,seq:x.seq,status:x.status,orderNumber:x.number,
      recipientName:x.recipient_name??'Получатель',address:x.address,
      items:x.items,comment:x.comment??null}))};
}
async function alert(db:Db,notify:Notifier,shopOrderId:string,body:string) {
  const row=await db.one<{client_id:string;created_by:string;number:number}>(
    'select client_id,created_by,number from shop_orders where id=$1',[shopOrderId]);
  if(!row)return;
  await notify.notify([row.client_id,row.created_by],{type:'shop',shopOrderId},
    {kind:'normal',title:'Доставка заказа №'+row.number,body,data:{shopOrderId}});
}
export function registerShopCourierRoutes(r:Router,db:Db,notifier:Notifier) {
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
      "select p.user_id,p.display_name,p.vehicle_label,p.active,p.created_at from shop_couriers p order by created_at desc limit 100")};
  });
  r.post('/api/admin/shop/delivery-addresses/:id/verify',['admin'],async(c:AuthedCtx)=>{
    const shopOrderId=parse(id,c.params.id);
    const b=parse(z.object({cityCode:z.literal('spb'),evidence:z.string().trim().min(10).max(500),
      lat:z.number().min(-90).max(90).optional(),lng:z.number().min(-180).max(180).optional()}),c.body);
    if((b.lat==null)!==(b.lng==null))throw bad('coords_incomplete','Укажите обе координаты или ни одной');
    const o=await db.one<{delivery:string;status:string;address:string|null}>(
      'select delivery,status,address from shop_orders where id=$1',[shopOrderId]);
    if(!o || o.delivery!=='delivery' || !o.address)throw notFound('Заказ с адресной доставкой не найден');
    if(!addressDeclaredInSpb(o.address))
      throw conflict('delivery_outside_region','Курьерская доставка доступна только по адресам Санкт-Петербурга');
    if(!['confirmed','ready'].includes(o.status))throw conflict('not_ready','Адрес подтверждается после согласования заказа');
    await db.query("insert into shop_delivery_address_checks(shop_order_id,city_code,reviewed_by,review_note,lat,lng) "+
      "values($1,$2,$3,$4,$5,$6) on conflict(shop_order_id) do update set "+
      "city_code=excluded.city_code,reviewed_by=excluded.reviewed_by,review_note=excluded.review_note,"+
      "lat=excluded.lat,lng=excluded.lng,reviewed_at=now()",
      [shopOrderId,b.cityCode,c.user.id,b.evidence,b.lat??null,b.lng??null]);
    await db.query('insert into audit_log(actor_id,action,target,data) values($1,$2,$3,$4)',
      [c.user.id,'shop.delivery_address_verified',shopOrderId,{city:'spb',evidence:b.evidence}]);
    return {verified:true,cityCode:'spb'};
  });
  r.post('/api/admin/shop/courier-runs',['admin'],async(c:AuthedCtx)=>{
    const b=parse(z.object({courierId:id,pickupAddress:z.string().trim().min(10).max(300),
      orderIds:z.array(id).min(1).max(50)}),c.body);
    if(new Set(b.orderIds).size!==b.orderIds.length)throw bad('duplicate_orders','Заказ повторяется в маршруте');
    const courierProfile=await db.one<{active:boolean}>('select active from shop_couriers where user_id=$1',[b.courierId]);
    if(!courierProfile?.active)throw notFound('Курьер не активен');
    const run=await db.tx(async q=>{
      const orders=await q.query<{id:string;status:string;delivery:string;verified:boolean;supplier_status:string|null}>(
        "select so.id,so.status,so.delivery,(ac.shop_order_id is not null) as verified,ev.status as supplier_status "+
        "from shop_orders so left join shop_delivery_address_checks ac on ac.shop_order_id=so.id "+
        "left join lateral(select status from shop_supplier_order_events e where e.shop_order_id=so.id "+
        "order by e.event_time desc,e.id desc limit 1) ev on true "+
        "where so.id=any($1::uuid[]) for update of so",[b.orderIds]);
      if(orders.length!==b.orderIds.length || orders.some(x=>x.status!=='ready'||x.delivery!=='delivery'||!x.verified))
        throw conflict('orders_not_ready','Нужны собранные заказы с проверенными адресами Санкт-Петербурга');
      if(orders.some(x=>x.supplier_status==='cancelled'))
        throw conflict('supplier_cancelled','Поставщик отменил заказ. Проверьте причину и наличие, прежде чем создавать рейс.');
      const result=await q.one<Run>(
        "insert into shop_courier_runs(courier_id,created_by,pickup_address) values($1,$2,$3) returning *",
        [b.courierId,c.user.id,b.pickupAddress]);
      if(!result)throw new Error('Courier run insert failed');
      for(let i=0;i<b.orderIds.length;i++) {
        await q.query('insert into shop_courier_stops(run_id,shop_order_id,seq) values($1,$2,$3)',
          [result.id,b.orderIds[i],i+1]);
      }
      await q.query('insert into audit_log(actor_id,action,target,data) values($1,$2,$3,$4)',
        [c.user.id,'shop.courier_run_created',result.id,{stops:b.orderIds.length}]);
      return result;
    });
    // The courier will be notified only after an admin approves the route economics.
    return {id:run.id,status:run.status,stops:b.orderIds.length};
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
      "select * from shop_courier_runs where courier_id=$1 and dispatch_approved_at is not null and status in ('planned','accepted','collecting','delivering') "+
      "order by created_at desc limit 10",[c.user.id]);
    return {runs:rows.map(x=>({id:x.id,status:x.status,cityCode:x.city_code,stopCount:null}))};
  });
  r.get('/api/courier/runs/:id',true,async(c:AuthedCtx)=>runSummary(db,await myRun(db,c)));
  r.post('/api/courier/runs/:id/accept',true,async(c:AuthedCtx)=>{
    const run=await myRun(db,c);
    const updated=await db.one('update shop_courier_runs set status=$2,accepted_at=now() where id=$1 and status=$3 returning id,status',
      [run.id,'accepted','planned']);
    if(!updated)throw conflict('invalid_state','Маршрут уже принят или завершён');
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
      await q.query("update shop_courier_stops set status='collected',collected_at=now() where id=$1",[stopId]);
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
      const r=await q.query<{id:string}>(
        "update shop_orders so set status='shipped',updated_at=now() from shop_courier_stops st "+
        "where st.shop_order_id=so.id and st.run_id=$1 and so.status='ready' returning so.id",[run.id]);
      if(r.length!==stats.total)throw conflict('order_status_changed','Статус одного из заказов изменился');
      const first=await q.one<{id:string}>(
        'select id from shop_courier_stops where run_id=$1 order by seq limit 1',[run.id]);
      await q.query("update shop_courier_runs set status='delivering',departed_at=now(),active_stop_id=$2 where id=$1",
        [run.id,first?.id??null]);
      return r;
    });
    for(const x of affected)await alert(db,notifier,x.id,'Курьер выехал со склада');
    return {status:'delivering',orders:affected.length};
  });
  r.post('/api/courier/runs/:id/stops/:stopId/arrive',true,async(c:AuthedCtx)=>{
    const run=await myRun(db,c);
    if(run.status!=='delivering')throw conflict('invalid_state','Маршрут не в доставке');
    const stopId=parse(id,c.params.stopId);
    const row=await db.one<{shop_order_id:string}>(
      "update shop_courier_stops set status='at_door',arrived_at=now() "+
      "where id=$1 and run_id=$2 and status='collected' and "+
      "exists(select 1 from shop_courier_runs r where r.id=$2 and r.active_stop_id=$1) returning shop_order_id",[stopId,run.id]);
    if(!row)throw conflict('invalid_stop','Остановка недоступна');
    await alert(db,notifier,row.shop_order_id,'Курьер прибыл по адресу; подтвердите получение в TrakSOS');
    return {status:'at_door'};
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
        "where shop_order_id=$1 and status='at_door' returning id",[orderId]);
      if(!stop)throw conflict('handoff_unconfirmed','Курьер должен отметить прибытие');
      await q.query("update shop_orders set status='done',updated_at=now() where id=$1",[orderId]);
      const remaining=await q.one<{n:number}>(
        "select count(*)::int as n from shop_courier_stops where run_id=$1 and status<>'delivered'",[row.run_id]);
      if(remaining?.n===0) {
        await q.query("update shop_courier_runs set status='completed',completed_at=now(),active_stop_id=null where id=$1",[row.run_id]);
        await q.query('delete from shop_courier_live_positions where run_id=$1',[row.run_id]);
      } else {
        const next=await q.one<{id:string}>(
          "select id from shop_courier_stops where run_id=$1 and status='collected' order by seq limit 1",[row.run_id]);
        await q.query('update shop_courier_runs set active_stop_id=$2 where id=$1',[row.run_id,next?.id??null]);
        // Do not show the last recipient's coordinates to the next customer.
        await q.query('delete from shop_courier_live_positions where run_id=$1',[row.run_id]);
      }
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
    const profile=await courier(db,c.user);
    const run=await myRun(db,c);
    if(run.status!=='delivering'||!profile.location_consent)
      throw forbidden('GPS доступен только с согласия во время доставки');
    const b=parse(z.object({lat:z.number().min(-90).max(90),
      lng:z.number().min(-180).max(180),accuracyMeters:z.number().int().min(1).max(500)}),c.body);
    const updated=await db.one<{updated_at:Date}>(
      "insert into shop_courier_live_positions(run_id,lat,lng,accuracy_m) values($1,$2,$3,$4) "+
      "on conflict(run_id) do update set lat=excluded.lat,lng=excluded.lng,accuracy_m=excluded.accuracy_m,updated_at=now() "+
      "where shop_courier_live_positions.updated_at < now()-interval '15 seconds' returning updated_at",
      [run.id,b.lat,b.lng,b.accuracyMeters]);
    return {updated:Boolean(updated),updatedAt:updated?.updated_at??null};
  });
  r.get('/api/shop/orders/:id/courier',true,async(c:AuthedCtx)=>{
    const orderId=parse(id,c.params.id);
    const row=await db.one<{client_id:string;created_by:string;status:string;stop_status:string;run_id:string;leg_active:boolean}>(
      "select o.client_id,o.created_by,r.status,s.status as stop_status,r.id as run_id, "+
      "(r.active_stop_id=s.id) as leg_active "+
      "from shop_orders o join shop_courier_stops s on s.shop_order_id=o.id "+
      "join shop_courier_runs r on r.id=s.run_id where o.id=$1",[orderId]);
    if(!row || (row.client_id!==c.user.id && row.created_by!==c.user.id))
      throw notFound('Доставка не найдена');
    const live=row.status==='delivering' && row.leg_active &&
      ['collected','at_door'].includes(row.stop_status);
    const position=live?await db.one<{lat:number;lng:number;accuracy_m:number;updated_at:Date}>(
      "select lat,lng,accuracy_m,updated_at from shop_courier_live_positions "+
      "where run_id=$1 and updated_at>now()-interval '2 minutes'",[row.run_id]):null;
    // No other customers, route stop list, courier private phone or off-duty locations.
    return {status:row.stop_status,runStatus:row.status,
      location:position?{lat:position.lat,lng:position.lng,accuracyMeters:position.accuracy_m,
        updatedAt:position.updated_at}:null,
      live:Boolean(position),etaMinutes:null};
  });
}
