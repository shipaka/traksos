// PR #274: true Postgres transaction boundary for multi-recipient notifications.
// Run by "npm test" on the disposable CI test DB. No production recipients.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, type T } from './helpers.ts';

let t: T;
let first: {id:string};
let second: {id:string};
before(async()=>{
  t=await setup();
  first=await t.login('+79994442231');
  second=await t.login('+79994442232');
});
after(async()=>{ await t?.close(); });

const kind='test_notify_atomic_20261124';
const msg={
  kind:'normal' as const,
  title:'Тестовая рассылка',
  body:'Проверка транзакции',
  data:{orderId:'synthetic-test'},
};
const rows=async()=>t.db.query<{user_id:string;kind:string}>(
  'select user_id,kind from notifications where kind=$1 order by user_id',[kind]);

test('PostgreSQL: multi-recipient inbox is all-or-nothing on invalid second recipient',async()=>{
  const beforeLive=t.app.hub.log.length;
  const beforePush=t.push.sent.length;
  await assert.rejects(
    t.app.notifier.notify([first.id,'not-a-valid-uuid'],{type:kind},msg));
  assert.deepEqual(await rows(),[],'first persisted recipient must roll back too');
  assert.equal(t.app.hub.log.length,beforeLive,'no event before persistence succeeds');
  assert.equal(t.push.sent.length,beforePush,'no external push before persistence succeeds');
});

test('PostgreSQL: same user ID appears once, both valid recipients retain inbox alerts',async()=>{
  const beforeLive=t.app.hub.log.length;
  await t.app.notifier.notify([first.id,second.id,first.id],{type:kind},msg);
  assert.deepEqual((await rows()).map(r=>r.user_id).sort(),[first.id,second.id].sort());
  assert.deepEqual(t.app.hub.log.slice(beforeLive).map(e=>e.userId).sort(),
    [first.id,second.id].sort());
});

test('PostgreSQL: call-class push is not an unread inbox notification',async()=>{
  const beforeCount=(await rows()).length;
  await t.app.notifier.notify([first.id],{type:kind},{
    kind:'call',title:'Тестовый вызов',body:'Проверка без inbox',data:{orderId:'synthetic-test'}
  });
  assert.equal((await rows()).length,beforeCount);
});
