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
