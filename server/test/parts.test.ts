import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, ok, type T } from './helpers.ts';

// «Нужна запчасть», уровень исполнителя, точность подсказок, «рядом на линии».

let t: T;
let admin: { token: string; id: string };
let client: { token: string; id: string };
let master: { token: string; id: string };

before(async () => {
  t = await setup();
  admin = await t.login('+79990000001');
  client = await t.login('+79991112233');
  master = await t.login('+79992223344', 'master');
  ok(await t.api('PUT', '/api/performer/profile', { kind: 'master', name: 'Иван', specialties: ['electric'], taxStatus: 'self_employed', inn: '780000000001' }, master.token));
  ok(await t.api('POST', `/api/admin/performers/${master.id}/verify`, { decision: 'approved' }, admin.token));
  ok(await t.api('PUT', '/api/performer/extras', { waitRate: 90_000 }, master.token));
  ok(await t.api('POST', '/api/performer/line', { lineStatus: 'online' }, master.token));
});
after(() => t.close());

async function take(body: Record<string, unknown>) {
  const o = ok(await t.api('POST', '/api/orders', body, client.token)).order;
  ok(await t.api('POST', `/api/orders/${o.id}/offers`, {}, master.token));
  const l = ok(await t.api('GET', `/api/orders/${o.id}/offers`, undefined, client.token));
  ok(await t.api('POST', `/api/orders/${o.id}/offers/${l.offers[0].id}/choose`, {}, client.token));
  return o.id as string;
}

test('рядом на линии: открытые заявки по профилю', async () => {
  const o = ok(await t.api('POST', '/api/orders', { service: 'electric', zoneId: 'spb', description: 'Свет' }, client.token)).order;
  const n = ok(await t.api('GET', '/api/performer/nearby', undefined, master.token));
  assert.equal(n.openNearby, 1);
  ok(await t.api('POST', `/api/orders/${o.id}/cancel`, { reason: 'тест' }, client.token));
});

test('нужна запчасть: ожидание считается, вернулись к работе; не на месте — нельзя', async () => {
  const id = await take({ service: 'electric', zoneId: 'spb', description: 'Не крутит стартер' });
  assert.equal((await t.api('POST', `/api/orders/${id}/part`, { mode: 'wait' }, client.token)).status, 409);
  ok(await t.api('POST', `/api/orders/${id}/step`, { action: 'arrive' }, master.token));
  const w = ok(await t.api('POST', `/api/orders/${id}/part`, { mode: 'wait' }, client.token));
  assert.equal(w.partMode, 'wait');
  assert.ok(w.waitStartedAt);
  t.clock.advance(40 * 60);
  const r = await t.api('POST', `/api/orders/${id}/part`, { mode: 'resume' }, master.token);
  ok(r);
  const v = ok(await t.api('GET', `/api/orders/${id}`, undefined, client.token));
  assert.equal(v.waitStartedAt, null);
  assert.ok(v.waitMinutes >= 1);
  const chat = ok(await t.api('GET', `/api/orders/${id}/messages`, undefined, client.token));
  assert.ok(JSON.stringify(chat).includes('900 ₽/ч'), 'ставка ожидания — в чате');
  assert.deepEqual(chat.participants.map((p: any) => p.who).sort(), ['owner', 'performer'], 'кто в чате');
  assert.equal(chat.participants.find((p: any) => p.who === 'owner').you, true);
  ok(await t.api('POST', `/api/orders/${id}/amount`, { extras: [{ name: 'Расходники', amount: 200_000 }], result: 'solved' }, master.token));
  ok(await t.api('POST', `/api/orders/${id}/confirm`, {}, client.token));
});

test('уровень: первые заказы — Новичок; точность — пока меньше 20 случаев не считается', async () => {
  const s = ok(await t.api('GET', '/api/performer/standing', undefined, master.token));
  assert.equal(s.level, 'newbie');
  assert.equal(s.jobs, 1);
  assert.equal(s.toBest.jobs, 49);
  assert.equal(s.accuracy.counted, false);
  assert.equal((await t.api('GET', '/api/performer/standing', undefined, client.token)).status, 403);
});

test('админ: сводка и живые заявки', async () => {
  const live = ok(await t.api('POST', '/api/orders', { service: 'electric', zoneId: 'spb', description: 'Свет 3' }, client.token)).order;
  const s = ok(await t.api('GET', '/api/admin/summary', undefined, admin.token));
  assert.equal(typeof s.today.orders, 'number'); // окна «сегодня/месяц» — по часам сервера, в тестах часы подменены
  assert.equal(typeof s.money.platformMonth, 'number');
  assert.equal(typeof s.quality.completedMonth, 'number');
  assert.ok(s.today.mastersOnline >= 1);
  const l = ok(await t.api('GET', '/api/admin/live', undefined, admin.token));
  const row = l.find((x: any) => x.id === live.id);
  assert.ok(row && row.events.length >= 1, 'лента событий');
  assert.equal((await t.api('GET', '/api/admin/summary', undefined, client.token)).status, 403);
});

test('неверный id в адресе — 404, а не ошибка сервера; реквизиты — без входа', async () => {
  assert.equal((await t.api('GET', '/api/orders/не-uuid', undefined, client.token)).status, 404);
  assert.equal((await t.api('GET', '/api/mod/cases/undefined', undefined, admin.token)).status, 404);
  const l = ok(await t.api('GET', '/api/legal'));
  assert.equal(l.brand, 'TrakSOS');
  ok(await t.api('PUT', '/api/admin/settings/legal', { entity: 'ИП Тестов Т. Т.', inn: '780000000000' }, admin.token));
  assert.equal(ok(await t.api('GET', '/api/legal')).entity, 'ИП Тестов Т. Т.');
  ok(await t.api('PUT', '/api/admin/settings/legal', { brand: 'InvalidBrand' }, admin.token));
  assert.equal(ok(await t.api('GET', '/api/legal')).brand, 'TrakSOS');
});

test('мастера рядом до вызова: сколько на линии и кто ближе — без контактов', async () => {
  const n = ok(await t.api('GET', '/api/masters-nearby?service=electric&lat=59.93&lng=30.31', undefined, client.token));
  assert.ok(n.online >= 1);
  assert.equal(typeof n.match, 'number');
  for (const m of n.items) { assert.equal(m.phone, undefined); assert.equal(m.user_id, undefined); }
  assert.equal((await t.api('GET', '/api/masters-nearby?service=../x', undefined, client.token)).status, 400);
});

test('отзывы по заявке: вес моего, после моего — отзыв обо мне', async () => {
  const id = await take({ service: 'electric', zoneId: 'spb', description: 'Габариты слева' });
  ok(await t.api('POST', `/api/orders/${id}/step`, { action: 'arrive' }, master.token));
  ok(await t.api('POST', `/api/orders/${id}/amount`, { extras: [{ name: 'Расходники', amount: 100_000 }], result: 'solved' }, master.token));
  ok(await t.api('POST', `/api/orders/${id}/confirm`, {}, client.token));
  ok(await t.api('POST', `/api/orders/${id}/review`, { stars: 2, tags: ['Задержал оплату'] }, master.token));
  const before = ok(await t.api('GET', `/api/orders/${id}/reviews`, undefined, client.token));
  assert.equal(before.mine, null);
  assert.equal(before.aboutMe, null, 'отзыв о себе — только после своего');
  ok(await t.api('POST', `/api/orders/${id}/review`, { stars: 5 }, client.token));
  const after = ok(await t.api('GET', `/api/orders/${id}/reviews`, undefined, client.token));
  assert.equal(after.mine.stars, 5);
  assert.equal(after.aboutMe.stars, 2);
  const list = ok(await t.api('GET', '/api/orders', undefined, client.token));
  assert.ok('vehicle_id' in list[0] && 'consult_of' in list[0], 'в списке — машина и связь с консультацией');
});

test('сумма за работу: время с «на месте», начатый час — полный, по получасам — настройкой; мастер руками не меняет', async () => {
  const { billWork } = await import('../src/domain/pricing.ts');
  const b = (min: number, step = 60) => billWork({ hour: 400_000, step, workMinutes: min, waitMinutes: 0, waitRate: null, extras: [] });
  assert.equal(b(0).time, 400_000, 'первая минута — уже час');
  assert.equal(b(60).time, 400_000);
  assert.equal(b(61).time, 800_000);
  assert.equal(b(10, 30).time, 200_000, 'по получасам: первые полчаса — половина');
  assert.equal(b(31, 30).time, 400_000);
  const w = billWork({ hour: 400_000, step: 60, workMinutes: 90, waitMinutes: 40, waitRate: 90_000, extras: [{ name: 'Блок управления', amount: 2_000_000 }] });
  assert.equal(w.minutes, 50, 'ожидание запчасти вычитается из работы');
  assert.equal(w.time, 400_000);
  assert.equal(w.wait, 60_000);
  assert.equal(w.total, 400_000 + 60_000 + 2_000_000);
});

test('неоплата: мастер или клиент сообщают — поддержка и модератор; без причины — только «отказываюсь»', async () => {
  const id = await take({ service: 'electric', zoneId: 'spb', description: 'Нет зарядки' });
  ok(await t.api('POST', `/api/orders/${id}/step`, { action: 'arrive' }, master.token));
  ok(await t.api('POST', `/api/orders/${id}/amount`, { extras: [{ name: 'Генератор', amount: 1_500_000 }] }, master.token));
  // Не та роль и без причины — нельзя
  assert.equal((await t.api('POST', `/api/orders/${id}/nonpayment`, { kind: 'client_refuses', reason: 'не платит' }, client.token)).body.error, 'bad_kind');
  assert.equal((await t.api('POST', `/api/orders/${id}/nonpayment`, { kind: 'not_done' }, client.token)).body.error, 'need_reason');
  ok(await t.api('POST', `/api/orders/${id}/nonpayment`, { kind: 'not_done', reason: 'Генератор так и не заряжает' }, client.token));
  ok(await t.api('POST', `/api/orders/${id}/nonpayment`, { kind: 'client_refuses', reason: 'Клиент уехал не заплатив' }, master.token));
  const tickets = await t.db.query(`select topic from support_tickets where order_id=$1`, [id]);
  assert.equal(tickets.length, 2);
  assert.ok(tickets.every((x: any) => x.topic === 'Отказ от оплаты'));
  const cases = await t.db.query(`select target_id from mod_cases where order_id=$1 and kind='dispute' order by created_at`, [id]);
  assert.deepEqual(cases.map((c: any) => c.target_id), [master.id, client.id], 'жалоба — на того, о ком она');
  // Чужой — нет
  const stranger = await t.login('+79998887766');
  assert.equal((await t.api('POST', `/api/orders/${id}/nonpayment`, { kind: 'refuse' }, stranger.token)).status, 403);
});
