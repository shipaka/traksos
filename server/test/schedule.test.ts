import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, ok, type T } from './helpers.ts';
import { slot } from '../src/domain/schedule.ts';

// Распорядок мастера: выходные, часы выездов, «на телефоне», перерыв; конец рабочего дня снимает с линии.

let t: T;
let admin: { token: string; id: string };
let client: { token: string; id: string };
let master: { token: string; id: string };
const days = { mon: true, tue: true, wed: true, thu: true, fri: true, sat: false, sun: false };

before(async () => {
  t = await setup(); // 2026-12-01, вторник, 12:00 МСК
  admin = await t.login('+79990000001');
  client = await t.login('+79991112233');
  master = await t.login('+79992223344', 'master');
  ok(await t.api('PUT', '/api/performer/profile', { kind: 'master', name: 'Иван', specialties: ['electric'], taxStatus: 'self_employed', inn: '780000000001' }, master.token));
  ok(await t.api('POST', `/api/admin/performers/${master.id}/verify`, { decision: 'approved' }, admin.token));
  ok(await t.api('POST', '/api/performer/line', { lineStatus: 'online' }, master.token));
});
after(() => t.close());

const invited = (orderId: string) => t.app.hub.log.some((l) => l.userId === master.id && l.event.orderId === orderId && ['auction', 'incoming_call'].includes(l.event.type));

test('слоты графика по московскому времени', () => {
  const s = { on: true, days, from: '09:00', to: '18:00', phoneTo: '20:00' };
  assert.equal(slot(s, new Date('2026-12-01T07:00:00Z')), 'work'); // вт 10:00
  assert.equal(slot(s, new Date('2026-12-01T15:30:00Z')), 'phone'); // вт 18:30
  assert.equal(slot(s, new Date('2026-12-01T18:00:00Z')), 'off'); // вт 21:00
  assert.equal(slot(s, new Date('2026-12-05T09:00:00Z')), 'off'); // суббота
  assert.equal(slot({ ...s, on: false }, new Date('2026-12-05T09:00:00Z')), 'work');
});

test('«на телефоне» — только консультации; вне графика заявки не приходят', async () => {
  // сейчас 12:00: выезды до 11:00, телефон до 13:00
  assert.equal((await t.api('PUT', '/api/performer/schedule', { on: true, days, from: '11:00', to: '09:00', phoneTo: '13:00' }, master.token)).body.error, 'bad_schedule');
  ok(await t.api('PUT', '/api/performer/schedule', { on: true, days, from: '09:00', to: '11:00', phoneTo: '13:00' }, master.token));
  const trip = ok(await t.api('POST', '/api/orders', { service: 'electric', zoneId: 'spb', description: 'Не горит свет прицепа' }, client.token));
  assert.equal(invited(trip.order.id), false, 'выезд в часы «на телефоне» не приходит');
  const call = ok(await t.api('POST', '/api/orders', { service: 'consult', brand: 'DAF' }, client.token));
  assert.equal(invited(call.order.id), true, 'консультация приходит');
  ok(await t.api('POST', `/api/orders/${trip.order.id}/cancel`, { reason: 'тест' }, client.token));
  ok(await t.api('POST', `/api/orders/${call.order.id}/cancel`, { reason: 'тест' }, client.token));
});

test('конец рабочего дня снимает с линии; ручной выход вне графика — до конца дня', async () => {
  t.clock.advance(3600 + 60); // 13:01 — график кончился
  await t.app.orders.tick();
  let me = ok(await t.api('GET', '/api/performer/profile', undefined, master.token));
  assert.equal(me.line_status, 'offline');
  // сам вышел на линию — звонки снова идут, график не снимает
  ok(await t.api('POST', '/api/performer/line', { lineStatus: 'online' }, master.token));
  await t.app.orders.tick();
  me = ok(await t.api('GET', '/api/performer/profile', undefined, master.token));
  assert.equal(me.line_status, 'online');
  const o = ok(await t.api('POST', '/api/orders', { service: 'electric', zoneId: 'spb', description: 'Не заводится, щёлкает' }, client.token));
  assert.equal(invited(o.order.id), true);
  ok(await t.api('POST', `/api/orders/${o.order.id}/cancel`, { reason: 'тест' }, client.token));
});

test('перерыв (обед): не звоним, по таймеру — снова «Свободен»', async () => {
  const until = new Date(t.clock.now().getTime() + 30 * 60_000).toISOString();
  ok(await t.api('POST', '/api/performer/line', { lineStatus: 'busy', busyUntil: until }, master.token));
  const o = ok(await t.api('POST', '/api/orders', { service: 'electric', zoneId: 'spb', description: 'Нет света в кабине' }, client.token));
  assert.equal(invited(o.order.id), false);
  ok(await t.api('POST', `/api/orders/${o.order.id}/cancel`, { reason: 'тест' }, client.token));
  t.clock.advance(31 * 60);
  await t.app.orders.tick();
  const me = ok(await t.api('GET', '/api/performer/profile', undefined, master.token));
  assert.equal(me.line_status, 'online');
});

test('отпуск: заявки не приходят; наценки и «с собой» видны клиенту в отклике', async () => {
  ok(await t.api('PUT', '/api/performer/schedule', { on: false, days, from: '09:00', to: '18:00', phoneTo: '20:00' }, master.token));
  ok(await t.api('PUT', '/api/performer/extras', { vacation: true }, master.token));
  const a = ok(await t.api('POST', '/api/orders', { service: 'electric', zoneId: 'spb', description: 'Не горит свет' }, client.token));
  assert.equal(invited(a.order.id), false, 'в отпуске не звоним');
  ok(await t.api('POST', `/api/orders/${a.order.id}/cancel`, { reason: 'тест' }, client.token));
  const p = ok(await t.api('PUT', '/api/performer/extras', { vacation: false, weekendPct: 20, waitRate: 90_000, stock: ['Розетка прицепа 15-конт.'], prepay: 'always' }, master.token));
  assert.equal(p.extras.weekendPct, 20);
  const b = ok(await t.api('POST', '/api/orders', { service: 'electric', zoneId: 'spb', description: 'Не горит свет' }, client.token));
  assert.equal(invited(b.order.id), true);
  ok(await t.api('POST', `/api/orders/${b.order.id}/offers`, {}, master.token));
  const l = ok(await t.api('GET', `/api/orders/${b.order.id}/offers`, undefined, client.token));
  assert.deepEqual(l.offers[0].extras.stock, ['Розетка прицепа 15-конт.']);
  assert.equal(l.offers[0].extras.prepay, 'always');
  assert.equal((await t.api('PUT', '/api/performer/extras', { takes: ['чушь'] }, master.token)).status, 400);
  ok(await t.api('POST', `/api/orders/${b.order.id}/cancel`, { reason: 'тест' }, client.token));
});
