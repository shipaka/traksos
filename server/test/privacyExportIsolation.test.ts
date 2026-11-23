import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, ok } from './helpers.ts';

test('personal data export includes account activity without exposing any other account',
  { timeout: 90000 }, async () => {
  const t=await setup();
  try {
    const admin=await t.login('+79990000001');
    const a=await t.login('+79997778041');
    const b=await t.login('+79997778042');

    const makeOrder=async(id:string,amount:number)=>t.db.one<{id:string}>(`
      insert into shop_orders
        (client_id,created_by,items,goods_total,delivery,delivery_price,total,
         address,payment,status)
      values ($1,$1,'[]'::jsonb,$2,'delivery',0,$2,'Тестовый адрес',
              'on_receipt','ready') returning id`,[id,amount]);
    const [shopA,shopB]=await Promise.all([makeOrder(a.id,1201),makeOrder(b.id,9453)]);
    assert.ok(shopA?.id&&shopB?.id);

    const vehicleA=ok(await t.api('POST','/api/vehicles',
      {brand:'Scania',year:2012,plate:'А141АА78'},a.token));
    const vehicleB=ok(await t.api('POST','/api/vehicles',
      {brand:'Volvo',year:2015,plate:'В242ВВ78'},b.token));
    ok(await t.api('POST','/api/vehicle-service-requests',
      {vehicleId:vehicleA.id,kind:'inspection',comment:'Only-account-A-inspection'},a.token));
    ok(await t.api('POST','/api/vehicle-service-requests',
      {vehicleId:vehicleB.id,kind:'inspection',comment:'Only-account-B-inspection'},b.token));

    ok(await t.api('POST','/api/support',
      {topic:'Другое',text:'Only-account-A-support'},a.token));
    ok(await t.api('POST','/api/support',
      {topic:'Другое',text:'Only-account-B-support'},b.token));

    // Courier records are deliberately exported without any buyer address,
    // receipt code, phone or items. The assignments remain private to each.
    await t.db.query("update users set roles=roles || '{courier}'::text[] where id=any($1::uuid[])",
      [[a.id,b.id]]);
    const courierA=ok(await t.api('POST',`/api/admin/shop/orders/${shopB!.id}/courier`,
      {courierId:a.id},admin.token));
    const courierB=ok(await t.api('POST',`/api/admin/shop/orders/${shopA!.id}/courier`,
      {courierId:b.id},admin.token));
    assert.ok(courierA.id&&courierB.id);

    const exportedA=ok(await t.api('GET','/api/me/export',undefined,a.token));
    const exportedB=ok(await t.api('GET','/api/me/export',undefined,b.token));
    const anonymous=await t.api('GET','/api/me/export');
    assert.equal(anonymous.status,401);

    assert.equal(exportedA.account.id,a.id);
    assert.equal(exportedB.account.id,b.id);
    assert.equal(exportedA.shopOrders.length,1);
    assert.equal(exportedB.shopOrders.length,1);
    assert.equal(exportedA.shopOrders[0].total,1201);
    assert.equal(exportedB.shopOrders[0].total,9453);
    assert.equal(exportedA.vehicleServiceRequests.length,1);
    assert.equal(exportedB.vehicleServiceRequests.length,1);
    assert.equal(exportedA.vehicleServiceRequests[0].comment,'Only-account-A-inspection');
    assert.equal(exportedB.vehicleServiceRequests[0].comment,'Only-account-B-inspection');
    assert.equal(exportedA.supportMessagesWritten.length,1);
    assert.equal(exportedB.supportMessagesWritten.length,1);
    assert.equal(exportedA.supportMessagesWritten[0].body,'Only-account-A-support');
    assert.equal(exportedB.supportMessagesWritten[0].body,'Only-account-B-support');
    assert.equal(exportedA.courierDeliveries.length,1);
    assert.equal(exportedB.courierDeliveries.length,1);
    assert.equal(exportedA.courierDeliveries[0].id,courierA.id);
    assert.equal(exportedB.courierDeliveries[0].id,courierB.id);
    for(const exported of [exportedA,exportedB]) {
      const delivery=JSON.stringify(exported.courierDeliveries);
      assert.doesNotMatch(delivery,/code_nonce|code_attempts|address|phone|vehicle_snapshot|shop_order_id/i,
        'Couriers may export their own progress but not buyer secrets');
    }
    const payloadA=JSON.stringify(exportedA);
    const payloadB=JSON.stringify(exportedB);
    assert.doesNotMatch(payloadA,/Only-account-B-inspection|Only-account-B-support|9453/);
    assert.doesNotMatch(payloadB,/Only-account-A-inspection|Only-account-A-support|1201/);
  } finally {await t.close();}
});
