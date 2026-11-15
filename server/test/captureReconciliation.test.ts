import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, ok } from './helpers.ts';

async function fixture() {
  const t = await setup();
  const admin = await t.login('+79990000001');
  const client = await t.login('+79998885551');
  const master = await t.login('+79998885552', 'master');
  ok(await t.api('PUT', '/api/performer/profile', {
    kind: 'master', name: 'Специалист для проверки платежа',
    specialties: ['electric'], taxStatus: 'self_employed', inn: '780000000555',
  }, master.token));
  ok(await t.api('POST', `/api/admin/performers/${master.id}/verify`,
    { decision: 'approved' }, admin.token));
  ok(await t.api('POST', '/api/performer/line', { lineStatus: 'online' }, master.token));
  ok(await t.api('PUT', '/api/admin/settings/payments', { online: true }, admin.token));

  async function newOrder(work = 80_000) {
    const created = ok(await t.api('POST', '/api/orders', {
      service: 'electric', zoneId: 'spb', paymentMethod: 'online',
    }, client.token));
    assert.ok(created.confirmationUrl);
    ok(await t.api('POST', `/api/dev/mock-pay/${created.confirmationUrl.split('/').pop()}`));
    ok(await t.api('POST', `/api/orders/${created.order.id}/offers`, {}, master.token));
    const offers = ok(await t.api('GET', `/api/orders/${created.order.id}/offers`, undefined, client.token));
    ok(await t.api('POST', `/api/orders/${created.order.id}/offers/${offers.offers[0].id}/choose`, {}, client.token));
    ok(await t.api('POST', `/api/orders/${created.order.id}/step`, { action: 'arrive' }, master.token));
    await t.db.query("update orders set estimate=estimate - 'hour' where id=$1", [created.order.id]);
    ok(await t.api('POST', `/api/orders/${created.order.id}/amount`,
      { extras: [{ name: 'Работа и детали', amount: work }], result: 'solved' }, master.token));
    ok(await t.api('POST', `/api/orders/${created.order.id}/confirm`, {}, client.token));
    const workPay = await t.db.one<any>(
      "select * from payments where order_id=$1 and kind='work'", [created.order.id]);
    const heldPay = await t.db.one<any>(
      "select * from payments where order_id=$1 and kind='call_out'", [created.order.id]);
    assert.ok(workPay && heldPay);
    return { id: created.order.id as string, workPay, heldPay };
  }

  async function capturedWebhook(workPay: any) {
    t.payments.simulate(workPay.provider_payment_id, 'captured');
    return t.api('POST', '/api/payments/webhook',
      { paymentId: workPay.provider_payment_id });
  }

  const intentFor = (orderId: string) => t.db.one<any>(
    'select * from payment_capture_intents where order_id=$1', [orderId]);
  const ledgerFor = (orderId: string) => t.db.query<any>(
    'select * from ledger_entries where order_id=$1', [orderId]);
  const payoutsFor = (orderId: string) => t.db.query<any>(
    'select * from payouts where order_id=$1', [orderId]);
  return { t, admin, client, master, newOrder, capturedWebhook,
    intentFor, ledgerFor, payoutsFor };
}

test('capture: provider succeeded but response lost; 12 replayed webhooks cannot recapture',
  { timeout: 60000 }, async () => {
  const f = await fixture();
  try {
    const { id, workPay, heldPay } = await f.newOrder();
    const realCapture = f.t.payments.capture.bind(f.t.payments);
    let calls = 0;
    f.t.payments.capture = async (paymentId, amount) => {
      if (paymentId !== heldPay.provider_payment_id) return realCapture(paymentId, amount);
      calls++;
      const confirmedByBank = await realCapture(paymentId, amount);
      assert.equal(confirmedByBank.status, 'captured');
      throw new Error('network response lost AFTER provider capture');
    };
    try {
      const first = await f.capturedWebhook(workPay);
      assert.equal(first.status, 200, JSON.stringify(first));
      assert.equal(first.body.changed, true);
      const uncertain = await f.intentFor(id);
      assert.equal(uncertain?.status, 'needs_review');
      assert.equal(uncertain?.attempts, 1);
      assert.equal(calls, 1);
      assert.equal((await f.ledgerFor(id)).length, 0, 'no money booked before confirmation');
      assert.equal((await f.payoutsFor(id)).length, 0);
      assert.equal((await f.t.db.one<any>(
        'select status from payments where id=$1', [heldPay.id]))?.status, 'held');
      const replays = await Promise.all(Array.from({ length: 12 }, () =>
        f.t.api('POST', '/api/payments/webhook', { paymentId: workPay.provider_payment_id })));
      assert.ok(replays.every(x => x.status === 200), JSON.stringify(replays));
      assert.equal(replays.filter(x => x.body.changed).length, 0);
      assert.equal(calls, 1, 'unknown capture is never re-sent');
      assert.equal((await f.ledgerFor(id)).length, 0);

      const pending = ok(await f.t.api('GET', '/api/admin/payment-captures', undefined, f.admin.token));
      assert.equal(pending.filter((x: any) => x.id === uncertain.id).length, 1);
      assert.equal((await f.t.api('GET', '/api/admin/payment-captures', undefined, f.client.token)).status, 403);

      // All 12 reconciliation calls may read the provider simultaneously but
      // only one database transaction may create accounting and payout.
      const reconcileUrl = `/api/admin/payment-captures/${uncertain.id}/reconcile`;
      const replies = await Promise.all(Array.from({ length: 12 }, () =>
        f.t.api('POST', reconcileUrl, {}, f.admin.token)));
      assert.ok(replies.every(x => x.status === 200 && x.body === 'settled'),
        JSON.stringify(replies));
      assert.equal(calls, 1, 'GET-based reconciliation never calls capture');
      const settled = await f.intentFor(id);
      assert.equal(settled.status, 'settled');
      assert.equal((await f.payoutsFor(id)).length, 1);
      assert.equal((await f.ledgerFor(id)).filter(x => x.kind === 'earning').length, 1);
      assert.equal((await f.ledgerFor(id)).filter(x => x.kind === 'payment').length, 1);
      assert.equal((await f.t.db.query(
        "select id from order_events where order_id=$1 and type='paid'", [id])).length, 1);
      const totals = await f.t.db.query<{ sum: string }>(
        "select coalesce(sum(amount),0)::text as sum from ledger_entries where order_id=$1", [id]);
      assert.equal(totals[0].sum, '0');
    } finally {
      f.t.payments.capture = realCapture;
    }
  } finally { await f.t.close(); }
});

test('capture: SQL transaction fails AFTER real bank capture; reconciliation repairs once',
  { timeout: 60000 }, async () => {
  const f = await fixture();
  try {
    const { id, workPay, heldPay } = await f.newOrder(62_000);
    await f.t.db.exec(`create function fail_capture_payout_insert() returns trigger as $$
      begin raise exception 'injected SQL failure after bank capture'; end
      $$ language plpgsql;
      create trigger test_capture_failure before insert on payouts
        for each row execute function fail_capture_payout_insert();`);
    let called = 0;
    const realCapture = f.t.payments.capture.bind(f.t.payments);
    f.t.payments.capture = async (payId, amount) => {
      if (payId === heldPay.provider_payment_id) called++;
      return realCapture(payId, amount);
    };
    try {
      const first = await f.capturedWebhook(workPay);
      assert.equal(first.status, 200);
      assert.equal((await f.intentFor(id))?.status, 'needs_review');
      assert.equal((await f.t.db.one<any>(
        'select status from payments where id=$1', [heldPay.id]))?.status, 'held');
      assert.equal((await f.payoutsFor(id)).length, 0);
      assert.equal((await f.ledgerFor(id)).length, 0);
      assert.equal(called, 1);
      await f.t.db.exec('drop trigger test_capture_failure on payouts; drop function fail_capture_payout_insert();');
      const intent = await f.intentFor(id);
      assert.equal(await f.t.app.payments.reconcileCapture(intent.id), 'settled');
      assert.equal(await f.t.app.payments.reconcileCapture(intent.id), 'settled');
      assert.equal(called, 1, 'provider capture is not re-sent after rollback');
      assert.equal((await f.payoutsFor(id)).length, 1);
      assert.equal((await f.ledgerFor(id)).length, 3);
      assert.equal((await f.t.db.query(
        "select id from order_events where order_id=$1 and type='paid'", [id])).length, 1);
    } finally {
      f.t.payments.capture = realCapture;
    }
  } finally { await f.t.close(); }
});

test('capture: disagreement between bank amount and intent blocks automatic accounting',
  { timeout: 60000 }, async () => {
  const f = await fixture();
  try {
    const { id, workPay, heldPay } = await f.newOrder(74_000);
    const realGetPayment = f.t.payments.getPayment.bind(f.t.payments);
    f.t.payments.getPayment = async paymentId => {
      const result = await realGetPayment(paymentId);
      return paymentId === heldPay.provider_payment_id && result.status === 'captured'
        ? { ...result, total: result.total + 1 } : result;
    };
    try {
      assert.equal((await f.capturedWebhook(workPay)).status, 200);
      assert.equal((await f.intentFor(id))?.status, 'needs_review');
      assert.equal((await f.payoutsFor(id)).length, 0);
      assert.equal((await f.ledgerFor(id)).length, 0);
    } finally {
      f.t.payments.getPayment = realGetPayment;
    }
    const intent = await f.intentFor(id);
    assert.equal(await f.t.app.payments.reconcileCapture(intent.id), 'settled');
    assert.equal((await f.payoutsFor(id)).length, 1);
    assert.equal((await f.ledgerFor(id)).length, 3);
  } finally { await f.t.close(); }
});
