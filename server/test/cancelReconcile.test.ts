import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, ok } from './helpers.ts';

test('en-route cancellation never escalates to 100 percent from an unverified GPS point', { timeout: 60000 }, async () => {
  const t = await setup();
  try {
    const admin = await t.login('+79990000001');
    const client = await t.login('+79998885571');
    const worker = await t.login('+79998885572', 'master');
    ok(await t.api('PUT', '/api/performer/profile', {
      kind: 'master', name: 'Исполнитель с GPS',
      specialties: ['electric'], taxStatus: 'self_employed', inn: '780000000556',
    }, worker.token));
    ok(await t.api('POST', `/api/admin/performers/${worker.id}/verify`,
      { decision: 'approved' }, admin.token));
    ok(await t.api('POST', '/api/performer/line', { lineStatus: 'online' }, worker.token));
    const created = ok(await t.api('POST', '/api/orders',
      { service: 'electric', zoneId: 'spb', paymentMethod: 'cash' }, client.token));
    const id = created.order.id;
    ok(await t.api('POST', `/api/orders/${id}/offers`, {}, worker.token));
    const bids = ok(await t.api('GET', `/api/orders/${id}/offers`, undefined, client.token));
    ok(await t.api('POST', `/api/orders/${id}/offers/${bids.offers[0].id}/choose`, {}, client.token));
    ok(await t.api('POST', `/api/orders/${id}/step`, { action: 'depart' }, worker.token));
    // A forged/stale last position at the client location used to look like
    // the second half of the route. It is not evidence of travel progress.
    const order = await t.db.one<any>('select lat,lng from orders where id=$1', [id]);
    if (order.lat != null && order.lng != null) {
      await t.db.query('update performer_profiles set lat=$2,lng=$3,location_at=now() where user_id=$1',
        [worker.id, order.lat, order.lng]);
    }
    await t.db.query('update order_dispatch set distance_km=100 where order_id=$1 and performer_id=$2',
      [id, worker.id]);
    const cancelled = ok(await t.api('POST', `/api/orders/${id}/cancel`,
      { reason: 'Передумал' }, client.token));
    assert.equal(cancelled.cancelStage, 'en_route_first_half');
    assert.equal(cancelled.cancelBreakdown.stage, 'en_route_first_half');
    assert.equal(cancelled.cancelBreakdown.share, 0.5);
    assert.deepEqual(cancelled.cancelBreakdown.stageEvidence, {
      source: 'status_only', gpsVerified: false, routeHalfVerified: false,
      note: 'No timestamped, validated route progress available',
    });
    const audit = await t.db.one<any>(
      "select data from order_events where order_id=$1 and type='cancelled' order by id desc limit 1", [id]);
    assert.equal(audit.data.stageEvidence.gpsVerified, false);
    assert.equal(audit.data.stageEvidence.routeHalfVerified, false);
    assert.equal((await t.db.one<any>('select cancel_stage from orders where id=$1', [id])).cancel_stage,
      'en_route_first_half');
  } finally { await t.close(); }
});

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
      // The client can audit the original cancellation tier and the bank
      // result separately; the performer cannot inspect client bank details.
      const clientView = ok(await t.api('GET', `/api/orders/${id}`, undefined, client.token));
      assert.equal(clientView.cancelBreakdown.stage, 'accepted');
      assert.equal(clientView.cancelBreakdown.share, 0.25);
      assert.equal(clientView.cancellationPayment.paymentStatus, 'partially_refunded');
      assert.equal(clientView.cancellationPayment.operationStatus, 'settled');
      assert.equal(clientView.cancellationPayment.amountToCapture, attempt.amount_to_capture);
      assert.equal(clientView.cancellationPayment.refundedAmount, attempt.refunded_amount);
      const performerView = ok(await t.api('GET', `/api/orders/${id}`, undefined, worker.token));
      assert.equal(performerView.cancellationPayment, null);

      assert.equal((await t.db.one<{ total: string }>(
        'select coalesce(sum(amount),0)::text total from ledger_entries where order_id=$1',
        [id]))?.total, '0');
    } finally {
      t.payments.capture = real;
    }
  } finally { await t.close(); }
});
