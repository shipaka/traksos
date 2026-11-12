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
