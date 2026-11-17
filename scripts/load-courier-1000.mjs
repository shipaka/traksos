// Isolated 1,000-order courier route-sheet load. No live products, customers,
// payment capture, geocoder, Yandex API, SMS, VPS or external providers.
// Fixture setup uses SQL; planning/read/authorization use real HTTP API.
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {mkdir,writeFile} from 'node:fs/promises';
import {setup,ok} from '../server/test/helpers.ts';

const ROUTES=20,STOPS_PER_ROUTE=50,TOTAL=ROUTES*STOPS_PER_ROUTE;
const start=performance.now(),issues=[];
const t=await setup();
try{
 const admin=await t.login('+79990000001');
 const buyer=await t.login('+79997619999','client');
 const couriers=[];
 for(let i=0;i<ROUTES;i++){
  const person=await t.login('+7999760'+String(i).padStart(4,'0'));
  ok(await t.api('POST','/api/admin/shop/couriers',{
    userId:person.id,displayName:'Тестовый курьер '+(i+1),
    vehicleLabel:'Фургон №'+(i+1)
  },admin.token));
  couriers.push(person);
 }
 // Create 1,000 realistic ready parcel records in disposable PostgreSQL.
 // This bypasses purchase flows ONLY in this mass-routing scenario; the
 // separate shopCourier integration tests exercise real purchase/finance approval.
 const orders=await t.db.query(`
  insert into shop_orders(client_id,created_by,status,items,goods_total,
    delivery,delivery_price,total,address)
  select $1,$1,'ready',
    jsonb_build_array(jsonb_build_object('name','Тестовый датчик EBS',
      'article','TEST-EBS','qty',1)),
    110000,'delivery',15000,125000,
    'Санкт-Петербург, проверенная тестовая стоянка '||g.i
  from generate_series(1,1000) g(i) returning id,number
 `,[buyer.id]);
 assert.equal(orders.length,TOTAL);
 const ids=orders.map(o=>o.id);
 await t.db.query(`
  insert into shop_delivery_address_checks(
    shop_order_id,city_code,reviewed_by,review_note,lat,lng)
  select p.id,'spb',$1,
    'Валидация фиктивных адресов только в одноразовой базе нагрузочного теста',
    59.80+(p.n%100)*0.002,30.10+floor(p.n/100)*0.03
  from unnest($2::uuid[]) with ordinality as p(id,n)
 `,[admin.id,ids]);
 // The entire 1000-parcel queue is grouped on the server. One operator
 // confirmation creates all 20 DRAFT routes atomically; no customer notification.
 const payload={
  courierIds:couriers.map(x=>x.id),
  pickupAddress:'Санкт-Петербург, тестовый склад, 1',
  pickupLat:59.8,pickupLng:30.1,maxStops:STOPS_PER_ROUTE
 };
 const previewStart=performance.now();
 const draft=ok(await t.api('POST','/api/admin/shop/courier-dispatch/preview',
  payload,admin.token));
 const previewMs=Math.round(performance.now()-previewStart);
 assert.equal(draft.plannedOrders,TOTAL);
 assert.equal(draft.batches.length,ROUTES);
 assert.equal(draft.queueTruncated,false);
 const createStart=performance.now();
 const committed=ok(await t.api('POST','/api/admin/shop/courier-dispatch/create',{
  ...payload,expectedSignature:draft.signature,capacityConfirmed:true
 },admin.token));
 const createMs=Math.round(performance.now()-createStart);
 assert.equal(committed.created,true);
 assert.equal(committed.courierNotified,false);
 assert.equal(committed.draftRuns.length,ROUTES);
 assert.equal(committed.plannedOrders,TOTAL);
 const byCourier=new Map(draft.batches.map(b=>[b.courierId,b]));
 const created=committed.draftRuns.map(r=>{
  const courier=couriers.find(x=>x.id===r.courierId);
  const batch=byCourier.get(r.courierId);
  assert.ok(courier&&batch,'route must belong to a selected courier');
  assert.equal(r.stops,STOPS_PER_ROUTE);
  return {...r,courier,orderIds:batch.orderIds};
 });
 const retry=await t.api('POST','/api/admin/shop/courier-dispatch/create',{
  ...payload,expectedSignature:draft.signature,capacityConfirmed:true
 },admin.token);
 assert.equal(retry.status,409,'repeating batch preview cannot reserve twice');
 const createdIds=created.map(x=>x.id);
 assert.equal(new Set(createdIds).size,ROUTES);
 const assignments=await t.db.query(`
  select s.shop_order_id,s.seq,s.run_id from shop_courier_stops s
  where s.run_id=any($1::uuid[]) order by s.run_id,s.seq
 `,[createdIds]);
 assert.equal(assignments.length,TOTAL);
 assert.equal(new Set(assignments.map(x=>x.shop_order_id)).size,TOTAL);
 // This fixture-only dispatch marker makes the real *courier* read endpoint
 // visible without creating fake accounting approvals; production cannot use
 // this shortcut and the normal economy approval remains mandatory.
 await t.db.query(`
  update shop_courier_runs set dispatch_approved_at=now(),
    dispatch_approved_by=$2 where id=any($1::uuid[])
 `,[createdIds,admin.id]);
 const sheets=await Promise.all(created.map(async row=>{
  const result=await t.api('GET','/api/courier/runs/'+row.id,undefined,row.courier.token);
  assert.equal(result.status,200);
  return result.body;
 }));
 for(let i=0;i<sheets.length;i++){
  const sheet=sheets[i],row=created[i];
  assert.equal(sheet.stops.length,50);
  assert.equal(sheet.routePlanning,'coordinate_heuristic');
  assert.deepEqual(sheet.stops.map(x=>x.seq),Array.from({length:50},(_,i)=>i+1));
  assert.ok(sheet.stops.every(x=>Number.isFinite(x.lat)&&Number.isFinite(x.lng)));
  const actual=await t.db.query(`
    select shop_order_id from shop_courier_stops where run_id=$1 order by seq
  `,[row.id]);
  assert.deepEqual(actual.map(x=>x.shop_order_id),row.orderIds,
   'committed route must match confirmed preview order');
 }
 const foreign=await t.api('GET','/api/courier/runs/'+created[1].id,
   undefined,created[0].courier.token);
 assert.equal(foreign.status,404,'cross-courier route disclosure');
 const count=await t.db.one(`
  select count(*)::int as n from shop_courier_stops
  where run_id=any($1::uuid[])
 `,[createdIds]);
 assert.equal(count.n,TOTAL);
 const report={
  scenario:'1000_ready_parcels_20_approved_fixture_courier_sheets',
  environment:'temporary local CI PostgreSQL; no production requests',
  realOrderCreation:false,realRouteCreationAPI:true,realBatchPlanningAPI:true,
  realCourierReadAPI:true,financialApproval:'fixture-only; separately tested',
  orders:TOTAL,courierRuns:ROUTES,stopsPerRun:STOPS_PER_ROUTE,
  duplicateAssignments:0,foreignCourierPrivacy:foreign.status===404,
  autoPlanningMs:{preview:previewMs,atomicCreate:createMs},
  durationMs:Math.round(performance.now()-start),issues
 };
 await mkdir('test-results',{recursive:true});
 await writeFile('test-results/courier-route-1000.json',JSON.stringify(report,null,2));
 console.log('PASS 1,000 READY COURIER PARCELS / 20 ROUTES / 50 STOPS EACH / ORDER AND ACL');
 console.log(JSON.stringify(report,null,2));
}catch(error){
 console.error('COURIER 1000 LOAD FAILED',error);
 await mkdir('test-results',{recursive:true});
 await writeFile('test-results/courier-route-1000.json',JSON.stringify({
  scenario:'courier_route_1000',status:'failed',error:String(error),
  elapsedMs:Math.round(performance.now()-start)
 },null,2));
 process.exitCode=1;
}finally{await t.close()}
