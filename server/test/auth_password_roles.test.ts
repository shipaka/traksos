import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, ok, type T } from './helpers.ts';

let t: T;
before(async () => { t = await setup(); });
after(() => t.close());

async function register(phone: string, accountType: string, password = 'StrongPassword-2026!') {
  const code = ok(await t.api('POST', '/api/auth/code', { phone, purpose: 'register' }));
  t.clock.advance(61);
  return ok(await t.api('POST', '/api/auth/verify', { phone, code: code.devCode, accountType, password }));
}

test('password login does not send SMS, recovery resets password, and roles stay unchanged', async () => {
  const phone = '+79998881111';
  const user = await register(phone, 'owner');
  assert.deepEqual(user.user.roles, ['client']);
  const wrong = await t.api('POST', '/api/auth/login', { phone, password: 'wrong' });
  assert.equal(wrong.status, 401);
  const logged = ok(await t.api('POST', '/api/auth/login', { phone, password: 'StrongPassword-2026!' }));
  assert.equal(logged.user.id, user.user.id);
  assert.deepEqual(logged.user.roles, ['client']);
  const resetCode = ok(await t.api('POST', '/api/auth/code', { phone, purpose: 'reset' }));
  ok(await t.api('POST', '/api/auth/verify', {
    phone, code: resetCode.devCode, purpose: 'reset', password: 'EvenStronger-2027!',
  }));
  assert.equal((await t.api('POST', '/api/auth/login', { phone, password: 'StrongPassword-2026!' })).status, 401);
  assert.equal(ok(await t.api('POST', '/api/auth/login', { phone, password: 'EvenStronger-2027!' })).user.id, user.user.id);
});

test('master plus service is automatic, client and insurance are exclusive', async () => {
  const hybrid = await register('+79998881112', 'master_service');
  assert.ok(hybrid.user.roles.includes('master'));
  assert.ok(hybrid.user.roles.includes('service'));
  assert.ok(!hybrid.user.roles.includes('client'));
  const p = ok(await t.api('PUT', '/api/performer/profile', {
    kind: 'master', name: 'Два кабинета', specialties: ['electric', 'diag'],
  }, hybrid.token));
  assert.deepEqual(p.specialties, ['electric', 'diag']);
  const c = ok(await t.api('PUT', '/api/base', { name: 'Собственная СТО', address: 'Шушары, 1' }, hybrid.token));
  assert.equal(c.center.verification, 'pending');

  const insured = await register('+79998881113', 'insurer');
  assert.deepEqual(insured.user.roles, ['insurer']);
  assert.equal((await t.api('POST', '/api/shop/orders', {
    items: [{ productId: '00000000-0000-4000-8000-000000000001', qty: 1 }],
    delivery: 'pickup',
  }, insured.token)).status, 403, 'страховой аккаунт не может оформлять обычные покупки');
  const insurerOffers = ok(await t.api('GET', '/api/me/offers', undefined, insured.token));
  assert.deepEqual(insurerOffers.map((entry: any) => entry.audience), ['privacy']);
  const hybridOffers = ok(await t.api('GET', '/api/me/offers', undefined, hybrid.token));
  assert.deepEqual(hybridOffers.map((entry: any) => entry.audience), ['performer', 'privacy']);
  assert.ok([400,403].includes((await t.api('PUT', '/api/base', { name: 'СТО', address: 'Шоссе, 1' }, insured.token)).status));
  assert.ok([400,403].includes((await t.api('PUT', '/api/performer/profile', { kind: 'master', name: 'Мастер' }, insured.token)).status));

  const client = await register('+79998881114', 'owner');
  assert.equal((await t.api('PUT', '/api/performer/profile', { kind: 'master', name: 'Мастер' }, client.token)).status, 400);
  assert.equal((await t.api('PUT', '/api/base', { name: 'СТО', address: 'Шоссе, 1' }, client.token)).status, 400);
});

test('SMS budget survives AuthService restart and concurrent requests cannot double-send', async () => {
  const { AuthService } = await import('../src/services/auth.ts');
  const phone = '+79998881166';
  const first = await Promise.all([
    t.api('POST', '/api/auth/code', { phone }),
    t.api('POST', '/api/auth/code', { phone }),
  ]);
  assert.deepEqual(first.map(r => r.status).sort(), [200, 429]);
  assert.equal((await t.db.one<{ used: number }>(
    "select used from auth_sms_limits where scope='phone_day' and identity=$1", [phone]))?.used, 1);
  const restarted = new AuthService(t.db, t.sms, t.clock.now);
  for (let i = 0; i < 7; i++) {
    t.clock.advance(61);
    await restarted.requestCode(phone);
  }
  t.clock.advance(61);
  await assert.rejects(() => new AuthService(t.db, t.sms, t.clock.now).requestCode(phone),
    (e: any) => e.status === 429 || e.code === 'too_many_codes');
  const count = await t.db.one<{ used: number }>(
    "select used from auth_sms_limits where scope='phone_day' and identity=$1", [phone]);
  assert.equal(count?.used, 8);
});

test('SMS external IP hourly budget survives changes of phone number', async () => {
  const { AuthService } = await import('../src/services/auth.ts');
  const auth = new AuthService(t.db, t.sms, t.clock.now);
  const ip = '198.51.100.123';
  for (let i = 0; i < 15; i++) {
    await auth.requestCode('+7999777' + String(1000 + i), ip);
  }
  await assert.rejects(() => new AuthService(t.db, t.sms, t.clock.now)
    .requestCode('+79997772000', ip), (e: any) => e.status === 429 || e.code === 'too_many_codes');
  const total = await t.db.one<{ used: number }>(
    "select used from auth_sms_limits where scope='ip_hour' and identity=$1", [ip]);
  assert.equal(total?.used, 15);
});

test('password brute-force lockout survives server restart and expires after fifteen minutes', async () => {
  const { AuthService } = await import('../src/services/auth.ts');
  const phone = '+79998881177';
  await register(phone, 'owner', 'KnownPassword-2026!');
  const firstInstance = new AuthService(t.db, t.sms, t.clock.now);
  for (let i = 0; i < 10; i++) {
    await assert.rejects(() => firstInstance.loginPassword(phone, 'wrong-password'), (e: any) => e.status === 401);
  }
  const restarted = new AuthService(t.db, t.sms, t.clock.now);
  await assert.rejects(() => restarted.loginPassword(phone, 'KnownPassword-2026!'), (e: any) => e.status === 429);
  t.clock.advance(901);
  const recovered = await restarted.loginPassword(phone, 'KnownPassword-2026!');
  assert.ok(recovered.token);
  assert.equal((await t.db.one<{ n: number }>(
    "select count(*)::int as n from auth_login_attempts where scope='phone' and identity=$1", [phone]))?.n, 0);
});

test('untrusted forwarded IP cannot evade direct connection SMS limits', async () => {
  const phone = '+79998881178';
  // A direct client cannot claim a different network address through this header.
  const response = await fetch(t.base + '/api/auth/code', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '198.51.100.77' },
    body: JSON.stringify({ phone }),
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await t.db.query(
    "select identity from auth_sms_limits where scope='ip_hour' and identity='198.51.100.77'"), []);
});

test('separate driver type is assigned without a client role', async () => {
  const driver = await register('+79998881115', 'driver');
  assert.deepEqual(driver.user.roles, ['driver']);
  const me = ok(await t.api('GET', '/api/me', undefined, driver.token));
  assert.ok(me.roles.includes('driver'));
  assert.ok(!me.roles.includes('client'));
});
