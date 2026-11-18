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
 assert.equal((await t.api('POST','/api/orders/'+consult.id+'/continuations/'+proposal.id+'/decision',
  {approve:false},owner.token)).status,409);
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
  summary:'Не отвечает блок двигателя, рекомендуется диагностика ЭБУ на стенде'
 },owner.token));
 assert.equal(handed.created,true);
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
