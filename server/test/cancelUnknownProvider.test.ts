import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, ok } from './helpers.ts';

test('cancel before bank hold: unknown provider response requires GET-only reconciliation', {timeout:60000}, async () => {
  const t = await setup();
  try {
    const admin = await t.login('+79990000001');
    const client = await t.login('+79998887771');
    ok(await t.api('PUT','/api/admin/settings/payments',{online:true},admin.token));
    const created = ok(await t.api('POST','/api/orders',
      {service:'electric',zoneId:'spb',paymentMethod:'online'},client.token));
    const id = created.order.id;
    const pay = await t.db.one<any>("select * from payments where order_id=$1 and kind='call_out'",[id]);
    assert.equal(pay.status,'pending');
    const real = t.payments.cancel.bind(t.payments);
    let calls=0;
    t.payments.cancel = async pId => {
      if(pId!==pay.provider_payment_id) return real(pId);
      calls++;
      await real(pId);
      throw new Error('bank cancelled hold but lost reply');
    };
    try {
      const result=ok(await t.api('POST',`/api/orders/${id}/cancel`,
        {reason:'Ошибочный вызов'},client.token));
      assert.equal(result.status,'cancelled');
      const intent=await t.db.one<any>('select * from payment_cancel_intents where order_id=$1',[id]);
      assert.equal(intent.action,'cancel');
      assert.equal(intent.status,'needs_review');
      assert.equal(calls,1);
      assert.equal((await t.db.one<any>('select status from payments where id=$1',[pay.id])).status,'pending');
      assert.equal(await t.app.payments.reconcileCancellation(intent.id),'settled');
      assert.equal(await t.app.payments.reconcileCancellation(intent.id),'settled');
      assert.equal(calls,1);
      assert.equal((await t.db.one<any>('select status from payments where id=$1',[pay.id])).status,'cancelled');
      assert.equal((await t.db.query('select id from ledger_entries where order_id=$1',[id])).length,0);
    } finally { t.payments.cancel=real; }
  } finally { await t.close(); }
});
