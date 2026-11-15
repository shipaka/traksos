import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, ok } from './helpers.ts';

test('invoice refund waits for admin bank confirmation and settles exactly once under 12 concurrent clicks',
  { timeout: 60000 }, async () => {
    const t = await setup();
    try {
      const admin = await t.login('+79990000001');
      const client = await t.login('+79995557771');
      const worker = await t.login('+79995557772', 'master');
      const order = await t.db.one<{ id: string }>(
        `insert into orders (client_id, created_by, performer_id, service, zone_id, status)
         values ($1,$1,$2,'electric','spb','completed') returning id`,
        [client.id, worker.id]);
      assert.ok(order);
      const payment = await t.db.one<{ id: string }>(
        `insert into payments (order_id, kind, method, amount, client_fee, total, status, provider, idempotency_key)
         values ($1,'work','invoice',50000,0,50000,'captured','invoice',$2) returning id`,
        [order.id, `test-invoice:${order.id}`]);
      assert.ok(payment);

      const request = { amount: 12500, from: 'platform', reason: 'Подтверждённое исправление' };
      const url = `/api/admin/payments/${payment.id}/refund`;
      const pending = ok(await t.api('POST', url, request, admin.token));
      assert.equal(pending.status, 'pending_manual_refund');
      assert.equal(pending.amount, 12500);
      assert.ok(pending.refundId);
      const same = ok(await t.api('POST', url, request, admin.token));
      assert.equal(same.refundId, pending.refundId, 'retry returns the same operation');

      const refsUrl = `/api/admin/payments/${payment.id}/refunds`;
      assert.equal(ok(await t.api('GET', refsUrl, undefined, admin.token))[0].status, 'pending_manual_refund');
      assert.equal((await t.db.one<any>(
        'select refunded_amount from payments where id=$1', [payment.id]))!.refunded_amount, 0);
      assert.equal((await t.db.query('select id from ledger_entries where payment_id=$1', [payment.id])).length, 0);
      assert.equal(t.payments.refunds.size, 0, 'invoice must not call provider refund');

      const reconcile = await t.api('POST',
        `/api/admin/payments/${payment.id}/refunds/${pending.refundId}/reconcile`, {}, admin.token);
      assert.equal(reconcile.body.error, 'manual_refund_required');
      const confirmUrl = `/api/admin/payments/${payment.id}/refunds/${pending.refundId}/confirm-bank-transfer`;
      const proof = {
        transferReference: 'BANK-OUT-20261113-001',
        transferredAt: '2026-11-13T09:00:00+03:00',
        confirmedTransfer: true,
      };
      assert.equal((await t.api('POST', confirmUrl, proof, client.token)).status, 403);
      assert.notEqual((await t.api('POST', confirmUrl,
        { ...proof, confirmedTransfer: false }, admin.token)).status, 200);
      assert.equal((await t.db.query('select id from ledger_entries where payment_id=$1', [payment.id])).length, 0);

      const replies = await Promise.all(Array.from({ length: 12 }, () =>
        t.api('POST', confirmUrl, proof, admin.token)));
      assert.ok(replies.every(r => r.status === 200), JSON.stringify(replies));
      const settled = await t.db.one<any>('select status, refunded_amount from payments where id=$1', [payment.id]);
      assert.equal(settled?.status, 'partially_refunded');
      assert.equal(settled?.refunded_amount, 12500);
      const attempts = await t.db.query<any>('select * from payment_refund_requests where payment_id=$1', [payment.id]);
      assert.equal(attempts.length, 1);
      assert.equal(attempts[0].status, 'succeeded');
      assert.equal(attempts[0].bank_transfer_reference, proof.transferReference);
      assert.equal(attempts[0].bank_confirmed_by, admin.id);
      assert.equal((await t.db.query('select id from ledger_entries where payment_id=$1', [payment.id])).length, 2,
        'exactly one double-entry refund');
      assert.equal((await t.db.query(
        "select id from audit_log where action='payment.invoice_refund_confirmed' and target=$1",
        [payment.id])).length, 1);
      const wrongProof = await t.api('POST', confirmUrl,
        { ...proof, transferReference: 'DIFFERENT-BANK-TRANSFER' }, admin.token);
      assert.equal(wrongProof.body.error, 'confirmation_conflict');
      assert.equal((await t.db.query('select id from ledger_entries where payment_id=$1', [payment.id])).length, 2);
      const balance = await t.db.query<{ amount: string }>(
        'select coalesce(sum(amount),0)::text as amount from ledger_entries where payment_id=$1', [payment.id]);
      assert.equal(balance[0].amount, '0', 'accounting entries must sum to zero');
      assert.equal(t.payments.refunds.size, 0);
    } finally {
      await t.close();
    }
  });
