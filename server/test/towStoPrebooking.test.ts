import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {setup,ok,type T} from './helpers.ts';

let t:T;
let owner:{id:string;token:string},tow:{id:string;token:string};
let base:{id:string;token:string},admin:{id:string;token:string},other:{id:string;token:string};
before(async()=>{
 t=await setup();
 owner=await t.login('+79997804101');
 tow=await t.login('+79997804102','tow');
 base=await t.login('+79997804103','service');
 other=await t.login('+79997804104');
 admin=await t.login('+79990000001');
});
after(()=>t.close());

test('linked STO can be booked during tow travel but truck cannot be recorded as arrived until delivery',async()=>{
 const garage=ok(await t.api('POST','/api/vehicles',{
   brand:'Scania',model:'R',year:2014,plate:'А401АА178',
 },owner.token));
 const order=ok(await t.api('POST','/api/orders',{
  service:'tow',zoneId:'spb',regionId:'spb',vehicleId:garage.id,
  address:'Санкт-Петербург, Софийская улица, 60',
  destination:'Санкт-Петербург, Московское шоссе, 20',
  description:'Повреждение двигателя, требуется СТО',
  paymentMethod:'cash',cargo:'tractor'
 },owner.token)).order;
 const center=ok(await t.api('PUT','/api/base',{
  name:'СТО для Scania',address:'Санкт-Петербург, Московское шоссе, 20',
  staff:{electric:'own'},accepts:['quick','long']
 },base.token)).center;
 ok(await t.api('POST','/api/admin/services/'+center.id+'/verify',{decision:'approved'},admin.token));
 await t.db.query("update orders set status='en_route',performer_id=$2,accepted_at=$3,en_route_at=$3 where id=$1",
   [order.id,tow.id,t.clock.now()]);
 const proposed=ok(await t.api('POST','/api/orders/'+order.id+'/continuations',{
  target:'sto',summary:'Эвакуируем грузовик в рембазу, просьба заранее подготовить место'
 },tow.token));
 assert.equal(proposed.created,true);
 const before=(await t.db.query('select id from service_bookings where case_root_id=$1',[order.id])).length;
 assert.equal((await t.api('POST','/api/services/'+center.id+'/book',{
  vehicleId:garage.id,need:'electric',day:'2026-12-02',arrival:'tow',
  caseOrderId:order.id,recommendationId:proposed.id
 },owner.token)).status,403,'the worker recommendation alone is not owner consent');
 assert.equal((await t.db.query('select id from service_bookings where case_root_id=$1',[order.id])).length,before);
 assert.equal((await t.api('POST','/api/orders/'+order.id+'/continuations/'+proposed.id+'/decision',
  {approve:true},other.token)).status,403);
 ok(await t.api('POST','/api/orders/'+order.id+'/continuations/'+proposed.id+'/decision',
  {approve:true},owner.token));
 const booking=ok(await t.api('POST','/api/services/'+center.id+'/book',{
  vehicleId:garage.id,need:'electric',day:'2026-12-02',arrival:'tow',
  caseOrderId:order.id,recommendationId:proposed.id,
  comment:'Ждём эвакуатор, не отмечать прибытие до фактической доставки'
 },owner.token));
 assert.equal(booking.caseRootId,order.id);
 assert.equal(booking.fromOrder,false,'an in-case prebooking does not invent a workshop referral discount');
 assert.equal(booking.status,'new');
 assert.equal(booking.transport.orderNumber,order.number);
 assert.equal(booking.handoff.sourceNumber,order.number);
 assert.match(booking.handoff.summary,/подготовить место/);
 assert.ok(booking.handoff.suggestedBy,'the original tow performer is recorded in the workshop handoff');
 assert.equal(booking.transport.status,'en_route');
 assert.equal(booking.transport.deliveryReported,false);
 assert.equal((await t.api('POST','/api/services/'+center.id+'/book',{
  vehicleId:garage.id,need:'electric',day:'2026-12-02',arrival:'tow',
  caseOrderId:order.id,recommendationId:proposed.id
 },owner.token)).status,409,'same signed recommendation cannot make another STO booking');
 ok(await t.api('POST','/api/base/bookings/'+booking.id+'/respond',{action:'accept'},base.token));
 const statusBefore=await t.db.one<{status:string;arrived_at:Date|null}>(
  'select status,arrived_at from service_bookings where id=$1',[booking.id]);
 assert.equal(statusBefore?.status,'expected');
 for(const status of ['arrived','in_work','diagnostics']){
  const attempt=await t.api('POST','/api/base/bookings/'+booking.id+'/status',{status},base.token);
  assert.equal(attempt.status,409,'a service must not mark a still-transported truck on site: '+status);
 }
 const pending=await t.db.one<{status:string;arrived_at:Date|null}>(
  'select status,arrived_at from service_bookings where id=$1',[booking.id]);
 assert.equal(pending?.status,'expected');
 assert.equal(pending?.arrived_at,null);
 const caseBefore=ok(await t.api('GET','/api/orders/'+order.id,undefined,owner.token));
 assert.equal(caseBefore.caseSummary.multiStage,true);
 assert.equal(caseBefore.caseSummary.serviceBookings.some((b:any)=>b.id===booking.id),true);
 assert.equal(caseBefore.caseSummary.confirmedTotal,0,'STO future reservation must not charge a repair');
 // The driver has reported delivery, but arrival is still an explicit STO action.
 await t.db.query("update orders set status='awaiting_confirmation' where id=$1",[order.id]);
 const receipt=ok(await t.api('GET','/api/bookings/'+booking.id,undefined,base.token));
 assert.equal(receipt.transport.deliveryReported,true);
 assert.equal(receipt.status,'expected','reported delivery is not automatic check-in');
 ok(await t.api('POST','/api/base/bookings/'+booking.id+'/status',{status:'arrived'},base.token));
 const accepted=ok(await t.api('GET','/api/bookings/'+booking.id,undefined,owner.token));
 assert.equal(accepted.status,'arrived');
 assert.ok(accepted.arrivedAt);
});
