import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, ok, type T } from './helpers.ts';

// Персональные данные: выгрузка, запрос на удаление, обезличивание через 30 дней.

let t: T;
let u: { token: string; id: string };

before(async () => {
  t = await setup();
  u = await t.login('+79991112233');
  ok(await t.api('POST', '/api/vehicles', { brand: 'DAF', model: 'XF', plate: 'а482км178' }, u.token));
});
after(() => t.close());

test('выгрузка «всё о себе»', async () => {
  const e = ok(await t.api('GET', '/api/me/export', undefined, u.token));
  assert.equal(e.account.phone, '+79991112233');
  assert.equal(e.vehicles.length, 1);
  assert.ok(Array.isArray(e.sessions) && e.sessions.length >= 1);
});

test('удаление: не при открытой заявке; отмена запроса; через 30 дней — обезличен, вход закрыт', async () => {
  const o = ok(await t.api('POST', '/api/orders', { service: 'consult' }, u.token)).order;
  if (!['no_performer', 'cancelled'].includes(o.status)) {
    assert.equal((await t.api('POST', '/api/me/delete', {}, u.token)).status, 409);
    ok(await t.api('POST', `/api/orders/${o.id}/cancel`, { reason: 'тест' }, u.token));
  }
  const s = ok(await t.api('POST', '/api/me/delete', {}, u.token));
  assert.ok(s.deleteAt);
  assert.equal(ok(await t.api('DELETE', '/api/me/delete', undefined, u.token)).deleteRequestedAt, null);
  ok(await t.api('POST', '/api/me/delete', {}, u.token));
  t.clock.advance(29 * 86400);
  assert.equal(await t.app.privacy.processDeletions(), 0, 'срок ещё не вышел');
  t.clock.advance(2 * 86400);
  assert.equal(await t.app.privacy.processDeletions(), 1);
  assert.equal((await t.api('GET', '/api/me', undefined, u.token)).status, 401, 'сессии удалены');
  const row = await t.db.one<any>('select phone, name, status from users where id=$1', [u.id]);
  assert.match(row.phone, /^deleted-/);
  assert.equal(row.status, 'blocked');
  const again = await t.login('+79991112233');
  assert.notEqual(again.id, u.id, 'тот же номер — уже новый аккаунт');
});
