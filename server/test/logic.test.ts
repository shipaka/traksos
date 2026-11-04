// Пересечения состояний: исполнитель не может быть в двух заявках сразу, занятый не висит в чужих торгах,
// из двух одновременных выборов проходит один, ушедший с линии исчезает из звонков и откликов.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, ok, type T } from './helpers.ts';

let t: T;
let admin: any, c1: any, c2: any, father: any, m1: any, m2: any;

before(async () => {
  t = await setup();
  admin = await t.login('+79990000001');
  c1 = await t.login('+79991110001');
  c2 = await t.login('+79991110002');
  father = await t.login('+79992220000', 'master');
  m1 = await t.login('+79993330001', 'master');
  m2 = await t.login('+79993330002', 'master');
  for (const [u, name] of [[father, 'Отец'], [m1, 'Сергей'], [m2, 'Олег']] as const) {
    ok(await t.api('PUT', '/api/performer/profile', { name, kind: 'master', specialties: ['electric'] }, u.token));
    ok(await t.api('POST', `/api/admin/performers/${u.id}/verify`, { decision: 'approved' }, admin.token));
    ok(await t.api('POST', '/api/performer/line', { lineStatus: 'online' }, u.token));
  }
  ok(await t.api('POST', `/api/admin/performers/${father.id}/priority`, { isPriority: true }, admin.token));
  ok(await t.api('PUT', '/api/admin/settings/dispatch', { priorityFirst: false }, admin.token));
});
after(() => t.close());

const order = async (c: any) => ok(await t.api('POST', '/api/orders', { service: 'electric', zoneId: 'spb' }, c.token)).order;
const offersOf = async (o: any, c: any) => ok(await t.api('GET', `/api/orders/${o.id}/offers`, undefined, c.token)).offers;
const events = (userId: string) => t.app.hub.log.filter((l) => l.userId === userId).map((l) => l.event);
const cleanup = async (...os: any[]) => { for (const [o, c] of os) await t.api('POST', `/api/orders/${o.id}/cancel`, { reason: 'Ошибся с заявкой' }, c.token); };

test('мастер откликнулся на две заявки — выбрали в одной, во второй его отклик исчезает', async () => {
  const a = await order(c1);
  const b = await order(c2);
  ok(await t.api('POST', `/api/orders/${a.id}/offers`, {}, m1.token));
  ok(await t.api('POST', `/api/orders/${b.id}/offers`, {}, m1.token));
  ok(await t.api('POST', `/api/orders/${b.id}/offers`, {}, m2.token));
  const idA = (await offersOf(a, c1))[0].id;
  const idB = (await offersOf(b, c2)).find((x: any) => x.performer_id === m1.id).id;

  ok(await t.api('POST', `/api/orders/${a.id}/offers/${idA}/choose`, {}, c1.token));
  // Во второй заявке у клиента остался только Олег
  const left = await offersOf(b, c2);
  assert.deepEqual(left.map((x: any) => x.performer_id), [m2.id]);
  // Даже если у клиента на экране старый список — выбрать занятого нельзя
  const r = await t.api('POST', `/api/orders/${b.id}/offers/${idB}/choose`, {}, c2.token);
  assert.equal(r.status, 409);
  // Клиенту второй заявки пришло событие обновить отклики, а мастеру — закрыть вызов
  assert.ok(events(c2.id).some((e) => e.orderId === b.id && e.offers));
  assert.ok(events(m1.id).some((e) => e.orderId === b.id && e.status === 'released'));
  // Занятый мастер не может откликнуться на новую заявку и не получает новых
  const c = await order(c2);
  assert.equal(events(m1.id).some((e) => e.type === 'auction' && e.orderId === c.id), false);
  assert.equal((await t.api('POST', `/api/orders/${c.id}/offers`, {}, m1.token)).status, 403);
  // Статус «Свободен» на выезде вручную не включить
  assert.equal((await t.api('POST', '/api/performer/line', { lineStatus: 'online' }, m1.token)).body.error, 'on_job');
  await cleanup([a, c1], [b, c2], [c, c2]);
  assert.equal(ok(await t.api('GET', '/api/performer/profile', undefined, m1.token)).line_status, 'online', 'после отмены — снова свободен');
});

test('два клиента выбирают одного мастера одновременно — пройдёт только один', async () => {
  const a = await order(c1);
  const b = await order(c2);
  ok(await t.api('POST', `/api/orders/${a.id}/offers`, {}, m2.token));
  ok(await t.api('POST', `/api/orders/${b.id}/offers`, {}, m2.token));
  const [ia] = await offersOf(a, c1);
  const [ib] = await offersOf(b, c2);
  const [r1, r2] = await Promise.all([
    t.api('POST', `/api/orders/${a.id}/offers/${ia.id}/choose`, {}, c1.token),
    t.api('POST', `/api/orders/${b.id}/offers/${ib.id}/choose`, {}, c2.token),
  ]);
  assert.deepEqual([r1.status, r2.status].sort(), [200, 409]);
  const active = await t.db.query(`select id from orders where performer_id=$1 and status='accepted'`, [m2.id]);
  assert.equal(active.length, 1, 'у мастера ровно одна заявка');
  await cleanup([a, c1], [b, c2]);
});

test('один клиент жмёт «Выбрать» дважды или на двух устройствах — заявка назначается один раз', async () => {
  const a = await order(c1);
  ok(await t.api('POST', `/api/orders/${a.id}/offers`, {}, m1.token));
  ok(await t.api('POST', `/api/orders/${a.id}/offers`, {}, m2.token));
  const [x, y] = await offersOf(a, c1);
  const [r1, r2] = await Promise.all([
    t.api('POST', `/api/orders/${a.id}/offers/${x.id}/choose`, {}, c1.token),
    t.api('POST', `/api/orders/${a.id}/offers/${y.id}/choose`, {}, c1.token),
  ]);
  assert.deepEqual([r1.status, r2.status].sort(), [200, 409]);
  const busy = await t.db.query(`select user_id from performer_profiles where line_status='on_job'`);
  assert.equal(busy.length, 1, 'на выезде только тот, кого выбрали');
  await cleanup([a, c1]);
});

test('мастер ушёл с линии — его отклики и вызовы пропадают у всех клиентов', async () => {
  const a = await order(c1);
  ok(await t.api('POST', `/api/orders/${a.id}/offers`, {}, m1.token));
  assert.equal((await offersOf(a, c1)).length, 1);
  ok(await t.api('POST', '/api/performer/line', { lineStatus: 'offline' }, m1.token));
  assert.equal((await offersOf(a, c1)).length, 0);
  assert.equal((await t.api('POST', `/api/orders/${a.id}/offers`, {}, m1.token)).status, 403, 'снова откликнуться с линии не выйдет');
  ok(await t.api('POST', '/api/performer/line', { lineStatus: 'online' }, m1.token));
  await cleanup([a, c1]);
});

test('приоритетный взял заявку — его звонок по другой заявке гаснет и она звонит дальше, торги не перезапускаются', async () => {
  ok(await t.api('PUT', '/api/admin/settings/dispatch', { priorityFirst: true }, admin.token));
  const a = await order(c1);
  const b = await order(c2);
  // Отцу звонят обе заявки
  const ringing = await t.db.query(`select order_id from order_dispatch where performer_id=$1 and status='ringing' order by order_id`, [father.id]);
  assert.equal(ringing.length, 2);
  ok(await t.api('POST', `/api/orders/${a.id}/accept`, {}, father.token));
  // Заявка b не ждёт 30 секунд — сразу ушла на торги
  const vb = ok(await t.api('GET', `/api/orders/${b.id}`, undefined, c2.token));
  assert.equal(vb.auction, true);
  const until = vb.auctionUntil;
  assert.ok(events(father.id).some((e) => e.orderId === b.id && e.status === 'released'));
  // Отказ, снятие с линии и т. п. больше не трогают таймер торгов
  t.clock.advance(5);
  ok(await t.api('POST', '/api/performer/line', { lineStatus: 'offline' }, m2.token));
  assert.equal(ok(await t.api('GET', `/api/orders/${b.id}`, undefined, c2.token)).auctionUntil, until);
  ok(await t.api('POST', '/api/performer/line', { lineStatus: 'online' }, m2.token));
  await cleanup([a, c1], [b, c2]);
});

test('отмена заявки закрывает вызов у всех, кому она звонила или кто откликнулся', async () => {
  ok(await t.api('PUT', '/api/admin/settings/dispatch', { priorityFirst: false }, admin.token));
  const a = await order(c1);
  ok(await t.api('POST', `/api/orders/${a.id}/offers`, {}, m1.token));
  await cleanup([a, c1]);
  for (const u of [m1, m2]) assert.ok(events(u.id).some((e) => e.orderId === a.id && e.status === 'cancelled'));
  assert.equal(ok(await t.api('GET', '/api/performer/auctions', undefined, m2.token)).some((x: any) => x.order_id === a.id), false);
});

test('справедливость: первым в «Рекомендуем» оказывается ближайший, а не один и тот же человек; «наш» на торгах без поблажек', async () => {
  ok(await t.api('PUT', '/api/admin/settings/dispatch', { priorityFirst: false }, admin.token));
  // Равные по рейтингу и опыту мастера в трёх местах; отец — тоже среди них, в Купчино
  const spots = { centre: { lat: 59.934, lng: 30.335 }, kupchino: { lat: 59.83, lng: 30.38 }, parnas: { lat: 60.07, lng: 30.33 } };
  await t.db.query(`update users set rating=4.7, rating_count=20 where id = any($1::uuid[])`, [[m1.id, m2.id, father.id]]);
  ok(await t.api('POST', '/api/performer/location', spots.centre, m1.token));
  ok(await t.api('POST', '/api/performer/location', spots.parnas, m2.token));
  ok(await t.api('POST', '/api/performer/location', spots.kupchino, father.token));
  const top: Record<string, string> = {};
  for (const [name, at] of Object.entries(spots)) {
    const o = ok(await t.api('POST', '/api/orders', { service: 'electric', zoneId: 'spb', ...at }, c1.token)).order;
    for (const u of [m1, m2, father]) ok(await t.api('POST', `/api/orders/${o.id}/offers`, {}, u.token));
    top[name] = (await offersOf(o, c1))[0].performer_id;
    await cleanup([o, c1]);
  }
  assert.deepEqual(top, { centre: m1.id, kupchino: father.id, parnas: m2.id }, 'в каждом месте первый — ближайший');

  // Отец далеко и с той же ценой — на торгах он не выше остальных только потому, что «наш»
  const o = ok(await t.api('POST', '/api/orders', { service: 'electric', zoneId: 'spb', ...spots.parnas }, c1.token)).order;
  for (const u of [m1, m2, father]) ok(await t.api('POST', `/api/orders/${o.id}/offers`, {}, u.token));
  const list = await offersOf(o, c1);
  assert.notEqual(list[0].performer_id, father.id);
  await cleanup([o, c1]);
});
