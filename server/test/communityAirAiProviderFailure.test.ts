import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setup,ok} from './helpers.ts';
import {randomUUID} from 'node:crypto';

test('provider disabled by default: driver chat works, AI status is off and no fake message is posted',async()=>{
 const t=await setup({airAiResponder:null});
 try{
  const driver=await t.login('+79995897001','driver');
  const rooms=ok(await t.api('GET','/api/community/rooms',undefined,driver.token));
  const room=rooms.rooms.find((x:any)=>x.slug==='drivers-russia');
  ok(await t.api('POST','/api/community/rooms/'+room.id+'/join',{},driver.token));
  const question=ok(await t.api('POST','/api/community/rooms/'+room.id+'/messages',{
   text:'@ТраксБот Подскажи, как безопасно проверить питание блока?',
   clientNonce:randomUUID()
  },driver.token));
  assert.equal(ok(await t.api('GET','/api/community/ai/status',undefined,driver.token)).enabled,false);
  assert.equal((await t.api('POST','/api/community/rooms/'+room.id+'/ai/ask',{
   sourceMessageId:question.id,consent:true
  },driver.token)).status,503);
  assert.equal((await t.db.query('select id from community_ai_requests')).length,0,'no request created without provider');
  assert.equal((await t.db.query("select id from community_messages where bot_type='traksbot'")).length,0,'no invented bot reply');
 }finally{await t.close();}
});

test('provider failure: no synthetic response, one bounded explicit retry after cooldown',async()=>{
 let calls=0;
 const t=await setup({airAiResponder:async()=>{calls++;throw new Error('offline_test');}});
 try{
  const driver=await t.login('+79995897002','driver');
  const rooms=ok(await t.api('GET','/api/community/rooms',undefined,driver.token));
  const room=rooms.rooms.find((x:any)=>x.slug==='drivers-russia');
  ok(await t.api('POST','/api/community/rooms/'+room.id+'/join',{},driver.token));
  const question=ok(await t.api('POST','/api/community/rooms/'+room.id+'/messages',{
   text:'@ТраксБот Сканер не видит модуль управления. Какие вводные нужны?',
   clientNonce:randomUUID()
  },driver.token));
  const ask=()=>t.api('POST','/api/community/rooms/'+room.id+'/ai/ask',{
   sourceMessageId:question.id,consent:true
  },driver.token);
  assert.equal((await ask()).status,503);
  assert.equal(calls,1);
  assert.equal((await ask()).body.status,'failed','immediate retry is not a second paid provider call');
  assert.equal(calls,1);
  assert.equal((await t.db.query("select id from community_messages where bot_type='traksbot'")).length,0);
  t.clock.advance(61);
  assert.equal((await ask()).status,503);
  assert.equal(calls,2);
  t.clock.advance(61);
  assert.equal((await ask()).body.status,'failed','bounded retry does not endlessly call a failing provider');
  assert.equal(calls,2);
  const rows=await t.db.query<{state:string;attempts:number}>('select state,attempts from community_ai_requests');
  assert.equal(rows.length,1);
  assert.equal(rows[0].state,'failed');
  assert.equal(rows[0].attempts,2);
 }finally{await t.close();}
});
