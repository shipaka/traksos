import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ReferralService } from '../src/services/referral.ts';
import type { SettingsService } from '../src/services/settings.ts';
import type { Db, Queryable } from '../src/db/index.ts';
import type { Notifier } from '../src/services/notify.ts';

// Settlement-level regression for a ZERO-fee shortage promotion. No database,
// bank, phone number, real points balance, or production payment is used.
function fakeSettlement(freeUntil: string | null = null) {
  const queries: string[] = [];
  const q = {
    one: async (sql: string) => {
      if (sql.includes('select is_priority')) return { is_priority: false };
      if (sql.includes('select extras')) return { extras: { pointsAuto: true } };
      // Neither client nor performer has a referrer in this isolated case.
      return null;
    },
    query: async (sql: string) => { queries.push(sql); return []; },
  } as unknown as Queryable;
  const fees = {
    performerCommissionPct: 5, priorityCommissionPct: 0, freeUntil,
    clientFeePct: 5,
  };
  const settings = {
    get: async (key: string) => key === 'fees' ? fees :
      {days: 180, performerJobs: 10, clientSharePct: 10},
  } as unknown as SettingsService;
  const service = new ReferralService({} as Db, settings, {} as Notifier);
  const spendBases: number[] = [];
  const ledgerAmounts: number[][] = [];
  service.spend = async (_q,_id,base) => {
    spendBases.push(base);
    return base;
  };
  service.ledger = async (_q,_orderId,_paymentId,entries) => {
    ledgerAmounts.push(entries.map(e => e.amount));
  };
  return { q, service, spendBases, ledgerAmounts, queries };
}

const order = {
  id: 'order-test', number: 92, client_id: 'client-test',
  performer_id: 'performer-test', payment_method: 'online',
  client_fee_pct: 5,
};

test('0% campaign never spends worker points against a nonexistent commission', async () => {
  const t=fakeSettlement();
  await t.service.afterOrder(t.q,{...order,commission_pct_override:0},30_000_000);
  assert.deepEqual(t.spendBases,[]);
  assert.deepEqual(t.ledgerAmounts,[]);
  assert.equal(t.queries.length,0);
});

test('an order saved under a discount uses its own immutable rate during settlement', async () => {
  const t=fakeSettlement();
  await t.service.afterOrder(t.q,{...order,commission_pct_override:2.5},1_000_000);
  assert.deepEqual(t.spendBases,[25_000], '2.5% of 10,000 RUB is 250 RUB');
  assert.deepEqual(t.ledgerAmounts,[[25_000,-25_000]]);
});

test('non-campaign expensive order remains subject to the 5000 RUB ceiling', async () => {
  const t=fakeSettlement();
  await t.service.afterOrder(t.q,{...order,commission_pct_override:null},30_000_000);
  assert.deepEqual(t.spendBases,[500_000]);
  assert.deepEqual(t.ledgerAmounts,[[500_000,-500_000]]);
});

test('late confirmation of a free-period order never spends worker points', async () => {
  const free = fakeSettlement('2025-01-31');
  await free.service.afterOrder(free.q, {
    ...order, created_at: '2025-01-25T10:00:00+03:00', commission_pct_override: null,
  }, 1_000_000);
  assert.deepEqual(free.spendBases, []);
  assert.deepEqual(free.ledgerAmounts, []);

  const paid = fakeSettlement('2025-01-31');
  await paid.service.afterOrder(paid.q, {
    ...order, created_at: '2025-02-01T10:00:00+03:00', commission_pct_override: null,
  }, 1_000_000);
  assert.deepEqual(paid.spendBases, [50_000]);
});
