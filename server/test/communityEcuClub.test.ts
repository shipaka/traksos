import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {setup,ok,type T} from './helpers.ts';
import {roomLiveRecipients} from '../src/services/community.ts';

let t:T,admin:any,ecu:any,ecuPeer:any,diagnostician:any,client:any,driver:any,ecuRoom:string;
before(async()=>{
  t=await setup();
  admin=await t.login('+79990000001');
  ecu=await t.login('+79996881001','master');
  ecuPeer=await t.login('+79996881002','master');
  diagnostician=await t.login('+79996881003','master');
  client=await t.login('+79996881004','client');
  driver=await t.login('+79996881005','driver');
  for(const [i,person] of [ecu,ecuPeer,diagnostician].entries()){
    const specialist=i<2;
    ok(await t.api('PUT','/api/performer/profile',{
      kind:specialist?'ecu':'master',
      name:specialist?'Специалист по ЭБУ '+(i+1):'Диагност без профиля ЭБУ',
      specialties:['diag','electric'],
      taxStatus:'self_employed',inn:'78000688100'+(i+1)
    },person.token));
    ok(await t.api('POST','/api/admin/performers/'+person.id+'/verify',
      {decision:'approved'},admin.token));
  }
  const list=ok(await t.api('GET','/api/community/rooms',undefined,ecu.token)).rooms;
  ecuRoom=list.find((x:any)=>x.slug==='ecu-pro')?.id;
});
after(()=>t.close());

test('ECU specialty room is visible only to verified qualified specialists',async()=>{
  assert.ok(ecuRoom,'seeded ECU room exists for approved ECU profile');
  const peer=ok(await t.api('GET','/api/community/rooms',undefined,ecuPeer.token)).rooms;
  assert.ok(peer.some((x:any)=>x.id===ecuRoom));
  for(const other of [diagnostician,client,driver]){
    const rooms=ok(await t.api('GET','/api/community/rooms',undefined,other.token)).rooms;
    assert.equal(rooms.some((x:any)=>x.id===ecuRoom),false,
      'ordinary diagnostic, client and driver users cannot enumerate ECU club');
    assert.equal((await t.api('POST','/api/community/rooms/'+ecuRoom+'/join',
      {},other.token)).status,404);
    assert.equal((await t.api('GET','/api/community/pro-cases/rooms/'+ecuRoom,
      undefined,other.token)).status,404);
  }
});

test('approved ECU expert can ask colleagues and receive scoped live event',async()=>{
  ok(await t.api('POST','/api/community/rooms/'+ecuRoom+'/join',{},ecu.token));
  ok(await t.api('POST','/api/community/rooms/'+ecuRoom+'/join',{},ecuPeer.token));
  const created=ok(await t.api('POST','/api/community/pro-cases',{
    roomId:ecuRoom,clientNonce:randomUUID(),
    make:'Renault',model:'Premium',modelYear:2010,
    subsystem:'ЭБУ EBS',symptoms:'Периодически обрывается CAN-связь с ЭБУ EBS при прогреве, проверены масса и питание, ошибка остаётся.',
    dtcCodes:['P0401'],
    diagnosticContext:'Сопоставить версию блока и разъёмы без публикации идентификаторов'
  },ecu.token));
  assert.equal(created.created,true);
  const list=ok(await t.api('GET','/api/community/pro-cases/rooms/'+ecuRoom,
    undefined,ecuPeer.token)).cases;
  assert.ok(list.some((x:any)=>x.id===created.case.id));
  const hint=t.app.hub.log.find((x:any)=>x.userId===ecuPeer.id&&
    x.event.type==='community_technical_case'&&x.event.caseId===created.case.id);
  assert.ok(hint);
  for(const field of ['phone','vin','address','orderId','text','payment'])
    assert.equal(field in hint.event,false);
  const users=await roomLiveRecipients(t.db,{id:ecuRoom,audience:'professional',specialty:'ecu'});
  assert.ok(users.includes(ecu.id)&&users.includes(ecuPeer.id));
  assert.ok(!users.includes(diagnostician.id)&&!users.includes(driver.id)&&!users.includes(client.id));
});

test('revoked ECU verification immediately loses room read and live subscriptions',async()=>{
  await t.db.query("update performer_profiles set verification='pending' where user_id=$1",
    [ecuPeer.id]);
  assert.equal((await t.api('GET','/api/community/rooms/'+ecuRoom+'/messages',
    undefined,ecuPeer.token)).status,404);
  assert.equal((await t.api('GET','/api/community/pro-cases/rooms/'+ecuRoom,
    undefined,ecuPeer.token)).status,404);
  const eligible=await roomLiveRecipients(t.db,{id:ecuRoom,audience:'professional',specialty:'ecu'});
  assert.ok(!eligible.includes(ecuPeer.id));
  assert.ok(eligible.includes(ecu.id));
});
