import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {setup,ok,type T} from './helpers.ts';

let t:T;
let owner:{token:string;id:string},consultant:{token:string;id:string};
let outsider:{token:string;id:string},driver:{token:string;id:string};
before(async()=>{
 t=await setup();
 owner=await t.login('+79997803001');
 consultant=await t.login('+79997803002','master');
 outsider=await t.login('+79997803003');
 driver=await t.login('+79997803004');
});
after(()=>t.close());

test('consultant proposes linked stages: owner approves, but no auto charge or dispatch',async()=>{
 const consult=ok(await t.api('POST','/api/orders',{
  service:'consult',zoneId:'phone',brand:'DAF',description:'Не запускается, нужна консультация',
  paymentMethod:'cash'},owner.token)).order;
 await t.db.query(
  "update orders set status='awaiting_confirmation',performer_id=$2,consult_hint=$3 where id=$1",
  [consult.id,consultant.id,{hints:['электрика'],confidence:'likely',note:'Нужна диагностика'}]);
 const proposal=ok(await t.api('POST','/api/orders/'+consult.id+'/continuations',{
  target:'master',summary:'После разговора рекомендую выездного диагноста для проверки питания'
 },consultant.token));
 assert.equal(proposal.created,true);
 assert.equal(ok(await t.api('POST','/api/orders/'+consult.id+'/continuations',{
  target:'master',summary:'Повтор из-за потери связи не должен создать ещё одну запись'
 },consultant.token)).created,false);
 const items=ok(await t.api('GET','/api/orders/'+consult.id+'/continuations',undefined,owner.token));
 assert.equal(items.length,1);
 assert.equal(items[0].status,'pending');
 assert.equal((await t.api('POST','/api/orders/'+consult.id+'/continuations',{
  target:'master',summary:'Посторонний не назначенный специалист рекомендует услугу'
 },outsider.token)).status,403);
 const next={
  service:'electric',zoneId:'spb',regionId:'spb',brand:'DAF',
  address:'Санкт-Петербург, Софийская улица, 60',
  description:'Диагностика после консультации',fromConsult:consult.id,
  recommendationId:proposal.id,paymentMethod:'cash'
 };
 const before=(await t.db.query('select id from orders where consult_of=$1',[consult.id])).length;
 assert.equal((await t.api('POST','/api/orders',next,owner.token)).status,403,
  'a performer recommendation is not a customer approval');
 assert.equal((await t.db.query('select id from orders where consult_of=$1',[consult.id])).length,before);
 assert.equal((await t.api('POST','/api/orders/'+consult.id+'/continuations/'+proposal.id+'/decision',
  {approve:true},outsider.token)).status,403);
 ok(await t.api('POST','/api/orders/'+consult.id+'/continuations/'+proposal.id+'/decision',
  {approve:true},owner.token));
 assert.equal(ok(await t.api('POST','/api/orders/'+consult.id+'/continuations/'+proposal.id+'/decision',
  {approve:true},owner.token)).status,'approved');
 const follow=ok(await t.api('POST','/api/orders',next,owner.token)).order;
 assert.equal(follow.caseRootId,consult.id);
 assert.equal(follow.consultOf,consult.id);
 assert.notEqual(follow.number,consult.number);
 const linked=ok(await t.api('GET','/api/orders/'+consult.id+'/continuations',undefined,owner.token));
 assert.equal(linked[0].next_order_id,follow.id);
 const exactLink=await t.db.one<{continuation_recommendation_id:string}>(
  'select continuation_recommendation_id from orders where id=$1',[follow.id]);
 assert.equal(exactLink?.continuation_recommendation_id,proposal.id,
  'paid next stage must carry the exact approved recommendation');
 assert.equal((await t.api('POST','/api/orders',{...next,service:'diag'},owner.token)).status,409,
  'another paid order cannot reuse the same approval even for another master specialty');
 assert.equal((await t.db.query('select id from orders where continuation_recommendation_id=$1',[proposal.id])).length,1);
 assert.equal((await t.api('POST','/api/orders/'+consult.id+'/continuations/'+proposal.id+'/decision',
  {approve:false},owner.token)).status,409);
});

test('an older independent consultation follow-up is not mistaken for an approved recommendation',async()=>{
 const consult=ok(await t.api('POST','/api/orders',{
  service:'consult',zoneId:'phone',brand:'DAF',paymentMethod:'cash',
  description:'Первичная дистанционная консультация по проводке'
 },owner.token)).order;
 await t.db.query(
  "update orders set status='awaiting_confirmation',performer_id=$2 where id=$1",
  [consult.id,consultant.id]);
 const legacy=ok(await t.api('POST','/api/orders',{
  service:'diag',zoneId:'spb',regionId:'spb',brand:'DAF',
  address:'Санкт-Петербург, Софийская улица, 61',
  description:'Ранее отдельно оформленный выезд после консультации',
  fromConsult:consult.id,paymentMethod:'cash'
 },owner.token)).order;
 assert.equal(legacy.consultOf,consult.id);
 const advice=ok(await t.api('POST','/api/orders/'+consult.id+'/continuations',{
  target:'master',summary:'Нужно проверить проводку и генератор с выездным электриком'
 },consultant.token));
 const linked=ok(await t.api('GET','/api/orders/'+consult.id+'/continuations',undefined,owner.token));
 assert.equal(linked[0].id,advice.id);
 assert.equal(linked[0].status,'pending');
 assert.equal(linked[0].next_order_id,null,
  'independent earlier order must not impersonate the recommendation');
});

test('consultant can propose ECU: only owner starts station quote flow with no payment',async()=>{
 const consult=ok(await t.api('POST','/api/orders',{
  service:'consult',zoneId:'phone',brand:'Scania',
  description:'Подозрение на ЭБУ, нет связи с блоком',paymentMethod:'cash'
 },owner.token)).order;
 await t.db.query(
  "update orders set status='awaiting_confirmation',performer_id=$2,consult_hint=$3 where id=$1",
  [consult.id,consultant.id,{hints:['электрика'],confidence:'likely',note:'Подозрение на ЭБУ'}]);
 const p=ok(await t.api('POST','/api/orders/'+consult.id+'/continuations',{
  target:'ecu',summary:'Не отвечает блок двигателя, рекомендуется диагностика ЭБУ на стенде'
 },consultant.token));
 const items=ok(await t.api('GET','/api/orders/'+consult.id+'/continuations',undefined,owner.token));
 assert.equal(items[0].target_kind,'ecu');
 ok(await t.api('POST','/api/orders/'+consult.id+'/continuations/'+p.id+'/decision',
  {approve:true},owner.token));
 const count=async()=>(await t.db.query(
  'select id from payments where order_id=$1',[consult.id])).length;
 const before=await count();
 const handed=ok(await t.api('POST','/api/orders/'+consult.id+'/ecu-handoff',{
  summary:'Не отвечает блок двигателя, рекомендуется диагностика ЭБУ на стенде',
  recommendationId:p.id
 },owner.token));
 assert.equal(handed.created,true);
 assert.equal((await t.db.one<{continuation_recommendation_id:string}>(
  'select continuation_recommendation_id from ecu_handoffs where id=$1',[handed.id]
 ))?.continuation_recommendation_id,p.id);
 assert.equal(await count(),before);
 const linked=ok(await t.api('GET','/api/orders/'+consult.id+'/continuations',undefined,owner.token));
 assert.equal(linked[0].next_ecu_handoff_id,handed.id);
 const detail=ok(await t.api('GET','/api/ecu/handoffs/'+handed.id,undefined,owner.token));
 assert.equal(detail.state,'pending');
 assert.equal((await t.api('GET','/api/ecu/handoffs/'+handed.id,undefined,outsider.token)).status,403);
});


test('roadside master recommends tow, owner approves search and a separately priced tow links into the case',async()=>{
 const source=ok(await t.api('POST','/api/orders',{
  service:'electric',zoneId:'spb',regionId:'spb',brand:'MAN',
  address:'Санкт-Петербург, Софийская улица, 60',
  description:'Неисправность на дороге',paymentMethod:'cash'
 },owner.token)).order;
 await t.db.query(
  "update orders set status='arrived',performer_id=$2,arrived_at=$3 where id=$1",
  [source.id,consultant.id,t.clock.now()]);
 const count=async()=>(await t.db.query(
  'select id from orders where continuation_of=$1',[source.id])).length;
 const initial=await count();
 const proposal=ok(await t.api('POST','/api/orders/'+source.id+'/continuations',{
  target:'tow',summary:'На месте устранить поломку невозможно, требуется эвакуировать тягач'
 },consultant.token));
 assert.equal(await count(),initial,'proposal cannot dispatch a tow itself');
 ok(await t.api('POST','/api/orders/'+source.id+'/continuations/'+proposal.id+'/decision',
  {approve:true},owner.token));
 assert.equal(await count(),initial,'owner approval of search still creates no paid job');
 const estimate=ok(await t.api('POST','/api/pricing/estimate',{
  service:'tow',zoneId:'spb',regionId:'spb',
  address:'Санкт-Петербург, Софийская улица, 60'
 }));
 const request={
  service:'tow',zoneId:'spb',regionId:'spb',brand:'MAN',
  address:'Санкт-Петербург, Софийская улица, 60',
  description:'Эвакуировать после диагностики',destination:'Санкт-Петербург, Софийская улица, 70',
  cargo:'tractor',paymentMethod:'cash',parallelWith:source.id,
  recommendationId:proposal.id,parallelConsent:true,parallelCallOut:estimate.callOut,
 };
 assert.equal((await t.api('POST','/api/orders',{...request,parallelConsent:false},owner.token)).status,400);
 const tow=ok(await t.api('POST','/api/orders',request,owner.token)).order;
 assert.equal(tow.caseRootId,source.id);
 assert.equal(tow.continuationOf,source.id);
 assert.equal(tow.parallelTow.secondCallOut,estimate.callOut);
 const listed=ok(await t.api('GET','/api/orders/'+source.id+'/continuations',undefined,owner.token));
 assert.equal(listed[0].next_order_id,tow.id);
 assert.equal((await t.api('POST','/api/orders',request,owner.token)).status,409,
  'repeated second dispatch cannot create a duplicate');
});


test('consultant STO advice creates one numbered same-case workshop booking, without fake referral discount',async()=>{
 const admin=await t.login('+79990000001');
 const service=await t.login('+79997803005','service');
 const center=ok(await t.api('PUT','/api/base',{
  name:'Тестовая грузовая рембаза',address:'Шушары, Московское шоссе, 50',
  staff:{electric:'own'},accepts:['quick','long']
 },service.token)).center;
 ok(await t.api('POST','/api/admin/services/'+center.id+'/verify',
  {decision:'approved'},admin.token));
 const truck=ok(await t.api('POST','/api/vehicles',{
  brand:'DAF',model:'XF',year:2016,plate:'А482КМ178'
 },owner.token));
 const consult=ok(await t.api('POST','/api/orders',{
  service:'consult',zoneId:'phone',vehicleId:truck.id,
  description:'Диагностика двигателя, требуется рембаза',paymentMethod:'cash'
 },owner.token)).order;
 await t.db.query("update orders set status='awaiting_confirmation',performer_id=$2 where id=$1",
  [consult.id,consultant.id]);
 const advice=ok(await t.api('POST','/api/orders/'+consult.id+'/continuations',{
  target:'sto',summary:'После диагностики на стенде требуется ремонт на грузовой рембазе'
 },consultant.token));
 const day=new Date(t.clock.now().getTime()+3*3600_000).toISOString().slice(0,10);
 const booking={vehicleId:truck.id,need:'electric',day,arrival:'tow',
  caseOrderId:consult.id,recommendationId:advice.id};
 assert.equal((await t.api('POST','/api/services/'+center.id+'/book',booking,owner.token)).status,403);
 ok(await t.api('POST','/api/orders/'+consult.id+'/continuations/'+advice.id+'/decision',
  {approve:true},owner.token));
 const booked=ok(await t.api('POST','/api/services/'+center.id+'/book',booking,owner.token));
 assert.equal(booked.caseRootId,consult.id);
 assert.equal(booked.fromOrder,false,'unearned referral discount not created');
 assert.equal((await t.api('POST','/api/services/'+center.id+'/book',booking,owner.token)).status,409);
 const linked=ok(await t.api('GET','/api/orders/'+consult.id+'/continuations',undefined,owner.token));
 assert.equal(linked[0].next_booking_id,booked.id);
 const caseData=ok(await t.api('GET','/api/orders/'+consult.id,undefined,owner.token));
 assert.equal(caseData.caseSummary.multiStage,true);
 assert.equal(caseData.caseSummary.serviceBookings.some((b:any)=>b.id===booked.id),true);
});
