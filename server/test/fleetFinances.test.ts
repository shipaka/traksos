import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FleetService } from '../src/services/fleet.ts';

const owner = { id: 'owner-1', roles: [] } as any;
const driver = { id: 'driver-1', owner_id: 'owner-1', roles: [] } as any;

test('fleet payment register separates agreed cost from confirmed receipts, refunds and pending payments', async () => {
  const rows = [
    {
      id: 'a', number: 18, service: 'electric', status: 'completed', created_at: '2026-11-11',
      call_out_amount: 10000, work_amount: 20000, client_fee_pct: 5, discount_amount: 1500,
      collected: 24000, refunded: 2000, pending_payment: 6000, payment_method: 'online',
    },
    {
      id: 'b', number: 19, service: 'tow', status: 'awaiting_confirmation', created_at: '2026-11-11',
      call_out_amount: 50000, work_amount: null, client_fee_pct: 5, discount_amount: 0,
      collected: 0, refunded: 0, pending_payment: 0, payment_method: 'cash',
    },
  ];
  const db: any = {
    query: async (sql: string, params: unknown[]) => {
      assert.deepEqual(params, [owner.id]);
      assert.match(sql, /where o.client_id=\$1/);
      assert.match(sql, /from payments where order_id=o.id/);
      return rows;
    },
  };
  const report = await new FleetService(db, {} as any, {} as any).finances(owner);
  assert.equal(report.agreedTotal, 30000);
  assert.equal(report.confirmedCollected, 24000);
  assert.equal(report.confirmedRefunded, 2000);
  assert.equal(report.items[0].pendingPayment, 6000);
  assert.equal(report.items[1].agreedTotal, null);
});

test('fleet finance report does not query company expenses for drivers', async () => {
  let queried = false;
  const db: any = { query: async () => { queried = true; return []; } };
  await assert.rejects(
    new FleetService(db, {} as any, {} as any).finances(driver),
    /Финансы автопарка доступны только владельцу/,
  );
  assert.equal(queried, false);
});
