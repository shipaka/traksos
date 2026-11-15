import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './helpers.ts';
import { exchangeSandboxTicket, issueSandboxTicket, SANDBOX_LANDING, SANDBOX_USER_PHONE } from '../src/services/sandboxTickets.ts';

const SHARED_SECRET = 'sandbox-test-only-' + 'a'.repeat(48);

test('sandbox ticket: real isolated DB account, single-use, expiry and no role escalation', async () => {
  const t = await setup();
  try {
    const phone = SANDBOX_USER_PHONE.client;
    await t.db.query(
      'insert into users(phone,name,roles) values ($1,$2,$3::text[])',
      [phone,'Вымышленный клиент',['client']],
    );
    const at = new Date('2026-12-01T09:00:00.000Z').getTime();
    const ticket = issueSandboxTicket('client',SHARED_SECRET,at,'https://traksos.example/#/admin/test-center');
    await assert.rejects(
      () => exchangeSandboxTicket(ticket.replace(/.$/,'x'), SHARED_SECRET, t.db, at+500),
      (e:any)=>e.status===403,
    );
    await assert.rejects(
      () => exchangeSandboxTicket(ticket,'wrong-secret'.repeat(5),t.db,at+500),
      (e:any)=>e.status===403,
    );
    const result = await exchangeSandboxTicket(ticket,SHARED_SECRET,t.db,at+500);
    assert.equal(result.sandbox,true);
    assert.equal(result.role,'client');
    assert.equal(result.landing,SANDBOX_LANDING.client);
    assert.equal(result.returnUrl,'https://traksos.example/#/admin/test-center');
    assert.ok(result.token.length>30);
    assert.equal((await t.api('GET','/api/me',undefined,result.token)).status,200);
    await assert.rejects(
      () => exchangeSandboxTicket(ticket,SHARED_SECRET,t.db,at+1000),
      (e:any)=>e.status===403,
      'same invite must never be reusable',
    );
    await assert.rejects(
      () => exchangeSandboxTicket(issueSandboxTicket('client',SHARED_SECRET,at),
        SHARED_SECRET,t.db,at+46_000),
      (e:any)=>e.status===403,
      'expired invite must never issue a session',
    );
    await assert.rejects(
      () => exchangeSandboxTicket(issueSandboxTicket('master',SHARED_SECRET,at),
        SHARED_SECRET,t.db,at+1000),
      (e:any)=>e.status===403,
      'unseeded or unauthorized role must fail closed',
    );
    const orderCount=await t.db.one<{n:number}>('select count(*)::int as n from orders');
    assert.equal(orderCount?.n,0);
  } finally {
    await t.close();
  }
});

test('primary site cannot exchange sandbox login credentials without SANDBOX_INSTANCE', async () => {
  const t=await setup();
  try {
    const response = await t.api('POST','/api/sandbox/exchange',{ticket:'a'.repeat(50)});
    assert.equal(response.status,404);
    const check = await t.api('GET','/api/health');
    assert.equal(check.body.sandbox,false);
  } finally {
    await t.close();
  }
});
