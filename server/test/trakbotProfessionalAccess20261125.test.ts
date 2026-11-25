import test from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './helpers.ts';
import type { Db, Queryable } from '../src/db/index.ts';
import { TrakBotService } from '../src/services/trakbot.ts';

test('TrakBot professional lookup and reply respect current approval and stale roles',async()=>{
 const t=await setup();
 try{
  const master=await t.login('+79997808401','master');
  await t.db.query("update performer_profiles set verification='approved' where user_id=$1",[master.id]);
  const actor=await t.app.auth.authenticate(master.token);
  assert.ok(actor);
  const bot=new TrakBotService(t.db);
  await bot.expertLookup(actor,'P0087');
  await t.db.query("update performer_profiles set verification='rejected' where user_id=$1",[master.id]);
  await assert.rejects(bot.expertLookup(actor,'P0087'),{status:403});
  await t.db.query("update performer_profiles set verification='approved' where user_id=$1",[master.id]);
  await t.db.query("update users set roles='{client}'::text[] where id=$1",[master.id]);
  await assert.rejects(bot.expertLookup(actor,'P0087'),{status:403});
  await t.db.query("update users set roles='{master}'::text[] where id=$1",[master.id]);
  // Pause at the final transaction boundary, after computation and before
  // committing the response pair. No external provider is involved.
  let transactions=0;
  const wrapped:Db={...t.db,tx:async<T>(fn:(q:Queryable)=>Promise<T>)=>{
   if(++transactions===2)await t.db.query("update performer_profiles set verification='rejected' where user_id=$1",[master.id]);
   return t.db.tx(fn);
  }};
  await assert.rejects(new TrakBotService(wrapped).reply(actor,'Что означает P0087?',{},false),{status:403});
  const history=await t.db.query('select id from trakbot_messages where user_id=$1',[master.id]);
  assert.equal(history.length,0);
  const quota=await t.db.one<{n:number}>('select count(*)::int as n from trakbot_request_attempts where user_id=$1',[master.id]);
  assert.equal(quota?.n,1);
  await t.db.query("update performer_profiles set verification='approved' where user_id=$1",[master.id]);
  const reply=await bot.reply(actor,'Что означает P0087?',{},false);
  assert.equal(reply.chargeAllowed,false);
  assert.equal((await t.db.query('select id from trakbot_messages where user_id=$1',[master.id])).length,2);
 }finally{await t.close();}
});
