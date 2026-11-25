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

test('расходы водителя ограничены текущим парком и не переполняют int32', async () => {
  // Existing SOS exception permits creating an order despite approval mode.
  const oldOrder = ok(await t.api('POST', '/api/orders', {
    service: 'consult', vehicleId, isSos: true, description: 'Тест старого автопарка',
  }, driver.token)).order;
  // Synthetic stored amounts only; no payment provider calls to create these amounts.
  await t.db.query(`update orders set status='completed', call_out_amount=1500000000,
    work_amount=1000000000, created_at=now() where id=$1`, [oldOrder.id]);
  const beforeMove = ok(await t.api('GET', '/api/fleet', undefined, owner.token));
  assert.equal(beforeMove.cars[0].driver.monthSpent, 2500000000);
  assert.equal(ok(await t.api('GET', '/api/fleet/rules', undefined, driver.token)).monthSpent, 2500000000);

  const nextOwner = await t.login('+79993334477');
  const nextVehicle = ok(await t.api('POST', '/api/vehicles', {
    brand: 'DAF', model: 'XF', plate: 'а483км178',
  }, nextOwner.token)).id;
  const nextQr = ok(await t.api('GET', '/api/fleet', undefined, nextOwner.token)).cars[0].qrCode;
  ok(await t.api('POST', `/api/fleet/vehicles/${vehicleId}/new-qr`, {}, owner.token));
  ok(await t.api('POST', `/api/qr/${nextQr}/join`, {}, driver.token));
  ok(await t.api('PUT', '/api/fleet', { mode: 'limit', perMonth: 100000 }, nextOwner.token));
  const nextFleet = ok(await t.api('GET', '/api/fleet', undefined, nextOwner.token));
  assert.equal(nextFleet.cars[0].driver.monthSpent, 0);
  assert.equal(ok(await t.api('GET', '/api/fleet/rules', undefined, driver.token)).monthSpent, 0);
  const nextOrder = ok(await t.api('POST', '/api/orders', { service: 'consult', vehicleId: nextVehicle }, driver.token)).order;
  assert.notEqual(nextOrder.status, 'awaiting_owner', 'старые расходы не расходуют лимит нового владельца');
  const stored = await t.db.one<{ client_id: string }>('select client_id from orders where id=$1', [oldOrder.id]);
  assert.equal(stored?.client_id, owner.id, 'история старого парка не переносится');
});

test('параллельные заявки резервируют лимит атомарно; повтор ключа и SOS сохраняются', async () => {
  const fleetOwner = await t.login('+79993334488');
  const fleetDriver = await t.login('+79993334499');
  const car = ok(await t.api('POST', '/api/vehicles', { brand: 'DAF', model: 'XF' }, fleetOwner.token)).id;
  const sticker = ok(await t.api('GET', '/api/fleet', undefined, fleetOwner.token)).cars[0].qrCode;
  ok(await t.api('POST', `/api/qr/${sticker}/join`, {}, fleetDriver.token));
  const amount = (await t.app.settings.all()).pricing.consult?.price ?? 70000;
  ok(await t.api('PUT', '/api/fleet', { mode: 'limit', perMonth: amount }, fleetOwner.token));

  // Keep the real HTTP/ACL/DB/create path, but freeze dispatch and payment
  // after commit: a no-performer outcome would legitimately release budget.
  const originalLaunch = t.app.orders.launch;
  t.app.orders.launch = async (actor, order) => ({
    order: await t.app.orders.view(actor, order.id), confirmationUrl: null,
  });
  const send = async (key: string, description: string, isSos = false) => {
    const res = await fetch(t.base + '/api/orders', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + fleetDriver.token, 'idempotency-key': key },
      body: JSON.stringify({ service: 'consult', vehicleId: car, description, isSos }),
    });
    return ok({ status: res.status, body: await res.json() }).order;
  };
  try {
    const [a, b, repeat] = await Promise.all([
      send('fleet-limit-a-20261125', 'A'),
      send('fleet-limit-b-20261125', 'B'),
      send('fleet-limit-a-20261125', 'A'),
    ]);
    assert.equal(a.id, repeat.id);
    assert.notEqual(a.id, b.id);
    assert.deepEqual([a.status, b.status].sort(), ['awaiting_owner', 'searching']);
    assert.equal(ok(await t.api('GET', '/api/fleet/rules', undefined, fleetDriver.token)).monthSpent, amount);
    const replay = await send('fleet-limit-a-20261125', 'A');
    assert.equal(replay.id, a.id);
    const sos = await send('fleet-limit-sos-20261125', 'SOS', true);
    assert.equal(sos.status, 'searching');
    const rows = await t.db.query('select status from orders where client_id=$1 and created_by=$2', [fleetOwner.id, fleetDriver.id]);
    assert.equal(rows.length, 3);
    assert.equal(rows.filter(r => r.status === 'awaiting_owner').length, 1);
    assert.equal(ok(await t.api('GET', '/api/fleet/rules', undefined, fleetDriver.token)).monthSpent, 2 * amount);
  } finally {
    t.app.orders.launch = originalLaunch;
  }
});
