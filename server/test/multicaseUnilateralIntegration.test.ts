import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {setup,ok,type T} from './helpers.ts';

// Integration of #169 multi-stage owner approvals with #175 emergency closure.
// All three contracts keep independent status, money and actor permissions.
let t:T;
let owner:{id:string;token:string},diagnostician:{id:string;token:string},driver:{id:string;token:string};
before(async()=>{
 t=await setup();
 owner=await t.login('+79997809601');
 diagnostician=await t.login('+79997809602','master');
 driver=await t.login('+79997809603');
});
after(()=>t.close());

test('consult → roadside master emergency report → owner-approved parallel tow keeps contracts and money independent',async()=>{
 const consult=ok(await t.api('POST','/api/orders',{
  service:'consult',zoneId:'phone',brand:'Scania',paymentMethod:'cash',
  description:'Нет зарядки, требуется проверка проводки и генератора',
 },owner.token)).order;
 await t.db.query(
  "update orders set status='awaiting_confirmation',performer_id=$2,consult_hint=$3 where id=$1",
  [consult.id,diagnostician.id,{hints:['электрика'],confidence:'likely',note:'Проверить генератор'}]);

 const rec=ok(await t.api('POST','/api/orders/'+consult.id+'/continuations',{
  target:'master',summary:'После телефонной диагностики нужен выезд для проверки генератора',
 },diagnostician.token));
 ok(await t.api('POST','/api/orders/'+consult.id+'/continuations/'+rec.id+'/decision',
  {approve:true},owner.token));
 const visit=ok(await t.api('POST','/api/orders',{
  service:'electric',zoneId:'spb',regionId:'spb',brand:'Scania',
  address:'Санкт-Петербург, Софийская улица, 60',
  description:'Выездной мастер проверяет электрические цепи',
  paymentMethod:'cash',fromConsult:consult.id,recommendationId:rec.id
 },owner.token)).order;
 assert.equal(visit.caseRootId,consult.id);
 const frozen={end:t.clock.now().toISOString(),hour:250000,step:60,units:1,
  time:250000,wait:0,waitMinutes:0,extras:[],total:250000};
 await t.db.query(
  `update orders set status='awaiting_confirmation',performer_id=$2,work_amount=$3,
   bill=$4,amount_proposed_at=$5 where id=$1`,
  [visit.id,diagnostician.id,250000,frozen,t.clock.now()]);
 await t.db.query("update performer_profiles set line_status='on_job' where user_id=$1",[diagnostician.id]);

 const request={requestKey:'multicase-visit-emergency-20261119',
  reason:'client_offline',workFinished:true,
  note:'Диагностика на дороге закончена, заказчик не отвечает, машина передана водителю.'};
 const closed=ok(await t.api('POST','/api/orders/'+visit.id+'/emergency-close',
  request,diagnostician.token));
 assert.equal(closed.status,'pending_client');
 assert.equal((await t.app.orders.busyWith(t.db,diagnostician.id,null)),false);
 assert.equal((await t.api('POST','/api/orders/'+visit.id+'/emergency-close',
  {...request,requestKey:'another-key-20261119'},diagnostician.token)).status,409);

 const nextRec=ok(await t.api('POST','/api/orders/'+visit.id+'/continuations',{
  target:'tow',summary:'На дороге двигатель не восстановить, нужна эвакуация до рембазы',
 },diagnostician.token));
 assert.equal((await t.api('POST','/api/orders/'+visit.id+'/continuations/'+nextRec.id+'/decision',
  {approve:true},driver.token)).status,403);
 ok(await t.api('POST','/api/orders/'+visit.id+'/continuations/'+nextRec.id+'/decision',
  {approve:true},owner.token));
 const price=ok(await t.api('POST','/api/pricing/estimate',{
  service:'tow',zoneId:'spb',regionId:'spb',
  address:'Санкт-Петербург, Софийская улица, 60'
 }));
 const tow=ok(await t.api('POST','/api/orders',{
  service:'tow',zoneId:'spb',regionId:'spb',brand:'Scania',
  address:'Санкт-Петербург, Софийская улица, 60',
  destination:'Санкт-Петербург, Московское шоссе, 20',
  description:'Эвакуировать до рембазы по согласованию владельца',cargo:'tractor',
  paymentMethod:'cash',parallelWith:visit.id,recommendationId:nextRec.id,
  parallelConsent:true,parallelCallOut:price.callOut,
 },owner.token)).order;
 assert.equal(tow.caseRootId,consult.id);
 assert.equal(tow.continuationOf,visit.id);
 assert.notEqual(tow.id,visit.id);
 const states=await t.db.query<any>(
  'select id,status,amount_confirmed_at,completed_at from orders where id=any($1::uuid[])',
  [[consult.id,visit.id,tow.id]]);
 assert.equal(states.find(x=>x.id===visit.id)?.status,'awaiting_confirmation');
 assert.equal(states.find(x=>x.id===visit.id)?.amount_confirmed_at,null);
 assert.equal(states.find(x=>x.id===visit.id)?.completed_at,null);
 assert.equal(states.find(x=>x.id===tow.id)?.status,'searching');
 const root=ok(await t.api('GET','/api/orders/'+consult.id,undefined,owner.token));
 assert.equal(root.caseSummary.stages.length,3);
 assert.equal(root.caseSummary.confirmedTotal,0);
 const view=ok(await t.api('GET','/api/orders/'+visit.id,undefined,owner.token));
 assert.equal(view.unilateralClosure.status,'pending_client');
 assert.equal(view.statusLabel,'Работа сдана · ожидаем клиента');
 const confirmed=ok(await t.api('POST','/api/orders/'+visit.id+'/confirm',
  {total:view.unilateralClosure.quoteTotal},owner.token));
 assert.equal(confirmed.status,'completed');
 assert.equal(confirmed.unilateralClosure.status,'accepted');
 const towAfter=await t.db.one<any>('select status,completed_at from orders where id=$1',[tow.id]);
 assert.equal(towAfter?.status,'searching','approval of one stage cannot close the tow');
 assert.equal(towAfter?.completed_at,null);
});
