import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, ok, type T } from './helpers.ts';

let t: T;
before(async () => { t = await setup(); });
after(() => t.close());

test('voluntary verification does not block a registered unverified master from going online', async () => {
  const worker=await t.login('+79998882223','master');
  const profile=ok(await t.api('PUT','/api/performer/profile',{
    kind:'master',name:'Мастер без добровольных фото',specialties:['electric'],
  },worker.token));
  assert.equal(profile.verification,'pending');
  const online=ok(await t.api('POST','/api/performer/line',{lineStatus:'online'},worker.token));
  assert.equal(online.line_status,'online');
  assert.equal(online.verification,'pending');
  const offline=ok(await t.api('POST','/api/performer/line',{lineStatus:'offline'},worker.token));
  assert.equal(offline.line_status,'offline');
});

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
