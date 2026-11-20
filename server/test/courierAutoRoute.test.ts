import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setup,ok} from './helpers.ts';
import {greatCircleKm,planCourierRoute} from '../src/services/shopCourierRoute.ts';

test('50 verified stops are deterministic, ordered, unique and no worse than initial path',()=>{
 const origin={lat:59.93,lng:30.32};
 const points=Array.from({length:50},(_,i)=>({
  id:String(i),lat:59.75+(i%10)*.03,lng:30.1+Math.floor(i/10)*.06
 })).reverse();
 const a=planCourierRoute(origin,points),b=planCourierRoute(origin,points);
 assert.deepEqual(a,b);
 assert.equal(a.planning,'coordinate_heuristic');
 assert.equal(new Set(a.orderedIds).size,50);
 assert.equal(a.orderedIds.length,50);
 const byId=new Map(points.map(p=>[p.id,p]));
 const sum=(ids:string[])=>ids.reduce((total,id,i)=>{
  const current=byId.get(id)!;
  return total+greatCircleKm(i?byId.get(ids[i-1])!:origin,current);
 },0);
 assert.ok(sum(a.orderedIds)<=sum(points.map(p=>p.id))+1e-7,
  'automatic coordinate order must not make a previously supplied route worse');
 assert.ok(a.directKm!==null&&a.directKm>0);
});
test('incomplete verified coordinates preserve manual sequence with no fake distance',()=>{
 const points=[{id:'B',lat:59.9,lng:30.2},{id:'A',lat:NaN,lng:NaN}];
 const result=planCourierRoute({lat:59.93,lng:30.32},points);
 assert.deepEqual(result.orderedIds,['B','A']);
 assert.equal(result.planning,'manual_coordinates_missing');
 assert.equal(result.directKm,null);
 assert.deepEqual(planCourierRoute(null,points).orderedIds,['B','A']);
 assert.throws(()=>planCourierRoute(null,[points[0],points[0]]),/duplicate/);
});
test('approved courier opens ordered sheet; no unapproved route or чужой адрес',async()=>{
 const t=await setup();
 try{
  const admin=await t.login('+79990000001');
  const courier=await t.login('+79997777001');
  const another=await t.login('+79997777002');
  const clients=await Promise.all([
   t.login('+79997777003','client'),
   t.login('+79997777004','client'),
   t.login('+79997777005','client')
  ]);
  ok(await t.api('PUT','/api/admin/settings/shop',{enabled:true,delivery:true},admin.token));
  const product=ok(await t.api('POST','/api/admin/shop/products',{
   name:'Датчик EBS для проверки курьера',category:'sensors',price:110000,stock:12
  },admin.token));
  ok(await t.api('PUT','/api/admin/shop/products/'+product.id+'/costing',{
   purchaseCostKopecks:50000,markupBps:3000,
   costSourceNote:'Тестовое подтверждение закупочной цены'
  },admin.token));
  for(const u of [courier,another])ok(await t.api('POST','/api/admin/shop/couriers',{
   userId:u.id,displayName:'Курьер маршрутов',vehicleLabel:'Фургон тестовый'
  },admin.token));
  const coords=[{lat:59.901,lng:30.30},{lat:59.950,lng:30.30},{lat:59.910,lng:30.30}];
  const ids:string[]=[];
  for(let i=0;i<clients.length;i++){
   const u=clients[i];
   ok(await t.api('PUT','/api/shop/region',{city:'Санкт-Петербург'},u.token));
   const created=ok(await t.api('POST','/api/shop/orders',{
    items:[{productId:product.id,qty:1}],delivery:'delivery',
    address:'Санкт-Петербург, тестовая точка '+(i+1)
   },u.token));
   ids.push(created.id);
   for(const status of ['confirmed','ready'])ok(await t.api('POST',
    '/api/admin/shop/orders/'+created.id+'/status',{status},admin.token));
   ok(await t.api('POST','/api/admin/shop/delivery-addresses/'+created.id+'/verify',{
    cityCode:'spb',evidence:'Проверенный адрес тестовой координаты на карте',
    lat:coords[i].lat,lng:coords[i].lng
   },admin.token));
  }
  const reversed=[ids[1],ids[2],ids[0]];
  const run=ok(await t.api('POST','/api/admin/shop/courier-runs',{
   courierId:courier.id,pickupAddress:'Санкт-Петербург, тестовый склад, 1',
   pickupLat:59.900,pickupLng:30.300,orderIds:reversed
  },admin.token));
  assert.equal(run.routePlanning,'coordinate_heuristic');
  assert.ok(run.directKm>0);
  assert.equal((await t.api('GET','/api/courier/runs/'+run.id,undefined,courier.token)).status,404,
   'courier cannot bypass admin financial approval');
  assert.equal((await t.api('GET','/api/courier/runs/'+run.id,undefined,another.token)).status,404);
  const expected=planCourierRoute({lat:59.900,lng:30.300},
   reversed.map(id=>({...coords[ids.indexOf(id)],id}))).orderedIds;
  const stops=await t.db.query<{shop_order_id:string;seq:number}>(
   'select shop_order_id,seq from shop_courier_stops where run_id=$1 order by seq',[run.id]);
  assert.deepEqual(stops.map(s=>s.shop_order_id),expected);
  ok(await t.api('PUT','/api/admin/shop/courier-runs/'+run.id+'/budget',{
   courierPayKopecks:1000,fuelKopecks:1000,packingKopecks:300,
   acquiringKopecks:300,taxesKopecks:300,otherKopecks:300,
   note:'Проверенная смета тестового рейса из трёх адресов'
  },admin.token));
  ok(await t.api('POST','/api/admin/shop/courier-runs/'+run.id+'/approve-dispatch',
   {},admin.token));
  const sheet=ok(await t.api('GET','/api/courier/runs/'+run.id,undefined,courier.token));
  assert.equal(sheet.routePlanning,'coordinate_heuristic');
  assert.equal(sheet.stops.length,3);
  assert.deepEqual(sheet.stops.map((x:any)=>x.seq),[1,2,3]);
  assert.equal(sheet.pickupLat,59.9);
  assert.ok(sheet.stops.every((x:any)=>Number.isFinite(x.lat)&&Number.isFinite(x.lng)));
  assert.equal((await t.api('GET','/api/courier/runs/'+run.id,undefined,another.token)).status,404);
 }finally{await t.close()}
});
