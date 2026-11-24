import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setup,ok} from './helpers.ts';
import {sha256} from '../src/util.ts';

const msg={kind:'normal' as const,title:'Тест',body:'Тестовая доставка',data:{orderId:'synthetic'}};
const event={type:'test_push_session_boundary'};
const register=(token:string)=>({provider:'rustore',token});

test('push delivery excludes legacy, expired and blocked sessions while preserving inbox and active device', {timeout:60000},async()=>{
 const t=await setup();
 try{
  const active=await t.login('+79994442301');
  const expired=await t.login('+79994442302');
  const blocked=await t.login('+79994442303');
  const legacy=await t.login('+79994442304');
  for(const [user,device] of [[active,'bound-active-test-device'],[expired,'bound-expired-test-device'],[blocked,'bound-blocked-test-device']] as const)
   ok(await t.api('POST','/api/me/push-token',register(device),user.token));
  await t.db.query("insert into push_tokens(user_id,provider,token) values ($1,'rustore',$2)",[legacy.id,'legacy-unbound-test-device']);
  await t.db.query("update sessions set expires_at=now()-interval '1 second' where token_hash=$1",[sha256(expired.token)]);
  await t.db.query("update users set status='blocked' where id=$1",[blocked.id]);
  const before=t.push.sent.length;
  await t.app.notifier.notify([active.id,expired.id,blocked.id,legacy.id],event,msg);
  assert.deepEqual(t.push.sent.slice(before).flatMap(x=>x.tokens),['bound-active-test-device']);
  const inbox=await t.db.one<{n:number}>('select count(*)::int as n from notifications where kind=$1',[event.type]);
  assert.equal(inbox?.n,4,'the session restriction affects transport, not the durable inbox');
 }finally{await t.close();}
});

test('revoked registration waiting for device lock cannot steal a current account binding', {timeout:60000},async()=>{
 const t=await setup();
 try{
  const previous=await t.login('+79994442305');
  const current=await t.login('+79994442306');
  const device='shared-test-device-token';
  ok(await t.api('POST','/api/me/push-token',register(device),current.token));
  let attempt:ReturnType<typeof t.api>|undefined;
  await t.db.tx(async q=>{
   await q.query('select pg_advisory_xact_lock(hashtext($1))',['push:rustore:'+device]);
   attempt=t.api('POST','/api/me/push-token',register(device),previous.token);
   // Wait until the authenticated request reaches the held advisory lock.
   // No sleeps are used as evidence of the race; verify PostgreSQL's waiter.
   const deadline=Date.now()+5000;
   let waiting=false;
   while(Date.now()<deadline){
    const row=await t.db.one<{waiting:boolean}>(
      "select exists(select 1 from pg_stat_activity where pid<>pg_backend_pid() and wait_event_type='Lock' and wait_event='advisory' and query like '%pg_advisory_xact_lock%') as waiting");
    if(row?.waiting){waiting=true;break;}
    await new Promise(resolve=>setTimeout(resolve,20));
   }
   assert.ok(waiting,'authenticated registration reached the device lock');
   await q.query('delete from sessions where token_hash=$1',[sha256(previous.token)]);
  });
  assert.ok(attempt);
  assert.equal((await attempt).status,403);
  const row=await t.db.one<{user_id:string;session_token_hash:string}>(
    "select user_id,session_token_hash from push_tokens where provider='rustore' and token=$1",[device]);
  assert.equal(row?.user_id,current.id);
  assert.equal(row?.session_token_hash,sha256(current.token));
  const before=t.push.sent.length;
  await t.app.notifier.deliverStored([previous.id],event,msg);
  assert.equal(t.push.sent.length,before);
  await t.app.notifier.deliverStored([current.id],event,msg);
  assert.deepEqual(t.push.sent.slice(before).flatMap(x=>x.tokens),[device]);
 }finally{await t.close();}
});
