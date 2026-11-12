import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, ok, type T } from './helpers.ts';

let t: T;
before(async () => { t = await setup(); });
after(() => t.close());

test('one physical push token belongs only to the most recent signed-in account', async () => {
  const first = await t.login('+79996667711');
  const second = await t.login('+79996667712');
  const token = 'device-test-rustore-token-123456';
  ok(await t.api('POST', '/api/me/push-token', { provider: 'rustore', token }, first.token));
  ok(await t.api('POST', '/api/me/push-token', { provider: 'rustore', token }, second.token));

  const owners = await t.db.query<{ user_id: string; session_token_hash: string | null }>(
    'select user_id, session_token_hash from push_tokens where token=$1', [token]);
  assert.equal(owners.length, 1);
  assert.equal(owners[0].user_id, second.id);
  assert.ok(owners[0].session_token_hash);

  const before = t.push.sent.length;
  await t.app.notifier.notify([first.id], { type: 'test' },
    { kind: 'normal', title: 'Первый', body: 'Нельзя отправлять', data: {} });
  assert.equal(t.push.sent.length, before, 'former account must not receive calls or private alerts');
  await t.app.notifier.notify([second.id], { type: 'test' },
    { kind: 'normal', title: 'Второй', body: 'Можно', data: {} });
  assert.equal(t.push.sent.length, before + 1);
  assert.deepEqual(t.push.sent.at(-1)?.tokens, [token]);
});


test('logout disconnects only its device; password reset removes old push sessions', async () => {
  const phone = '+79996667714';
  const registration = ok(await t.api('POST', '/api/auth/code', { phone }));
  const verified = ok(await t.api('POST', '/api/auth/verify', {
    phone, code: registration.devCode, password: 'TestPassword-2026!',
    accountType: 'owner',
  }));
  const second = ok(await t.api('POST', '/api/auth/login', {
    phone, password: 'TestPassword-2026!',
  }));
  const firstPush = 'device-a-token-for-login-123';
  const secondPush = 'device-b-token-for-login-456';
  ok(await t.api('POST', '/api/me/push-token', { provider: 'rustore', token: firstPush }, verified.token));
  ok(await t.api('POST', '/api/me/push-token', { provider: 'rustore', token: secondPush }, second.token));
  ok(await t.api('POST', '/api/auth/logout', {}, verified.token));
  assert.equal((await t.api('GET', '/api/me', undefined, verified.token)).status, 401);
  assert.equal((await t.api('GET', '/api/me', undefined, second.token)).status, 200);
  const afterLogout = await t.db.query<{ token: string }>(
    'select token from push_tokens where user_id=$1 order by token', [verified.user.id]);
  assert.deepEqual(afterLogout.map(x => x.token), [secondPush]);

  t.clock.advance(61);
  const reset = ok(await t.api('POST', '/api/auth/code', { phone, purpose: 'reset' }));
  ok(await t.api('POST', '/api/auth/verify', {
    phone, code: reset.devCode, purpose: 'reset', password: 'NewPassword-2027!',
  }));
  assert.equal((await t.api('GET', '/api/me', undefined, second.token)).status, 401);
  assert.deepEqual(await t.db.query(
    'select token from push_tokens where user_id=$1', [verified.user.id]), []);
});
