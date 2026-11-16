import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, ok } from './helpers.ts';

test('GPS history is scoped to an en-route order and rejects impossible jumps', { timeout: 60000 }, async () => {
  const t = await setup();
  try {
    const admin = await t.login('+79990000001');
    const client = await t.login('+79998886671');
    const worker = await t.login('+79998886672', 'master');
    ok(await t.api('PUT', '/api/performer/profile', {
      kind: 'master', name: 'GPS test specialist', specialties: ['electric'],
      taxStatus: 'self_employed', inn: '780000000557',
    }, worker.token));
    ok(await t.api('POST', `/api/admin/performers/${worker.id}/verify`,
      { decision: 'approved' }, admin.token));
    ok(await t.api('POST', '/api/performer/line', { lineStatus: 'online' }, worker.token));
    // A location while idle is available for dispatch, but never becomes a
    // route-history entry for a future job.
    ok(await t.api('POST', '/api/performer/location',
      { lat: 59.9343, lng: 30.3351 }, worker.token));
    const created = ok(await t.api('POST', '/api/orders',
      { service: 'electric', zoneId: 'spb', paymentMethod: 'cash' }, client.token));
    const id = created.order.id;
    ok(await t.api('POST', `/api/orders/${id}/offers`, {}, worker.token));
    const bids = ok(await t.api('GET', `/api/orders/${id}/offers`, undefined, client.token));
    ok(await t.api('POST', `/api/orders/${id}/offers/${bids.offers[0].id}/choose`, {}, client.token));
    assert.equal((await t.db.query('select id from performer_route_samples where order_id=$1', [id])).length, 0);
    ok(await t.api('POST', `/api/orders/${id}/step`, { action: 'depart' }, worker.token));
    const accepted = ok(await t.api('POST', '/api/performer/location',
      { lat: 59.9344, lng: 30.3352 }, worker.token));
    assert.notEqual(accepted.accepted, false);
    const rejected = ok(await t.api('POST', '/api/performer/location',
      { lat: 55.7558, lng: 37.6173 }, worker.token));
    assert.equal(rejected.accepted, false);
    const points = await t.db.query<any>(
      'select lat,lng from performer_route_samples where order_id=$1 order by id', [id]);
    assert.equal(points.length, 1);
    assert.equal(Number(points[0].lat), 59.9344);
    // Route history must never leak to the client, performer, or anonymous users.
    const path = `/api/admin/orders/${id}/route`;
    assert.equal((await t.api('GET', path, undefined, client.token)).status, 403);
    assert.equal((await t.api('GET', path, undefined, worker.token)).status, 403);
    assert.equal((await t.api('GET', path)).status, 401);
    // Rejected telemetry must never appear in the admin's evidence timeline,
    // even if a legacy writer or an import leaves it in the table.
    await t.db.query(
      'insert into performer_route_samples(order_id,performer_id,lat,lng,accepted) values($1,$2,$3,$4,false)',
      [id, worker.id, 59.9350, 30.3360]);
    const adminRoute = ok(await t.api('GET', path, undefined, admin.token));
    assert.equal(adminRoute.orderId, id);
    assert.equal(adminRoute.points.length, 1);
    assert.equal(Number(adminRoute.points[0].lat), 59.9344);
    assert.equal(adminRoute.points[0].received_at != null, true);
    assert.equal((await t.api('GET', '/api/admin/orders/00000000-0000-0000-0000-000000000000/route',
      undefined, admin.token)).status, 404);
    ok(await t.api('POST', `/api/orders/${id}/cancel`, { reason: 'Отмена' }, client.token));
    await t.api('POST', '/api/performer/location', { lat: 59.9345, lng: 30.3353 }, worker.token);
    assert.equal((await t.db.query('select id from performer_route_samples where order_id=$1 and accepted=true', [id])).length, 1);
  } finally { await t.close(); }
});
