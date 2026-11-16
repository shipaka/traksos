import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setup, ok, type T } from './helpers.ts';

let t:T, admin:any, client:any, driver:any, master:any, stranger:any;
let driverRoom:string, techRoom:string, proRoom:string;

before(async()=>{
  t=await setup();
  admin=await t.login('+79990000001');
  client=await t.login('+79994440001');
  driver=await t.login('+79994440002','driver');
  stranger=await t.login('+79994440003');
  master=await t.login('+79994440004','master');
  ok(await t.api('PUT','/api/performer/profile',{kind:'master',name:'Электрик',
    specialties:['electric'],taxStatus:'self_employed',inn:'780000009999'},master.token));
  const rooms=ok(await t.api('GET','/api/community/rooms',undefined,admin.token)).rooms;
  driverRoom=rooms.find((x:any)=>x.slug==='drivers-russia').id;
  techRoom=rooms.find((x:any)=>x.slug==='vehicle-help').id;
  proRoom=rooms.find((x:any)=>x.slug==='electric-pro').id;
});
after(()=>t.close());

test('separate ACL: guest and client cannot enter driver/pro rooms',async()=>{
  assert.equal((await t.api('GET','/api/community/rooms')).status,401);
  const c=ok(await t.api('GET','/api/community/rooms',undefined,client.token)).rooms;
  assert.deepEqual(c.map((x:any)=>x.slug),['vehicle-help']);
  const d=ok(await t.api('GET','/api/community/rooms',undefined,driver.token)).rooms;
  assert.ok(d.some((x:any)=>x.slug==='drivers-russia'));
  assert.ok(!d.some((x:any)=>x.slug==='electric-pro'));
  assert.equal((await t.api('GET',`/api/community/rooms/${driverRoom}/messages`,undefined,client.token)).status,404);
  assert.equal((await t.api('POST',`/api/community/rooms/${proRoom}/join`,{},master.token)).status,404,'pending verification is not enough');
  ok(await t.api('POST',`/api/admin/performers/${master.id}/verify`,{decision:'approved'},admin.token));
  const m=ok(await t.api('GET','/api/community/rooms',undefined,master.token)).rooms;
  assert.ok(m.some((x:any)=>x.slug==='electric-pro'));
  assert.equal((await t.api('GET',`/api/community/rooms/${proRoom}/messages`,undefined,driver.token)).status,404);
  ok(await t.api('POST',`/api/community/rooms/${proRoom}/join`,{},master.token));
});

test('nicknames: neutral automatic alias, case-insensitive uniqueness and opt-in city only',async()=>{
  const auto=ok(await t.api('GET','/api/community/me',undefined,driver.token));
  assert.match(auto.nickname,/^Участник_/);
  assert.equal(auto.public_city,null);
  ok(await t.api('PUT','/api/community/me',{nickname:'VolvoDriver_78',cityLabel:'Ижевск',shareCity:false},driver.token));
  assert.equal((await t.api('PUT','/api/community/me',{nickname:'volvodriver_78'},client.token)).status,409);
  assert.equal((await t.api('PUT','/api/community/me',{nickname:'TrackSOS_Admin'},driver.token)).status,400);
  assert.equal((await t.api('GET','/api/community/me',undefined,driver.token)).body.public_city,null);
});

test('messages: retry idempotence, moderation, cursor, no phone/PII leak',async()=>{
  ok(await t.api('POST',`/api/community/rooms/${driverRoom}/join`,{},driver.token));
  const nonce=randomUUID();
  const path=`/api/community/rooms/${driverRoom}/messages`;
  const first=ok(await t.api('POST',path,{text:'Всем привет, кто на М10?',clientNonce:nonce},driver.token));
  const second=ok(await t.api('POST',path,{text:'Всем привет, кто на М10?',clientNonce:nonce},driver.token));
  assert.equal(first.id,second.id);
  const retransmissions=await Promise.all(Array.from({length:4},()=>t.api('POST',path,{text:'Всем привет, кто на М10?',clientNonce:nonce},driver.token)));
  for(const retransmission of retransmissions)assert.equal(ok(retransmission).id,first.id);
  const physical=await t.db.query('select id from community_messages where sender_id=$1 and client_nonce=$2',[driver.id,nonce]);
  assert.equal(physical.length,1,'the same mobile message must be persisted only once');
  assert.equal((await t.api('POST',path,{text:'Другая фраза',clientNonce:nonce},driver.token)).status,409);
  assert.equal((await t.api('POST',path,{text:'Мой номер +7 999 111-22-33',clientNonce:randomUUID()},driver.token)).status,400);
  const pending=ok(await t.api('POST',path,{text:'блядь, ошибка на панели',clientNonce:randomUUID()},driver.token));
  assert.equal(pending.status,'pending');
  const latest=ok(await t.api('GET',
    `/api/community/rooms/${driverRoom}/messages?recent=1&limit=1`,undefined,driver.token));
  assert.equal(latest.messages.length,1,'мобильный чат загружает последнюю страницу');
  assert.equal(latest.messages[0].id,pending.id);
  assert.equal(latest.nextCursor,pending.id);
  const incremental=ok(await t.api('GET',
    `/api/community/rooms/${driverRoom}/messages?after=${latest.nextCursor}`,undefined,driver.token));
  assert.equal(incremental.messages.length,0,'новые события через курсор не повторяют предыдущие');
  const viewed=ok(await t.api('GET',`/api/community/rooms/${driverRoom}/messages?after=0`,undefined,driver.token));
  assert.equal(viewed.messages.length,2);
  assert.ok(viewed.messages.every((m:any)=>m.isMine));
  assert.ok(viewed.messages.every((m:any)=>!('phone' in m) && !('sender_id' in m)));
  assert.equal(viewed.messages[0].public_city,null);
  const other=await t.login('+79994440005','driver');
  const publicView=ok(await t.api('GET',`/api/community/rooms/${driverRoom}/messages?after=0`,undefined,other.token));
  assert.equal(publicView.messages.length,1,'pending is hidden from everyone except author and staff');
  ok(await t.api('POST',`/api/admin/community/messages/${pending.id}/moderate`,{status:'hidden'},admin.token));
  const hidden=ok(await t.api('GET',`/api/community/rooms/${driverRoom}/messages?after=0`,undefined,other.token));
  assert.equal(hidden.messages.length,1);
  const cursor=ok(await t.api('GET',`/api/community/rooms/${driverRoom}/messages?after=${first.id}`,undefined,other.token));
  assert.equal(cursor.messages.length,0);
  assert.equal((await t.api('GET',`/api/community/rooms/${driverRoom}/messages?after=not-number`,undefined,driver.token)).status,400);
});

test('room moderation changes reach readers after message cursor and remove hidden text',async()=>{
  const author=await t.login('+79994440311','driver');
  const viewer=await t.login('+79994440312','driver');
  const room='/api/community/rooms/'+driverRoom;
  ok(await t.api('POST',room+'/join',{},author.token));
  const late=ok(await t.api('POST',room+'/messages',
    {text:'сука, тяжёлый ремонт на трассе',clientNonce:randomUUID()},author.token));
  assert.equal(late.status,'pending');
  const initially=ok(await t.api('GET',room+'/messages?recent=1',undefined,viewer.token));
  const before=initially.moderationCursor;
  assert.equal(initially.messages.some((m:any)=>m.id===late.id),false);
  const later=ok(await t.api('POST',room+'/messages',
    {text:'Проверка дорожного чата',clientNonce:randomUUID()},author.token));
  const newMessages=ok(await t.api('GET',room+'/messages?after='+late.id,undefined,viewer.token));
  assert.ok(newMessages.messages.some((m:any)=>m.id===later.id));
  assert.equal(newMessages.messages.some((m:any)=>m.id===late.id),false);
  assert.equal((await t.api('GET',room+'/moderation-events',undefined,client.token)).status,404,
    'non-driver must not read a driver-room change feed');

  const approvals=await Promise.all(Array.from({length:2},()=>t.api('POST',
    '/api/admin/community/messages/'+late.id+'/moderate',{status:'published'},admin.token)));
  for(const approval of approvals)assert.equal(ok(approval).moderation_state,'published');
  const feed=ok(await t.api('GET',room+'/moderation-events?after='+before,undefined,viewer.token));
  const added=feed.changes.filter((x:any)=>x.id===late.id && x.moderation_state==='published');
  assert.equal(added.length,1,'concurrent moderation emits only one publication event');
  assert.equal(added[0].message.body,'сука, тяжёлый ремонт на трассе');
  assert.equal(added[0].message.isMine,false);
  assert.equal('sender_id' in added[0].message,false);
  assert.equal('phone' in added[0].message,false);
  const missed=ok(await t.api('GET',room+'/messages?after='+later.id,undefined,viewer.token));
  assert.ok(!missed.messages.some((m:any)=>m.id===late.id),
    'message ID cursor alone skips delayed approvals');

  ok(await t.api('POST','/api/admin/community/messages/'+later.id+'/moderate',
    {status:'hidden'},admin.token));
  const removal=ok(await t.api('GET',
    room+'/moderation-events?after='+feed.nextCursor,undefined,viewer.token));
  assert.ok(removal.changes.some((x:any)=>x.id===later.id&&x.moderation_state==='hidden'));
  assert.ok(removal.changes.every((x:any)=>!('body' in x)),
    'a tombstone must not leak hidden message content');
  const afterHidden=ok(await t.api('GET',room+'/messages?recent=1',undefined,viewer.token));
  assert.ok(!afterHidden.messages.some((m:any)=>m.id===later.id));
  assert.ok(afterHidden.messages.some((m:any)=>m.id===late.id));
  assert.equal((await t.api('GET',room+'/moderation-events?after=wrong',undefined,viewer.token)).status,400);
});

test('technical metadata never published until rights AND tech reviewed, and only professional',async()=>{
  assert.equal((await t.api('GET','/api/community/knowledge',undefined,client.token)).status,403);
  const proposed=ok(await t.api('POST','/api/community/knowledge/propose',{
    title:'Проверка контактов EBS Renault Premium',make:'Renault',model:'Premium',modelYear:2010,
    subsystem:'EBS',description:'Авторская инструкция по первичной проверке контактов перед ремонтом',
    rightsBasis:'own',rightsReference:'Материал специалиста, ожидает проверки',
  },master.token));
  assert.equal(proposed.rights_review,'pending');
  const rightsQueue=ok(await t.api('GET','/api/admin/community/knowledge/review-queue',undefined,admin.token));
  assert.ok(rightsQueue.articles.some((x:any)=>x.id===proposed.id));
  assert.equal((await t.api('GET','/api/admin/community/knowledge/review-queue',undefined,master.token)).status,403);
  assert.equal(ok(await t.api('GET','/api/community/knowledge',undefined,master.token)).articles.length,0);
  assert.equal((await t.api('GET',`/api/community/knowledge/${proposed.id}`,undefined,master.token)).status,404);
  assert.equal((await t.api('POST',`/api/admin/community/knowledge/${proposed.id}/review`,{
    scope:'rights',decision:'approved'
  },admin.token)).status,400);
  ok(await t.api('POST',`/api/admin/community/knowledge/${proposed.id}/review`,{
    scope:'rights',decision:'approved',reference:'Подтвержденное авторство и согласие от автора'
  },admin.token));
  assert.equal(ok(await t.api('GET','/api/community/knowledge',undefined,master.token)).articles.length,0);
  ok(await t.api('POST',`/api/admin/community/knowledge/${proposed.id}/review`,{
    scope:'technical',decision:'approved'
  },admin.token));
  const articles=ok(await t.api('GET','/api/community/knowledge?make=Renault',undefined,master.token)).articles;
  assert.equal(articles.length,1);
  assert.equal(articles[0].id,proposed.id);
  assert.equal((await t.api('GET',`/api/community/knowledge/${proposed.id}`,undefined,driver.token)).status,403);
  const own=ok(await t.api('GET','/api/community/knowledge/mine',undefined,master.token));
  assert.equal(own.articles[0].id,proposed.id);
});

test('only admin can create regional rooms; server enforces membership and reports',async()=>{
  assert.equal((await t.api('POST','/api/admin/community/rooms',{
    slug:'izhevsk',title:'Ижевск',kind:'city',audience:'driver'
  },driver.token)).status,403);
  const city=ok(await t.api('POST','/api/admin/community/rooms',{
    slug:'izhevsk',title:'Ижевск',kind:'city',audience:'driver',locality:'Ижевск'
  },admin.token));
  assert.equal((await t.api('POST',`/api/community/rooms/${city.id}/join`,{},client.token)).status,404);
  ok(await t.api('POST',`/api/community/rooms/${city.id}/join`,{},driver.token));
  const msg=ok(await t.api('POST',`/api/community/rooms/${city.id}/messages`,{
    text:'Подскажите стоянку у Ижевска',clientNonce:randomUUID()
  },driver.token));
  const other=await t.login('+79994440006','driver');
  ok(await t.api('POST',`/api/community/messages/${msg.id}/report`,{reason:'Проверить сообщение'},other.token));
  const queue=ok(await t.api('GET','/api/admin/community/moderation',undefined,admin.token));
  assert.ok(queue.reports.some((x:any)=>x.message_id===msg.id));
});

test('privacy export includes new community data; scheduled erasure purges nickname and posts',async()=>{
  const identity={id:driver.id,phone:'+79994440002',roles:['driver'],status:'active',name:null,owner_id:null};
  const archive=await t.app.privacy.export(identity);
  assert.equal(archive.communityProfile?.nickname,'VolvoDriver_78');
  assert.ok(archive.communityMessages.length>=1);
  assert.ok(archive.communityRooms.length>=1);
  await t.app.privacy.requestDelete(identity);
  t.clock.advance(31*86400);
  assert.equal(await t.app.privacy.processDeletions(),1);
  assert.equal((await t.db.query('select * from community_profiles where user_id=$1',[driver.id])).length,0);
  assert.equal((await t.db.query('select * from community_messages where sender_id=$1',[driver.id])).length,0);
  assert.equal((await t.db.query('select * from community_memberships where user_id=$1',[driver.id])).length,0);
  assert.equal((await t.db.one('select status from users where id=$1',[driver.id]))?.status,'blocked');
});
