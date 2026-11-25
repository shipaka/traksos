import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {setup,ok,type T} from './helpers.ts';

// Real HTTP API and migrated PostgreSQL. No fake owner approval or billing.
// Keeps a single incident root while protecting each separate contract.
let t:T;
let owner:{id:string;token:string},driver:{id:string;token:string};
let consultant:{id:string;token:string},towDriver:{id:string;token:string};
let workshop:{id:string;token:string},admin:{id:string;token:string};
before(async()=>{
 t=await setup();
 owner=await t.login('+79997806501');
 driver=await t.login('+79997806502');
 consultant=await t.login('+79997806503','master');
 towDriver=await t.login('+79997806504','tow');
 workshop=await t.login('+79997806505','service');
 admin=await t.login('+79990000001');
});
after(()=>t.close());

test('one incident: consultation → roadside master → parallel tow → prebooked STO, owner controls every step',async()=>{
 const truck=ok(await t.api('POST','/api/vehicles',{
  brand:'Scania',model:'R',year:2014,plate:'А830МХ178'
 },owner.token));
 const qr=ok(await t.api('GET','/api/fleet',undefined,owner.token)).cars[0].qrCode;
 ok(await t.api('POST','/api/qr/'+qr+'/join',{},driver.token));
 const fleetDriver=await t.db.one<{owner_id:string}>('select owner_id from users where id=$1',[driver.id]);
 assert.equal(fleetDriver?.owner_id,owner.id);

 const consult=ok(await t.api('POST','/api/orders',{
  service:'consult',zoneId:'phone',vehicleId:truck.id,
  description:'Тягач потерял питание, нужна консультация',paymentMethod:'cash'
 },owner.token)).order;
 await t.db.query("update orders set status='awaiting_confirmation',performer_id=$2 where id=$1",
  [consult.id,consultant.id]);
 const visitAdvice=ok(await t.api('POST','/api/orders/'+consult.id+'/continuations',{
  target:'master',summary:'После беседы нужна проверка генератора и силовой цепи непосредственно на машине'
 },consultant.token));
 const ownerDecision='/api/orders/'+consult.id+'/continuations/'+visitAdvice.id+'/decision';
 assert.equal((await t.api('POST',ownerDecision,{approve:true},driver.token)).status,403,
  'fleet driver never approves an additional paid visit');
 ok(await t.api('POST',ownerDecision,{approve:true},owner.token));
 const visit=ok(await t.api('POST','/api/orders',{
  service:'electric',zoneId:'spb',regionId:'spb',vehicleId:truck.id,
  address:'Санкт-Петербург, Софийская улица, 60',
  description:'Диагностика после консультации',paymentMethod:'cash',
  fromConsult:consult.id,recommendationId:visitAdvice.id
 },owner.token)).order;
 assert.equal(visit.caseRootId,consult.id);
 assert.equal(visit.consultOf,consult.id);

 await t.db.query(
  "update orders set status='arrived',performer_id=$2,arrived_at=$3 where id=$1",
  [visit.id,consultant.id,t.clock.now()]);
 const towAdvice=ok(await t.api('POST','/api/orders/'+visit.id+'/continuations',{
  target:'tow',summary:'Питание восстановить на дороге нельзя: нужен эвакуатор до грузовой рембазы'
 },consultant.token));
 assert.equal((await t.api('POST','/api/orders/'+visit.id+'/continuations/'+towAdvice.id+'/decision',
  {approve:true},driver.token)).status,403);
 ok(await t.api('POST','/api/orders/'+visit.id+'/continuations/'+towAdvice.id+'/decision',
  {approve:true},owner.token));
 const estimate=ok(await t.api('POST','/api/pricing/estimate',{
  service:'tow',zoneId:'spb',regionId:'spb',address:'Санкт-Петербург, Софийская улица, 60'
 }));
 const towBody={
  service:'tow',zoneId:'spb',regionId:'spb',vehicleId:truck.id,
  address:'Санкт-Петербург, Софийская улица, 60',
  destination:'Санкт-Петербург, Московское шоссе, 20',
  description:'Везти тягач на рембазу после осмотра',cargo:'tractor',
  paymentMethod:'cash',parallelWith:visit.id,recommendationId:towAdvice.id,
  parallelConsent:true,parallelCallOut:estimate.callOut
 };
 assert.equal((await t.api('POST','/api/orders',towBody,driver.token)).status,403,
  'driver must not approve a second paid call-out even with the exact quoted price');
 const tow=ok(await t.api('POST','/api/orders',towBody,owner.token)).order;
 assert.equal(tow.caseRootId,consult.id);
 assert.equal(tow.continuationOf,visit.id);
 assert.equal(tow.parallelTow.secondCallOut,estimate.callOut);
 assert.equal((await t.api('POST','/api/orders',towBody,owner.token)).status,409,
  'double tap cannot create another towing contract');

 const garage=ok(await t.api('PUT','/api/base',{
  name:'Рембаза для Scania',address:'Санкт-Петербург, Московское шоссе, 20',
  staff:{electric:'own'},accepts:['quick','long']
 },workshop.token)).center;
 ok(await t.api('POST','/api/admin/services/'+garage.id+'/verify',
  {decision:'approved'},admin.token));
 await t.db.query(
  "update orders set status='en_route',performer_id=$2,accepted_at=$3,en_route_at=$3 where id=$1",
  [tow.id,towDriver.id,t.clock.now()]);
 const stoAdvice=ok(await t.api('POST','/api/orders/'+tow.id+'/continuations',{
  target:'sto',summary:'Эвакуация до согласованной грузовой рембазы; требуется подготовить диагностическое место'
 },towDriver.token));
 const bookingBody={
  vehicleId:truck.id,need:'electric',day:'2026-12-02',arrival:'tow',
  caseOrderId:tow.id,recommendationId:stoAdvice.id,
 };
 assert.equal((await t.api('POST','/api/services/'+garage.id+'/book',
  bookingBody,owner.token)).status,403,'advice does not reserve a paid workshop stage');
 ok(await t.api('POST','/api/orders/'+tow.id+'/continuations/'+stoAdvice.id+'/decision',
  {approve:true},owner.token));
 assert.equal((await t.api('POST','/api/services/'+garage.id+'/book',
  bookingBody,driver.token)).status,403,
  'the driver cannot turn owner approval into a separate workshop contract');
 const booking=ok(await t.api('POST','/api/services/'+garage.id+'/book',
  bookingBody,owner.token));
 assert.equal(booking.caseRootId,consult.id);
 assert.equal(booking.fromOrder,false,'no fabricated referral discount');
 assert.equal(booking.status,'new');
 assert.equal(booking.transport.deliveryReported,false);
 assert.equal((await t.api('POST','/api/services/'+garage.id+'/book',
  bookingBody,owner.token)).status,409);

 ok(await t.api('POST','/api/base/bookings/'+booking.id+'/respond',
  {action:'accept'},workshop.token));
 assert.equal((await t.api('POST','/api/base/bookings/'+booking.id+'/status',
  {status:'arrived'},workshop.token)).status,409,
  'the workshop cannot claim arrival while tow is still en route');
 const root=ok(await t.api('GET','/api/orders/'+consult.id,undefined,owner.token));
 assert.equal(root.caseSummary.multiStage,true);
 assert.equal(root.caseSummary.stages.length,3);
 assert.equal(root.caseSummary.serviceBookings.some((b:any)=>b.id===booking.id),true);
 assert.equal(root.caseSummary.confirmedTotal,0,
  'booking a future workshop cannot confirm any bill');
 const states=await t.db.query<{id:string;status:string}>(
  'select id,status from orders where id=any($1::uuid[])',[[consult.id,visit.id,tow.id]]);
 assert.equal(states.find(x=>x.id===consult.id)?.status,'awaiting_confirmation');
 assert.equal(states.find(x=>x.id===visit.id)?.status,'arrived');
 assert.equal(states.find(x=>x.id===tow.id)?.status,'en_route');
 const links=await t.db.query<{continuation_recommendation_id:string|null}>(
  'select continuation_recommendation_id from orders where id=any($1::uuid[])',[[visit.id,tow.id]]);
 assert.deepEqual(new Set(links.map(x=>x.continuation_recommendation_id)),
  new Set([visitAdvice.id,towAdvice.id]));
});
