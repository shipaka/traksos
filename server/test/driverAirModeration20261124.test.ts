import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, ok } from './helpers.ts';

test('driver Air has role checks, duplicate protection, atomic hide and durable moderation audit',
 {timeout:90000},async()=>{
  const t=await setup();
  try{
    const admin=await t.login('+79990000001');
    const owner=await t.login('+79998893011');
    const master=await t.login('+79998893012','master');
    ok(await t.api('POST','/api/admin/air/bot',{enabled:false},admin.token));
    const forbiddenWrite=await t.api('POST','/api/air/messages',
      {body:'Я мастер, пишу в чат водителей'},master.token);
    assert.equal(forbiddenWrite.status,403);
    const forbiddenHide=await t.api('POST','/api/admin/air/messages/1/hide',
      {},owner.token);
    assert.equal(forbiddenHide.status,403);
    const posted=ok(await t.api('POST','/api/air/messages',
      {body:'Где лучше остановиться для отдыха водителей?'},owner.token));
    assert.equal(posted.message.isBot,false);
    const id=posted.message.id;
    const replay=await t.api('POST','/api/air/messages',
      {body:'Где лучше остановиться для отдыха водителей?'},owner.token);
    assert.equal(replay.status,400);
    assert.equal(replay.body.error,'air_duplicate');
    const publicView=ok(await t.api('GET','/api/air/messages',undefined,owner.token));
    assert.ok(publicView.messages.some((x:any)=>x.id===id));
    const hidden=await Promise.all(Array.from({length:5},
      ()=>t.api('POST',`/api/admin/air/messages/${id}/hide`,{},admin.token)));
    assert.equal(hidden.filter(x=>x.status===200).length,1);
    assert.ok(hidden.filter(x=>x.status!==200).every(x=>x.status===404));
    assert.equal((await t.db.one<{n:number}>(
      "select count(*)::int as n from audit_log where action='air.message_hidden' and target=$1",
      [id]))?.n,1);
    assert.equal((await t.db.one<{n:number}>(
      "select count(*)::int as n from driver_air_messages where id=$1::bigint and hidden_at is not null",
      [id]))?.n,1);
    const after=ok(await t.api('GET','/api/air/messages',undefined,owner.token));
    assert.equal(after.messages.some((x:any)=>x.id===id),false);
  }finally{await t.close();}
});

test('bot control only creates one settings audit on repeated action, rate limit rejects seventh post',
 {timeout:90000},async()=>{
  const t=await setup();
  try{
    const admin=await t.login('+79990000001');
    const owner=await t.login('+79998893021');
    const initial=ok(await t.api('GET','/api/air/messages',undefined,admin.token));
    const opposite=!initial.botEnabled;
    const switched=await Promise.all(Array.from({length:7},
      ()=>t.api('POST','/api/admin/air/bot',{enabled:opposite},admin.token)));
    assert.ok(switched.every(r=>r.status===200));
    assert.ok(switched.every(r=>r.body.botEnabled===opposite));
    assert.equal((await t.db.one<{n:number}>(
      "select count(*)::int as n from audit_log where action='air.bot_settings' and target='driver-air'"))?.n,1,
      'settings retries must not create seven fake actions');
    ok(await t.api('POST','/api/admin/air/bot',{enabled:false},admin.token));
    for(let i=0;i<6;i++){
      const sent=await t.api('POST','/api/air/messages',
        {body:`Проверка чата водителей: сообщение номер ${i+1}`},owner.token);
      assert.equal(sent.status,200,JSON.stringify(sent.body));
    }
    const excessive=await t.api('POST','/api/air/messages',
      {body:'Проверка лимита: сообщение номер семь'},owner.token);
    assert.equal(excessive.status,400);
    assert.equal(excessive.body.error,'air_rate');
    const adverts=await t.api('POST','/api/air/messages',
      {body:'Продам автохимию, пишите мне'},owner.token);
    assert.equal(adverts.status,400);
    assert.equal(adverts.body.error,'air_ads');
    const link=await t.api('POST','/api/air/messages',
      {body:'Проверка ссылки https://example.com'},owner.token);
    assert.equal(link.status,400);
    assert.equal(link.body.error,'air_links');
    assert.equal((await t.db.one<{n:number}>(
      "select count(*)::int as n from driver_air_messages where user_id=$1 and origin='human'",
      [owner.id]))?.n,6);
  }finally{await t.close();}
});
