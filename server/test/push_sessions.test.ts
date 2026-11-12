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

