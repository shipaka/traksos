import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, ok } from './helpers.ts';

test('bank cancellation capture is reconciled once after response loss and 12 parallel retries', { timeout: 60000 }, async () => {
  const t = await setup();
  try {
    const admin = await t.login('+79990000001');
    const client = await t.login('+79998885561');
    const worker = await t.login('+79998885562', 'master');
    ok(await t.api('PUT', '/api/performer/profile', {
      kind: 'master', name: 'Исполнитель тестовой заявки',
      specialties: ['electric'], taxStatus: 'self_employed', inn: '780000000555',
    }, worker.token));
    ok(await t.api('POST', `/api/admin/performers/${worker.id}/verify`,
      { decision: 'approved' }, admin.token));
    ok(await t.api('POST', '/api/performer/line', { lineStatus: 'online' }, worker.token));
    ok(await t.api('PUT', '/api/admin/settings/payments', { online: true }, admin.token));

    const created = ok(await t.api('POST', '/api/orders',
      { service: 'electric', zoneId: 'spb', paymentMethod: 'online' }, client.token));
    const id = created.order.id;
    const payment = await t.db.one<any>(
      "select * from payments where order_id=$1 and kind='call_out'", [id]);
    assert.ok(payment);
    ok(await t.api('POST', `/api/dev/mock-pay/${payment.provider_payment_id}`));
    ok(await t.api('POST', `/api/orders/${id}/offers`, {}, worker.token));
    const bids = ok(await t.api('GET', `/api/orders/${id}/offers`, undefined, client.token));
    ok(await t.api('POST', `/api/orders/${id}/offers/${bids.offers[0].id}/choose`, {}, client.token));

    const real = t.payments.capture.bind(t.payments);
    let calls = 0;
    t.payments.capture = async (payId, amount) => {
      if (payId !== payment.provider_payment_id) return real(payId, amount);
      calls++;
      await real(payId, amount);
      throw new Error('reply was lost after capture');
    };
    try {
      const cancelled = ok(await t.api('POST', `/api/orders/${id}/cancel`,
        { reason: 'Больше не нужен выезд' }, client.token));
      assert.equal(cancelled.status, 'cancelled');
      const attempt = await t.db.one<any>(
        'select * from payment_cancel_intents where order_id=$1', [id]);
      assert.equal(attempt.status, 'needs_review');
      assert.equal(attempt.action, 'capture');
      assert.equal(attempt.attempts, 1);
      assert.equal(calls, 1);
      assert.equal((await t.db.query('select id from payouts where order_id=$1', [id])).length, 0);
      assert.equal((await t.db.query('select id from ledger_entries where order_id=$1', [id])).length, 0);

      const hook = await t.api('POST', '/api/payments/webhook',
        { paymentId: payment.provider_payment_id });
      assert.equal(hook.status, 200);
      assert.equal(hook.body.changed, false);

      const url = `/api/admin/payment-cancellations/${attempt.id}/reconcile`;
      const replies = await Promise.all(Array.from({ length: 12 },
        () => t.api('POST', url, {}, admin.token)));
      assert.ok(replies.every(v => v.status === 200 && v.body === 'settled'), JSON.stringify(replies));
      assert.equal(calls, 1);
      assert.equal((await t.db.query('select id from payouts where order_id=$1', [id])).length, 1);
      assert.equal((await t.db.query('select id from ledger_entries where order_id=$1', [id])).length, 3);
      const pay = await t.db.one<any>('select * from payments where id=$1', [payment.id]);
      assert.equal(pay.status, 'partially_refunded');
      assert.equal(pay.total - pay.refunded_amount, attempt.amount_to_capture);
      assert.equal((await t.db.one<{ total: string }>(
        'select coalesce(sum(amount),0)::text total from ledger_entries where order_id=$1',
        [id]))?.total, '0');
    } finally {
      t.payments.capture = real;
    }
  } finally { await t.close(); }
});
