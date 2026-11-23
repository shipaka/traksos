import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, ok } from './helpers.ts';

// Real HTTP/PostgreSQL failure injection on a disposable test database.
// A failed cleanup must not publish a new search while stale invitations
// survive, and it must not create a retry event for a rolled-back attempt.
test('failed retry cleanup rolls back status and event before re-dispatch', async () => {
  const t = await setup();
  try {
    const client = await t.login('+79992220051', 'client');
    for (const audience of ['client', 'privacy']) {
      const current = ok(await t.api('GET', '/api/offers/current/' + audience));
      if (current?.id) ok(await t.api('POST', '/api/offers/' + current.id + '/accept', {}, client.token));
    }
    const created = ok(await t.api('POST', '/api/orders', {
      service: 'hydraulics',
      zoneId: 'spb',
      paymentMethod: 'cash',
      description: 'TEST ONLY: transactional retry rollback',
    }, client.token));
    const id: string = created.order.id;

    // No hydraulics performer is connected in the disposable seed. Complete
    // any pending auction through the actual scheduler, never an SQL status edit.
    let order = ok(await t.api('GET', '/api/orders/' + id, undefined, client.token));
    if (order.status === 'searching') {
      t.clock.advance(11 * 60);
      await t.app.orders.tick();
      await t.app.auction.tick();
      order = ok(await t.api('GET', '/api/orders/' + id, undefined, client.token));
    }
    assert.equal(order.status, 'no_performer', 'fixture must be a genuinely exhausted search');
    const before = await t.db.one<{ count: number }>(
      "select count(*)::int as count from order_events where order_id=$1 and type='retry'", [id]);

    await t.db.exec(`create function traksos_test_refuse_retry_cleanup()
      returns trigger language plpgsql as $$
      begin raise exception 'injected retry cleanup failure'; end $$;
      create trigger traksos_test_refuse_retry_cleanup
      before delete on order_dispatch for each statement
      execute function traksos_test_refuse_retry_cleanup();`);
    try {
      const rejected = await t.api('POST', '/api/orders/' + id + '/retry', {}, client.token);
      assert.equal(rejected.status, 500, 'database cleanup failure must abort the retry');
      const retained = await t.db.one<{ status: string }>(
        'select status from orders where id=$1', [id]);
      assert.equal(retained?.status, 'no_performer',
        'a half-committed retry must never expose searching without valid dispatch');
      const events = await t.db.one<{ count: number }>(
        "select count(*)::int as count from order_events where order_id=$1 and type='retry'", [id]);
      assert.equal(events?.count, before?.count,
        'rolled-back action must not appear in the immutable event history');
    } finally {
      await t.db.exec(`drop trigger if exists traksos_test_refuse_retry_cleanup on order_dispatch;
        drop function if exists traksos_test_refuse_retry_cleanup();`);
    }

    const retried = ok(await t.api('POST', '/api/orders/' + id + '/retry', {}, client.token));
    assert.ok(['searching', 'no_performer'].includes(retried.status),
      'after trigger removal the customer can start a real new search');
    const after = await t.db.one<{ count: number }>(
      "select count(*)::int as count from order_events where order_id=$1 and type='retry'", [id]);
    assert.equal(after?.count, (before?.count ?? 0) + 1,
      'successful retry writes one durable event');
  } finally {
    await t.close();
  }
});
