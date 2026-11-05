import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, ok, type T } from './helpers.ts';

// Мой парк: лимиты водителя, подтверждение владельцем, права, вход по QR-наклейке.

let t: T;
let owner: { token: string; id: string };
let driver: { token: string; id: string };
let vehicleId: string;
let qr: string;

before(async () => {
  t = await setup();
  owner = await t.login('+79991112233');
  vehicleId = ok(await t.api('POST', '/api/vehicles', { brand: 'DAF', model: 'XF', plate: 'а482км178' }, owner.token)).id;
  qr = ok(await t.api('GET', '/api/fleet', undefined, owner.token)).cars[0].qrCode;
});
after(() => t.close());

test('водитель входит по QR-наклейке; прежний теряет доступ; своя машина владельца — нельзя', async () => {
  const info = ok(await t.api('GET', `/api/qr/${qr}`));
  assert.equal(info.brand, 'DAF');
  assert.ok(!info.plate.includes('482'), 'госномер на публичной странице скрыт');
  assert.equal((await t.api('POST', `/api/qr/${qr}/join`, {}, owner.token)).status, 400);
  driver = await t.login('+79993334455');
  ok(await t.api('POST', `/api/qr/${qr}/join`, {}, driver.token));
  const f = ok(await t.api('GET', '/api/fleet', undefined, owner.token));
  assert.equal(f.cars[0].driver.id, driver.id);
  assert.match(f.cars[0].driver.phone, /\*\*\*/);
  const other = await t.login('+79993334466');
  ok(await t.api('POST', `/api/qr/${qr}/join`, {}, other.token));
  assert.equal(ok(await t.api('GET', '/api/vehicles', undefined, driver.token)).length, 0, 'прежний водитель машину больше не видит');
  ok(await t.api('POST', `/api/qr/${qr}/join`, {}, driver.token));
  const fresh = ok(await t.api('POST', `/api/fleet/vehicles/${vehicleId}/new-qr`, {}, owner.token));
  assert.notEqual(fresh.cars[0].qrCode, qr);
  assert.equal(fresh.cars[0].driver, null, 'новая наклейка — водителя снимаем');
  assert.equal((await t.api('GET', `/api/qr/${qr}`)).status, 404, 'старая наклейка не действует');
  qr = fresh.cars[0].qrCode;
  ok(await t.api('POST', `/api/qr/${qr}/join`, {}, driver.token));
});

test('лимит на заказ: дороже — ждёт владельца; подтвердил — ищем; отказал — отменено; SOS — всегда', async () => {
  ok(await t.api('PUT', '/api/fleet', { mode: 'limit', perOrder: 100_000 }, owner.token));
  const r = ok(await t.api('GET', '/api/fleet/rules', undefined, driver.token));
  assert.equal(r.perOrder, 100_000);
  const a = ok(await t.api('POST', '/api/orders', { service: 'electric', zoneId: 'spb', vehicleId, description: 'Не горит свет' }, driver.token)).order;
  assert.equal(a.status, 'awaiting_owner');
  const f = ok(await t.api('GET', '/api/fleet', undefined, owner.token));
  assert.equal(f.pending.length, 1);
  assert.equal((await t.api('POST', `/api/orders/${a.id}/owner-decision`, { approve: true }, driver.token)).status, 404, 'водитель сам себе не подтверждает');
  assert.notEqual(ok(await t.api('POST', `/api/orders/${a.id}/owner-decision`, { approve: true }, owner.token)).status, 'awaiting_owner');
  ok(await t.api('POST', `/api/orders/${a.id}/cancel`, { reason: 'тест' }, driver.token));

  const b = ok(await t.api('POST', '/api/orders', { service: 'electric', zoneId: 'spb', vehicleId, description: 'Опять свет' }, driver.token)).order;
  const no = ok(await t.api('POST', `/api/orders/${b.id}/owner-decision`, { approve: false, reason: 'Дотяни до базы' }, owner.token));
  assert.equal(no.status, 'cancelled');
  assert.equal(no.cancelReason, 'Дотяни до базы');

  const sos = ok(await t.api('POST', '/api/orders', { service: 'electric', zoneId: 'spb', vehicleId, isSos: true, description: 'Встал на КАД' }, driver.token)).order;
  assert.notEqual(sos.status, 'awaiting_owner', 'SOS — без подтверждения');
  ok(await t.api('POST', `/api/orders/${sos.id}/cancel`, { reason: 'тест' }, driver.token));

  const c = ok(await t.api('POST', '/api/orders', { service: 'consult', vehicleId }, driver.token)).order;
  assert.notEqual(c.status, 'awaiting_owner', 'консультация дешевле лимита — сразу');
  ok(await t.api('POST', `/api/orders/${c.id}/cancel`, { reason: 'тест' }, driver.token));
});

test('«всё через меня» и запреты: эвакуатор и запись в сервис', async () => {
  ok(await t.api('PUT', '/api/fleet', { mode: 'approve', allow: { tow: false, service: false } }, owner.token));
  const c = ok(await t.api('POST', '/api/orders', { service: 'consult', vehicleId }, driver.token)).order;
  assert.equal(c.status, 'awaiting_owner');
  ok(await t.api('POST', `/api/orders/${c.id}/cancel`, { reason: 'тест' }, driver.token));
  assert.equal((await t.api('POST', '/api/orders', { service: 'tow', zoneId: 'spb', vehicleId, cargo: 'tractor' }, driver.token)).status, 403);
  const sosTow = ok(await t.api('POST', '/api/orders', { service: 'tow', zoneId: 'spb', vehicleId, cargo: 'tractor', isSos: true }, driver.token)).order;
  assert.notEqual(sosTow.status, 'awaiting_owner', 'SOS водителю доступен всегда');
  ok(await t.api('POST', `/api/orders/${sosTow.id}/cancel`, { reason: 'тест' }, driver.token));
  const fs = ok(await t.api('GET', '/api/fleet', undefined, owner.token));
  assert.equal(fs.settings.allow.tow, false);
  assert.equal(fs.settings.allow.repair, true);
  assert.equal((await t.api('GET', '/api/fleet', undefined, driver.token)).status, 400, 'парк видит только владелец');
});
