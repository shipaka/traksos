import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PaymentsService } from '../src/payments/service.ts';

test('delayed payment notifications cannot reopen settled or cancelled payments', async () => {
  for (const previous of ['captured', 'cancelled', 'failed', 'partially_refunded']) {
    let writes = 0;
    const db: any = { query: async () => { writes++; } };
    const service = new PaymentsService(db, {} as any, {} as any, {} as any, {} as any);
    const result = await (service as any).sync({ id: 'payment-1', status: previous }, 'pending');
    assert.deepEqual(result, { changed: false }, previous);
    assert.equal(writes, 0, previous);
  }
});

test('out-of-order pending event cannot reverse an authorized hold', async () => {
  let writes = 0;
  const db: any = { query: async () => { writes++; } };
  const service = new PaymentsService(db, {} as any, {} as any, {} as any, {} as any);
  const result = await (service as any).sync({ id: 'payment-1', status: 'held' }, 'pending');
  assert.deepEqual(result, { changed: false });
  assert.equal(writes, 0);
});

test('candidate payment endpoint denies access before querying payment rows', async () => {
  const order = { id: 'order-1', client_id: 'client-1', created_by: 'client-1', performer_id: null };
  let queries = 0;
  const db: any = { query: async () => { queries++; return []; } };
  const orders: any = { mustSee: async () => order, actorOf: () => null };
  const service = new PaymentsService(db, {} as any, {} as any, {} as any, orders);
  await assert.rejects(service.forOrder({ id: 'candidate-1', roles: ['master'] } as any, order.id),
    (err: any) => err.status === 403);
  assert.equal(queries, 0, 'payment records must not be read for a bidding candidate');
});

test('assigned performer can read payment history', async () => {
  const order = { id: 'order-1', client_id: 'client-1', performer_id: 'master-1' };
  let queries = 0;
  const db: any = { query: async () => { queries++; return [{ id: 'payment-1' }]; } };
  const orders: any = { mustSee: async () => order, actorOf: () => 'performer' };
  const service = new PaymentsService(db, {} as any, {} as any, {} as any, orders);
  const payments = await service.forOrder({ id: 'master-1', roles: ['master'] } as any, order.id);
  assert.deepEqual(payments, [{ id: 'payment-1' }]);
  assert.equal(queries, 1);
});
