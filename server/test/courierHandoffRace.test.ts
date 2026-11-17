import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setup,ok} from './helpers.ts';

test('simultaneous buyer confirmation and courier failure cannot both finish one stop',async()=>{
 const t=await setup();
 try{
  const admin=await t.login('+79990000001');
  const customer=await t.login('+79996886001','client');
  const courier=await t.login('+79996886002');
  ok(await t.api('PUT','/api/admin/settings/shop',{enabled:true,delivery:true},admin.token));
  ok(await t.api('PUT','/api/shop/region',{city:'Санкт-Петербург'},customer.token));
  const product=ok(await t.api('POST','/api/admin/shop/products',{
   name:'EBS для испытания одновременных статусов',category:'sensors',
   price:110000,stock:4
  },admin.token));
  ok(await t.api('PUT','/api/admin/shop/products/'+product.id+'/costing',{
   purchaseCostKopecks:50000,markupBps:3000,
   costSourceNote:'Тестовая подтверждённая первичная стоимость для проверки гонки'
  },admin.token));
  ok(await t.api('POST','/api/admin/shop/couriers',{
   userId:courier.id,displayName:'Курьер гонки статусов',
   vehicleLabel:'Тестовый фургон'
  },admin.token));
  const created=ok(await t.api('POST','/api/shop/orders',{
   items:[{productId:product.id,qty:1}],delivery:'delivery',
   address:'Санкт-Петербург, тестовая стоянка, 1'
  },customer.token));
  for(const status of ['confirmed','ready'])ok(await t.api(
   'POST','/api/admin/shop/orders/'+created.id+'/status',{status},admin.token));
  ok(await t.api('POST','/api/admin/shop/delivery-addresses/'+created.id+'/verify',{
   cityCode:'spb',evidence:'Достоверность адреса и города подтверждена для теста',
   lat:59.93,lng:30.35
  },admin.token));
  const run=ok(await t.api('POST','/api/admin/shop/courier-runs',{
   courierId:courier.id,pickupAddress:'Санкт-Петербург, тестовый склад 1',
   pickupLat:59.93,pickupLng:30.33,orderIds:[created.id]
  },admin.token));
  ok(await t.api('PUT','/api/admin/shop/courier-runs/'+run.id+'/budget',{
   courierPayKopecks:1000,fuelKopecks:1000,packingKopecks:300,
   acquiringKopecks:300,taxesKopecks:300,otherKopecks:300,
   note:'Проверенные расходы для сценария одновременных действий'
  },admin.token));
  ok(await t.api('POST','/api/admin/shop/courier-runs/'+run.id+'/approve-dispatch',
   {},admin.token));
  const route=ok(await t.api('GET','/api/courier/runs/'+run.id,undefined,courier.token));
  const stop=route.stops[0].id;
  ok(await t.api('POST','/api/courier/runs/'+run.id+'/accept',{},courier.token));
  ok(await t.api('POST','/api/courier/runs/'+run.id+'/stops/'+stop+'/collect',
   {},courier.token));
  ok(await t.api('POST','/api/courier/runs/'+run.id+'/start',{},courier.token));
  ok(await t.api('POST','/api/courier/runs/'+run.id+'/stops/'+stop+'/arrive',
   {},courier.token));
  const code=ok(await t.api('POST','/api/shop/orders/'+created.id+'/delivery-code',
   {},customer.token));
  ok(await t.api('POST','/api/courier/runs/'+run.id+'/stops/'+stop+'/verify-handoff',
   {code:code.code},courier.token));
  const [buyer,failure]=await Promise.all([
   t.api('POST','/api/shop/orders/'+created.id+'/confirm-delivery',{},customer.token),
   t.api('POST','/api/courier/runs/'+run.id+'/stops/'+stop+'/report-failure',{
    reason:'Клиент не получил комплект и зафиксирована спорная выдача запчасти'
   },courier.token)
  ]);
  assert.equal([buyer.status,failure.status].filter(x=>x===200).length,1,
   'exactly one of the two competing state changes may commit');
  assert.ok([409,404].includes(
   buyer.status===200?failure.status:buyer.status));
  const dbStatus=await t.db.one<{order_status:string;stop_status:string;route_status:string}>(
   'select o.status as order_status,s.status as stop_status,r.status as route_status '+
   'from shop_orders o join shop_courier_stops s on s.shop_order_id=o.id '+
   'join shop_courier_runs r on r.id=s.run_id where o.id=$1',[created.id]);
  assert.ok(dbStatus);
  const events=ok(await t.api('GET','/api/shop/orders/'+created.id+
   '/delivery-history',undefined,customer.token)).events;
  const done=events.filter((x:any)=>x.status==='delivered');
  const failed=events.filter((x:any)=>x.status==='failed');
  assert.equal(done.length+failed.length,1,
   'immutable timeline must contain exactly one terminal stop decision');
  if(buyer.status===200){
   assert.equal(dbStatus!.order_status,'done');
   assert.equal(dbStatus!.stop_status,'delivered');
   assert.equal(dbStatus!.route_status,'completed');
   assert.equal((ok(await t.api('POST','/api/shop/orders/'+created.id+
    '/confirm-delivery',{},customer.token))).alreadyConfirmed,true);
  }else{
   assert.equal(dbStatus!.order_status,'shipped');
   assert.equal(dbStatus!.stop_status,'failed');
   assert.equal(dbStatus!.route_status,'returning');
   assert.equal((await t.api('POST','/api/shop/orders/'+created.id+
    '/confirm-delivery',{},customer.token)).status,409);
  }
  assert.equal((await t.api('GET','/api/courier/runs/'+run.id,undefined,
   await t.login('+79996886003').then(u=>u.token))).status,403,
   'no outsider can read the disputed route');
 }finally{await t.close()}
});
