import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, ok, type T } from './helpers.ts';
import { pointsBalance } from '../src/services/referral.ts';

// Реферальные баллы: ссылка, приветственные баллы, 10% от комиссии пригласившему, гашение до 20% сбора/комиссии, сгорание.

let t: T;
let admin: { token: string; id: string };
let inviter: { token: string; id: string };
let master: { token: string; id: string };

async function loginRef(phone: string, ref: string, role?: string) {
  const c = ok(await t.api('POST', '/api/auth/code', { phone }));
  const v = ok(await t.api('POST', '/api/auth/verify', { phone, code: c.devCode, ref, role }));
  t.clock.advance(61);
  return { token: v.token as string, id: v.user.id as string };
}

before(async () => {
  t = await setup();
  admin = await t.login('+79990000001');
  inviter = await t.login('+79991112233');
  master = await t.login('+79992223344', 'master');
  ok(await t.api('PUT', '/api/performer/profile', { kind: 'master', name: 'Иван', specialties: ['electric'], taxStatus: 'self_employed', inn: '780000000001' }, master.token));
  ok(await t.api('POST', `/api/admin/performers/${master.id}/verify`, { decision: 'approved' }, admin.token));
  ok(await t.api('POST', '/api/performer/line', { lineStatus: 'online' }, master.token));
});
after(() => t.close());

test('остаток: траты гасят старые начисления, сгоревшее не считается', () => {
  const d = (s: string) => new Date(s);
  const b = pointsBalance([
    { amount: 1000, expires_at: d('2026-03-01'), created_at: d('2026-01-01') },
    { amount: 500, expires_at: d('2026-12-01'), created_at: d('2026-02-01') },
    { amount: -800, expires_at: null, created_at: d('2026-02-10') },
  ], d('2026-04-01'));
  assert.equal(b.balance, 500, 'потратили 800 из первой тысячи, остаток 200 сгорел 1 марта');
});

test('пригласил клиента: ему подарок, мне 10% комиссии; баллами — не больше 20% сбора', async () => {
  const me = ok(await t.api('GET', '/api/me/referral', undefined, inviter.token));
  assert.match(me.code, /^[A-Z2-9]{6}$/);
  assert.equal(me.balance, 0);

  const friend = await loginRef('+79993334455', me.code);
  const f0 = ok(await t.api('GET', '/api/me/referral', undefined, friend.token));
  assert.equal(f0.balance, 30_000, 'подарок 300 баллов');
  // Повторный вход старым номером по чужой ссылке — ничего не меняет
  const again = await loginRef('+79991112233', f0.code);
  assert.equal(ok(await t.api('GET', '/api/me/referral', undefined, again.token)).balance, 0);

  // Заявка друга: работа час (1 500 ₽) + выезд
  const o = ok(await t.api('POST', '/api/orders', { service: 'electric', zoneId: 'spb', description: 'Свет' }, friend.token)).order;
  ok(await t.api('POST', `/api/orders/${o.id}/offers`, {}, master.token));
  const [f] = ok(await t.api('GET', `/api/orders/${o.id}/offers`, undefined, friend.token)).offers;
  ok(await t.api('POST', `/api/orders/${o.id}/offers/${f.id}/choose`, {}, friend.token));
  ok(await t.api('POST', `/api/orders/${o.id}/step`, { action: 'arrive' }, master.token));
  const pr = ok(await t.api('POST', `/api/orders/${o.id}/amount`, { result: 'solved' }, master.token));
  const fee = pr.money.clientFee;
  // Клиент видит, сколько баллов можно списать, и вписывает сам
  const view = ok(await t.api('GET', `/api/orders/${o.id}`, undefined, friend.token));
  assert.equal(view.points.max, Math.min(30_000, Math.floor(fee * 0.2)));
  const done = ok(await t.api('POST', `/api/orders/${o.id}/confirm`, { total: pr.money.total, points: 999_999 }, friend.token));
  const row = (await t.db.one<any>('select points_fee, work_amount from orders where id=$1', [o.id]))!;
  // The client welcome discount is capped by commission on WORK only, not
  // the full order amount (which also includes travel and other charges).
  const workCommission = Math.round(Number(row.work_amount) * 0.05);
  assert.equal(row.points_fee, Math.min(30_000, Math.floor(fee * 0.2), Math.floor(workCommission * 0.2)),
    'вписал больше — списали не больше 20% сбора и 20% комиссии за работу');
  assert.equal(done.money.discount, row.points_fee);

  const mine = ok(await t.api('GET', '/api/me/referral', undefined, inviter.token));
  assert.equal(mine.balance, Math.round(pr.money.amount * 5 / 100 * 10 / 100), '10% от комиссии по заявке друга');
  assert.equal(mine.invited.length, 1);
  assert.deepEqual(await t.db.query(`select order_id from ledger_entries where order_id is not null group by order_id having sum(amount) <> 0`), [], 'проводки сходятся');
});

test('мастер гасит баллами до 20% комиссии — по наличным уменьшается долг', async () => {
  await t.db.query(`insert into points_entries(user_id, amount, kind, note, expires_at) values ($1, 100_000, 'admin', 'тест', now() + interval '30 days')`, [master.id]);
  const c = await t.login('+79995550011');
  const o = ok(await t.api('POST', '/api/orders', { service: 'electric', zoneId: 'spb', description: 'Стартер' }, c.token)).order;
  ok(await t.api('POST', `/api/orders/${o.id}/offers`, {}, master.token));
  const [f] = ok(await t.api('GET', `/api/orders/${o.id}/offers`, undefined, c.token)).offers;
  ok(await t.api('POST', `/api/orders/${o.id}/offers/${f.id}/choose`, {}, c.token));
  ok(await t.api('POST', `/api/orders/${o.id}/step`, { action: 'arrive' }, master.token));
  const pr = ok(await t.api('POST', `/api/orders/${o.id}/amount`, { result: 'solved' }, master.token));
  const before = ok(await t.api('GET', '/api/performer/balance', undefined, master.token)).cash_debt;
  ok(await t.api('POST', `/api/orders/${o.id}/confirm`, { total: pr.money.total }, c.token));
  const after = ok(await t.api('GET', '/api/performer/balance', undefined, master.token)).cash_debt;
  const commission = Math.round(pr.money.amount * 5 / 100);
  const used = (await t.db.one<any>('select points_commission from orders where id=$1', [o.id]))!.points_commission;
  assert.equal(used, Math.floor(commission * 0.2));
  assert.equal(after - before, commission + pr.money.clientFee - used, 'долг меньше на погашенное баллами');
  assert.deepEqual(await t.db.query(`select order_id from ledger_entries where order_id is not null group by order_id having sum(amount) <> 0`), [], 'проводки сходятся');
});

test('баллы — по желанию: мастер выключил гашение комиссии — баллы целы', async () => {
  ok(await t.api('PUT', '/api/performer/extras', { pointsAuto: false }, master.token));
  const b0 = ok(await t.api('GET', '/api/me/referral', undefined, master.token)).balance;
  const c = await t.login('+79995550022');
  const o = ok(await t.api('POST', '/api/orders', { service: 'electric', zoneId: 'spb', description: 'Фары' }, c.token)).order;
  ok(await t.api('POST', `/api/orders/${o.id}/offers`, {}, master.token));
  const [f] = ok(await t.api('GET', `/api/orders/${o.id}/offers`, undefined, c.token)).offers;
  ok(await t.api('POST', `/api/orders/${o.id}/offers/${f.id}/choose`, {}, c.token));
  ok(await t.api('POST', `/api/orders/${o.id}/step`, { action: 'arrive' }, master.token));
  const pr = ok(await t.api('POST', `/api/orders/${o.id}/amount`, { result: 'solved' }, master.token));
  ok(await t.api('POST', `/api/orders/${o.id}/confirm`, { total: pr.money.total }, c.token));
  assert.equal(ok(await t.api('GET', '/api/me/referral', undefined, master.token)).balance, b0);
  ok(await t.api('PUT', '/api/performer/extras', { pointsAuto: true }, master.token));
});


test('замороженные и отменённые начисления нельзя потратить', () => {
  const d = new Date('2026-01-01');
  const rows = [
    { amount: 1000, expires_at: null, created_at: d, status: 'available' },
    { amount: 500, expires_at: null, created_at: d, status: 'held' },
    { amount: 700, expires_at: null, created_at: d, status: 'reversed' },
  ];
  assert.equal(pointsBalance(rows, new Date('2026-01-02')).balance, 1000);
});
