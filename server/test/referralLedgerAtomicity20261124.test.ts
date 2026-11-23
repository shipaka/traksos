import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, ok, type T } from './helpers.ts';
import { ReferralService, pointsBalance } from '../src/services/referral.ts';

// Genuine PostgreSQL and HTTP regression; setup() destroys ONLY the dedicated
// test schema. No production accounts, money provider or SMS are involved.
let t: T;
let referral: ReferralService;

before(async () => {
  t = await setup();
  referral = new ReferralService(t.db, t.app.settings, t.app.notifier, t.clock.now);
});
after(async () => { if (t) await t.close(); });

const earned = async (userId: string, kind: string) => {
  const rows = await t.db.query<{ amount: number }>(
    'select amount from points_entries where user_id=$1 and kind=$2', [userId, kind]);
  return rows.reduce((sum, row) => sum + Number(row.amount), 0);
};
const count = async (sql: string, params: unknown[]) =>
  Number((await t.db.one<{ n: number }>(sql, params))?.n ?? 0);

test('concurrent first registration attaches once and saves exactly one welcome award', async () => {
  const inviter = await t.login('+79993220001');
  const newcomer = await t.login('+79993220002');
  const code = await referral.code(inviter.id);
  const identity = { id: newcomer.id, roles: ['client'], inserted: true } as any;
  const answers = await Promise.all(Array.from({ length: 5 }, () =>
    referral.attach(identity, code)));
  assert.deepEqual(answers.filter(Boolean), [true]);
  assert.equal((await t.db.one<{ referred_by: string }>(
    'select referred_by from users where id=$1', [newcomer.id]))?.referred_by, inviter.id);
  assert.equal(await count(
    "select count(*)::int as n from points_entries where user_id=$1 and kind='welcome'",
    [newcomer.id]), 1);
  const gift = await earned(newcomer.id, 'welcome');
  assert.ok(gift > 0);
  assert.equal((await referral.balance(newcomer.id)).balance, gift);
  // Same registration event and a replay cannot manufacture additional points.
  assert.equal(await referral.attach(identity, code), false);
  assert.equal(await earned(newcomer.id, 'welcome'), gift);
});

test('six simultaneous expenses cannot spend more than one shared FIFO balance', async () => {
  const owner = await t.login('+79993220003');
  await referral.grant(t.db, { userId: owner.id, amount: 10_000,
    kind: 'admin', note: 'Тестовый баланс в одноразовой БД' });
  const spends = await Promise.all(Array.from({ length: 6 }, (_, index) =>
    t.db.tx(q => referral.spend(q, owner.id, 40_000, 'Конкурентный тест ' + index,
      null, null, 10_000))));
  assert.equal(spends.reduce((a, b) => a + b, 0), 10_000);
  assert.equal((await referral.balance(owner.id)).balance, 0);
  assert.equal(await earned(owner.id, 'spend'), -10_000);
});

test('idempotent client referral reward and performer milestone withstand parallel retries', async () => {
  const inviter = await t.login('+79993220004');
  const invitee = await t.login('+79993220005');
  const customer = await t.login('+79993220006');
  const o = ok(await t.api('POST', '/api/orders', {
    service: 'electric', zoneId: 'spb', description: 'Проверка защиты от двойных бонусов',
  }, customer.token)).order;
  const add = () => t.db.tx(q => referral.grant(q, {
    userId: inviter.id, amount: 900, kind: 'ref_client', orderId: o.id,
    refUserId: invitee.id, note: 'Тест реферала клиента',
  }));
  const first = await Promise.all(Array.from({ length: 5 }, add));
  assert.equal(first.reduce((a, b) => a + b, 0), 900);
  assert.equal(await count(
    "select count(*)::int as n from points_entries where order_id=$1 and kind='ref_client'",
    [o.id]), 1);

  const performer = () => t.db.tx(q => referral.grant(q, {
    userId: inviter.id, amount: 2_000, kind: 'ref_performer',
    refUserId: invitee.id, note: 'Однократное вознаграждение',
  }));
  const awards = await Promise.all(Array.from({ length: 5 }, performer));
  assert.equal(awards.reduce((a, b) => a + b, 0), 2_000);
  assert.equal(await count(
    "select count(*)::int as n from points_entries where ref_user_id=$1 and kind='ref_performer'",
    [invitee.id]), 1);
  assert.equal(await count(
    "select count(*)::int as n from notifications where user_id=$1 and kind='points'",
    [inviter.id]), 2, 'no second inbox notification on a duplicate credit');
});

test('replayed client settlement does not increment discount or deduct twice', async () => {
  const customer = await t.login('+79993220007');
  const o = ok(await t.api('POST', '/api/orders', {
    service: 'electric', zoneId: 'spb', description: 'Повторный расчёт по баллам',
  }, customer.token)).order;
  await referral.grant(t.db, { userId: customer.id, amount: 100_000,
    kind: 'admin', note: 'Тестовые баллы клиента' });
  const order = { id: o.id, number: o.number, client_id: customer.id,
    call_out_amount: 1_000_000, work_amount: 0 };
  const use = () => t.db.tx(q => referral.spendClientFee(q, order, 25_000, 25_000));
  const spent = await Promise.all(Array.from({ length: 3 }, use));
  assert.equal(spent.reduce((a, b) => a + b, 0), 25_000);
  const row = await t.db.one<{ points_fee: number; discount_amount: number }>(
    'select points_fee, discount_amount from orders where id=$1', [o.id]);
  assert.equal(Number(row?.points_fee), 25_000);
  assert.equal(Number(row?.discount_amount), 25_000);
  assert.equal(await count(
    "select count(*)::int as n from points_entries where user_id=$1 and order_id=$2 and kind='spend'",
    [customer.id, o.id]), 1);
});

test('STO inviter earns once, only after real receipt, never for a foreign booking', async () => {
  const admin = await t.login('+79990000001');
  const inviter = await t.login('+79993220008');
  const service = await t.login('+79993220009', 'service');
  const client = await t.login('+79993220010');
  const outsider = await t.login('+79993220011', 'service');
  const code = await referral.code(inviter.id);
  assert.equal(await referral.attach({
    id: service.id, roles: ['service'], inserted: true,
  } as any, code), true);
  const profile = ok(await t.api('PUT', '/api/base', {
    name: 'Тестовая рембаза', address: 'Санкт-Петербург, Промышленная 14',
    lat: 59.9, lng: 30.3, accepts: ['quick', 'day'], staff: { electric: 'own' },
  }, service.token));
  const centerId = profile.center.id;
  ok(await t.api('POST', `/api/admin/services/${centerId}/verify`,
    { decision: 'approved' }, admin.token));
  const day = new Date(t.clock.now().getTime() + 3 * 3600_000).toISOString().slice(0, 10);
  const booking = ok(await t.api('POST', `/api/services/${centerId}/book`, {
    need: 'electric', day, time: '14:00', arrival: 'self',
  }, client.token));
  ok(await t.api('POST', `/api/base/bookings/${booking.id}/respond`,
    { action: 'accept', time: '14:00' }, service.token));
  ok(await t.api('POST', `/api/base/bookings/${booking.id}/status`,
    { status: 'arrived' }, service.token));
  ok(await t.api('POST', `/api/base/bookings/${booking.id}/ready`,
    { works: ['Электрика'] }, service.token));
  ok(await t.api('POST', `/api/base/bookings/${booking.id}/invoice`,
    { amount: 500_000 }, service.token));
  ok(await t.api('POST', `/api/bookings/${booking.id}/confirm`,
    { agree: true }, client.token));

  await Promise.all([
    referral.afterBookingClosed(service.id, booking.id),
    referral.afterBookingClosed(outsider.id, booking.id),
  ]);
  assert.equal(await earned(inviter.id, 'ref_service'), 0,
    'unpaid or foreign workshop closure is not a paid referral');
  const booked = await t.db.one<{ amount: number; client_fee: number; discount: number }>(
    'select amount, client_fee, discount from service_bookings where id=$1', [booking.id]);
  const received = Number(booked?.amount) + Number(booked?.client_fee) - Number(booked?.discount);
  ok(await t.api('POST', `/api/admin/bookings/${booking.id}/payment-events`, {
    kind: 'receipt', amount: received, method: 'invoice', reference: 'REF-LEDGER-TEST-RECEIPT',
  }, admin.token));
  const again = await Promise.all(Array.from({ length: 4 }, () =>
    referral.afterBookingClosed(service.id, booking.id)));
  assert.deepEqual(again, [undefined, undefined, undefined, undefined]);
  assert.equal(await count(
    "select count(*)::int as n from points_entries where ref_user_id=$1 and kind='ref_service'",
    [service.id]), 1);
  assert.equal(await earned(inviter.id, 'ref_service'),
    (await t.app.settings.get('referral')).serviceReward);
});

test('FIFO points ledger is deterministic when debit and grants share exact timestamp', () => {
  const day = new Date('2026-12-01T12:00:00Z');
  const end = new Date('2026-12-31T12:00:00Z');
  // The DB may return insertion rows in any order. Sequence, not undefined
  // row order, determines whether the old 100-point lot or new 200-point lot
  // was consumed, and which amount expires first.
  const entries = [
    { id: 3, amount: -8_000, created_at: day, expires_at: null },
    { id: 2, amount: 20_000, created_at: day, expires_at: end },
    { id: 1, amount: 10_000, created_at: day, expires_at: new Date('2026-12-05T00:00:00Z') },
  ];
  const result = pointsBalance(entries, new Date('2026-12-06T00:00:00Z'));
  assert.deepEqual(result, { balance: 20_000, expiringSoon: 20_000 },
    '8,000 cents spent from the first expiring lot; new lot untouched');
  assert.deepEqual(pointsBalance([...entries].reverse(), new Date('2026-12-06T00:00:00Z')), result);
});
