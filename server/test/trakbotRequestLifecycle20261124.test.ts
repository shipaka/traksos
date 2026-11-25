import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { setup, ok } from './helpers.ts';

test('TrakBot: deletion does not reset minute/day quota; a different account is unaffected', async () => {
  const t = await setup();
  try {
    const a = await t.login('+79997774451','client');
    const b = await t.login('+79997774452','client');
    const send = (token: string) => t.api('POST','/api/trakbot/answer',
      { message: 'Привет', allowAiProcessing: false }, token);
    const first = await Promise.all(Array.from({length:10}, () => send(a.token)));
    assert.ok(first.every(r => r.status === 200));
    ok(await t.api('DELETE','/api/trakbot/messages',undefined,a.token));
    const limited = await send(a.token);
    assert.equal(limited.body?.error,'trakbot_rate_limit');
    assert.equal(ok(await t.api('GET','/api/trakbot/messages',undefined,a.token)).messages.length,0);
    ok(await send(b.token));
    // Age the ten reservations beyond the minute but still within the day.
    await t.db.query("update trakbot_request_attempts set requested_at=now()-interval '2 minutes' where user_id=$1",[a.id]);
    await t.db.query("insert into trakbot_request_attempts(user_id,requested_at) select $1,now()-interval '2 minutes' from generate_series(1,140)",[a.id]);
    assert.equal((await send(a.token)).body?.error,'trakbot_rate_limit');
    // Expired reservations must not block a genuinely new day.
    await t.db.query("update trakbot_request_attempts set requested_at=now()-interval '2 days' where user_id=$1",[a.id]);
    ok(await send(a.token));
    const count = await t.db.one<{n:number}>('select count(*)::int as n from trakbot_request_attempts where user_id=$1',[a.id]);
    assert.equal(count?.n,1);
  } finally { await t.close(); }
});

test('TrakBot: a real in-flight answer cannot resurrect history after deletion', async () => {
  const t = await setup();
  let release!: () => void;
  const hold = new Promise<void>(resolve => { release = resolve; });
  let locked!: () => void;
  const ready = new Promise<void>(resolve => { locked = resolve; });
  let blocker: Promise<unknown> | undefined;
  let pending: ReturnType<typeof t.api> | undefined;
  try {
    const a = await t.login('+79997774453','client');
    // Force a deterministic pause AFTER quota reservation, BEFORE answer
    // generation, without any real external model or production traffic.
    blocker = t.db.tx(async q => {
      await q.query('lock table diagnostic_codes in access exclusive mode');
      locked();
      await hold;
    });
    await Promise.race([ready,blocker.then(() => { throw Error('lock ended early'); })]);
    pending = t.api('POST','/api/trakbot/answer',
      {message:'Что означает P0087?',allowAiProcessing:false},a.token);
    let reserved = false;
    for (let i=0;i<100;i++) {
      const row = await t.db.one<{n:number}>('select count(*)::int as n from trakbot_request_attempts where user_id=$1',[a.id]);
      if (row?.n === 1) { reserved=true; break; }
      await delay(30);
    }
    assert.ok(reserved,'request must reserve its slot before lookup');
    ok(await t.api('DELETE','/api/trakbot/messages',undefined,a.token));
    release();
    await blocker;
    const old = await pending;
    assert.equal(old.body?.error,'trakbot_history_changed');
    assert.notEqual(old.status,200);
    assert.deepEqual(ok(await t.api('GET','/api/trakbot/messages',undefined,a.token)).messages,[]);
    ok(await t.api('POST','/api/trakbot/answer',
      {message:'Привет, новый разговор',allowAiProcessing:false},a.token));
    const messages = ok(await t.api('GET','/api/trakbot/messages',undefined,a.token)).messages;
    assert.equal(messages.length,2);
    assert.ok(messages.every((m:{body:string}) => !m.body.includes('P0087')));
  } finally {
    release();
    await blocker?.catch(()=>{});
    await pending?.catch(()=>{});
    await t.close();
  }
});
