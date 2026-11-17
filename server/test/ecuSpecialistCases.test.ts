import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setup,ok} from './helpers.ts';

async function createSource(t:Awaited<ReturnType<typeof setup>>,token:string){
  const made=ok(await t.api('POST','/api/orders',{
    service:'electric',zoneId:'spb',tier:'eco',isSos:false,
    paymentMethod:'cash',brand:'Renault',model:'Premium',year:2010,
    address:'Санкт-Петербург, тестовая ремонтная площадка 22',
    description:'Проверка питания электронного блока и неисправности проводки грузовика'
  },token));
  return made.order.id as string;
}

test('linked ECU order keeps distinct payment/performer/status and client-only case totals',async()=>{
 const t=await setup();
 try{
  const admin=await t.login('+79990000001');
  const client=await t.login('+79994620001','client');
  const outsider=await t.login('+79994620002','client');
  const master=await t.login('+79994620003','master');
  const ecu=await t.login('+79994620004','master');
  ok(await t.api('PUT','/api/performer/profile',{
    kind:'master',name:'Электрик для связанного ремонта',
    specialties:['electric'],taxStatus:'self_employed',inn:'780004620003'
  },master.token));
  ok(await t.api('PUT','/api/performer/profile',{
    kind:'ecu',name:'Инженер ЭБУ для связанного ремонта',
    specialties:['diag','electric'],taxStatus:'self_employed',inn:'780004620004'
  },ecu.token));
  ok(await t.api('POST','/api/admin/performers/'+master.id+'/verify',
    {decision:'approved'},admin.token));
  ok(await t.api('POST','/api/admin/performers/'+ecu.id+'/verify',
    {decision:'approved'},admin.token));
  const profile=ok(await t.api('GET','/api/performer/profile',undefined,ecu.token));
  assert.equal(profile.kind,'ecu');
  const first=await createSource(t,client.token);
  await t.db.query("update orders set performer_id=$2,status='accepted' where id=$1",
    [first,master.id]);
  const reason='После осмотра проводки требуется диагностика и программирование электронного блока ЭБУ.';
  assert.equal((await t.api('POST','/api/orders/'+first+'/recommend-ecu',
    {reason},ecu.token)).status,403,'other master cannot recommend from someone else\'s order');
  const referral=ok(await t.api('POST','/api/orders/'+first+'/recommend-ecu',
    {reason},master.token));
  assert.equal(referral.createsOrder,false,'first technician cannot open chargeable order');
  const refPath='/api/orders/'+first+'/ecu-recommendations';
  assert.equal(ok(await t.api('GET',refPath,undefined,client.token)).recommendations[0].status,'pending');
  assert.equal((await t.api('GET',refPath,undefined,outsider.token)).status,404);
  assert.equal((await t.api('POST','/api/orders/'+first+'/recommend-ecu',
    {reason},master.token)).status,409);

  const addition={
    service:'ecu',zoneId:'spb',tier:'pro',
    paymentMethod:'cash',additionalTo:first,
    description:'Отдельная диагностическая работа с ЭБУ по рекомендации электрика',
    address:'Санкт-Петербург, тестовая ремонтная площадка 22'
  };
  assert.equal((await t.api('POST','/api/orders',{...addition,service:'diag'},
    client.token)).status,400,'unsupported additional service must never silently merge contracts');
  assert.equal((await t.api('POST','/api/orders',{...addition,zoneId:'lo'},
    client.token)).status,400,'linked service must use parent quotation region');
  assert.equal((await t.api('POST','/api/orders',{...addition,brand:'Scania'},
    client.token)).status,400,'different vehicle forbidden');
  assert.equal((await t.api('POST','/api/orders',addition,outsider.token)).status,403);
  const second=ok(await t.api('POST','/api/orders',addition,client.token));
  assert.ok(second.order.id);
  assert.notEqual(second.order.id,first);
  assert.equal(second.order.service,'ecu');
  assert.equal(second.order.additionalTo,first);
  assert.equal(second.order.caseRootId,first);
  assert.equal(second.order.brand,'Renault');
  assert.equal(second.order.model,'Premium');
  assert.equal(second.order.year,2010);
  assert.equal(second.order.you,'client');
  const paymentRecords=await t.db.query<{order_id:string}>(
    'select order_id from payments where order_id=any($1::uuid[])',[[first,second.order.id]]);
  assert.ok(!paymentRecords.some(row=>!([first,second.order.id] as string[]).includes(row.order_id)));
  // Dispatch may immediately mark this test order as no_performer: make it
  // an active ECU stage before asserting duplicate prevention. A truly failed
  // dispatch is intentionally eligible for a fresh, explicit retry.
  await t.db.query("update orders set status='searching' where id=$1",[second.order.id]);
  assert.equal((await t.api('POST','/api/orders',addition,client.token)).status,409,
    'one parent cannot silently create two concurrent live ECU charges');
  const source=ok(await t.api('GET','/api/orders/'+first,undefined,client.token));
  assert.equal(source.caseSummary.stages.length,2);
  assert.equal(source.caseSummary.separateContracts,true);
  assert.equal(source.caseSummary.confirmedTotal,0,
    'pending stages must never be counted as paid/completed');
  assert.equal(source.caseSummary.pendingCount,2);
  assert.equal(source.caseSummary.stages[1].additionalTo,first);
  const recommendations=ok(await t.api('GET',refPath,undefined,client.token));
  assert.equal(recommendations.recommendations[0].status,'used');
  assert.equal(recommendations.recommendations[0].linkedOrderId,second.order.id);
  assert.equal((await t.api('GET','/api/orders/'+second.order.id,
    undefined,master.token)).status,403,
    'earlier electrician has no access to ECU technician own contract');
  assert.equal((await t.api('GET','/api/orders/'+first,
    undefined,ecu.token)).status,403,
    'ECU cannot read earlier contractor chat and finance');
  await t.db.query("update orders set performer_id=$2,status='accepted' where id=$1",
    [second.order.id,ecu.id]);
  const specialist=ok(await t.api('GET','/api/orders/'+second.order.id,undefined,ecu.token));
  assert.equal(specialist.you,'performer');
  assert.equal(specialist.caseSummary.stages.length,0);
  assert.equal(specialist.caseSummary.confirmedTotal,0);
  assert.deepEqual(specialist.caseOtherStages.map((x:any)=>x.number),[source.number]);
  assert.ok(!JSON.stringify(specialist.caseOtherStages).includes('resultNote'));
  assert.ok(!JSON.stringify(specialist.caseOtherStages).includes('money'));
  const mine=ok(await t.api('GET','/api/orders?as=performer',undefined,ecu.token));
  assert.equal(mine.length,1);
  assert.equal(mine[0].parent_number,source.number);
  assert.equal(mine[0].additional_to,first);
  assert.equal((await t.api('GET',refPath,undefined,outsider.token)).status,404);
 }finally{await t.close()}
});

test('declined ECU recommendation remains non-chargeable and cannot be processed twice',async()=>{
 const t=await setup();
 try{
  const client=await t.login('+79994620011','client');
  const master=await t.login('+79994620012','master');
  const outsider=await t.login('+79994620013','client');
  const sourceId=await createSource(t,client.token);
  await t.db.query("update orders set performer_id=$2,status='working' where id=$1",
    [sourceId,master.id]);
  const reason='Требуется проверить аппаратный блок управления после основной диагностики проводки.';
  const ref=ok(await t.api('POST','/api/orders/'+sourceId+'/recommend-ecu',
    {reason},master.token));
  assert.equal((await t.api('POST','/api/orders/'+sourceId+
    '/ecu-recommendations/'+ref.id+'/decline',{},outsider.token)).status,403);
  const rejected=ok(await t.api('POST','/api/orders/'+sourceId+
    '/ecu-recommendations/'+ref.id+'/decline',{},client.token));
  assert.equal(rejected.status,'declined');
  assert.equal(rejected.createsOrder,false);
  assert.equal((await t.api('POST','/api/orders/'+sourceId+
    '/ecu-recommendations/'+ref.id+'/decline',{},client.token)).status,409);
  assert.equal((await t.db.query('select id from orders where additional_to=$1',
    [sourceId])).length,0);
 }finally{await t.close()}
});

test('fleet driver cannot read owner-created ECU charges within a shared case',async()=>{
 const t=await setup();
 try{
  const owner=await t.login('+79994620021','client');
  const driver=await t.login('+79994620022','driver');
  const master=await t.login('+79994620023','master');
  // Driver belongs to the fleet; the order is owned by the fleet but created
  // by the driver. This must not expose unrelated follow-up contracts.
  await t.db.query('update users set owner_id=$2 where id=$1',[driver.id,owner.id]);
  const root=await createSource(t,driver.token);
  await t.db.query("update orders set performer_id=$2,status='accepted' where id=$1",
    [root,master.id]);
  const additional={
    service:'ecu',zoneId:'spb',tier:'pro',paymentMethod:'cash',
    additionalTo:root,
    description:'Отдельная диагностика и ремонт ЭБУ для машины из парка',
    address:'Санкт-Петербург, тестовая ремонтная площадка 22'
  };
  const child=ok(await t.api('POST','/api/orders',additional,owner.token)).order;
  // Prove that the private active-stage flag works, independent of whether
  // any expert happens to be online during this deterministic unit test.
  await t.db.query("update orders set status='searching' where id=$1",[child.id]);
  const ownerView=ok(await t.api('GET','/api/orders/'+root,undefined,owner.token));
  const driverView=ok(await t.api('GET','/api/orders/'+root,undefined,driver.token));
  assert.equal(ownerView.caseSummary.stages.length,2);
  assert.equal(driverView.caseSummary.stages.length,1);
  assert.equal(driverView.caseSummary.stages[0].id,root);
  assert.equal(driverView.hasActiveEcuAddition,true,
    'private boolean can prevent duplicate order without leaking owner-created work');
  assert.equal((await t.api('GET','/api/orders/'+child.id,
    undefined,driver.token)).status,403);
  assert.ok(!JSON.stringify(driverView.caseSummary).includes(child.id));
  assert.equal((await t.api('POST','/api/orders',additional,driver.token)).status,409,
    'server prevents duplicate charges across driver and owner account');
 }finally{await t.close()}
});
