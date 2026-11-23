import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OrdersService } from '../src/services/orders.ts';
import type { Db } from '../src/db/index.ts';
import type { SettingsService } from '../src/services/settings.ts';
import type { Notifier } from '../src/services/notify.ts';

// A narrow service-level regression: the worker-facing amount returned to
// the actual UI must match the approved 5 000 ₽ per-side ceiling. No payment,
// user account or external notification is created by this unit test.
function createOrders(priority = false) {
  const db = {
    one: async () => ({ is_priority: priority }),
  } as unknown as Db;
  const settings = {
    get: async () => ({
      performerCommissionPct: 5,
      priorityCommissionPct: 0,
      freeUntil: null,
    }),
  } as unknown as SettingsService;
  return new OrdersService(db, settings, {} as Notifier);
}

const largeOrder = {
  performer_id: 'unit-test-performer',
  call_out_amount: 30_000_000, // 300 000 ₽
  work_amount: 0,
  client_fee_pct: 5,
  payment_method: 'online',
  points_commission: 0,
};

test('worker-facing breakdown caps both 5% sides at 5000 RUB on expensive repairs', async () => {
  const breakdown = await createOrders().moneyForViewer(largeOrder, 'performer');
  assert.equal(breakdown.amount, 30_000_000);
  assert.equal(breakdown.commissionPct, 5);
  assert.equal(breakdown.commission, 500_000, 'worker commission must never exceed 5000 RUB');
  assert.equal(breakdown.payout, 29_500_000);
  const customer = await createOrders().moneyForViewer(largeOrder, 'client');
  assert.equal(customer.clientFee, 500_000, 'client service fee retains its independent cap');
  assert.equal(customer.total, 30_500_000);
});

test('a zero-fee campaign and a priority worker still have no worker commission', async () => {
  const zero = await createOrders().moneyForViewer({
    ...largeOrder, commission_pct_override: 0,
  }, 'performer');
  assert.equal(zero.commission, 0);
  assert.equal(zero.payout, largeOrder.call_out_amount);
  const priority = await createOrders(true).moneyForViewer(largeOrder, 'performer');
  assert.equal(priority.commission, 0);
  assert.equal(priority.payout, largeOrder.call_out_amount);
});

test('a low percentage is retained, with a cap only when the computed amount exceeds it', async () => {
  const small = await createOrders().moneyForViewer({
    ...largeOrder,
    call_out_amount: 1_000_000, // 10 000 ₽
    commission_pct_override: 2.5,
  }, 'performer');
  assert.equal(small.commissionPct, 2.5);
  assert.equal(small.commission, 25_000); // 250 ₽
  assert.equal(small.payout, 975_000);
  const large = await createOrders().moneyForViewer({
    ...largeOrder,
    commission_pct_override: 2.5,
  }, 'performer');
  assert.equal(large.commission, 500_000);
  assert.equal(large.payout, 29_500_000);
});
