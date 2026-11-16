import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, ok, type T } from './helpers.ts';

let t:T, admin:any, first:any, second:any, client:any, room:string;
before(async()=>{
  t=await setup();
  admin=await t.login('+79990000001');
  first=await t.login('+79994330001','driver');
  second=await t.login('+79994330002','driver');
  client=await t.login('+79994330003');
  room=ok(await t.api('GET','/api/community/rooms',undefined,first.token)).rooms.find((x:any)=>x.slug==='drivers-russia').id;
  ok(await t.api('PUT','/api/community/me',{nickname:'Daf_78',shareCity:false},first.token));
});
after(()=>t.close());

test('regional subscriptions: only drivers and no location tracking',async()=>{
  assert.equal((await t.api('GET','/api/community/rooms/'+room+'/road-events',undefined,client.token)).status,403);
  const city=ok(await t.api('POST','/api/admin/community/rooms',{
    slug:'route-m10',title:'М10 Москва — Санкт-Петербург',kind:'route',audience:'driver'
  },admin.token));
  assert.equal((await t.api('POST','/api/community/rooms/'+city.id+'/join',{},client.token)).status,404);
  let rooms=ok(await t.api('GET','/api/community/rooms',undefined,first.token)).rooms;
  assert.equal(rooms.find((x:any)=>x.id===city.id).joined,false);
  ok(await t.api('POST','/api/community/rooms/'+city.id+'/join',{},first.token));
  rooms=ok(await t.api('GET','/api/community/rooms',undefined,first.token)).rooms;
  assert.equal(rooms.find((x:any)=>x.id===city.id).joined,true);
  ok(await t.api('POST','/api/community/rooms/'+city.id+'/leave',{},first.token));
  rooms=ok(await t.api('GET','/api/community/rooms',undefined,first.token)).rooms;
  assert.equal(rooms.find((x:any)=>x.id===city.id).joined,false);
});

test('road alerts: limited-lived user reports without lat/lng and clear provenance',async()=>{
  const post='/api/community/rooms/'+room+'/road-events';
  assert.equal((await t.api('POST',post,{
    category:'traffic',description:'Большая пробка, движение медленное',locality:'Синявино',hours:3
  },client.token)).status,403);
  assert.equal((await t.api('POST',post,{
    category:'traffic',description:'Большая пробка, движение медленное',locality:'улица Пушкина',hours:3
  },first.token)).status,400);
  const event=ok(await t.api('POST',post,{
    category:'traffic',description:'Большая пробка, движение медленное',locality:'Синявино',hours:3
  },first.token));
  assert.equal(event.status,'published');
  assert.equal(event.verifiedByRoadServices,false);
  const rows=ok(await t.api('GET',post,undefined,second.token)).events;
  assert.equal(rows.length,1);
  assert.equal(rows[0].nickname,'Daf_78');
  assert.equal(rows[0].verifiedByRoadServices,false);
  for(const secret of ['lat','lng','user_id','author_id','phone','address'])assert.ok(!(secret in rows[0]),secret);
  ok(await t.api('POST','/api/community/road-events/'+event.id+'/report',{reason:'Сведения устарели'},second.token));
  const queue=ok(await t.api('GET','/api/admin/community/road/moderation',undefined,admin.token));
  assert.ok(queue.reports.some((x:any)=>x.event_id===event.id));
  ok(await t.api('POST','/api/admin/community/road-events/'+event.id+'/moderate',{status:'hidden'},admin.token));
  assert.equal(ok(await t.api('GET',post,undefined,second.token)).events.length,0);
});

test('road alerts: profanity waits for human moderation; expiry filters stale data',async()=>{
  const post='/api/community/rooms/'+room+'/road-events';
  const pending=ok(await t.api('POST',post,{
    category:'parking',description:'пиздец, стоянка полностью занята',hours:1
  },first.token));
  assert.equal(pending.status,'pending');
  assert.equal(ok(await t.api('GET',post,undefined,second.token)).events.length,0);
  assert.equal(ok(await t.api('GET',post,undefined,first.token)).events.length,1);
  ok(await t.api('POST','/api/admin/community/road-events/'+pending.id+'/moderate',{status:'published'},admin.token));
  assert.equal(ok(await t.api('GET',post,undefined,second.token)).events.length,1);
  await t.db.query("update community_road_events set created_at=now()-interval '2 hours',expires_at=now()-interval '1 hour' where id=$1",[pending.id]);
  assert.equal(ok(await t.api('GET',post,undefined,second.token)).events.length,0);
});

test('driver can export and erase road data when account is deleted',async()=>{
  const identity={id:first.id,phone:'+79994330001',name:null,roles:['driver'],status:'active',owner_id:null};
  const archive=await t.app.privacy.export(identity);
  assert.ok(archive.communityRoadEvents.length>=1);
  await t.app.privacy.requestDelete(identity);
  t.clock.advance(31*86400);
  assert.ok(await t.app.privacy.processDeletions()>=1);
  assert.equal((await t.db.query('select * from community_road_events where author_id=$1',[first.id])).length,0);
});
