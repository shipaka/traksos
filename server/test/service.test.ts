import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, ok, type T } from './helpers.ts';

// Рембаза: карточка, проверка, запись клиента, ответ, статусы, «Машина готова → счёт», сверка, история машины.

let t: T;
let admin: { token: string; id: string };
let client: { token: string; id: string };
let base: { token: string; id: string };
let master: { token: string; id: string };
let vehicleId: string;
let centerId: string;
const today = () => new Date(t.clock.now().getTime() + 3 * 3600_000).toISOString().slice(0, 10);

before(async () => {
  t = await setup();
  admin = await t.login('+79990000001');
  client = await t.login('+79991112233');
  base = await t.login('+79995556677', 'service');
  master = await t.login('+79992223344', 'master');
  ok(await t.api('PUT', '/api/performer/profile', { kind: 'master', name: 'Иван', specialties: ['electric'], taxStatus: 'self_employed', inn: '780000000001' }, master.token));
  ok(await t.api('POST', `/api/admin/performers/${master.id}/verify`, { decision: 'approved' }, admin.token));
  ok(await t.api('POST', '/api/performer/line', { lineStatus: 'online' }, master.token));
  vehicleId = ok(await t.api('POST', '/api/vehicles', { brand: 'DAF', model: 'XF', year: 2016, plate: 'а482км178' }, client.token)).id;
});
after(() => t.close());

test('карточка сервиса: виден клиентам только после проверки', async () => {
  assert.equal((await t.api('PUT', '/api/base', { name: 'Ш' }, base.token)).status, 400);
  const c = ok(await t.api('PUT', '/api/base', {
    name: 'Шушары-Трак', address: 'Шушары, Московское ш., 50', lat: 59.8, lng: 30.38, brands: ['DAF', 'Scania'],
    staff: { electric: 'own', gearbox: 'invite', tires: 'none' }, conditions: ['parking', 'pit'], accepts: ['quick', 'long'],
  }, base.token));
  centerId = c.center.id;
  assert.equal(c.center.verification, 'pending');
  assert.equal(ok(await t.api('GET', '/api/services', undefined, client.token)).length, 0);
  ok(await t.api('POST', `/api/admin/services/${centerId}/verify`, { decision: 'approved' }, admin.token));
  const l = ok(await t.api('GET', '/api/services?lat=59.9&lng=30.3&brand=DAF', undefined, client.token));
  assert.equal(l.length, 1);
  assert.equal(l[0].knowsBrand, true);
  assert.ok(l[0].distanceKm > 5 && l[0].distanceKm < 20);
  assert.equal(ok(await t.api('GET', '/api/services?need=tires', undefined, client.token)).length, 0, 'шиномонтажа нет — не показываем');
  const closed = ok(await t.api('PUT', '/api/base', { closedDays: [today()] }, base.token));
  assert.equal(closed.center.closedToday, true);
  assert.equal((await t.api('POST', `/api/services/${centerId}/book`, { need: 'electric', day: today(), arrival: 'self' }, client.token)).status, 400, 'в закрытый день не записать');
  ok(await t.api('PUT', '/api/base', { closedDays: [] }, base.token));
});

test('запись → уточнить → готовы принять → ремонт → готова → счёт → сверка и отзыв → история машины', async () => {
  const b = ok(await t.api('POST', `/api/services/${centerId}/book`, { vehicleId, need: 'electric', day: today(), time: '14:00', arrival: 'self', comment: 'Не горит свет прицепа' }, client.token));
  assert.equal(b.status, 'new');
  assert.equal(b.vehicle.plate, 'А482КМ178');
  const cab = ok(await t.api('GET', '/api/base', undefined, base.token));
  assert.equal(cab.groups.requests.length, 1);
  assert.equal((await t.api('POST', `/api/base/bookings/${b.id}/respond`, { action: 'accept' }, client.token)).status, 403, 'клиент не отвечает за сервис');

  ok(await t.api('POST', `/api/base/bookings/${b.id}/respond`, { action: 'clarify', q: 'Нужно подробнее о поломке' }, base.token));
  const mine = ok(await t.api('GET', '/api/bookings', undefined, client.token));
  assert.equal(mine[0].clarifyQ, 'Нужно подробнее о поломке');
  assert.equal(ok(await t.api('POST', `/api/bookings/${b.id}/answer`, { text: 'Габариты слева, после мойки' }, client.token)).status, 'new');

  ok(await t.api('POST', `/api/base/bookings/${b.id}/respond`, { action: 'accept', time: '15:00' }, base.token));
  assert.equal((await t.api('POST', `/api/base/bookings/${b.id}/ready`, { works: ['Электрика'] }, base.token)).status, 409, 'готова — только после приезда');
  ok(await t.api('POST', `/api/base/bookings/${b.id}/status`, { status: 'arrived' }, base.token));
  ok(await t.api('POST', `/api/base/bookings/${b.id}/status`, { status: 'waiting_part' }, base.token));
  ok(await t.api('POST', `/api/base/bookings/${b.id}/note`, { text: 'Заказали разъём, будет в четверг' }, base.token));
  assert.equal(ok(await t.api('GET', `/api/bookings/${b.id}`, undefined, client.token)).notes.length, 0, 'заметки скрыты, пока сервис не откроет');
  ok(await t.api('POST', `/api/base/bookings/${b.id}/note`, { notesPublic: true }, base.token));
  const seen = ok(await t.api('GET', `/api/bookings/${b.id}`, undefined, client.token));
  assert.equal(seen.notes.length, 1);
  assert.equal(seen.statusName, 'Ждём запчасть');
  assert.equal(seen.commission, undefined, 'комиссию сервиса клиент не видит');
  assert.equal((await t.api('POST', `/api/bookings/${b.id}/cancel`, {}, client.token)).status, 409, 'машина в ремонте — отмена только через сервис');

  const card = ok(await t.api('GET', `/api/base/bookings/${b.id}/company`, undefined, base.token));
  assert.equal(card.park, 1);
  ok(await t.api('POST', `/api/base/bookings/${b.id}/ready`, { works: ['Электрика', 'Диагностика'] }, base.token));
  const inv = ok(await t.api('POST', `/api/base/bookings/${b.id}/invoice`, { amount: 1_200_000 }, base.token));
  assert.equal(inv.commission, 120_000);
  assert.equal(inv.payout, 1_080_000);
  assert.equal(inv.discount, 0, 'пришёл сам — без скидки');
  assert.equal(ok(await t.api('GET', `/api/bookings/${b.id}`, undefined, client.token)).toPay, 1_200_000);
  ok(await t.api('POST', `/api/bookings/${b.id}/confirm`, { agree: true, stars: 5, text: 'Быстро нашли место' }, client.token));

  const h = ok(await t.api('GET', `/api/vehicles/${vehicleId}/history`, undefined, client.token));
  const item = h.items.find((x: any) => x.kind === 'service');
  assert.equal(item.problem, 'Ремонт на рембазе');
  assert.match(item.performer_name, /Шушары-Трак/);
  assert.equal(item.status, 'completed');
  const c = ok(await t.api('GET', `/api/services/${centerId}`, undefined, client.token));
  assert.equal(c.rating, 5);
  assert.equal(c.reviews[0].text, 'Быстро нашли место');
});

test('по совету мастера: скидка клиенту из комиссии; «не согласен» — спор', async () => {
  const o = ok(await t.api('POST', '/api/orders', { service: 'electric', zoneId: 'spb', vehicleId, description: 'Стучит КПП' }, client.token)).order;
  ok(await t.api('POST', `/api/orders/${o.id}/offers`, {}, master.token));
  const l = ok(await t.api('GET', `/api/orders/${o.id}/offers`, undefined, client.token));
  ok(await t.api('POST', `/api/orders/${o.id}/offers/${l.offers[0].id}/choose`, {}, client.token));
  assert.equal((await t.api('POST', `/api/orders/${o.id}/recommend-service`, { centerId }, master.token)).status, 409);
  ok(await t.api('POST', `/api/orders/${o.id}/step`, { action: 'arrive' }, master.token));
  const v = ok(await t.api('POST', `/api/orders/${o.id}/recommend-service`, { centerId }, master.token));
  assert.equal(v.recommendedCenter.name, 'Шушары-Трак');

  const b = ok(await t.api('POST', `/api/services/${centerId}/book`, { vehicleId, need: 'gearbox', day: today(), arrival: 'tow', fromOrderId: o.id }, client.token));
  assert.equal(b.fromOrder, true);
  ok(await t.api('POST', `/api/base/bookings/${b.id}/respond`, { action: 'accept' }, base.token));
  ok(await t.api('POST', `/api/base/bookings/${b.id}/status`, { status: 'in_work' }, base.token));
  ok(await t.api('POST', `/api/base/bookings/${b.id}/ready`, { works: ['КПП'] }, base.token));
  const inv = ok(await t.api('POST', `/api/base/bookings/${b.id}/invoice`, { amount: 5_000_000 }, base.token));
  assert.equal(inv.discount, 250_000);
  assert.equal(inv.payout, 4_500_000, 'выручка сервиса не меняется');
  assert.equal(inv.toPay, 4_750_000);
  assert.equal((await t.api('POST', `/api/bookings/${b.id}/confirm`, { agree: false }, client.token)).status, 400);
  assert.equal(ok(await t.api('POST', `/api/bookings/${b.id}/confirm`, { agree: false, why: 'Синхронизатор не меняли' }, client.token)).status, 'disputed');
  const tickets = ok(await t.api('GET', '/api/admin/support', undefined, admin.token));
  assert.ok(JSON.stringify(tickets).includes('Синхронизатор не меняли'));
});
