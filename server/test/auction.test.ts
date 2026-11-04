import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, ok, type T } from './helpers.ts';
import { sortOffers, offerLimits } from '../src/domain/offers.ts';
import { defaultSettings as S } from '../src/domain/defaults.ts';

test('«Рекомендуем»: дешёвый новичок не обгоняет проверенного мастера, «Дешевле» — наоборот', () => {
  const lim = offerLimits(150_000, 0.85, 1.3);
  assert.deepEqual(lim, { usual: 150_000, floor: 130_000, ceil: 195_000 });
  const rows = [
    { id: 'cheap-newbie', price: 130_000, eta_minutes: 25, rating: null, rating_count: 0, completed: 0, brand_level: 'good' as const, distance_km: 10 },
    { id: 'pro', price: 165_000, eta_minutes: 30, rating: 4.9, rating_count: 40, completed: 60, brand_level: 'excellent' as const, distance_km: 14 },
    { id: 'weak-cheap', price: 130_000, eta_minutes: 20, rating: 3.4, rating_count: 12, completed: 15, brand_level: 'good' as const, distance_km: 6 },
  ];
  const w = S.dispatch.weights;
  assert.deepEqual(sortOffers(rows, 'recommended', lim, w).map((r) => r.id), ['pro', 'cheap-newbie', 'weak-cheap']);
  assert.deepEqual(sortOffers(rows, 'price', lim, w).map((r) => r.id), ['cheap-newbie', 'weak-cheap', 'pro']);
  assert.deepEqual(sortOffers(rows, 'eta', lim, w).map((r) => r.id), ['weak-cheap', 'cheap-newbie', 'pro']);
});

let t: T;
let admin: any, client: any, father: any, m1: any, m2: any, tow: any;

before(async () => {
  t = await setup();
  admin = await t.login('+79990000001');
  client = await t.login('+79991110000');
  father = await t.login('+79992220000', 'master');
  m1 = await t.login('+79993330001', 'master');
  m2 = await t.login('+79993330002', 'master');
  tow = await t.login('+79994440000', 'tow');
  const mk = async (u: any, body: any, lat: number) => {
    ok(await t.api('PUT', '/api/performer/profile', { name: body.name, kind: body.kind ?? 'master', specialties: ['electric'], ...body }, u.token));
    ok(await t.api('POST', `/api/admin/performers/${u.id}/verify`, { decision: 'approved' }, admin.token));
    ok(await t.api('POST', '/api/performer/line', { lineStatus: 'online' }, u.token));
    ok(await t.api('POST', '/api/performer/location', { lat, lng: 30.3 }, u.token));
  };
  await mk(father, { name: 'Отец' }, 59.9);
  await mk(m1, { name: 'Сергей' }, 59.95);
  await mk(m2, { name: 'Олег' }, 60.0);
  await mk(tow, { name: 'Эвакуатор Пётр', kind: 'tow', prepMinutes: 15 }, 59.9);
  ok(await t.api('POST', `/api/admin/performers/${father.id}/priority`, { isPriority: true }, admin.token));
});
after(() => t.close());

const kinds = (userId: string, type: string) => t.app.hub.log.filter((l) => l.userId === userId && l.event.type === type).map((l) => l.event.orderId);

test('SOS: никто из приоритетных не взял → торги 90 секунд → лучший назначается сам', async () => {
  const o = ok(await t.api('POST', '/api/orders', { service: 'electric', isSos: true, zoneId: 'spb', lat: 59.9, lng: 30.3 }, client.token)).order;
  assert.deepEqual(kinds(father.id, 'incoming_call').at(-1), o.id);
  t.clock.advance(31);
  await t.app.orders.tick(); // отец пропустил — общие торги
  assert.deepEqual(kinds(m1.id, 'auction').at(-1), o.id);
  assert.deepEqual(kinds(m2.id, 'auction').at(-1), o.id);
  const v = ok(await t.api('GET', `/api/orders/${o.id}`, undefined, client.token));
  assert.equal(v.auction, true);
  assert.equal(v.autoPick, true);

  ok(await t.api('POST', `/api/orders/${o.id}/offers`, { price: 130_000 }, m2.token));
  ok(await t.api('POST', `/api/orders/${o.id}/offers`, {}, m1.token));
  const list = ok(await t.api('GET', `/api/orders/${o.id}/offers?sort=price`, undefined, client.token));
  assert.equal(list.offers.length, 2);
  assert.equal(list.offers[0].diffPct, -13);
  // Исполнитель видит только свой отклик
  assert.equal(ok(await t.api('GET', `/api/orders/${o.id}/offers`, undefined, m1.token)).offers.length, 1);

  t.clock.advance(60);
  assert.equal(await t.app.auction.tick(), 0, 'до 90 секунд ждём выбора клиента');
  t.clock.advance(31);
  assert.equal(await t.app.auction.tick(), 1);
  const after = ok(await t.api('GET', `/api/orders/${o.id}`, undefined, client.token));
  assert.equal(after.status, 'accepted');
  assert.ok([m1.id, m2.id].includes(after.performer.id));
  assert.ok(after.events.some((e: any) => e.type === 'offer_autopicked'));
  ok(await t.api('POST', `/api/orders/${o.id}/cancel`, { reason: 'Ошибся с заявкой' }, client.token));
});

test('обычная заявка: без откликов за 10 минут — «никто не взял»; с откликами ждём выбора', async () => {
  ok(await t.api('POST', '/api/performer/line', { lineStatus: 'online' }, father.token));
  const a = ok(await t.api('POST', '/api/orders', { service: 'electric', zoneId: 'spb' }, client.token)).order;
  ok(await t.api('POST', `/api/orders/${a.id}/decline`, {}, father.token));
  const b = ok(await t.api('POST', '/api/orders', { service: 'electric', zoneId: 'spb' }, client.token)).order;
  ok(await t.api('POST', `/api/orders/${b.id}/decline`, {}, father.token));
  ok(await t.api('POST', `/api/orders/${b.id}/offers`, {}, m1.token));
  t.clock.advance(11 * 60);
  await t.app.auction.tick();
  assert.equal(ok(await t.api('GET', `/api/orders/${a.id}`, undefined, client.token)).status, 'no_performer');
  assert.equal(ok(await t.api('GET', `/api/orders/${b.id}`, undefined, client.token)).status, 'searching');
  // Клиент выбирает позже — отклик ещё в силе
  const list = ok(await t.api('GET', `/api/orders/${b.id}/offers`, undefined, client.token));
  const chosen = ok(await t.api('POST', `/api/orders/${b.id}/offers/${list.offers[0].id}/choose`, {}, client.token));
  assert.equal(chosen.performer.id, m1.id);
  // Проигравших предупреждаем, второй раз выбрать нельзя
  assert.equal((await t.api('POST', `/api/orders/${b.id}/offers/${list.offers[0].id}/choose`, {}, client.token)).status, 409);
  ok(await t.api('POST', `/api/orders/${b.id}/cancel`, { reason: 'Ошибся с заявкой' }, client.token));
});

test('переключатель «Сначала нам» выключен — заявка сразу на торги, вместе со всеми', async () => {
  ok(await t.api('PUT', '/api/admin/settings/dispatch', { priorityFirst: false }, admin.token));
  ok(await t.api('POST', '/api/performer/line', { lineStatus: 'online' }, father.token));
  const before = kinds(father.id, 'incoming_call').length;
  const o = ok(await t.api('POST', '/api/orders', { service: 'electric', zoneId: 'spb' }, client.token)).order;
  assert.equal(kinds(father.id, 'incoming_call').length, before, 'отдельного звонка «нам» нет');
  assert.deepEqual(kinds(father.id, 'auction').at(-1), o.id, 'но откликнуться можно наравне со всеми');
  assert.deepEqual(kinds(m1.id, 'auction').at(-1), o.id);
  ok(await t.api('POST', `/api/orders/${o.id}/cancel`, { reason: 'Ошибся с заявкой' }, client.token));
  ok(await t.api('PUT', '/api/admin/settings/dispatch', { priorityFirst: true }, admin.token));
});

test('эвакуатор: торги с подачей «сборы + дорога», куда везти и что везём', async () => {
  const o = ok(await t.api('POST', '/api/orders', {
    service: 'tow', zoneId: 'kad30', address: 'КАД, 72-й км', destination: 'Шушары-Трак', cargo: 'coupling', loaded: 'loaded', driverOnSite: true,
  }, client.token)).order;
  assert.equal(o.destination, 'Шушары-Трак');
  assert.deepEqual(kinds(tow.id, 'auction').at(-1), o.id);
  assert.equal(kinds(m1.id, 'auction').includes(o.id), false, 'мастерам эвакуатор не приходит');
  const f = ok(await t.api('POST', `/api/orders/${o.id}/offers`, {}, tow.token));
  assert.ok(f.eta_minutes >= 15, 'подача включает 15 минут на сборы');
  assert.equal(f.hour_price, null);
  const list = ok(await t.api('GET', `/api/orders/${o.id}/offers`, undefined, client.token));
  const v = ok(await t.api('POST', `/api/orders/${o.id}/offers/${list.offers[0].id}/choose`, {}, client.token));
  assert.equal(v.money.callOut, o.estimate.callOut);
});
