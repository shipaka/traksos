import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, ok } from './helpers.ts';

test('performer GPS events stop reaching the historical driver after reassignment', { timeout: 60000 }, async () => {
  const t = await setup();
  try {
    const owner = await t.login('+79996567901');
    const driver = await t.login('+79996567902', 'driver');
    const worker = await t.login('+79996567903', 'master');
    const a = ok(await t.api('POST', '/api/vehicles', { brand: 'Scania', model: 'R', year: 2017, plate: 'А313АА178' }, owner.token));
    const b = ok(await t.api('POST', '/api/vehicles', { brand: 'Scania', model: 'R', year: 2018, plate: 'А314АА178' }, owner.token));
    const fleet = ok(await t.api('GET', '/api/fleet', undefined, owner.token));
    const qr = fleet.cars.find((v: any) => v.id === a.id)?.qrCode;
    assert.ok(qr);
    ok(await t.api('POST', '/api/qr/' + qr + '/join', {}, driver.token));
    const order = await t.db.one<{id: string}>(`
      insert into orders(client_id,created_by,performer_id,vehicle_id,service,zone_id,status)
      values($1,$2,$3,$4,'electric','spb','accepted') returning id`,
      [owner.id, driver.id, worker.id, a.id]);
    assert.ok(order);
    const ownerEvents: any[] = [];
    const driverEvents: any[] = [];
    t.app.hub.add(owner.id, { readyState: 1, send: s => ownerEvents.push(JSON.parse(s)) });
    t.app.hub.add(driver.id, { readyState: 1, send: s => driverEvents.push(JSON.parse(s)) });
    const point = { lat: 59.93, lng: 30.31 };
    const gps = (events: any[]) => events.filter(e => e.type === 'performer_location' && e.orderId === order.id);
    assert.notEqual(ok(await t.api('POST', '/api/performer/location', point, worker.token)).accepted, false);
    assert.equal(gps(ownerEvents).length, 1);
    assert.equal(gps(driverEvents).length, 1);
    ok(await t.api('POST', `/api/vehicles/${b.id}/driver`, { phone: '+79996567902' }, owner.token));
    assert.equal((await t.db.one<{owner_id: string}>('select owner_id from users where id=$1', [driver.id]))?.owner_id, owner.id);
    assert.notEqual(ok(await t.api('POST', '/api/performer/location', point, worker.token)).accepted, false);
    assert.equal(gps(ownerEvents).length, 2, 'owner still receives current GPS');
    assert.equal(gps(driverEvents).length, 1, 'historical driver with an open socket receives no further GPS');
  } finally {
    await t.close();
  }
});
