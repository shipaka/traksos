import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {setup,ok,type T} from './helpers.ts';

let t:T,admin:any,driver:any,client1:any,client2:any,outsider:any;
let order1:string,order2:string,runId:string,stops:any[];

before(async()=>{
 t=await setup();
 admin=await t.login('+79990000001');
 driver=await t.login('+79993332220');
 client1=await t.login('+79993332221');
 client2=await t.login('+79993332222');
 outsider=await t.login('+79993332223');
 ok(await t.api('PUT','/api/admin/settings/shop',{enabled:true,delivery:true},admin.token));
 const item=ok(await t.api('POST','/api/admin/shop/products',{
   name:'Позиция тестовой доставки',category:'sensors',price:110000,stock:5
 },admin.token)).id;
 order1=ok(await t.api('POST','/api/shop/orders',{
   items:[{productId:item,qty:1}],delivery:'delivery',address:'Санкт-Петербург, тестовая улица 1'
 },client1.token)).id;
 order2=ok(await t.api('POST','/api/shop/orders',{
   items:[{productId:item,qty:1}],delivery:'delivery',address:'Санкт-Петербург, тестовая улица 2'
 },client2.token)).id;
 for(const oid of [order1,order2]){
   ok(await t.api('POST','/api/admin/shop/orders/'+oid+'/status',{status:'confirmed'},admin.token));
   ok(await t.api('POST','/api/admin/shop/orders/'+oid+'/status',{status:'ready'},admin.token));
 }
});
after(()=>t.close());

test('courier role admin-only, not self-registering or regular cargo carrier',async()=>{
 assert.equal((await t.api('GET','/api/courier/runs',undefined,driver.token)).status,403);
 assert.equal((await t.api('POST','/api/admin/shop/couriers',
   {userId:driver.id,displayName:'Курьер тест'},client1.token)).status,403);
 assert.equal((await t.api('POST','/api/admin/shop/couriers',
   {userId:client1.id,displayName:'Нельзя перевести клиента с заказами'},admin.token)).status,409);
 ok(await t.api('POST','/api/admin/shop/couriers',
   {userId:driver.id,displayName:'Курьер тест',vehicleLabel:'Малотоннажный автомобиль'},admin.token));
 const me=ok(await t.api('GET','/api/me',undefined,driver.token));
 assert.ok(me.roles.includes('courier'));
 assert.ok(!me.roles.includes('master') && !me.roles.includes('driver'));
});

test('dispatch requires verified SPb delivery addresses and never assigns unverified goods',async()=>{
 assert.equal((await t.api('POST','/api/admin/shop/courier-runs',{
   courierId:driver.id,pickupAddress:'Санкт-Петербург, тестовый склад 1',orderIds:[order1,order2]
 },admin.token)).status,409);
 assert.equal((await t.api('POST','/api/admin/shop/delivery-addresses/'+order1+'/verify',{
   cityCode:'moscow',evidence:'Район указан в заказе'},admin.token)).status,400);
 for(const oid of [order1,order2]){
   assert.equal((await t.api('POST','/api/admin/shop/delivery-addresses/'+oid+'/verify',{
     cityCode:'spb',evidence:'Адрес проверен по заявке и карте Санкт-Петербурга'
   },client1.token)).status,403);
   ok(await t.api('POST','/api/admin/shop/delivery-addresses/'+oid+'/verify',{
     cityCode:'spb',evidence:'Адрес проверен по заявке и карте Санкт-Петербурга'
   },admin.token));
 }
 const run=ok(await t.api('POST','/api/admin/shop/courier-runs',{
   courierId:driver.id,pickupAddress:'Санкт-Петербург, тестовый склад 1',orderIds:[order1,order2]
 },admin.token));
 runId=run.id;
 const info=ok(await t.api('GET','/api/courier/runs/'+runId,undefined,driver.token));
 stops=info.stops;
 assert.equal(stops.length,2);
 assert.equal((await t.api('GET','/api/courier/runs/'+runId,undefined,client1.token)).status,403);
 assert.equal((await t.api('GET','/api/courier/runs/'+runId,undefined,outsider.token)).status,403);
 assert.equal((await t.api('GET','/api/shop/orders/'+order2+'/courier',undefined,client1.token)).status,404);
});

test('courier consent + stop-by-stop GPS, customer signs handoff, last fix is erased on route switch',async()=>{
 ok(await t.api('POST','/api/courier/runs/'+runId+'/accept',{},driver.token));
 for(const stop of stops)ok(await t.api('POST','/api/courier/runs/'+runId+'/stops/'+stop.id+'/collect',{},driver.token));
 ok(await t.api('POST','/api/courier/runs/'+runId+'/start',{},driver.token));
 assert.equal((await t.api('PUT','/api/courier/runs/'+runId+'/position',{
   lat:59.9,lng:30.3,accuracyMeters:20},driver.token)).status,403);
 ok(await t.api('PUT','/api/courier/location-consent',{enabled:true},driver.token));
 ok(await t.api('PUT','/api/courier/runs/'+runId+'/position',{
   lat:59.9,lng:30.3,accuracyMeters:20},driver.token));
 let one=ok(await t.api('GET','/api/shop/orders/'+order1+'/courier',undefined,client1.token));
 let two=ok(await t.api('GET','/api/shop/orders/'+order2+'/courier',undefined,client2.token));
 assert.equal(one.live,true);
 assert.equal(two.live,false);
 assert.ok(!('stops' in one)&&!('customerPhone' in one)&&!('otherAddress' in one));
 assert.equal((await t.api('POST','/api/courier/runs/'+runId+'/stops/'+stops[1].id+'/arrive',
   {},driver.token)).status,409,'cannot serve another customer before current stop');
 ok(await t.api('POST','/api/courier/runs/'+runId+'/stops/'+stops[0].id+'/arrive',{},driver.token));
 assert.equal((await t.api('POST','/api/shop/orders/'+order1+'/confirm-delivery',
   {},client2.token)).status,404);
 ok(await t.api('POST','/api/shop/orders/'+order1+'/confirm-delivery',{},client1.token));
 one=ok(await t.api('GET','/api/shop/orders/'+order1+'/courier',undefined,client1.token));
 two=ok(await t.api('GET','/api/shop/orders/'+order2+'/courier',undefined,client2.token));
 assert.equal(one.live,false);
 assert.equal(two.live,false,'location from first recipient must not leak into second leg');
 ok(await t.api('PUT','/api/courier/runs/'+runId+'/position',{
   lat:59.8,lng:30.4,accuracyMeters:15},driver.token));
 two=ok(await t.api('GET','/api/shop/orders/'+order2+'/courier',undefined,client2.token));
 assert.equal(two.live,true);
 ok(await t.api('POST','/api/courier/runs/'+runId+'/stops/'+stops[1].id+'/arrive',{},driver.token));
 ok(await t.api('POST','/api/shop/orders/'+order2+'/confirm-delivery',{},client2.token));
 two=ok(await t.api('GET','/api/shop/orders/'+order2+'/courier',undefined,client2.token));
 assert.equal(two.live,false);
 assert.equal((await t.db.query('select * from shop_courier_live_positions where run_id=$1',[runId])).length,0);
});
