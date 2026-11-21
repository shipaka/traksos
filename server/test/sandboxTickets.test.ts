import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './helpers.ts';
import { config } from '../src/config.ts';
import { exchangeSandboxTicket, issueSandboxTicket, switchSandboxRole, SANDBOX_ROLES, SANDBOX_LANDING, SANDBOX_USER_PHONE } from '../src/services/sandboxTickets.ts';

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
    // A final base64url character can change only ignored padding bits.
    // Such aliases must be rejected even when they decode to the same HMAC.
    const [payload, mac] = ticket.split('.');
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    const last = alphabet.indexOf(mac.at(-1)!);
    const alias = mac.slice(0,-1) + alphabet[last ^ 1];
    assert.equal(Buffer.from(alias,'base64url').toString('hex'), Buffer.from(mac,'base64url').toString('hex'));
    await assert.rejects(
      () => exchangeSandboxTicket(payload+'.'+alias, SHARED_SECRET, t.db, at+500),
      (e:any)=>e.status===403,
      'non-canonical signature encoding must never be accepted',
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


test('sandbox role matrix: all 12 isolated handoffs, courier and supervisor switching', async () => {
  const t = await setup();
  // The CI helper has a different privileged phone allowlist from the real
  // isolated sandbox. Temporarily reproduce the sandbox allowlist so the
  // *existing* staff-auth protection is exercised rather than bypassed.
  const oldAdmin=[...config.adminPhones],oldMod=[...config.moderatorPhones];
  config.adminPhones.splice(0,config.adminPhones.length,SANDBOX_USER_PHONE.admin);
  config.moderatorPhones.splice(0,config.moderatorPhones.length,SANDBOX_USER_PHONE.moderator);
  try {
    // Keep real DB/session timestamps and injected API clock aligned. This
    // regression test never uses a sandbox VPS or grants roles to real users.
    const at = Date.now();
    t.clock.set(new Date(at).toISOString());
    const required: Record<string,string[]> = {
      client:['client'], owner:['client'], driver:['client','driver'],
      master:['master'], tow:['tow'], service:['service'],
      master_service:['master','service'], insurer:['insurer'],
      inspection:['inspection_operator'], courier:['courier'],
      moderator:['moderator'], admin:['admin'],
    };
    assert.equal(SANDBOX_ROLES.length,12,'the owner-approved 12 test cabinets must remain available');
    assert.deepEqual([...SANDBOX_ROLES].sort(),Object.keys(required).sort());
    for(const role of SANDBOX_ROLES){
      const phone=SANDBOX_USER_PHONE[role];
      assert.ok(phone && /^\+7\d{10}$/.test(phone),role+': isolated account mapping missing');
      await t.db.query('insert into users(phone,name,roles) values ($1,$2,$3::text[])',
        [phone,'Только локальный тест '+role,required[role]]);
    }
    let supervisorToken='';
    let courierToken='';
    for(const role of SANDBOX_ROLES){
      const ticket=issueSandboxTicket(role,SHARED_SECRET,at);
      const handoff=await exchangeSandboxTicket(ticket,SHARED_SECRET,t.db,at+100);
      assert.equal(handoff.role,role);
      assert.equal(handoff.landing,SANDBOX_LANDING[role],role+': wrong landing route');
      assert.ok(handoff.token.length>=30,role+': no real session');
      const me=await t.api('GET','/api/me',undefined,handoff.token);
      assert.equal(me.status,200,role+': role session cannot reach its real API');
      assert.equal(me.body.phone,SANDBOX_USER_PHONE[role],role+': opened another fixture');
      if(role==='admin')supervisorToken=handoff.token;
      if(role==='courier')courierToken=handoff.token;
      await assert.rejects(
        () => exchangeSandboxTicket(ticket,SHARED_SECRET,t.db,at+200),
        (e:any)=>e.status===403,role+': one-time ticket can be replayed');
    }
    assert.ok(supervisorToken&&courierToken);
    const switched=await switchSandboxRole(t.db,supervisorToken,'courier',at+300);
    assert.equal(switched.role,'courier');
    assert.equal(switched.landing,'#/courier');
    const courier=await t.api('GET','/api/me',undefined,switched.token);
    assert.equal(courier.status,200,'admin cannot open the dedicated courier sandbox account');
    assert.equal(courier.body.phone,SANDBOX_USER_PHONE.courier);
    await assert.rejects(
      () => switchSandboxRole(t.db,courierToken,'admin',at+400),
      (e:any)=>e.status===403,'courier role must not become sandbox supervisor');
    // Missing a dedicated courier role must fail closed; never enter as client.
    await t.db.query('update users set roles=$2::text[] where phone=$1',
      [SANDBOX_USER_PHONE.courier,['client']]);
    await assert.rejects(
      () => exchangeSandboxTicket(issueSandboxTicket('courier',SHARED_SECRET,at),
        SHARED_SECRET,t.db,at+500),
      (e:any)=>e.status===403,'unseeded courier must not silently fall back to client');
  } finally {
    config.adminPhones.splice(0,config.adminPhones.length,...oldAdmin);
    config.moderatorPhones.splice(0,config.moderatorPhones.length,...oldMod);
    await t.close();
  }
});
