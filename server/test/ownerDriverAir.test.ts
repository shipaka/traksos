import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {setup,ok,type T} from './helpers.ts';

let t:T,admin:any,owner:any,driver:any,guestCustomer:any,master:any,roomId:string;
before(async()=>{
  t=await setup();
  admin=await t.login('+79990000001');
  owner=await t.login('+79996333001');
  driver=await t.login('+79996333002','driver');
  guestCustomer=await t.login('+79996333003');
  master=await t.login('+79996333004','master');
  const rooms=ok(await t.api('GET','/api/community/rooms',undefined,driver.token)).rooms;
  roomId=rooms.find((x:any)=>x.slug==='drivers-russia').id;
  ok(await t.api('PUT','/api/community/me',{
    nickname:'DriverAir_123',shareCity:false
  },driver.token));
});
after(()=>t.close());

test('owner explicit opt-in does not grant another account role and keeps the garage',async()=>{
  const initial=ok(await t.api('GET','/api/community/driver-access',undefined,owner.token));
  assert.deepEqual(initial,{eligible:true,enabled:false,driverRole:false});
  assert.equal(ok(await t.api('GET','/api/community/driver-access',undefined,driver.token)).enabled,true);
  assert.equal(ok(await t.api('GET','/api/community/driver-access',undefined,master.token)).eligible,false);
  assert.equal((await t.api('PUT','/api/community/driver-access',{enabled:true},master.token)).status,403);
  assert.equal((await t.api('PUT','/api/community/driver-access',{enabled:false},driver.token)).status,403);
  assert.equal((await t.api('GET','/api/community/rooms/'+roomId+'/messages',undefined,owner.token)).status,404);
  assert.equal((await t.api('POST','/api/community/direct/request',{nickname:'DriverAir_123'},owner.token)).status,403);
  assert.equal((await t.api('POST','/api/community/nearby-help',
    {lat:59.95,lng:30.3,accuracyMeters:20},owner.token)).status,403);
  const ownBefore=ok(await t.api('GET','/api/me',undefined,owner.token));
  assert.deepEqual(ownBefore.roles,['client']);
  const vehicle=ok(await t.api('POST','/api/vehicles',{brand:'Scania',plate:'а444вм178'},owner.token));
  assert.ok(vehicle.id);
  assert.equal(ok(await t.api('PUT','/api/community/driver-access',{enabled:true},owner.token)).enabled,true);
  const ownAfter=ok(await t.api('GET','/api/me',undefined,owner.token));
  assert.deepEqual(ownAfter.roles,ownBefore.roles);
  assert.equal(ok(await t.api('GET','/api/vehicles',undefined,owner.token)).length,1);
  const optin=ok(await t.api('GET','/api/community/driver-access',undefined,owner.token));
  assert.equal(optin.enabled,true);
});

test('consented owner can use rooms, pseudonym, road events and direct messages',async()=>{
  const rooms=ok(await t.api('GET','/api/community/rooms',undefined,owner.token)).rooms;
  assert.ok(rooms.some((x:any)=>x.id===roomId));
  const profile=ok(await t.api('GET','/api/community/me',undefined,owner.token));
  assert.match(profile.nickname,/^Участник_/);
  assert.equal(profile.public_city,null);
  ok(await t.api('PUT','/api/community/me',{nickname:'OwnerDriver_78',shareCity:false},owner.token));
  ok(await t.api('POST','/api/community/rooms/'+roomId+'/join',{},owner.token));
  const msg=ok(await t.api('POST','/api/community/rooms/'+roomId+'/messages',{
    text:'Я владелец и водитель, всем хорошей дороги',clientNonce:randomUUID()
  },owner.token));
  assert.equal(msg.status,'published');
  const posts=ok(await t.api('GET','/api/community/rooms/'+roomId+'/messages',
    undefined,owner.token)).messages;
  assert.ok(posts.some((x:any)=>x.id===msg.id));
  const road=ok(await t.api('POST','/api/community/rooms/'+roomId+'/road-events',{
    category:'traffic',description:'На трассе плотное движение, будьте внимательны',
    locality:'Санкт-Петербург',hours:1
  },owner.token));
  assert.equal(road.status,'published');
  const invitation=ok(await t.api('POST','/api/community/direct/request',
    {nickname:'DriverAir_123'},owner.token));
  assert.equal(invitation.status,'pending');
  assert.equal(ok(await t.api('POST','/api/community/direct/'+invitation.id+'/decision',
    {decision:'accept'},driver.token)).status,'accepted');
  const sent=ok(await t.api('POST','/api/community/direct/'+invitation.id+'/messages',{
    text:'Привет! Ищу советы по стоянке',clientNonce:randomUUID()
  },owner.token));
  assert.equal(sent.status,'published');
  const inbox=ok(await t.api('GET','/api/community/direct/'+invitation.id+'/messages',
    undefined,driver.token));
  assert.ok(inbox.messages.some((x:any)=>x.id===sent.id));
  const mine=ok(await t.api('GET','/api/community/direct',undefined,owner.token)).threads;
  assert.equal(mine.length,1);
  assert.equal(mine[0].peerNickname,'DriverAir_123');
  assert.ok(!('phone' in mine[0])&&!('peerUserId' in mine[0]));
});

test('disabling access revokes reading, sending, road alerts and recipient discovery',async()=>{
  const before=ok(await t.api('GET','/api/community/direct',undefined,owner.token)).threads;
  const threadId=before[0].id;
  const disabled=ok(await t.api('PUT','/api/community/driver-access',{enabled:false},owner.token));
  assert.equal(disabled.enabled,false);
  assert.equal((await t.api('GET','/api/community/rooms/'+roomId+'/messages',undefined,owner.token)).status,404);
  assert.equal((await t.api('POST','/api/community/rooms/'+roomId+'/messages',{
    text:'Нельзя отправить после отключения',clientNonce:randomUUID()
  },owner.token)).status,404);
  assert.equal((await t.api('GET','/api/community/direct',undefined,owner.token)).status,403);
  assert.equal((await t.api('GET','/api/community/direct/'+threadId+'/messages',undefined,owner.token)).status,403);
  assert.equal((await t.api('POST','/api/community/rooms/'+roomId+'/road-events',{
    category:'traffic',description:'Нельзя опубликовать после отключения',
    locality:'Москва'
  },owner.token)).status,403);
  const visibleToDriver=ok(await t.api('GET','/api/community/direct',
    undefined,driver.token)).threads;
  assert.ok(!visibleToDriver.some((x:any)=>x.id===threadId),
    'a disabled recipient is not advertised as a reachable active thread');
  const recipients=await t.db.query<{user_id:string}>(`
    select cm.user_id from community_memberships cm join users u on u.id=cm.user_id
    where cm.room_id=$1 and u.id=$2 and
    ('driver'=any(u.roles) or ('client'=any(u.roles) and exists(
      select 1 from community_driver_optins opt where opt.user_id=u.id and opt.enabled)))`,
    [roomId,owner.id]);
  assert.equal(recipients.length,0);
  assert.equal((await t.api('POST','/api/community/direct/request',
    {nickname:'OwnerDriver_78'},driver.token)).status,404);
});

test('re-enable preserves identity while unrelated clients and specialists stay excluded',async()=>{
  assert.equal(ok(await t.api('PUT','/api/community/driver-access',{enabled:true},owner.token)).enabled,true);
  assert.equal(ok(await t.api('GET','/api/community/me',undefined,owner.token)).nickname,'OwnerDriver_78');
  const exported=await t.app.privacy.export({id:owner.id,phone:'+79996333001',name:null,
    roles:['client'],status:'active',owner_id:null});
  assert.equal(exported.driverAirParticipation?.enabled,true);
  assert.ok(!JSON.stringify(exported.driverAirParticipation).includes('DriverAir_123'));

  assert.ok(ok(await t.api('GET','/api/community/direct',undefined,owner.token)).threads.length);
  const outsiderRooms=ok(await t.api('GET','/api/community/rooms',undefined,guestCustomer.token)).rooms;
  assert.ok(!outsiderRooms.some((x:any)=>x.id===roomId));
  assert.equal((await t.api('GET','/api/community/rooms/'+roomId+'/messages',undefined,master.token)).status,404);
});
