import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {setup,ok} from './helpers.ts';
import {communityQuietAt} from '../src/services/communityNotifications.ts';

test('server-side IANA quiet hours cross midnight and handle daytime intervals',()=>{
 const base={dm_invites:true,dm_messages:false,case_replies:false,
   quiet_enabled:true,quiet_start_minute:22*60,quiet_end_minute:8*60,
   quiet_timezone:'Europe/Moscow'};
 assert.equal(communityQuietAt(base,new Date('2026-12-01T21:30:00Z')),true);
 assert.equal(communityQuietAt(base,new Date('2026-12-01T08:00:00Z')),false);
 assert.equal(communityQuietAt({...base,quiet_start_minute:10*60,quiet_end_minute:16*60},
   new Date('2026-12-01T09:00:00Z')),true);
 assert.equal(communityQuietAt({...base,quiet_start_minute:10*60,quiet_end_minute:10*60},
   new Date('2026-12-01T09:00:00Z')),false);
 assert.equal(communityQuietAt({...base,quiet_enabled:false},
   new Date('2026-12-01T21:30:00Z')),false);
});

test('driver push preferences, private thread mute, quiet hours and retry do not leak text',async()=>{
 const t=await setup();
 try{
  const a=await t.login('+79996112201','driver');
  const b=await t.login('+79996112202','driver');
  const outsider=await t.login('+79996112203','driver');
  for(const [user,nickname]of [[a,'RoadAlert_A'],[b,'RoadAlert_B']] as const)
   ok(await t.api('PUT','/api/community/me',{nickname,shareCity:false},user.token));
  await t.db.query(
    "insert into push_tokens(user_id,provider,token) values($1,'log','test-mobile-device-0001')",
    [b.id]);
  const settings='/api/community/notification-preferences';
  const original=ok(await t.api('GET',settings,undefined,b.token));
  assert.equal(original.dmInvites,true);
  assert.equal(original.dmMessages,false);
  assert.equal(original.caseReplies,false);
  assert.equal(original.quietEnabled,false);
  assert.equal(original.normalOrderAndSecurityNotificationsUnaffected,true);
  assert.equal((await t.api('GET',settings)).status,401);
  assert.equal((await t.api('PUT',settings,{...original,quietTimezone:'INVALID/TZ'},b.token)).status,400);
  assert.equal((await t.api('PUT',settings,{...original,quietEnabled:true,
    quietStartMinute:480,quietEndMinute:480},b.token)).status,400);
  const invited=ok(await t.api('POST','/api/community/direct/request',{
    nickname:'RoadAlert_B'
  },a.token));
  assert.equal(invited.status,'pending');
  const invitePush=t.push.sent.find(x=>x.msg.data.kind==='dm_invites');
  assert.ok(invitePush);
  assert.ok(!JSON.stringify(invitePush).includes('RoadAlert_A'));
  assert.ok(!JSON.stringify(invitePush).includes(a.id));
  assert.ok(!JSON.stringify(invitePush).includes('+7999'));
  assert.equal(ok(await t.api('POST','/api/community/direct/request',{
    nickname:'RoadAlert_B'
  },a.token)).id,invited.id);
  assert.equal(t.push.sent.filter(x=>x.msg.data.kind==='dm_invites').length,1,
    'idempotent request never sends repeated push');
  ok(await t.api('POST','/api/community/direct/'+invited.id+'/decision',
    {decision:'accept'},b.token));
  assert.equal((await t.api('PUT',settings+'/threads/'+invited.id,
    {muted:true},outsider.token)).status,404);
  const url='/api/community/direct/'+invited.id+'/messages';
  const nonce=randomUUID();
  ok(await t.api('POST',url,{text:'Первый технический вопрос без контактов',clientNonce:nonce},a.token));
  assert.equal(t.push.sent.filter(x=>x.msg.data.kind==='dm_messages').length,0);
  const saved=ok(await t.api('PUT',settings,{
    ...original,dmMessages:true,quietEnabled:false
  },b.token));
  assert.equal(saved.dmMessages,true);
  ok(await t.api('PUT',settings+'/threads/'+invited.id,{muted:true},b.token));
  ok(await t.api('POST',url,{text:'Второе личное сообщение, уведомление выключено',
    clientNonce:randomUUID()},a.token));
  assert.equal(t.push.sent.filter(x=>x.msg.data.kind==='dm_messages').length,0,
    'thread mute suppresses even explicitly opted-in push');
  ok(await t.api('PUT',settings+'/threads/'+invited.id,{muted:false},b.token));
  const third={text:'Третье личное сообщение без персональных данных',
    clientNonce:randomUUID()};
  ok(await t.api('POST',url,third,a.token));
  const dm=t.push.sent.filter(x=>x.msg.data.kind==='dm_messages');
  assert.equal(dm.length,1);
  assert.ok(!JSON.stringify(dm[0]).includes(third.text));
  assert.ok(!JSON.stringify(dm[0]).includes(invited.id));
  ok(await t.api('POST',url,third,a.token));
  assert.equal(t.push.sent.filter(x=>x.msg.data.kind==='dm_messages').length,1);
  ok(await t.api('POST',url,{
    text:'Четвёртое сообщение в период антиспама',clientNonce:randomUUID()
  },a.token));
  assert.equal(t.push.sent.filter(x=>x.msg.data.kind==='dm_messages').length,1,
    'two-minute cooldown is atomic per user and thread');
  const quiet=ok(await t.api('PUT',settings,{
    ...saved,quietEnabled:true,quietStartMinute:1320,quietEndMinute:480,
    quietTimezone:'Europe/Moscow'
  },b.token));
  assert.equal(quiet.quietEnabled,true);
  t.clock.set('2026-12-02T00:30:00Z');
  ok(await t.api('POST',url,{
    text:'Пятое сообщение приходит ночью',clientNonce:randomUUID()
  },a.token));
  assert.equal(t.push.sent.filter(x=>x.msg.data.kind==='dm_messages').length,1,
    'quiet hours suppress remote notification, not the chat message');
  const list=ok(await t.api('GET',url,undefined,b.token));
  assert.ok(list.messages.some((m:any)=>m.body==='Пятое сообщение приходит ночью'));
 }finally{await t.close()}
});

test('only an authorized professional case author receives opted-in push; room mute blocks it',async()=>{
 const t=await setup();
 try{
  const admin=await t.login('+79990000001');
  const author=await t.login('+79996112301','master');
  const peer=await t.login('+79996112302','master');
  const driver=await t.login('+79996112303','driver');
  for(const [i,p]of [author,peer].entries()){
    ok(await t.api('PUT','/api/performer/profile',{
      kind:'master',name:'Проверенный электрик '+i,specialties:['electric'],
      taxStatus:'self_employed',inn:'7800012345'+String(i).padStart(2,'0')
    },p.token));
    ok(await t.api('POST','/api/admin/performers/'+p.id+'/verify',
      {decision:'approved'},admin.token));
  }
  const room=ok(await t.api('GET','/api/community/rooms',undefined,author.token))
    .rooms.find((r:any)=>r.slug==='electric-pro');
  for(const p of [author,peer])
    ok(await t.api('POST','/api/community/rooms/'+room.id+'/join',{},p.token));
  await t.db.query(
    "insert into push_tokens(user_id,provider,token) values($1,'log','test-pro-expert-001')",[author.id]);
  const base='/api/community/notification-preferences';
  const def=ok(await t.api('GET',base,undefined,author.token));
  assert.equal((await t.api('PUT',base+'/rooms/'+room.id,{muted:true},driver.token)).status,404);
  ok(await t.api('PUT',base,{...def,caseReplies:true},author.token));
  const question=ok(await t.api('POST','/api/community/pro-cases',{
    roomId:room.id,clientNonce:randomUUID(),make:'Renault',model:'Premium',modelYear:2010,
    subsystem:'EBS',symptoms:'Проверенный технический вопрос по питанию блока тормозной системы без публикации данных автомобиля.'
  },author.token));
  await t.db.query('update community_technical_cases set created_at=now()-interval \'3 hours\' where id=$1',
    [question.case.id]);
  const replyPath='/api/community/pro-cases/'+question.case.id+'/replies';
  const answer={clientNonce:randomUUID(),body:'Проверить штатное питание и массу электронного блока по заводской схеме.'};
  ok(await t.api('POST',replyPath,answer,peer.token));
  const first=t.push.sent.filter(x=>x.msg.data.kind==='case_replies');
  assert.equal(first.length,1);
  assert.ok(!JSON.stringify(first[0]).includes('EBS'));
  assert.ok(!JSON.stringify(first[0]).includes(question.case.id));
  ok(await t.api('POST',replyPath,answer,peer.token));
  assert.equal(t.push.sent.filter(x=>x.msg.data.kind==='case_replies').length,1);
  ok(await t.api('PUT',base+'/rooms/'+room.id,{muted:true},author.token));
  ok(await t.api('POST',replyPath,{
    clientNonce:randomUUID(),body:'Проверьте соединение разъёмов на коррозию и восстановите контакт.'
  },peer.token));
  assert.equal(t.push.sent.filter(x=>x.msg.data.kind==='case_replies').length,1);
  const mutes=ok(await t.api('GET',base,undefined,author.token));
  assert.ok(mutes.mutedRoomIds.includes(room.id));
  assert.equal((await t.api('GET',base,undefined,driver.token)).body.mutedRoomIds.length,0);
 }finally{await t.close()}
});
