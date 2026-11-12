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
  assert.equal((await t.api('PUT', '/api/base', { name: 'СТО', address: 'Шоссе, 1' }, insured.token)).status, 400);
  assert.equal((await t.api('PUT', '/api/performer/profile', { kind: 'master', name: 'Мастер' }, insured.token)).status, 400);

  const client = await register('+79998881114', 'owner');
  assert.equal((await t.api('PUT', '/api/performer/profile', { kind: 'master', name: 'Мастер' }, client.token)).status, 400);
  assert.equal((await t.api('PUT', '/api/base', { name: 'СТО', address: 'Шоссе, 1' }, client.token)).status, 400);
});

test('separate driver type is assigned without a client role', async () => {
  const driver = await register('+79998881115', 'driver');
  assert.deepEqual(driver.user.roles, ['driver']);
  const me = ok(await t.api('GET', '/api/me', undefined, driver.token));
  assert.ok(me.roles.includes('driver'));
  assert.ok(!me.roles.includes('client'));
});
