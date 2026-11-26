import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, ok } from './helpers.ts';

test('unavailable performer cleanup retries a rolled-back deadlock before publishing release', { timeout: 60000 }, async () => {
  const t = await setup();
  try {
    assert.equal(t.db.driver, 'pg');
    const admin = await t.login('+79990000001');
    const customer = await t.login('+79995673101');
    const worker = await t.login('+79995673102', 'master');
    const other = await t.login('+79995673103', 'master');
    await ok(await t.api('PUT', '/api/admin/settings/dispatch', { priorityFirst: false }, admin.token));
    for (const u of [worker, other]) {
      ok(await t.api('PUT', '/api/performer/profile', { name: 'Учебный мастер', kind: 'master', specialties: ['electric'] }, u.token));
      ok(await t.api('POST', '/api/performer/line', { lineStatus: 'online' }, u.token));
      ok(await t.api('POST', '/api/performer/location', { lat: 59.95, lng: 30.3 }, u.token));
    }
    const order = ok(await t.api('POST', '/api/orders', { service: 'electric', zoneId: 'spb', lat: 59.95, lng: 30.3 }, customer.token)).order;
    for (const u of [worker, other])
      ok(await t.api('POST', '/api/orders/'+order.id+'/offers', {}, u.token));
    const read = (id: string) => t.db.one<{bid: string; invitation: string}>(`
      select b.status as bid, d.status as invitation
      from bids b join order_dispatch d on d.order_id=b.order_id and d.performer_id=b.performer_id
      where b.order_id=$1 and b.performer_id=$2`, [order.id, id]);
    assert.equal((await read(worker.id))?.bid, 'active');
    const otherBefore = await read(other.id);
    assert.equal(otherBefore?.bid, 'active');

    // Disposable PostgreSQL only. A sequence is not rolled back, so the first
    // attempt deterministically raises the same SQLSTATE seen in CI and the
    // next attempt can succeed. No global database retry settings are changed.
    await t.db.exec(`
      create sequence fixture_release_retry;
      create function fixture_release_deadlock() returns trigger language plpgsql as $$
      begin
        if old.status='active' and new.status='withdrawn' then
          if nextval('fixture_release_retry')=1 then
            raise exception 'fixture deadlock' using errcode='40P01';
          end if;
        end if;
        return new;
      end $$;
      create trigger fixture_release_deadlock before update on bids
        for each row execute function fixture_release_deadlock();
    `);
    const before = t.app.hub.log.length;
    ok(await t.api('POST', '/api/performer/line', { lineStatus: 'offline' }, worker.token));
    assert.deepEqual(await read(worker.id), { bid: 'withdrawn', invitation: 'cancelled' });
    assert.deepEqual(await read(other.id), otherBefore);
    const attempts = await t.db.one<{n: number}>('select last_value::int as n from fixture_release_retry');
    assert.equal(attempts?.n, 2, 'the failed transaction was retried once');
    const releases = t.app.hub.log.slice(before).filter(l =>
      l.userId === worker.id && l.event.type === 'order' &&
      l.event.orderId === order.id && l.event.status === 'released');
    assert.equal(releases.length, 1, 'publish only after successful commit');
  } finally {
    await t.close();
  }
});
