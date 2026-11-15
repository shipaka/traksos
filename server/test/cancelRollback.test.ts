import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, ok } from './helpers.ts';

test('cancel: bank capture succeeds but SQL payout insert fails; recovery books money once', {timeout:60000}, async () => {
  const t=await setup();
  try {
    const admin=await t.login('+79990000001');
    const client=await t.login('+79998888881');
    const master=await t.login('+79998888882','master');
    ok(await t.api('PUT','/api/performer/profile',{
      kind:'master',name:'Проверка отката',specialties:['electric'],
      taxStatus:'self_employed',inn:'780000000555'},master.token));
    ok(await t.api('POST',`/api/admin/performers/${master.id}/verify`,{decision:'approved'},admin.token));
    ok(await t.api('POST','/api/performer/line',{lineStatus:'online'},master.token));
    ok(await t.api('PUT','/api/admin/settings/payments',{online:true},admin.token));
    const o=ok(await t.api('POST','/api/orders',
      {service:'electric',zoneId:'spb',paymentMethod:'online'},client.token));
    const id=o.order.id;
    const pay=await t.db.one<any>("select * from payments where order_id=$1 and kind='call_out'",[id]);
    ok(await t.api('POST',`/api/dev/mock-pay/${pay.provider_payment_id}`));
    ok(await t.api('POST',`/api/orders/${id}/offers`,{},master.token));
    const offers=ok(await t.api('GET',`/api/orders/${id}/offers`,undefined,client.token));
    ok(await t.api('POST',`/api/orders/${id}/offers/${offers.offers[0].id}/choose`,{},client.token));
    await t.db.exec(`create function reject_cancel_payout() returns trigger as $$
      begin raise exception 'injected SQL failure'; end $$ language plpgsql;
      create trigger reject_cancel_payout_before before insert on payouts
      for each row execute function reject_cancel_payout();`);
    const real=t.payments.capture.bind(t.payments);
    let count=0;
    t.payments.capture=async (pid,amount)=>{
      if(pid===pay.provider_payment_id) count++;
      return real(pid,amount);
    };
    try {
      const result=ok(await t.api('POST',`/api/orders/${id}/cancel`,
        {reason:'Отмена после принятия'},client.token));
      assert.equal(result.status,'cancelled');
      assert.equal(count,1);
      const intent=await t.db.one<any>('select * from payment_cancel_intents where order_id=$1',[id]);
      assert.equal(intent.status,'needs_review');
      assert.equal((await t.db.query('select id from payouts where order_id=$1',[id])).length,0);
      assert.equal((await t.db.query('select id from ledger_entries where order_id=$1',[id])).length,0);
      await t.db.exec('drop trigger reject_cancel_payout_before on payouts; drop function reject_cancel_payout();');
      assert.equal(await t.app.payments.reconcileCancellation(intent.id),'settled');
      assert.equal(await t.app.payments.reconcileCancellation(intent.id),'settled');
      assert.equal(count,1,'provider capture not repeated after DB rollback');
      assert.equal((await t.db.query('select id from payouts where order_id=$1',[id])).length,1);
      assert.equal((await t.db.query('select id from ledger_entries where order_id=$1',[id])).length,3);
      assert.equal((await t.db.one<any>('select status from payments where id=$1',[pay.id])).status,'partially_refunded');
    } finally {t.payments.capture=real;}
  } finally {await t.close();}
});
