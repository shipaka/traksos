import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, ok, type T } from './helpers.ts';

// Мастер на заявке: опоздание, отметки, проверка подсказки, карточка клиента, уточнение машины, «не брать клиента».

let t: T;
let admin: { token: string; id: string };
let client: { token: string; id: string };
let master: { token: string; id: string };
let vehicleId: string;

before(async () => {
  t = await setup();
  admin = await t.login('+79990000001');
  client = await t.login('+79991112233');
  master = await t.login('+79992223344', 'master');
  ok(await t.api('PUT', '/api/performer/profile', { kind: 'master', name: 'Иван', specialties: ['electric'], taxStatus: 'self_employed', inn: '780000000001' }, master.token));
  ok(await t.api('POST', `/api/admin/performers/${master.id}/verify`, { decision: 'approved' }, admin.token));
  ok(await t.api('POST', '/api/performer/line', { lineStatus: 'online' }, master.token));
  vehicleId = ok(await t.api('POST', '/api/vehicles', { brand: 'DAF', model: 'XF', plate: 'а482км178' }, client.token)).id;
});
after(() => t.close());

async function take(body: Record<string, unknown>) {
  const o = ok(await t.api('POST', '/api/orders', body, client.token)).order;
  ok(await t.api('POST', `/api/orders/${o.id}/offers`, {}, master.token));
  const l = ok(await t.api('GET', `/api/orders/${o.id}/offers`, undefined, client.token));
  ok(await t.api('POST', `/api/orders/${o.id}/offers/${l.offers[0].id}/choose`, {}, client.token));
  return o.id as string;
}

test('опаздываю, отметки на месте, проверка подсказки, карточка клиента', async () => {
  const c = await take({ service: 'consult', vehicleId });
  ok(await t.api('POST', `/api/orders/${c}/consult-finish`, { hints: ['Масса'], confidence: 'likely' }, master.token));
  ok(await t.api('POST', `/api/orders/${c}/confirm`, { total: 70_000 }, client.token));
  const id = await take({ service: 'electric', zoneId: 'spb', vehicleId, fromConsult: c, description: 'Не заводится' });
  const late = ok(await t.api('POST', `/api/orders/${id}/late`, { minutes: 30 }, master.token));
  assert.equal(late.lateMinutes, 30);
  assert.equal((await t.api('POST', `/api/orders/${id}/site-flags`, { flags: ['waited'] }, master.token)).status, 409, 'отметки — после приезда');
  ok(await t.api('POST', `/api/orders/${id}/step`, { action: 'arrive' }, master.token));
  const f = ok(await t.api('POST', `/api/orders/${id}/site-flags`, { flags: ['waited', 'gate', 'чушь'] }, master.token));
  assert.deepEqual(f.siteFlags, ['waited', 'gate']);
  assert.equal(ok(await t.api('POST', `/api/orders/${id}/hint-check`, { result: 'yes' }, master.token)).hintCheck, 'yes');
  const card = ok(await t.api('GET', `/api/orders/${id}/client-card`, undefined, master.token));
  assert.equal(card.vehicle.brand, 'DAF');
  assert.ok(card.marks.some((m: any) => m.label === 'Ждал клиента'));
  assert.equal(card.history.length, 1, 'в истории машины — прошлая консультация');
  const fixed = ok(await t.api('POST', `/api/orders/${id}/vehicle`, { model: 'XF 105', year: 2016, axles: 2 }, master.token));
  assert.equal(fixed.vehicle.year, 2016);
  assert.equal(fixed.vehicle.fixed_by_name, 'Иван');
  // чужой мастер карточку не видит
  const other = await t.login('+79993334455', 'master');
  assert.equal((await t.api('GET', `/api/orders/${id}/client-card`, undefined, other.token)).status, 403);
  ok(await t.api('POST', `/api/orders/${id}/amount`, { extras: [{ name: 'Расходники', amount: 100_000 }], result: 'solved' }, master.token));
  ok(await t.api('POST', `/api/orders/${id}/confirm`, {}, client.token));
});

test('кандидат не получает ИНН, госномер и историю ремонта до выбора клиентом', async () => {
  const order = ok(await t.api('POST', '/api/orders', {
    service: 'electric', zoneId: 'spb', vehicleId, description: 'Проверить электрику',
  }, client.token)).order;
  ok(await t.api('POST', `/api/orders/${order.id}/offers`, {}, master.token));
  assert.equal((await t.api('GET', `/api/orders/${order.id}/client-card`, undefined, master.token)).status, 403);
  const preview = ok(await t.api('GET', `/api/orders/${order.id}`, undefined, master.token));
  assert.equal(preview.you, 'candidate');
  assert.equal(preview.vehicle, null);
  assert.equal(preview.site, null);
  assert.equal(preview.bill, null);
  assert.deepEqual(preview.followUps, []);
  assert.equal(preview.consultFrom, null);
});

test('«не брать заявки этого клиента»: заявки клиента больше не приходят', async () => {
  const last = ok(await t.api('GET', '/api/orders?as=performer', undefined, master.token))[0];
  ok(await t.api('POST', `/api/orders/${last.id}/block-client`, { on: true, reason: 'не оплатил ожидание' }, master.token));
  assert.equal(ok(await t.api('GET', '/api/performer/blacklist', undefined, master.token)).length, 1);
  const o = ok(await t.api('POST', '/api/orders', { service: 'electric', zoneId: 'spb', description: 'Нет света' }, client.token)).order;
  assert.equal(t.app.hub.log.some((l) => l.userId === master.id && l.event.orderId === o.id && ['auction', 'incoming_call'].includes(l.event.type)), false);
  ok(await t.api('DELETE', `/api/performer/blacklist/${client.id}`, undefined, master.token));
  assert.equal(ok(await t.api('GET', '/api/performer/blacklist', undefined, master.token)).length, 0);
});

