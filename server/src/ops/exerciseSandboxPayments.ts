// Disposable CI-only financial rehearsal: verifies mock holds, partial capture,
// refund, payout and idempotency survive replacement of the provider instance.
// No production bank, credentials, real clients or live data can be accessed.
import { randomUUID } from 'node:crypto';
import { config } from '../config.ts';
import { createDb } from '../db/index.ts';
import { PersistentSandboxMockProvider } from '../payments/persistentSandboxMock.ts';

if (!config.sandboxInstance || process.env.TRAKSOS_RUN_DISPOSABLE_SCENARIO !== 'true')
  throw new Error('Explicit disposable SANDBOX_INSTANCE rehearsal required');
const db = await createDb(config.databaseUrl);
try {
  const prefix = 'disposable-sandbox-scenario-' + randomUUID();
  const first = new PersistentSandboxMockProvider(db,config.publicUrl);
  const request = {
    total:123_450, description:'Учебный выезд: 1 234,50 руб.',
    capture:false, method:'card' as const, idempotencyKey:prefix+'-hold',
    returnUrl:config.publicUrl+'/#/orders',
    metadata:{orderId:'synthetic-check',kind:'call_out'},
  };
  const created = await first.createPayment(request);
  if (!created.id.startsWith('sandbox_mock_')) throw new Error('Unexpected provider ID');
  await first.simulate(created.id,'held');

  // Reconstruct the provider as if the application container restarted.
  const restarted = new PersistentSandboxMockProvider(db,config.publicUrl);
  const replay = await restarted.createPayment(request);
  if (replay.id !== created.id || replay.status !== 'held')
    throw new Error('Sandbox provider did not preserve an idempotent held payment');
  await restarted.capture(created.id,110_000);
  const after = await restarted.getPayment(created.id);
  if (after.total !== 110_000 || after.status !== 'captured')
    throw new Error('Partial capture failed after provider restart');
  await restarted.capture(created.id,110_000);
  const refund = await restarted.refund(created.id,12_300,prefix+'-refund');
  const duplicate = await restarted.refund(created.id,12_300,prefix+'-refund');
  if (refund.id !== duplicate.id) throw new Error('Refund idempotency failed');
  const persisted = new PersistentSandboxMockProvider(db,config.publicUrl);
  const refundAgain = await persisted.getRefund(refund.id);
  if (refundAgain.status !== 'succeeded') throw new Error('Refund lost after provider restart');
  const payoutInput = {
    amount:97_700, description:'Тестовая выплата мастеру',
    idempotencyKey:prefix+'-payout',
    performer:{id:'synthetic-master',taxStatus:'self_employed' as const,inn:null},
    metadata:{orderId:'synthetic-check'},
  };
  const payout = await persisted.payout(payoutInput);
  const repeated = await first.payout(payoutInput);
  if (!payout || !repeated || payout.id !== repeated.id ||
    payout.receiptIssued !== repeated.receiptIssued)
    throw new Error('Payout idempotency failed');
  const verified = await db.one<{refunded:number;captured:number;total:number}>(
    'select refunded,captured,total from sandbox_mock_payments where id=$1',[created.id]);
  if (verified?.refunded !== 12_300 || verified.captured !== 110_000 || verified.total !== 123_450)
    throw new Error('Captured/refunded amounts disagree in sandbox PostgreSQL');
  console.log('PASS: durable fictitious hold/capture/refund/payout; no real money transferred');
} finally {
  await db.close();
}
