import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setup, ok } from './helpers.ts';
import { pruneCommunityEvents } from '../src/services/communityEventRetention.ts';

test('room event retention is bounded, versioned and preserves newer publications',async()=>{
  const t=await setup();
  try{
    const admin=await t.login('+79990000001');
    const writer=await t.login('+79994099001','driver');
    const reader=await t.login('+79994099002','driver');
    const room=ok(await t.api('POST','/api/admin/community/rooms',{
      slug:'retention-test-room',title:'Синхронизация трассы',kind:'route',audience:'driver'
    },admin.token));
    const route='/api/community/rooms/'+room.id;
    ok(await t.api('POST',route+'/join',{},writer.token));
    const old=ok(await t.api('POST',route+'/messages',{
      text:'Сообщение до хранения журнала',clientNonce:randomUUID()
    },writer.token));
    const recent=ok(await t.api('POST',route+'/messages',{
      text:'Недавнее сообщение после отсечки',clientNonce:randomUUID()
    },writer.token));
    const initial=ok(await t.api('GET',route+'/messages?recent=1',undefined,reader.token));
    assert.equal(initial.syncEpoch,'0');
    assert.ok(initial.messages.some((m:any)=>m.id===old.id));
    await t.db.query("update community_room_moderation_events set changed_at=$2 where message_id=$1",
      [old.id,'2027-01-01T00:00:00Z']);
    await t.db.query("update community_room_moderation_events set changed_at=$2 where message_id=$1",
      [recent.id,'2027-04-29T00:00:00Z']);
    const result=await pruneCommunityEvents(t.db,new Date('2027-04-30T00:00:00Z'));
    assert.deepEqual(result,{rooms:1,directThreads:0,removed:1});
    const feed=ok(await t.api('GET',route+'/moderation-events?after=0',undefined,reader.token));
    assert.equal(feed.syncEpoch,'1','the stale client must discard all local text on epoch mismatch');
    assert.equal(feed.changes.length,1);
    assert.equal(feed.changes[0].id,recent.id);
    const second=await pruneCommunityEvents(t.db,new Date('2027-04-30T00:00:00Z'));
    assert.equal(second.removed,0,'pruning is idempotent');
    assert.equal(ok(await t.api('GET',route+'/messages?recent=1',undefined,reader.token)).syncEpoch,'1');

    // Erasure cascades earlier creation events: the other driver's device
    // must resnapshot, not keep the deleted driver's old messages.
    const identity={id:writer.id,phone:'+79994099001',roles:['driver'],
      status:'active',name:null,owner_id:null};
    await t.app.privacy.requestDelete(identity);
    t.clock.advance(31*86400);
    assert.equal(await t.app.privacy.processDeletions(),1);
    const erased=ok(await t.api('GET',route+'/moderation-events?after=0',undefined,reader.token));
    assert.equal(erased.syncEpoch,'2');
    assert.ok(!erased.changes.some((e:any)=>e.id===recent.id));
    assert.ok(!ok(await t.api('GET',route+'/messages?recent=1',undefined,reader.token))
      .messages.some((m:any)=>m.id===old.id||m.id===recent.id));
  }finally{await t.close()}
});

test('direct-message retention has an independent epoch and protects private chats',async()=>{
  const t=await setup();
  try{
    const a=await t.login('+79994099111','driver');
    const b=await t.login('+79994099112','driver');
    const outsider=await t.login('+79994099113','driver');
    ok(await t.api('PUT','/api/community/me',{nickname:'Retention_A'},a.token));
    ok(await t.api('PUT','/api/community/me',{nickname:'Retention_B'},b.token));
    const invite=ok(await t.api('POST','/api/community/direct/request',
      {nickname:'Retention_B'},a.token));
    ok(await t.api('POST','/api/community/direct/'+invite.id+'/decision',
      {decision:'accept'},b.token));
    const route='/api/community/direct/'+invite.id;
    const old=ok(await t.api('POST',route+'/messages',{
      text:'Частный старый текст',clientNonce:randomUUID()
    },a.token));
    const recent=ok(await t.api('POST',route+'/messages',{
      text:'Частный недавний текст',clientNonce:randomUUID()
    },a.token));
    await t.db.query("update community_dm_moderation_events set changed_at=$2 where message_id=$1",
      [old.id,'2027-01-01T00:00:00Z']);
    await t.db.query("update community_dm_moderation_events set changed_at=$2 where message_id=$1",
      [recent.id,'2027-04-29T00:00:00Z']);
    const result=await pruneCommunityEvents(t.db,new Date('2027-04-30T00:00:00Z'));
    assert.deepEqual(result,{rooms:0,directThreads:1,removed:1});
    const feed=ok(await t.api('GET',route+'/moderation-events?after=0',undefined,b.token));
    assert.equal(feed.syncEpoch,'1');
    assert.equal(feed.changes.length,1);
    assert.equal(feed.changes[0].id,recent.id);
    assert.equal((await t.api('GET',route+'/moderation-events?after=0',
      undefined,outsider.token)).status,404);
    assert.equal(ok(await t.api('GET',route+'/messages?recent=1',undefined,b.token)).syncEpoch,'1');
  }finally{await t.close()}
});
