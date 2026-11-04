// Нагрузочная проверка «как в жизни»: 10 мастеров (двое — приоритетные), 2 эвакуаторщика, 15 клиентов
// по всему СПб и ЛО. Сотни случайных действий пачками одновременно: заявки, SOS, отклики, выборы
// (в том числе по устаревшему списку), отказы, уход с линии, отмены, статусы, суммы, споры.
// После каждой пачки проверяем правила — ни одно не должно нарушиться.
// Повторяемо: SEED фиксирует случайность (SIM_SEED, SIM_STEPS — переопределить).

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, ok, type T } from './helpers.ts';

const SEED = Number(process.env.SIM_SEED ?? 20261104);
const STEPS = Number(process.env.SIM_STEPS ?? 60);
const BATCH = 6;

function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}
const rand = rng(SEED);
const pick = <X,>(a: X[]) => a[Math.floor(rand() * a.length)];
const chance = (p: number) => rand() < p;

// Точки: центр, Купчино, Парнас, Тосно, Гатчина, Кириши
const PLACES = [
  { zone: 'spb', lat: 59.934, lng: 30.335 }, { zone: 'spb', lat: 59.83, lng: 30.38 }, { zone: 'spb', lat: 60.07, lng: 30.33 },
  { zone: 'tos', lat: 59.54, lng: 30.88 }, { zone: 'gat', lat: 59.565, lng: 30.128 }, { zone: 'kir', lat: 59.45, lng: 32.02 },
];
const BRANDS = ['Scania', 'DAF', 'Volvo', 'MAN', 'КАМАЗ'];
const ACTIVE = ['accepted', 'en_route', 'arrived', 'working', 'awaiting_confirmation'];

let t: T;
let admin: any;
const masters: any[] = [];
const tows: any[] = [];
const clients: any[] = [];
const stats: Record<string, number> = {};
const bump = (k: string) => (stats[k] = (stats[k] ?? 0) + 1);
const topInRecommended: Record<string, number> = {};

before(async () => {
  t = await setup();
  admin = await t.login('+79990000001');
  for (let i = 0; i < 10; i++) {
    const u = await t.login(`+7999100${String(i).padStart(4, '0')}`, 'master');
    const place = PLACES[i % PLACES.length];
    const brands: Record<string, string> = {};
    for (const b of BRANDS) brands[b] = pick(['excellent', 'good', 'good', 'last_resort', 'refuse']);
    ok(await t.api('PUT', '/api/performer/profile', {
      name: i < 2 ? ['Дима', 'Отец'][i] : `Мастер ${i}`, kind: 'master', specialties: pick([['electric'], ['electric', 'diag'], ['electric', 'air']]),
      brands, tier: 'eco', acceptsGroup: chance(0.7),
    }, u.token));
    // один не прошёл проверку — заявок получать не должен
    if (i !== 9) ok(await t.api('POST', `/api/admin/performers/${u.id}/verify`, { decision: 'approved' }, admin.token));
    if (i !== 9) ok(await t.api('POST', '/api/performer/line', { lineStatus: 'online' }, u.token));
    ok(await t.api('POST', '/api/performer/location', { lat: place.lat + (rand() - 0.5) * 0.05, lng: place.lng + (rand() - 0.5) * 0.05 }, u.token));
    await t.db.query('update users set rating=$2, rating_count=$3 where id=$1', [u.id, (3.5 + rand() * 1.5).toFixed(2), Math.floor(rand() * 40)]);
    masters.push({ ...u, i, brands, verified: i !== 9 });
  }
  for (const id of [masters[0].id, masters[1].id]) ok(await t.api('POST', `/api/admin/performers/${id}/priority`, { isPriority: true }, admin.token));
  for (let i = 0; i < 2; i++) {
    const u = await t.login(`+7999200${String(i).padStart(4, '0')}`, 'tow');
    ok(await t.api('PUT', '/api/performer/profile', { name: `Эвакуатор ${i}`, kind: 'tow', prepMinutes: pick([0, 15, 30]) }, u.token));
    ok(await t.api('POST', `/api/admin/performers/${u.id}/verify`, { decision: 'approved' }, admin.token));
    ok(await t.api('POST', '/api/performer/line', { lineStatus: 'online' }, u.token));
    const place = PLACES[i * 3];
    ok(await t.api('POST', '/api/performer/location', { lat: place.lat, lng: place.lng }, u.token));
    tows.push(u);
  }
  for (let i = 0; i < 15; i++) clients.push(await t.login(`+7999300${String(i).padStart(4, '0')}`));
});
after(() => t.close());

/** Ответ API: 2xx и 4xx — нормальная жизнь, 5xx — ошибка сервера */
async function call(method: string, path: string, body: unknown, token: string) {
  const r = await t.api(method, path, body, token);
  assert.ok(r.status < 500, `${method} ${path} → ${r.status} ${JSON.stringify(r.body)}`);
  const action = method + ' ' + path.split('?')[0].replace(/[0-9a-f-]{36}/g, ':id');
  bump(r.status < 300 ? `✓ ${action}` : `✗ ${r.status} ${r.body?.error}`);
  return r;
}

const performers = () => [...masters, ...tows];
const byId = (id: string) => [...performers(), ...clients].find((u) => u.id === id);

async function randomAction() {
  const roll = rand();
  const searching = await t.db.query(`select id, client_id, auction_until, service from orders where status='searching'`);
  const active = await t.db.query(`select id, client_id, performer_id, status from orders where status = any($1::text[])`, [ACTIVE]);

  if (roll < 0.2) {
    // Новая заявка
    const c = pick(clients);
    const place = pick(PLACES);
    const isTow = chance(0.15);
    await call('POST', '/api/orders', {
      service: isTow ? 'tow' : pick(['electric', 'electric', 'diag', 'air']), isSos: chance(0.3), zoneId: place.zone,
      lat: place.lat, lng: place.lng, brand: pick(BRANDS), groupTrip: chance(0.2),
      ...(isTow ? { destination: 'Шушары-Трак', cargo: 'tractor', loaded: 'empty', driverOnSite: true } : {}),
    }, c.token);
    bump('orders_created');
  } else if (roll < 0.32) {
    // Приоритетный отвечает на звонок
    const ring = await t.db.query(`select order_id, performer_id from order_dispatch where status='ringing'`);
    if (!ring.length) return;
    const r = pick(ring);
    const u = byId(r.performer_id);
    await call('POST', `/api/orders/${r.order_id}/${chance(0.5) ? 'accept' : 'decline'}`, {}, u.token);
  } else if (roll < 0.5) {
    // Отклик на торгах: обычная цена, своя, иногда ниже пола (должно отбиться)
    const bidding = await t.db.query(`select order_id, performer_id from order_dispatch where status='bidding'`);
    if (!bidding.length) return;
    const d = pick(bidding);
    const u = byId(d.performer_id);
    const o = await t.db.one(`select estimate from orders where id=$1`, [d.order_id]);
    const usual = o!.estimate.callOut;
    const price = pick([undefined, Math.round(usual * 0.9 / 5000) * 5000, Math.round(usual * 1.2 / 5000) * 5000, Math.round(usual * 0.5)]);
    await call('POST', `/api/orders/${d.order_id}/offers`, price ? { price } : {}, u.token);
  } else if (roll < 0.62) {
    // Клиент выбирает — иногда по устаревшему списку (берём отклик, снятый уже кем-то)
    if (!searching.length) return;
    const o = pick(searching);
    const c = byId(o.client_id);
    const list = (await call('GET', `/api/orders/${o.id}/offers?sort=${pick(['recommended', 'price', 'eta', 'distance'])}`, undefined, c.token)).body;
    const offers = list?.offers ?? [];
    if (offers.length) {
      const top = (await t.api('GET', `/api/orders/${o.id}/offers?sort=recommended`, undefined, c.token)).body.offers[0];
      if (top) topInRecommended[top.performer_id] = (topInRecommended[top.performer_id] ?? 0) + 1;
    }
    const stale = chance(0.2) ? (await t.db.one(`select id from bids where order_id=$1 order by random() limit 1`, [o.id])) : null;
    const choice = stale ?? (offers.length ? pick(offers) : null);
    if (choice) await call('POST', `/api/orders/${o.id}/offers/${choice.id}/choose`, {}, c.token);
  } else if (roll < 0.78) {
    // Исполнитель ведёт заявку дальше
    if (!active.length) return;
    const o = pick(active);
    const u = byId(o.performer_id);
    const next: Record<string, () => Promise<unknown>> = {
      accepted: () => call('POST', `/api/orders/${o.id}/step`, { action: chance(0.9) ? 'depart' : 'arrive' }, u.token),
      en_route: () => call('POST', `/api/orders/${o.id}/step`, { action: 'arrive' }, u.token),
      arrived: () => call('POST', `/api/orders/${o.id}/step`, { action: 'start_work' }, u.token),
      working: () => call('POST', `/api/orders/${o.id}/amount`, { workAmount: pick([0, 150_000, 210_000]), result: 'solved' }, u.token),
      awaiting_confirmation: async () => {
        const c = byId(o.client_id);
        if (chance(0.8)) await call('POST', `/api/orders/${o.id}/confirm`, {}, c.token);
        else await call('POST', `/api/orders/${o.id}/dispute`, { reason: 'Договаривались дешевле' }, c.token);
      },
    };
    if (o.status === 'accepted' && chance(0.08)) await call('POST', `/api/orders/${o.id}/drop`, { reason: 'Сломалась машина' }, u.token);
    else await next[o.status]();
  } else if (roll < 0.86) {
    // Кто-то уходит с линии или возвращается
    const u = pick(performers());
    await call('POST', '/api/performer/line', { lineStatus: chance(0.5) ? 'offline' : 'online' }, u.token);
  } else if (roll < 0.92) {
    // Клиент отменяет
    const pool = [...searching, ...active.filter((a: any) => a.status === 'accepted')];
    if (!pool.length) return;
    const o = pick(pool);
    await call('POST', `/api/orders/${o.id}/cancel`, { reason: 'Завелась сама' }, byId(o.client_id).token);
  } else {
    // «Никто не взял» — повторить поиск
    const none = await t.db.query(`select id, client_id from orders where status='no_performer'`);
    if (!none.length) return;
    const o = pick(none);
    await call('POST', `/api/orders/${o.id}/retry`, {}, byId(o.client_id).token);
  }
}

/** Правила, которые не должны нарушаться никогда */
async function checkInvariants(step: number) {
  const q = (sql: string, p: unknown[] = []) => t.db.query(sql, p);
  const at = `(шаг ${step}, seed ${SEED})`;

  // 1. У исполнителя не больше одной заявки в работе
  const dbl = await q(`select performer_id, count(*)::int c from orders where status = any($1::text[]) group by performer_id having count(*) > 1`, [ACTIVE]);
  assert.deepEqual(dbl, [], `исполнитель в двух заявках сразу ${at}`);

  // 2. У заявки в работе есть исполнитель, у ищущей — нет
  const orphan = await q(`select id, status from orders where status = any($1::text[]) and performer_id is null`, [ACTIVE]);
  assert.deepEqual(orphan, [], `заявка в работе без исполнителя ${at}`);
  assert.deepEqual(await q(`select id from orders where status='searching' and performer_id is not null`), [], `ищущая заявка с исполнителем ${at}`);

  // 3. Занятый исполнитель не висит ни в чьих звонках и торгах и не имеет действующих откликов
  const busyHanging = await q(
    `select d.order_id, d.performer_id, d.status from order_dispatch d join orders o on o.id=d.order_id
      where o.status='searching' and d.status in ('ringing','bidding','queued')
        and exists (select 1 from orders x where x.performer_id=d.performer_id and x.status = any($1::text[]))`, [ACTIVE]);
  assert.deepEqual(busyHanging, [], `занятый исполнитель висит в чужом поиске ${at}`);
  const busyBids = await q(
    `select b.id from bids b join orders o on o.id=b.order_id where b.status='active' and o.status='searching'
        and exists (select 1 from orders x where x.performer_id=b.performer_id and x.status = any($1::text[]))`, [ACTIVE]);
  assert.deepEqual(busyBids, [], `у занятого исполнителя действующий отклик ${at}`);

  // 4. Ушедший с линии или на паузе — без действующих откликов и звонков
  const offline = await q(
    `select b.id from bids b join performer_profiles p on p.user_id=b.performer_id join orders o on o.id=b.order_id
      where b.status='active' and o.status='searching' and (p.line_status='offline' or p.paused)`);
  assert.deepEqual(offline, [], `отклик того, кто ушёл с линии ${at}`);
  const offRing = await q(
    `select d.order_id from order_dispatch d join performer_profiles p on p.user_id=d.performer_id join orders o on o.id=d.order_id
      where d.status in ('ringing','bidding') and o.status='searching' and (p.line_status='offline' or p.paused)`);
  assert.deepEqual(offRing, [], `звонок тому, кто ушёл с линии ${at}`);

  // 5. Звонок приоритетным — только до начала торгов; приоритетные звонки получают только приоритетные
  assert.deepEqual(await q(`select d.order_id from order_dispatch d join orders o on o.id=d.order_id
      where d.status='ringing' and o.auction_until is not null and o.status='searching'`), [], `звонок после начала торгов ${at}`);
  assert.deepEqual(await q(`select d.order_id from order_dispatch d join performer_profiles p on p.user_id=d.performer_id
      where d.status in ('ringing','queued') and not p.is_priority`), [], `приоритетный звонок не приоритетному ${at}`);

  // 6. Подбор: эвакуатор — только эвакуаторщикам, ремонт — только мастерам нужной специальности; «не берусь» и непроверенные не приглашаются
  assert.deepEqual(await q(`select d.order_id from order_dispatch d join orders o on o.id=d.order_id join performer_profiles p on p.user_id=d.performer_id
      where (o.service='tow') <> (p.kind='tow')`), [], `не тот тип исполнителя ${at}`);
  assert.deepEqual(await q(`select d.order_id from order_dispatch d join orders o on o.id=d.order_id join performer_profiles p on p.user_id=d.performer_id
      where p.kind='master' and not (o.service = any(p.specialties))`), [], `мастер не той специальности ${at}`);
  assert.deepEqual(await q(`select d.order_id from order_dispatch d join orders o on o.id=d.order_id join performer_profiles p on p.user_id=d.performer_id
      where o.brand is not null and p.brands->>o.brand = 'refuse'`), [], `приглашён мастер с «не берусь» по марке ${at}`);
  assert.deepEqual(await q(`select d.order_id from order_dispatch d join performer_profiles p on p.user_id=d.performer_id where p.verification <> 'approved'`), [],
    `приглашён непроверенный ${at}`);

  // 7. Назначение через торги — ровно один выбранный отклик, цена выезда = цена отклика, в коридоре
  const chosen = await q(`select o.id, o.call_out_amount, o.estimate, count(b.*)::int n, max(b.price) price
      from orders o join bids b on b.order_id=o.id and b.status='chosen' group by o.id`);
  for (const r of chosen) {
    assert.equal(r.n, 1, `два выбранных отклика в заявке ${at}`);
    if (r.call_out_amount != null) assert.equal(r.call_out_amount, r.price, `цена выезда ≠ цене отклика ${at}`);
    const usual = r.estimate.callOut;
    assert.ok(r.price >= Math.round(usual * 0.85 / 5000) * 5000 && r.price <= Math.round(usual * 1.3 / 5000) * 5000, `отклик вне коридора ${at}`);
  }

  // 8. На выезде только те, у кого есть заявка в работе
  assert.deepEqual(await q(`select user_id from performer_profiles p where line_status='on_job'
      and not exists (select 1 from orders x where x.performer_id=p.user_id and x.status = any($1::text[]))`, [ACTIVE]), [], `«на выезде» без заявки ${at}`);

  // 9. Учёт денег по каждой заявке сходится в ноль
  assert.deepEqual(await q(`select order_id, sum(amount)::int s from ledger_entries where order_id is not null group by order_id having sum(amount) <> 0`), [],
    `проводки не сходятся ${at}`);

  // 10. SOS не висит после истечения торгов, если есть отклики
  assert.deepEqual(await q(`select o.id from orders o where o.status='searching' and o.auto_pick and o.auction_until < $1
      and exists (select 1 from bids b where b.order_id=o.id and b.status='active')`, [t.clock.now()]), [], `SOS с откликами не назначен вовремя ${at}`);

  // 11. Завершённая заявка — с подтверждённой суммой
  assert.deepEqual(await q(`select id from orders where status='completed' and amount_confirmed_at is null`), [], `завершена без подтверждения суммы ${at}`);
}

test(`нагрузка: ${STEPS} пачек по ${BATCH} одновременных действий — правила не нарушаются`, { timeout: 600_000 }, async () => {
  for (let step = 1; step <= STEPS; step++) {
    await Promise.all(Array.from({ length: BATCH }, () => randomAction()));
    // время идёт: от 5 секунд до 4 минут
    t.clock.advance(pick([5, 10, 20, 40, 95, 240]));
    await t.app.orders.tick();
    await t.app.auction.tick();
    await checkInvariants(step);
  }

  const outcome = await t.db.query(`select status, count(*)::int n from orders group by status order by n desc`);
  const top = Object.entries(topInRecommended).sort((a, b) => b[1] - a[1]);
  const totalTop = top.reduce((s, [, n]) => s + n, 0);
  console.log('\nИтог заявок:', Object.fromEntries(outcome.map((r: any) => [r.status, r.n])));
  console.log('Отбитые конфликты и ошибки ввода:', Object.fromEntries(Object.entries(stats).filter(([k]) => k.startsWith('✗'))));
  console.log('Успешные действия:', Object.fromEntries(Object.entries(stats).filter(([k]) => k.startsWith('✓'))));
  console.log('Кто первым в «Рекомендуем» (сколько раз):', Object.fromEntries(top.map(([id, n]) => [byId(id)?.i != null ? `мастер ${byId(id).i}` : 'эвакуатор', n])));

  // Справедливость: один и тот же человек не должен быть первым везде, где бы ни была заявка
  if (totalTop >= 20) {
    assert.ok(top[0][1] / totalTop < 0.6, `один исполнитель первый в ${Math.round((top[0][1] / totalTop) * 100)}% выдач — подбор не учитывает расстояние`);
  }
  assert.ok(outcome.some((r: any) => r.status === 'completed'), 'хотя бы одна заявка дошла до конца');
});
