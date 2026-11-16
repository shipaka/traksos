import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, ok, type T } from './helpers.ts';

let t: T;
before(async () => { t = await setup(); });
after(() => t.close());

test('background is not a logout: on-line status persists until explicit signout', async () => {
  const admin = await t.login('+79990000001');
  const worker = await t.login('+79998882222', 'master');
  ok(await t.api('PUT', '/api/performer/profile', {
    kind: 'master', name: 'Проверка линии', specialties: ['electric'],
  }, worker.token));
  ok(await t.api('POST', `/api/admin/performers/${worker.id}/verify`, { decision: 'approved' }, admin.token));
  ok(await t.api('POST', '/api/performer/line', { lineStatus: 'online' }, worker.token));
  // Pausing the Android activity does not call any API: server remains on-line.
  assert.equal((await t.db.one<any>('select line_status from performer_profiles where user_id=$1', [worker.id]))?.line_status, 'online');
  const logout = ok(await t.api('POST', '/api/auth/logout', {}, worker.token));
  assert.equal(logout.ok, true);
  assert.equal((await t.db.one<any>('select line_status from performer_profiles where user_id=$1', [worker.id]))?.line_status, 'offline');
  assert.equal((await t.api('GET', '/api/me', undefined, worker.token)).status, 401);
});

test('lost device PIN revokes only its session and does not silently change the worker line', async () => {
  const admin = await t.login('+79990000001');
  const worker = await t.login('+79998882223', 'master');
  ok(await t.api('PUT', '/api/performer/profile', {
    kind: 'master', name: 'PIN recovery', specialties: ['electric'],
  }, worker.token));
  ok(await t.api('POST', `/api/admin/performers/${worker.id}/verify`, { decision: 'approved' }, admin.token));
  ok(await t.api('POST', '/api/performer/line', { lineStatus: 'online' }, worker.token));
  // Closing the local PIN gate must NOT equal pressing the worker's "offline" button.
  const result = ok(await t.api('POST', '/api/auth/recover-local-lock', {}, worker.token));
  assert.equal(result.ok, true);
  assert.equal((await t.api('GET', '/api/me', undefined, worker.token)).status, 401);
  assert.equal((await t.db.one<any>(
    'select line_status from performer_profiles where user_id=$1', [worker.id]
  ))?.line_status, 'online');
});

test('a trusted browser renews a valid session near expiry without any IP-based trust', async () => {
  const client = await t.login('+79998882224');
  await t.db.query(
    "update sessions set expires_at=now()+interval '10 days' where user_id=$1",
    [client.id],
  );
  const before = await t.db.one<{ expires_at: Date }>(
    'select expires_at from sessions where user_id=$1', [client.id],
  );
  ok(await t.api('GET', '/api/me', undefined, client.token));
  const after = await t.db.one<{ expires_at: Date }>(
    'select expires_at from sessions where user_id=$1', [client.id],
  );
  assert.ok(before && after);
  assert.ok(new Date(after.expires_at).getTime() - new Date(before.expires_at).getTime() > 60 * 86_400_000);
});
