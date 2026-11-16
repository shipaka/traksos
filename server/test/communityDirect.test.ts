import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setup, ok, type T } from './helpers.ts';

let t:T, admin:any, driverA:any, driverB:any, outsider:any, customer:any, master:any;
before(async()=>{
  t=await setup();
  admin=await t.login('+79990000001');
  driverA=await t.login('+79995670001','driver');
  driverB=await t.login('+79995670002','driver');
  outsider=await t.login('+79995670003','driver');
  customer=await t.login('+79995670004');
  master=await t.login('+79995670005','master');
  ok(await t.api('PUT','/api/community/me',{nickname:'Volvo_77',cityLabel:'Ижевск',shareCity:false},driverA.token));
  ok(await t.api('PUT','/api/community/me',{nickname:'Scania_88',cityLabel:'Санкт-Петербург',shareCity:true},driverB.token));
  ok(await t.api('PUT','/api/performer/profile',{kind:'master',name:'Электрик',specialties:['electric'],
    taxStatus:'self_employed',inn:'780000006666'},master.token));
  ok(await t.api('POST','/api/admin/performers/'+master.id+'/verify',{decision:'approved'},admin.token));
});
after(()=>t.close());

test('DM: client cannot list/invite, driver invitation requires consent and sender cannot accept',async()=>{
  assert.equal((await t.api('GET','/api/community/direct',undefined,customer.token)).status,403);
  assert.equal((await t.api('POST','/api/community/direct/request',{nickname:'Scania_88'},customer.token)).status,403);
  const request=ok(await t.api('POST','/api/community/direct/request',{nickname:'Scania_88'},driverA.token));
  assert.equal(request.status,'pending');
  assert.equal(request.direction,'outgoing');
  // Retries (including concurrent taps on a weak mobile network) reuse one invite.
  const retries=await Promise.all(Array.from({length:4},()=>t.api('POST','/api/community/direct/request',{nickname:'Scania_88'},driverA.token)));
  for(const retry of retries){
    assert.equal(ok(retry).id,request.id);
    assert.equal(ok(retry).status,'pending');
  }
  const incomingThreads=ok(await t.api('GET','/api/community/direct',undefined,driverB.token)).threads;
  assert.equal(incomingThreads.filter((thread:any)=>thread.id===request.id).length,1);
  assert.equal((await t.api('GET','/api/community/direct/'+request.id+'/messages',undefined,driverA.token)).status,403);
  assert.equal((await t.api('POST','/api/community/direct/'+request.id+'/decision',{decision:'accept'},driverA.token)).status,403);
  assert.equal((await t.api('GET','/api/community/direct/'+request.id+'/messages',undefined,outsider.token)).status,404);
  const incoming=ok(await t.api('GET','/api/community/direct',undefined,driverB.token)).threads[0];
  assert.equal(incoming.peerNickname,'Volvo_77');
  assert.equal(incoming.direction,'incoming');
  assert.equal(incoming.status,'pending');
  const accepted=ok(await t.api('POST','/api/community/direct/'+request.id+'/decision',{decision:'accept'},driverB.token));
  assert.equal(accepted.status,'accepted');
  assert.equal((await t.api('POST','/api/community/direct/'+request.id+'/decision',{decision:'decline'},driverB.token)).status,409);
  const mine=ok(await t.api('GET','/api/community/direct',undefined,driverA.token)).threads;
  assert.equal(mine[0].peerNickname,'Scania_88');
  assert.ok(!('phone' in mine[0]));
  assert.ok(!('peerUserId' in mine[0]));
});

test('DM: idempotency, contacts and profanity moderation, peer isolation, reports',async()=>{
  const tid=ok(await t.api('GET','/api/community/direct',undefined,driverA.token)).threads[0].id;
  const url='/api/community/direct/'+tid+'/messages';
  const id=randomUUID();
  const msg=ok(await t.api('POST',url,{text:'Привет, есть информация по стоянке?',clientNonce:id},driverA.token));
  assert.equal(msg.status,'published');
  assert.equal(ok(await t.api('POST',url,{text:'Привет, есть информация по стоянке?',clientNonce:id},driverA.token)).id,msg.id);
  assert.equal((await t.api('POST',url,{text:'Другой текст',clientNonce:id},driverA.token)).status,409);
  assert.equal((await t.api('POST',url,{text:'Мой номер +7 999 111-22-33',clientNonce:randomUUID()},driverA.token)).status,400);
  const flagged=ok(await t.api('POST',url,{text:'Это пиздец, просто стою',clientNonce:randomUUID()},driverA.token));
  assert.equal(flagged.status,'pending');
  const peer=ok(await t.api('GET',url+'?after=0',undefined,driverB.token));
  assert.equal(peer.messages.length,1);
  assert.equal(peer.messages[0].nickname,'Volvo_77');
  assert.ok(!('sender_id' in peer.messages[0]));
  assert.ok(!('phone' in peer.messages[0]));
  const owner=ok(await t.api('GET',url+'?after=0',undefined,driverA.token));
  assert.equal(owner.messages.length,2);
  const latest=ok(await t.api('GET',url+'?recent=1&limit=1',undefined,driverA.token));
  assert.equal(latest.messages.length,1);
  assert.equal(latest.messages[0].id,flagged.id,
    'личные сообщения на телефоне открываются с последних, включая ожидающие модерации свои');
  assert.equal(latest.nextCursor,flagged.id);
  assert.equal(ok(await t.api('GET',url+'?after='+latest.nextCursor,undefined,driverA.token))
    .messages.length,0);
  assert.equal((await t.api('POST','/api/community/direct/messages/'+msg.id+'/report',{reason:'Не по теме'},outsider.token)).status,404);
  ok(await t.api('POST','/api/community/direct/messages/'+msg.id+'/report',{reason:'Не по теме'},driverB.token));
  const queue=ok(await t.api('GET','/api/admin/community/direct/moderation',undefined,admin.token));
  assert.ok(queue.reports.some((x:any)=>x.message_id===msg.id));
  assert.ok(queue.pending.some((x:any)=>x.id===flagged.id));
  assert.equal((await t.api('GET','/api/admin/community/direct/moderation',undefined,driverA.token)).status,403);
});

test('DM: blocking prevents new messages without destroying earlier conversation',async()=>{
  const tid=ok(await t.api('GET','/api/community/direct',undefined,driverA.token)).threads[0].id;
  ok(await t.api('POST','/api/community/direct/blocks',{nickname:'Volvo_77',blocked:true},driverB.token));
  assert.equal((await t.api('POST','/api/community/direct/'+tid+'/messages',{
    text:'После блокировки',clientNonce:randomUUID()},driverA.token)).status,403);
  const list=ok(await t.api('GET','/api/community/direct',undefined,driverA.token)).threads;
  assert.equal(list[0].blocked,true);
  ok(await t.api('POST','/api/community/direct/blocks',{nickname:'Volvo_77',blocked:false},driverB.token));
  assert.equal(ok(await t.api('POST','/api/community/direct/'+tid+'/messages',{
    text:'Спасибо, всё решено',clientNonce:randomUUID()},driverA.token)).status,'published');
});

test('TechBase by order: match make/model/year, do not expose to owner or unrelated technician',async()=>{
  ok(await t.api('POST','/api/performer/line',{lineStatus:'online'},master.token));
  const vehicle=ok(await t.api('POST','/api/vehicles',{
    brand:'Scania',model:'R',year:2007,plate:'А111АА78'},customer.token));
  const order=ok(await t.api('POST','/api/orders',{
    service:'electric',zoneId:'spb',vehicleId:vehicle.id,description:'Проблема по электрике'
  },customer.token)).order;
  ok(await t.api('POST','/api/orders/'+order.id+'/offers',{},master.token));
  const offers=ok(await t.api('GET','/api/orders/'+order.id+'/offers',undefined,customer.token)).offers;
  ok(await t.api('POST','/api/orders/'+order.id+'/offers/'+offers[0].id+'/choose',{},customer.token));
  const proposed=ok(await t.api('POST','/api/community/knowledge/propose',{
    title:'Контрольные проверки Scania R 2007',make:'Scania',model:'R',modelYear:2007,
    subsystem:'electric',description:'Авторская памятка об этапах подготовки к диагностике электрооборудования',
    rightsBasis:'own',rightsReference:'Собственное описание автора'
  },master.token));
  const path='/api/community/knowledge/for-order/'+order.id;
  assert.equal((await t.api('GET',path,undefined,customer.token)).status,403);
  assert.equal((await t.api('GET',path,undefined,driverA.token)).status,403);
  let result=ok(await t.api('GET',path,undefined,master.token));
  assert.equal(result.articles.length,0,'unapproved articles never leak');
  ok(await t.api('POST','/api/admin/community/knowledge/'+proposed.id+'/review',{
    scope:'rights',decision:'approved',reference:'Автор дал разрешение на публикацию'
  },admin.token));
  ok(await t.api('POST','/api/admin/community/knowledge/'+proposed.id+'/review',{
    scope:'technical',decision:'approved'
  },admin.token));
  result=ok(await t.api('GET',path,undefined,master.token));
  assert.equal(result.articles.length,1);
  assert.equal(result.context.brand,'Scania');
  assert.equal(result.context.model,'R');
  assert.equal(result.context.year,2007);
  assert.ok(!('plate' in result.context));
  assert.ok(!('clientId' in result.context));
  const otherMaster=await t.login('+79995670006','master');
  ok(await t.api('PUT','/api/performer/profile',{kind:'master',name:'Другой',specialties:['electric']},otherMaster.token));
  ok(await t.api('POST','/api/admin/performers/'+otherMaster.id+'/verify',{decision:'approved'},admin.token));
  assert.equal((await t.api('GET',path,undefined,otherMaster.token)).status,404);
});

test('DM privacy export and account deletion erase direct history and blocks',async()=>{
  const profile={id:driverA.id,phone:'+79995670001',roles:['driver'],status:'active',owner_id:null,name:null};
  const data=await t.app.privacy.export(profile);
  assert.ok(data.directThreads.length>0);
  assert.ok(data.directMessages.length>0);
  const person=ok(await t.api('GET','/api/community/direct',undefined,driverA.token)).threads[0];
  await t.app.privacy.requestDelete(profile);
  t.clock.advance(31*86400);
  assert.ok(await t.app.privacy.processDeletions()>=1);
  assert.equal((await t.db.query('select * from community_dm_threads where id=$1',[person.id])).length,0);
  assert.equal((await t.db.query('select * from community_dm_messages where sender_id=$1',[driverA.id])).length,0);
});
