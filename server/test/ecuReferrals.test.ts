import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {setup,ok,type T} from './helpers.ts';

let t:T;
let admin:{id:string;token:string},customer:{id:string;token:string};
let outsider:{id:string;token:string},mechanic:{id:string;token:string};
let expert:{id:string;token:string},sourceId:string,vehicleId:string;
const reason='После проверки питания EBS ошибка блока управления сохраняется. Нужна диагностика специалиста по ЭБУ.';

before(async()=>{
  t=await setup();
  admin=await t.login('+79990000001');
  customer=await t.login('+79998000111');
  outsider=await t.login('+79998000112');
  mechanic=await t.login('+79998000113','master');
  expert=await t.login('+79998000114','master');
  ok(await t.api('PUT','/api/performer/profile',
    {kind:'master',name:'Автоэлектрик',specialties:['electric','diag']},mechanic.token));
  ok(await t.api('PUT','/api/performer/profile',
    {kind:'ecu',name:'Специалист по ЭБУ',specialties:['diag','electric']},expert.token));
  ok(await t.api('POST',`/api/admin/performers/${mechanic.id}/verify`,
    {decision:'approved'},admin.token));
  ok(await t.api('POST',`/api/admin/performers/${expert.id}/verify`,
    {decision:'approved'},admin.token));
  vehicleId=ok(await t.api('POST','/api/vehicles',
    {brand:'Scania',model:'R-series',year:2010,plate:'а456вс178'},
    customer.token)).id;
  const source=ok(await t.api('POST','/api/orders',{
    service:'electric',zoneId:'spb',vehicleId,
    description:'Ошибка EBS и неисправность блока управления тормозной системой',
    address:'Санкт-Петербург, Московское шоссе, 10'
  },customer.token)).order;
  sourceId=source.id;
  // Only the assigned specialist can recommend a second specialist.
  // Set up an accepted first job deterministically, without auction timing.
  await t.db.query('update orders set performer_id=$1,status=$2 where id=$3',
    [mechanic.id,'accepted',sourceId]);
});
after(()=>t.close());

test('ECU has a dedicated verified performer profile without granting unrelated roles',async()=>{
  const profile=ok(await t.api('GET','/api/performer/profile',undefined,expert.token));
  assert.equal(profile.kind,'ecu');
  const me=ok(await t.api('GET','/api/me',undefined,expert.token));
  assert.ok(me.roles.includes('master'));
  assert.ok(!me.roles.includes('client'));
});

test('only assigned performer recommends ECU; outsider and unassigned ECU cannot read it',async()=>{
  assert.ok([403,404].includes((await t.api('POST',
    `/api/orders/${sourceId}/recommend-ecu`,{reason},expert.token)).status));
  assert.ok([403,404].includes((await t.api('POST',
    `/api/orders/${sourceId}/recommend-ecu`,{reason},outsider.token)).status));
  assert.ok([403,404].includes((await t.api('GET',
    `/api/orders/${sourceId}/ecu-recommendations`,undefined,outsider.token)).status));
  assert.ok([403,404].includes((await t.api('GET',
    `/api/orders/${sourceId}/ecu-recommendations`,undefined,expert.token)).status));
  const suggestion=ok(await t.api('POST',
    `/api/orders/${sourceId}/recommend-ecu`,{reason},mechanic.token));
  assert.equal(suggestion.status,'pending');
  assert.equal(suggestion.createsOrder,false);
  assert.equal(suggestion.requiresClientConfirmation,true);
  assert.equal((await t.api('POST',
    `/api/orders/${sourceId}/recommend-ecu`,{reason},mechanic.token)).status,409);
  const ownerView=ok(await t.api('GET',
    `/api/orders/${sourceId}/ecu-recommendations`,undefined,customer.token));
  assert.equal(ownerView.recommendations.length,1);
  assert.equal(ownerView.recommendations[0].reason,reason);
  assert.equal(ownerView.canCreate,true);
});

test('customer can reject recommendation without creating order',async()=>{
  const rows=ok(await t.api('GET',
    `/api/orders/${sourceId}/ecu-recommendations`,undefined,customer.token));
  const ref=rows.recommendations.find((r:any)=>r.status==='pending').id;
  assert.ok([403,404].includes((await t.api('POST',
    `/api/orders/${sourceId}/ecu-recommendations/${ref}/decline`,{},
    outsider.token)).status));
  assert.equal(ok(await t.api('POST',
    `/api/orders/${sourceId}/ecu-recommendations/${ref}/decline`,{},
    customer.token)).status,'declined');
  assert.equal((await t.api('POST',
    `/api/orders/${sourceId}/ecu-recommendations/${ref}/decline`,{},
    customer.token)).status,409);
  const initial=ok(await t.api('GET',`/api/orders/${sourceId}`,undefined,customer.token));
  assert.equal(initial.caseSummary.stages.length,1);
});

test('client-controlled linked ECU order keeps independent contracts and private pricing',async()=>{
  const recommended=ok(await t.api('POST',
    `/api/orders/${sourceId}/recommend-ecu`,{reason},mechanic.token));
  assert.equal(recommended.status,'pending');
  const input={
    service:'ecu',zoneId:'spb',vehicleId,additionalTo:sourceId,
    description:'Отдельная проверка и восстановление электронного блока EBS',
    address:'Санкт-Петербург, Московское шоссе, 10'
  };
  assert.ok([403,404].includes((await t.api('POST','/api/orders',
    input,outsider.token)).status));
  assert.ok([403,404].includes((await t.api('POST','/api/orders',
    input,mechanic.token)).status));
  const requestHeaders={'idempotency-key':'ecu-linked-referrals-test-0001'};
  const linked=ok(await t.api('POST','/api/orders',input,customer.token,requestHeaders)).order;
  assert.notEqual(linked.id,sourceId);
  assert.equal(linked.additionalTo,sourceId);
  assert.equal(linked.caseRootId,sourceId);
  const root=ok(await t.api('GET',`/api/orders/${sourceId}`,undefined,customer.token));
  assert.equal(root.caseSummary.stages.length,2);
  assert.equal(root.caseSummary.separateContracts,true);
  assert.equal(root.caseSummary.stages.find((x:any)=>x.id===linked.id).additionalTo,sourceId);
  const firstTech=ok(await t.api('GET',`/api/orders/${sourceId}`,undefined,mechanic.token));
  assert.equal(firstTech.caseSummary.stages.length,0);
  assert.equal(firstTech.caseOtherStages.length,1);
  assert.ok(!('money' in firstTech.caseOtherStages[0]),
    'first specialist must not see the ECU contractor amounts');
  assert.ok([403,404].includes((await t.api('GET',
    `/api/orders/${linked.id}`,undefined,mechanic.token)).status));
  const retried=ok(await t.api('POST','/api/orders',input,customer.token,requestHeaders)).order;
  assert.equal(retried.id,linked.id,'network retry returns one stable order, never a second charge');
  const duplicateRows=await t.db.query('select id from orders where additional_to=$1 and created_by=$2',[sourceId,customer.id]);
  assert.equal(duplicateRows.length,1);
  const rec=ok(await t.api('GET',
    `/api/orders/${sourceId}/ecu-recommendations`,undefined,customer.token));
  assert.equal(rec.recommendations[0].status,'used');
  assert.equal(rec.recommendations[0].linkedOrderId,linked.id);
});
