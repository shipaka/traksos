import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setup,ok} from './helpers.ts';

test('WebSocket tickets are 30-second, single-use, hashed at rest and bound to a live session',async()=>{
  const t=await setup();
  try{
    const driver=await t.login('+79994990501','driver');
    assert.equal((await t.api('POST','/api/auth/realtime-ticket',{})).status,401);
    const issued=ok(await t.api('POST','/api/auth/realtime-ticket',{},driver.token));
    assert.match(issued.ticket,/^[A-Za-z0-9_-]{43}$/);
    assert.equal(issued.expiresInSeconds,30);
    assert.notEqual(issued.ticket,driver.token);
    const rows=await t.db.query<{ticket_hash:string;session_token_hash:string}>(
      'select ticket_hash,session_token_hash from realtime_ws_tickets');
    assert.equal(rows.length,1);
    assert.notEqual(rows[0].ticket_hash,issued.ticket);
    assert.notEqual(rows[0].session_token_hash,driver.token);
    // Two concurrent handshakes for the same ticket: only one is admitted.
    const attempts=await Promise.all([
      t.app.auth.consumeRealtimeTicket(issued.ticket),
      t.app.auth.consumeRealtimeTicket(issued.ticket),
    ]);
    assert.equal(attempts.filter(Boolean).length,1);
    assert.equal(attempts.find(Boolean)?.user.id,driver.id);
    assert.equal(await t.app.auth.consumeRealtimeTicket(issued.ticket),null);

    const expired=ok(await t.api('POST','/api/auth/realtime-ticket',{},driver.token));
    await t.db.query(
      "update realtime_ws_tickets set expires_at=now()-interval '1 minute'");
    assert.equal(await t.app.auth.consumeRealtimeTicket(expired.ticket),null);

    const logoutTicket=ok(await t.api('POST','/api/auth/realtime-ticket',{},driver.token));
    ok(await t.api('POST','/api/auth/logout',{},driver.token));
    assert.equal(await t.app.auth.consumeRealtimeTicket(logoutTicket.ticket),null,
      'logout must revoke even an unexpired one-time ticket');
  }finally{await t.close()}
});

test('no more than five unconsumed tickets per session, and role revocation applies on consume',async()=>{
  const t=await setup();
  try{
    const driver=await t.login('+79994990502','driver');
    const issued=[];
    for(let i=0;i<5;i++)issued.push(
      ok(await t.api('POST','/api/auth/realtime-ticket',{},driver.token)).ticket);
    const tooMany=await t.api('POST','/api/auth/realtime-ticket',{},driver.token);
    assert.equal(tooMany.status,429);
    assert.equal(tooMany.body.error,'ws_ticket_limit');
    const first=await t.app.auth.consumeRealtimeTicket(issued[0]);
    assert.equal(first?.user.id,driver.id);
    assert.ok(ok(await t.api('POST','/api/auth/realtime-ticket',{},driver.token)).ticket);
    // Issued earlier, consumed only after the driver's role was removed:
    // the server returns CURRENT roles rather than an old token claim.
    await t.db.query("update users set roles=ARRAY['client']::text[] where id=$1",[driver.id]);
    const current=await t.app.auth.consumeRealtimeTicket(issued[1]);
    assert.deepEqual(current?.user.roles,['client']);
    assert.equal(current?.user.id,driver.id);
  }finally{await t.close()}
});
