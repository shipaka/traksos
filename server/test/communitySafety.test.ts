import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {setup,ok} from './helpers.ts';

test('revoked professional verification never receives live publication or moderation hints',async()=>{
  const t=await setup();
  try {
    const admin=await t.login('+79990000001');
    const master=await t.login('+79994990101','master');
    const recipient=await t.login('+79994990102','master');
    for(const [idx,u] of [master,recipient].entries()){
      ok(await t.api('PUT','/api/performer/profile',{
        kind:'master',name:'Тестовый электрик '+idx,specialties:['electric'],
        taxStatus:'self_employed',inn:'780000004001',
      },u.token));
      ok(await t.api('POST','/api/admin/performers/'+u.id+'/verify',
        {decision:'approved'},admin.token));
    }
    const room=ok(await t.api('POST','/api/admin/community/rooms',{
      slug:'air-revocation-electric',title:'Клуб электриков для проверки',
      kind:'professional',audience:'professional',specialty:'electric',
    },admin.token));
    const path='/api/community/rooms/'+room.id;
    ok(await t.api('POST',path+'/join',{},master.token));
    ok(await t.api('POST',path+'/join',{},recipient.token));
    t.app.hub.log.length=0;
    // The member still has a stale subscription but lost access on the server.
    await t.db.query("update performer_profiles set verification='pending' where user_id=$1",[recipient.id]);
    const fresh=ok(await t.api('POST',path+'/messages',{
      text:'Проверяем электрическую цепь тягача',clientNonce:randomUUID(),
    },master.token));
    assert.equal(fresh.status,'published');
    assert.ok(!t.app.hub.log.some((x:any)=>x.userId===recipient.id&&x.event.type==='community_message'),
      'a revoked member must not receive even a private room ID through WebSocket');
    assert.equal((await t.api('GET',path+'/moderation-events',undefined,recipient.token)).status,404);
    assert.equal((await t.api('GET',path+'/messages',undefined,recipient.token)).status,404);
    const pending=ok(await t.api('POST',path+'/messages',{
      text:'сука, проверка контакта',clientNonce:randomUUID()
    },master.token));
    assert.equal(pending.status,'pending');
    t.app.hub.log.length=0;
    ok(await t.api('POST','/api/admin/community/messages/'+pending.id+'/moderate',
      {status:'published'},admin.token));
    assert.ok(!t.app.hub.log.some((x:any)=>x.userId===recipient.id&&x.event.type==='community_moderation'),
      'moderation hints must apply the same ACL as room reads');
    const own=ok(await t.api('GET',path+'/moderation-events?after=0',undefined,master.token));
    assert.ok(own.changes.some((x:any)=>x.id===pending.id));
  }finally{await t.close()}
});

test('driver role revocation closes old DM history even with an existing token',async()=>{
  const t=await setup();
  try{
    const sender=await t.login('+79994990111','driver');
    const recipient=await t.login('+79994990112','driver');
    ok(await t.api('PUT','/api/community/me',{nickname:'RevokedDriver_A'},sender.token));
    ok(await t.api('PUT','/api/community/me',{nickname:'RevokedDriver_B'},recipient.token));
    const invitation=ok(await t.api('POST','/api/community/direct/request',
      {nickname:'RevokedDriver_B'},sender.token));
    ok(await t.api('POST','/api/community/direct/'+invitation.id+'/decision',
      {decision:'accept'},recipient.token));
    const path='/api/community/direct/'+invitation.id;
    ok(await t.api('POST',path+'/messages',{
      text:'Проверка отзыва водительской роли',clientNonce:randomUUID()
    },sender.token));
    await t.db.query("update users set roles=ARRAY['client']::text[] where id=$1",[recipient.id]);
    assert.equal((await t.api('GET',path+'/messages?recent=1',undefined,recipient.token)).status,403);
    assert.equal((await t.api('GET',path+'/moderation-events',undefined,recipient.token)).status,403);
    assert.equal((await t.api('GET','/api/community/direct',undefined,recipient.token)).status,403);
  }finally{await t.close()}
});

test('blocking a driver also prevents late publication of already pending DMs',async()=>{
  const t=await setup();
  try{
    const admin=await t.login('+79990000001');
    const sender=await t.login('+79994990121','driver');
    const recipient=await t.login('+79994990122','driver');
    ok(await t.api('PUT','/api/community/me',{nickname:'DelayedBlock_A'},sender.token));
    ok(await t.api('PUT','/api/community/me',{nickname:'DelayedBlock_B'},recipient.token));
    const invite=ok(await t.api('POST','/api/community/direct/request',
      {nickname:'DelayedBlock_B'},sender.token));
    ok(await t.api('POST','/api/community/direct/'+invite.id+'/decision',
      {decision:'accept'},recipient.token));
    const path='/api/community/direct/'+invite.id;
    const pending=ok(await t.api('POST',path+'/messages',{
      text:'сука, сообщение ожидает проверки',clientNonce:randomUUID()
    },sender.token));
    assert.equal(pending.status,'pending');
    ok(await t.api('POST','/api/community/direct/blocks',{
      nickname:'DelayedBlock_A',blocked:true
    },recipient.token));
    t.app.hub.log.length=0;
    const approval=await t.api('POST','/api/admin/community/direct/messages/'+pending.id+'/moderate',
      {status:'published'},admin.token);
    assert.equal(approval.status,409,'moderation must not override a later peer block');
    assert.equal(approval.body.error,'conversation_unavailable');
    assert.equal((await t.db.one<{moderation_state:string}>(
      'select moderation_state from community_dm_messages where id=$1',[pending.id]))?.moderation_state,'pending');
    const recipientHistory=ok(await t.api('GET',path+'/messages?recent=1',undefined,recipient.token));
    assert.ok(!recipientHistory.messages.some((m:any)=>m.id===pending.id));
    ok(await t.api('POST','/api/admin/community/direct/messages/'+pending.id+'/moderate',
      {status:'hidden'},admin.token));
    assert.ok(!t.app.hub.log.some((x:any)=>x.userId===recipient.id&&
      x.event.type==='community_direct_moderation'&&x.event.text),
      'a moderation signal must never contain private content');
  }finally{await t.close()}
});
