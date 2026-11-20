import { before,after,test } from 'node:test';
import assert from 'node:assert/strict';
import { setup,ok,type T } from './helpers.ts';
let t:T;
let owner:{token:string;id:string},master:{token:string;id:string},tow:{token:string;id:string},other:{token:string;id:string};
before(async()=>{t=await setup();owner=await t.login('+79997801001');master=await t.login('+79997801002','master');tow=await t.login('+79997801003','tow');other=await t.login('+79997801004');});
after(()=>t.close());

test('second concurrent tow only after exact owner acknowledgement; prevents double contracts',async()=>{
 const source=ok(await t.api('POST','/api/orders',{
  service:'electric',zoneId:'spb',regionId:'spb',brand:'Scania',
  address:'Санкт-Петербург, Софийская улица, 60',
  description:'Не заводится ЭБУ',paymentMethod:'cash'
 },owner.token)).order;
 await t.db.query("update orders set status='accepted',performer_id=$2,accepted_at=$3 where id=$1",
  [source.id,master.id,t.clock.now()]);
 const estimation=ok(await t.api('POST','/api/pricing/estimate',{
  service:'tow',zoneId:'spb',regionId:'spb',address:'Санкт-Петербург, Софийская улица, 60'
 }));
 const request={
  service:'tow',zoneId:'spb',regionId:'spb',brand:'Scania',
  address:'Санкт-Петербург, Софийская улица, 60',
  description:'Эвакуация одновременно с диагностикой',
  destination:'Санкт-Петербург, ремонтная база, Софийская, 70',
  cargo:'tractor',paymentMethod:'cash',parallelWith:source.id,
 };
 assert.equal((await t.api('POST','/api/orders',{...request},owner.token)).status,400);
 assert.equal((await t.api('POST','/api/orders',{
  ...request,parallelConsent:true,parallelCallOut:estimation.callOut+100
 },owner.token)).status,409);
 assert.equal((await t.api('POST','/api/orders',{
  ...request,parallelConsent:true,parallelCallOut:estimation.callOut
 },other.token)).status,403);
 const child=ok(await t.api('POST','/api/orders',{
  ...request,parallelConsent:true,parallelCallOut:estimation.callOut
 },owner.token)).order;
 assert.equal(child.service,'tow');
 assert.equal(child.continuationOf,source.id);
 assert.equal(child.caseRootId,source.id);
 assert.equal(child.parallelTow.secondCallOut,estimation.callOut);
 assert.notEqual(child.number,source.number);
 assert.equal((await t.api('POST','/api/orders',{
  ...request,parallelConsent:true,parallelCallOut:estimation.callOut
 },owner.token)).status,409);
 assert.equal((await t.db.one<{status:string}>('select status from orders where id=$1',[source.id]))?.status,'accepted');
 await t.db.query("update orders set performer_id=$2,status='arrived' where id=$1",[child.id,tow.id]);
 assert.equal((await t.api('POST','/api/orders/'+child.id+'/step',{action:'start_work'},tow.token)).status,409);
 await t.db.query("update orders set status='completed',result='cause_found' where id=$1",[source.id]);
 ok(await t.api('POST','/api/orders/'+child.id+'/step',{action:'start_work'},tow.token));
 assert.equal((await t.db.one<{status:string}>('select status from orders where id=$1',[child.id]))?.status,'working');
});
test('consult then electrician inherit one multi-case root with different numbers',async()=>{
 const consult=ok(await t.api('POST','/api/orders',{
  service:'consult',zoneId:'phone',brand:'MAN',description:'Неизвестная ошибка при запуске',
  paymentMethod:'cash'
 },owner.token)).order;
 await t.db.query("update orders set status='completed',performer_id=$2,completed_at=$3 where id=$1",
  [consult.id,master.id,t.clock.now()]);
 const follow=ok(await t.api('POST','/api/orders',{
  service:'electric',zoneId:'spb',regionId:'spb',brand:'MAN',
  address:'Санкт-Петербург, Шушары',description:'Осмотр после консультации',
  paymentMethod:'cash',fromConsult:consult.id
 },owner.token)).order;
 assert.equal(follow.caseRootId,consult.id);
 assert.equal(follow.consultOf,consult.id);
 const root=ok(await t.api('GET','/api/orders/'+consult.id,undefined,owner.token));
 assert.equal(root.caseSummary.multiStage,true);
 assert.equal(root.caseSummary.stages.length,2);
});
