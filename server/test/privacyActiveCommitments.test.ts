import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, ok } from './helpers.ts';

async function shopFixture(t: Awaited<ReturnType<typeof setup>>, userId: string,
  status: 'new' | 'ready' | 'done', delivery: 'pickup' | 'delivery' = 'pickup') {
  return t.db.one<{id: string}>(`
    insert into shop_orders
      (client_id, created_by, items, goods_total, delivery, delivery_price,
       total, address, payment, status)
    values ($1,$1,'[]'::jsonb,1000,$3,0,1000,$4,'on_receipt',$2)
    returning id`,
    [userId, status, delivery, delivery === 'delivery' ? 'Тестовый адрес' : null]);
}

test('privacy deletion waits for open shop orders, including work begun during grace period',
  {timeout: 90000}, async () => {
  const t=await setup();
  try {
    const buyer=await t.login('+79997778031');
    const item=await shopFixture(t,buyer.id,'new');
    assert.ok(item?.id);
    const before=await t.api('POST','/api/me/delete',{},buyer.token);
    assert.equal(before.status,409);
    assert.equal(before.body.error,'active_shop_orders');
    assert.equal(ok(await t.api('GET','/api/me/privacy',undefined,buyer.token)).deleteRequestedAt,null);
    await t.db.query("update shop_orders set status='done' where id=$1",[item!.id]);
    const request=ok(await t.api('POST','/api/me/delete',{},buyer.token));
    assert.ok(request.deleteRequestedAt);

    // Requests can be placed while a grace period is active; the scheduled
    // deletion MUST recheck commitments, not blindly erase an active buyer.
    const after=await shopFixture(t,buyer.id,'ready');
    t.clock.advance(31 * 86400);
    assert.equal(await t.app.privacy.processDeletions(),0);
    assert.equal((await t.db.one<{deleted_at:Date|null}>(
      'select deleted_at from users where id=$1',[buyer.id]))?.deleted_at,null);
    assert.equal((await t.db.one<{n:number}>(
      'select count(*)::int as n from sessions where user_id=$1',[buyer.id]))?.n,1);
    await t.db.query("update shop_orders set status='done' where id=$1",[after!.id]);
    assert.equal(await t.app.privacy.processDeletions(),1);
    assert.equal(await t.app.privacy.processDeletions(),0);
  } finally {await t.close();}
});

test('inspection request remains visible while pending and blocks account erasure',
  {timeout: 90000}, async () => {
  const t=await setup();
  try {
    const customer=await t.login('+79997778032');
    const v=ok(await t.api('POST','/api/vehicles',
      {brand:'Scania',model:'R',year:2011,plate:'А111АА78'},customer.token));
    const request=ok(await t.api('POST','/api/vehicle-service-requests',
      {vehicleId:v.id,kind:'inspection',comment:'Тестовый осмотр'},customer.token));
    assert.equal(request.kind,'inspection');
    const active=await t.api('POST','/api/me/delete',{},customer.token);
    assert.equal(active.status,409);
    assert.equal(active.body.error,'active_vehicle_requests');
    await t.db.query("update vehicle_service_requests set status='cancelled' where id=$1",[request.id]);
    assert.ok(ok(await t.api('POST','/api/me/delete',{},customer.token)).deleteRequestedAt);
  } finally {await t.close();}
});

test('open workshop bookings block both customer and station owner without altering the booking',
  {timeout: 90000}, async () => {
  const t=await setup();
  try {
    const customer=await t.login('+79997778033');
    const station=await t.login('+79997778034','service');
    ok(await t.api('PUT','/api/base',
      {name:'Тестовая рембаза',address:'Промзона 1, Санкт-Петербург'},station.token));
    const center=await t.db.one<{id:string}>('select id from service_centers where owner_id=$1',[station.id]);
    assert.ok(center?.id);
    await t.db.query("update service_centers set verification='approved' where id=$1",[center!.id]);
    const booking=ok(await t.api('POST',`/api/services/${center!.id}/book`,
      {need:'electric',day:'2026-12-09',arrival:'self'},customer.token));
    assert.ok(booking.id);
    const clientDenied=await t.api('POST','/api/me/delete',{},customer.token);
    assert.equal(clientDenied.status,409);
    assert.equal(clientDenied.body.error,'active_service_bookings');
    const stationDenied=await t.api('POST','/api/me/delete',{},station.token);
    assert.equal(stationDenied.status,409);
    assert.equal(stationDenied.body.error,'active_service_bookings');
    assert.equal((await t.db.one<{status:string}>(
      'select status from service_bookings where id=$1',[booking.id]))?.status,'new');
    await t.db.query("update service_bookings set status='cancelled' where id=$1",[booking.id]);
    assert.ok(ok(await t.api('POST','/api/me/delete',{},customer.token)).deleteRequestedAt);
    assert.ok(ok(await t.api('POST','/api/me/delete',{},station.token)).deleteRequestedAt);
  } finally {await t.close();}
});

test('assigned courier cannot be deleted before handing off their active delivery',
  {timeout: 90000}, async () => {
  const t=await setup();
  try {
    const admin=await t.login('+79990000001');
    const buyer=await t.login('+79997778035');
    const courier=await t.login('+79997778036');
    // Courier roles are staff-approved, not self-registered.
    await t.db.query("update users set roles=array['courier']::text[] where id=$1",[courier.id]);
    const o=await shopFixture(t,buyer.id,'ready','delivery');
    assert.ok(o?.id);
    const assigned=ok(await t.api('POST',`/api/admin/shop/orders/${o!.id}/courier`,
      {courierId:courier.id},admin.token));
    assert.ok(assigned);
    const refused=await t.api('POST','/api/me/delete',{},courier.token);
    assert.equal(refused.status,409);
    assert.equal(refused.body.error,'active_courier_deliveries');
    const status=await t.db.one<{status:string}>(
      'select status from shop_courier_deliveries where shop_order_id=$1',[o!.id]);
    assert.equal(status?.status,'assigned');
    await t.db.query("update shop_courier_deliveries set status='cancelled' where shop_order_id=$1",[o!.id]);
    assert.ok(ok(await t.api('POST','/api/me/delete',{},courier.token)).deleteRequestedAt);
  } finally {await t.close();}
});
