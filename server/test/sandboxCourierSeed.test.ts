// Regression for the real sandbox courier fixture SQL; disposable PostgreSQL only.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setup } from './helpers.ts';
import { seedSandboxCourierSample } from '../src/seedSandbox.ts';
import { SANDBOX_USER_PHONE } from '../src/services/sandboxTickets.ts';

test('parallel sandbox courier fixture creation is atomic and repeated seeding preserves history', async () => {
  const t = await setup();
  try {
    assert.equal(t.db.driver, 'pg');
    const add = async (phone: string, role: string) => {
      const user = await t.db.one<{id:string}>(
        'insert into users(phone,roles,name) values ($1,$2::text[],$3) returning id',
        [phone, [role], 'Disposable sandbox fixture']);
      assert.ok(user);
      return user.id;
    };
    const buyer = await add(SANDBOX_USER_PHONE.client, 'client');
    const courier = await add(SANDBOX_USER_PHONE.courier, 'courier');
    const dispatcher = await add(SANDBOX_USER_PHONE.admin, 'admin');
    const marker = 'TRAKSOS_SANDBOX_COURIER_SAMPLE_20261120';
    const run = () => seedSandboxCourierSample(t.db, buyer, courier, dispatcher);
    const readOrders = () => t.db.query('select * from shop_orders where comment=$1', [marker]);
    const readProducts = () => t.db.query(
      "select * from shop_products where spec='Тестовый товар — не продаётся'");
    const readDeliveries = (id: string) => t.db.query(
      'select * from shop_courier_deliveries where shop_order_id=$1', [id]);

    await Promise.all(Array.from({length: 6}, run));
    const orders = await readOrders();
    const products = await readProducts();
    assert.equal(orders.length, 1);
    assert.equal(products.length, 1);
    const sample = orders[0];
    assert.equal(sample.client_id, buyer);
    assert.equal(Number(sample.total), 0);
    assert.equal(products[0].active, false);
    const deliveries = await readDeliveries(sample.id);
    assert.equal(deliveries.length, 1);
    assert.equal(deliveries[0].courier_id, courier);
    assert.equal(deliveries[0].assigned_by, dispatcher);

    // A second run must not restore an already edited address or reset courier presence.
    await t.db.query('update shop_orders set address=$2 where id=$1',
      [sample.id, 'Изменённый учебный адрес']);
    await t.db.query('update shop_courier_presence set online=false where courier_id=$1', [courier]);
    const before = await readOrders();
    const presence = await t.db.one('select * from shop_courier_presence where courier_id=$1', [courier]);
    assert.equal(presence?.online, false);
    await Promise.all([run(), run()]);
    assert.deepEqual(await readOrders(), before);
    assert.deepEqual(await readProducts(), products);
    assert.deepEqual(await readDeliveries(sample.id), deliveries);
    assert.deepEqual(await t.db.one('select * from shop_courier_presence where courier_id=$1', [courier]), presence);
  } finally {
    await t.close();
  }
});
