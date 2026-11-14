import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, ok } from './helpers.ts';

async function enableOnline(t: Awaited<ReturnType<typeof setup>>) {
  const admin = await t.login('+79990000001');
  const client = await t.login('+79998886661');
  ok(await t.api('PUT','/api/admin/settings/payments',{ online:true },admin.token));
  return {admin,client};
}

test('SOS: cancellation before bank create is claimed abandons hold and never sends later', {timeout:60000}, async()=>{
  const t=await setup();
  try{
    const {client}=await enableOnline(t);
    const send=t.app.payments.processCallOutPaymentForOrder.bind(t.app.payments);
    t.app.payments.processCallOutPaymentForOrder=async()=>null;
    try {
      const created=ok(await t.api('POST','/api/orders',
        {service:'electric',zoneId:'spb',paymentMethod:'online',isSos:true},client.token));
      assert.equal(created.confirmationUrl,null);
      const id=created.order.id;
      const initial=await t.db.one<any>(
        'select * from payment_create_intents where order_id=$1',[id]);
      assert.equal(initial.status,'prepared');
      const cancel=ok(await t.api('POST',`/api/orders/${id}/cancel`,
        {reason:'Ошибочная заявка'},client.token));
      assert.equal(cancel.status,'cancelled');
      assert.equal(cancel.cancelStage,'searching');
      assert.equal((await t.db.one<any>(
        'select status from payment_create_intents where id=$1',[initial.id])).status,'abandoned');
      assert.equal((await t.db.one<any>(
        "select status from payments where order_id=$1 and kind='call_out'",[id])).status,'cancelled');
      assert.equal(t.payments.payments.size,0);
      assert.equal((await t.db.query('select id from payment_cancel_intents where order_id=$1',[id])).length,0);
      assert.equal(await t.app.payments.reconcileWorkPayment(initial.payment_id),'abandoned');
      assert.equal((await t.app.payments.reconcileWorkCreations()).length,0);
      assert.equal(t.payments.payments.size,0,'cancelled unsubmitted SOS can never create bank money');
      assert.equal((await t.db.query('select id from payouts where order_id=$1',[id])).length,0);
      assert.equal((await t.api('POST',`/api/orders/${id}/retry`,{},client.token)).status,409);
    } finally {t.app.payments.processCallOutPaymentForOrder=send;}
  } finally {await t.close();}
});

test('SOS: customer cancels during in-flight bank POST, the late hold is cancelled once', {timeout:60000},async()=>{
  const t=await setup();
  try{
    const {client}=await enableOnline(t);
    const original=t.payments.createPayment.bind(t.payments);
    let started!: ()=>void;
    const bankStarted=new Promise<void>(r=>{started=r;});
    let release!: ()=>void;
    const bankGate=new Promise<void>(r=>{release=r;});
    t.payments.createPayment=async p=>{
      if(!p.capture){started();await bankGate;}
      return original(p);
    };
    try{
      const submitted=t.api('POST','/api/orders',
        {service:'electric',isSos:true,zoneId:'spb',paymentMethod:'online'},client.token);
      await bankStarted;
      const order=await t.db.one<any>('select id from orders where created_by=$1',[client.id]);
      assert.ok(order);
      const cancelled=ok(await t.api('POST',`/api/orders/${order.id}/cancel`,
        {reason:'Отмена до оплаты'},client.token));
      assert.equal(cancelled.status,'cancelled');
      assert.equal(cancelled.cancelStage,'searching');
      assert.equal((await t.db.one<any>(
        'select status from payment_create_intents where order_id=$1',[order.id])).status,'sending');
      release();
      const answer=ok(await submitted);
      assert.equal(answer.order.status,'cancelled');
      assert.ok(!answer.confirmationUrl,'do not redirect a cancelled order to the bank');
      const pay=await t.db.one<any>(
        "select * from payments where order_id=$1 and kind='call_out'",[order.id]);
      assert.ok(pay.provider_payment_id);
      assert.equal(pay.status,'cancelled');
      const intent=await t.db.one<any>(
        'select * from payment_cancel_intents where order_id=$1',[order.id]);
      assert.equal(intent.status,'settled');
      assert.equal(intent.action,'cancel');
      assert.equal(intent.amount_to_capture,0);
      assert.equal(t.payments.payments.size,1);
      assert.equal(t.payments.payments.get(pay.provider_payment_id)?.status,'cancelled');
      assert.equal((await t.db.query('select id from payouts where order_id=$1',[order.id])).length,0);
      assert.equal((await t.db.query('select id from order_dispatch where order_id=$1',[order.id])).length,0);
      assert.equal((await t.db.query("select id from ledger_entries where order_id=$1",[order.id])).length,0);
      assert.deepEqual(await t.app.payments.reconcileCancelledHolds(),[]);
    } finally {release(); t.payments.createPayment=original;}
  } finally {await t.close();}
});

test('SOS: unknown bank-create response followed by cancellation safely replays only original key', {timeout:60000},async()=>{
  const t=await setup();
  try{
    const {client}=await enableOnline(t);
    const original=t.payments.createPayment.bind(t.payments);
    let sent=0;
    t.payments.createPayment=async p=>{
      const result=await original(p);
      if(!p.capture){sent++;throw new Error('bank hold created, response lost');}
      return result;
    };
    try{
      const made=ok(await t.api('POST','/api/orders',
        {service:'electric',isSos:true,zoneId:'spb',paymentMethod:'online'},client.token));
      const orderId=made.order.id;
      const intent=await t.db.one<any>('select * from payment_create_intents where order_id=$1',[orderId]);
      assert.equal(intent.status,'needs_review');
      const cancelled=ok(await t.api('POST',`/api/orders/${orderId}/cancel`,
        {reason:'Клиент отменил поиск'},client.token));
      assert.equal(cancelled.status,'cancelled');
      assert.equal((await t.db.one<any>(
        'select status from payment_create_intents where order_id=$1',[orderId])).status,'needs_review');
      t.payments.createPayment=original;
      await t.db.query(
        "update payment_create_intents set last_attempt_at=now()-interval '2 minutes' where id=$1",
        [intent.id]);
      assert.equal(await t.app.payments.reconcileWorkPayment(intent.payment_id),'ready');
      const pay=await t.db.one<any>('select * from payments where id=$1',[intent.payment_id]);
      assert.equal(pay.status,'cancelled');
      assert.equal(t.payments.payments.size,1);
      assert.equal(sent,1);
      const after=await Promise.all(Array.from({length:12},
        ()=>t.api('POST','/api/payments/webhook',{paymentId:pay.provider_payment_id})));
      assert.ok(after.every(x=>x.status===200),JSON.stringify(after));
      assert.equal((await t.db.query('select id from payment_cancel_intents where order_id=$1',[orderId])).length,1);
      assert.equal((await t.db.query('select id from payouts where order_id=$1',[orderId])).length,0);
    } finally {t.payments.createPayment=original;}
  } finally {await t.close();}
});

test('SOS: no_performer allows free cancellation; retry and late offers cannot revive it', {timeout:60000},async()=>{
  const t=await setup();
  try{
    const client=await t.login('+79998886662');
    const created=ok(await t.api('POST','/api/orders',
      {service:'electric',zoneId:'spb',isSos:true,paymentMethod:'cash'},client.token));
    const orderId=created.order.id;
    const current=ok(await t.api('GET',`/api/orders/${orderId}`,undefined,client.token));
    assert.equal(current.status,'no_performer');
    assert.ok(current.actions.includes('cancel'));
    const cancelled=ok(await t.api('POST',`/api/orders/${orderId}/cancel`,
      {reason:'Больше не требуется'},client.token));
    assert.equal(cancelled.status,'cancelled');
    assert.equal(cancelled.cancelStage,'searching');
    assert.equal((await t.api('POST',`/api/orders/${orderId}/retry`,{},client.token)).status,409);
    assert.equal((await t.api('POST',`/api/orders/${orderId}/cancel`,
      {reason:'Снова'},client.token)).status,409);
    t.clock.advance(301);
    assert.equal(await t.app.auction.tick(),0);
    const final=ok(await t.api('GET',`/api/orders/${orderId}`,undefined,client.token));
    assert.equal(final.status,'cancelled');
    assert.equal((await t.db.query(
      "select id from order_events where order_id=$1 and type='cancelled'",[orderId])).length,1);
  } finally {await t.close();}
});
