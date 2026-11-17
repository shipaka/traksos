import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {setup,ok,type T} from './helpers.ts';

let t:T, admin:any, client:any, author:any, colleague:any, driver:any;
let club:string, orderId:string, otherOrderId:string, caseId:string;
const symptoms='При прогреве грузовика блок EBS периодически теряет связь и появляется код ошибки, проверили питание и массу.';

before(async()=>{
  t=await setup();
  admin=await t.login('+79990000001');
  client=await t.login('+79996771001','client');
  author=await t.login('+79996771002','master');
  colleague=await t.login('+79996771003','master');
  driver=await t.login('+79996771004','driver');
  for(const [i,person] of [author,colleague].entries()){
    ok(await t.api('PUT','/api/performer/profile',{
      kind:'master',name:'Электронщик '+(i+1),
      specialties:['electric','diag'],taxStatus:'self_employed',
      inn:'78000677100'+(i+2)
    },person.token));
    ok(await t.api('POST','/api/admin/performers/'+person.id+'/verify',
      {decision:'approved'},admin.token));
  }
  const rooms=ok(await t.api('GET','/api/community/rooms',undefined,author.token)).rooms;
  club=rooms.find((r:any)=>r.slug==='electric-pro').id;
  ok(await t.api('POST','/api/community/rooms/'+club+'/join',{},author.token));
  ok(await t.api('POST','/api/community/rooms/'+club+'/join',{},colleague.token));
  const vehicle=await t.db.one<{id:string}>(`
    insert into vehicles(owner_id,brand,model,year,plate)
    values($1,'Renault','Premium',2010,'А155АА178') returning id`,[client.id]);
  const create=async()=>t.db.one<{id:string}>(`
    insert into orders(client_id,created_by,vehicle_id,service,status,performer_id,
      address,lat,lng,description)
    values($1,$1,$2,'electric','accepted',$3,
      'Секретный адрес клиента',59.9,30.3,'Частное описание неисправности')
    returning id`,[client.id,vehicle!.id,author.id]);
  orderId=(await create())!.id;
  otherOrderId=(await create())!.id;
});
after(()=>t.close());

test('published club case never exposes its originating order, including to its author',async()=>{
  const payload={
    roomId:club,clientNonce:randomUUID(),orderId,
    subsystem:'EBS',symptoms,dtcCodes:['P0401'],
    diagnosticContext:'Проверили питание блока, результата пока нет'
  };
  const created=ok(await t.api('POST','/api/community/pro-cases',payload,author.token));
  assert.equal(created.created,true);
  caseId=created.case.id;
  assert.equal(created.case.origin,'order_preview');
  for(const property of ['orderId','order_id','phone','address','lat','lng','plate','vin'])
    assert.equal(property in created.case,false,property);
  const listed=ok(await t.api('GET','/api/community/pro-cases/rooms/'+club,
    undefined,colleague.token)).cases;
  const peerView=listed.find((x:any)=>x.id===caseId);
  assert.ok(peerView);
  for(const prop of ['orderId','order_id','phone','address','lat','lng','plate','vin'])
    assert.equal(prop in peerView,false,prop);
  assert.ok(!JSON.stringify(peerView).includes(orderId));
  assert.ok(!JSON.stringify(peerView).includes('Секретный адрес'));
  const rows=await t.db.query<{order_id:string}>(
    'select order_id from community_technical_case_order_links where case_id=$1',[caseId]);
  assert.deepEqual(rows.map(x=>x.order_id),[orderId]);
  const archive=await t.app.privacy.export({
    id:author.id,phone:'+79996771002',name:null,
    roles:['master'],status:'active',owner_id:null
  });
  assert.ok(archive.privateTechnicalCaseOrderLinks.some((x:any)=>
    x.case_id===caseId&&x.order_id===orderId),
    'author has an auditable personal data export of private case links');
  const replay=ok(await t.api('POST','/api/community/pro-cases',payload,author.token));
  assert.equal(replay.case.id,caseId);
  assert.equal(replay.created,false);
  assert.equal((await t.api('POST','/api/community/pro-cases',
    {...payload,orderId:otherOrderId},author.token)).status,409,
    'same nonce cannot silently attach a different private customer order');
  assert.equal((await t.api('POST','/api/community/pro-cases',
    {...payload,orderId:undefined},author.token)).status,409,
    'same nonce cannot detach a private order mapping');
});

test('only assigned verified expert gets private order-to-discussion list',async()=>{
  const path='/api/community/pro-cases/for-order/'+orderId;
  assert.equal((await t.api('GET',path)).status,401);
  assert.equal((await t.api('GET',path,undefined,driver.token)).status,403);
  assert.equal((await t.api('GET',path,undefined,client.token)).status,403);
  assert.equal((await t.api('GET',path,undefined,colleague.token)).status,404);
  const mine=ok(await t.api('GET',path,undefined,author.token));
  assert.equal(mine.privateOrderContext,true);
  assert.equal(mine.createsOrder,false);
  assert.equal(mine.cases.length,1);
  assert.equal(mine.cases[0].id,caseId);
  assert.equal(mine.cases[0].roomId,club);
  assert.equal(mine.cases[0].subsystem,'EBS');
  for(const key of ['orderId','order_id','phone','lat','lng','plate','payment','clientId'])
    assert.equal(key in mine.cases[0],false,key);
  assert.equal((await t.api('GET','/api/community/pro-cases/for-order/'+otherOrderId,
    undefined,colleague.token)).status,404);
  assert.deepEqual(ok(await t.api('GET','/api/community/pro-cases/for-order/'+otherOrderId,
    undefined,author.token)).cases,[]);
});

test('private link remains in history after completion but is revoked on assignment change',async()=>{
  await t.db.query("update orders set status='completed' where id=$1",[orderId]);
  const url='/api/community/pro-cases/for-order/'+orderId;
  assert.equal(ok(await t.api('GET',url,undefined,author.token)).cases.length,1);
  assert.equal((await t.api('GET','/api/community/pro-cases/order-preview/'+orderId,
    undefined,author.token)).status,404,
    'closed orders cannot be used to publish new club cases');
  await t.db.query('update orders set performer_id=$2 where id=$1',[orderId,colleague.id]);
  assert.equal((await t.api('GET',url,undefined,author.token)).status,404);
  assert.deepEqual(ok(await t.api('GET',url,undefined,colleague.token)).cases,[],
    'replacement performer cannot inherit a previous author\'s private club/order link');
  assert.equal((await t.db.query('select id from orders where additional_to=$1',[orderId])).length,0,
    'professional club discussion never creates a paid ECU order');
});
