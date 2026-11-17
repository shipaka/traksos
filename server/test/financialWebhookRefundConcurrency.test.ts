import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, ok } from './helpers.ts';

// #47: all money here is created in disposable PostgreSQL with MockProvider.
// No real bank, credentials, invoices or personal information are involved.
async function fixture() {
  const t=await setup();
  const customer=await t.login('+79997774702');
  const performer=await t.login('+79997774703','master');
  // The fixture admin number is explicitly allowlisted by helpers.ts.
  const adminAccount=await t.login('+79990000001');
  ok(await t.api('PUT','/api/performer/profile',{
    kind:'master',name:'Проверка возврата',specialties:['electric'],
    taxStatus:'self_employed',inn:'780000000555',
  },performer.token));
  ok(await t.api('POST',`/api/admin/performers/${performer.id}/verify`,
    {decision:'approved'},adminAccount.token));
  ok(await t.api('POST','/api/performer/line',{lineStatus:'online'},performer.token));
  ok(await t.api('PUT','/api/admin/settings/payments',{online:true},adminAccount.token));

  const newWork=async()=>{
    const created=ok(await t.api('POST','/api/orders',{
      service:'electric',zoneId:'spb',paymentMethod:'online',
    },customer.token));
    ok(await t.api('POST',`/api/dev/mock-pay/${created.confirmationUrl.split('/').pop()}`));
    ok(await t.api('POST',`/api/orders/${created.order.id}/offers`,{},performer.token));
    const offers=ok(await t.api('GET',`/api/orders/${created.order.id}/offers`,undefined,customer.token));
    ok(await t.api('POST',`/api/orders/${created.order.id}/offers/${offers.offers[0].id}/choose`,{},customer.token));
    ok(await t.api('POST',`/api/orders/${created.order.id}/step`,{action:'arrive'},performer.token));
    await t.db.query("update orders set estimate=estimate - 'hour' where id=$1",[created.order.id]);
    ok(await t.api('POST',`/api/orders/${created.order.id}/amount`,{
      extras:[{name:'Запчасти и работа',amount:80000}],result:'solved',
    },performer.token));
    ok(await t.api('POST',`/api/orders/${created.order.id}/confirm`,{},customer.token));
    const work=await t.db.one<any>(
      "select * from payments where order_id=$1 and kind='work'",[created.order.id]);
    assert.ok(work?.provider_payment_id);
    t.payments.simulate(work.provider_payment_id,'captured');
    return {orderId:created.order.id as string,work};
  };
  return {t,admin:adminAccount,customer,performer,newWork};
}

test('12 simultaneous captured work webhooks settle one payout, one paid event and balanced ledger',
  {timeout:60000},async()=>{
  const f=await fixture();
  try{
    const {orderId,work}=await f.newWork();
    const webhook=()=>f.t.api('POST','/api/payments/webhook',{paymentId:work.provider_payment_id});
    const replies=await Promise.all(Array.from({length:12},webhook));
    assert.ok(replies.every(r=>r.status===200),
      'webhook duplicates cannot fail: '+JSON.stringify(replies.map(x=>[x.status,x.body?.error])));
    const payouts=await f.t.db.query('select * from payouts where order_id=$1',[orderId]);
    const paidEvents=await f.t.db.query(
      "select id from order_events where order_id=$1 and type='paid'",[orderId]);
    const ledger=await f.t.db.query<any>(
      'select account,kind,amount from ledger_entries where order_id=$1',[orderId]);
    assert.equal(payouts.length,1,'only one performer payout');
    assert.equal(paidEvents.length,1,'only one paid event');
    assert.equal(ledger.filter(x=>x.kind==='earning').length,1,'one earning');
    assert.equal(ledger.filter(x=>x.kind==='payment').length,1,'one client debit');
    assert.equal(ledger.reduce((s,x)=>s+Number(x.amount),0),0,'double-entry ledger balances');
    assert.equal((await f.t.db.one<any>(
      'select status from payment_capture_intents where order_id=$1',[orderId]))?.status,
      'settled','one bank capture intent settled after concurrent webhooks');

    // #47: independent concurrent refund clicks must not send twelve external
    // transfers or book twelve sets of accounting.
    const req={amount:2500,from:'platform',reason:'Возврат согласованной части оплаты'};
    const refundUrl=`/api/admin/payments/${work.id}/refund`;
    const requests=await Promise.all(Array.from({length:12},()=>
      f.t.api('POST',refundUrl,req,f.admin.token)));
    assert.ok(requests.some(x=>x.status===200),'at least one refund request must complete');
    assert.ok(requests.every(x=>x.status===200 ||
      (x.status===409 && x.body.error==='refund_processing')),
      'concurrent duplicate clicks: '+JSON.stringify(requests.map(x=>[x.status,x.body?.error])));
    assert.equal(f.t.payments.refunds.size,1,'only one provider refund');
    const refundRows=await f.t.db.query<any>(
      'select * from payment_refund_requests where payment_id=$1',[work.id]);
    assert.equal(refundRows.length,1,'only one durable refund request');
    assert.equal(refundRows[0].status,'succeeded');
    assert.equal(Number(refundRows[0].amount),2500);
    const payment=await f.t.db.one<any>('select refunded_amount from payments where id=$1',[work.id]);
    assert.equal(Number(payment.refunded_amount),2500,'do not double account refund');
    const ledgerAfter=await f.t.db.query<any>('select amount from ledger_entries where order_id=$1',[orderId]);
    assert.equal(ledgerAfter.reduce((s,x)=>s+Number(x.amount),0),0,'balanced after refund');
    assert.equal((await f.t.db.query(
      "select id from order_events where order_id=$1 and type='paid'",[orderId])).length,1);
  }finally{await f.t.close()}
});

test('provider accepted refund but its HTTP response is lost: mark needs_review, do not resend',
  {timeout:60000},async()=>{
  const f=await fixture();
  try{
    const {work}=await f.newWork();
    ok(await f.t.api('POST','/api/payments/webhook',{paymentId:work.provider_payment_id}));
    const actual=f.t.payments.refund.bind(f.t.payments);
    let bankCalls=0;
    f.t.payments.refund=async(id,amount,key)=>{
      bankCalls++;
      await actual(id,amount,key);
      throw new Error('connection dropped after bank issued refund');
    };
    const body={amount:1400,from:'platform',reason:'Сбой ответа банка после возврата'};
    try{
      const first=await f.t.api('POST',`/api/admin/payments/${work.id}/refund`,body,f.admin.token);
      assert.equal(first.status,409);
      assert.equal(first.body.error,'refund_unknown');
      const pending=await f.t.db.query<any>(
        'select * from payment_refund_requests where payment_id=$1',[work.id]);
      assert.equal(pending.length,1);
      assert.equal(pending[0].status,'needs_review');
      assert.equal(Number((await f.t.db.one<any>(
        'select refunded_amount from payments where id=$1',[work.id]))?.refunded_amount),0,
        'unverified provider response never counts as completed refund');
      const retries=await Promise.all(Array.from({length:12},()=>
        f.t.api('POST',`/api/admin/payments/${work.id}/refund`,body,f.admin.token)));
      assert.ok(retries.every(r=>r.status===409&&r.body.error==='refund_processing'),
        'unknown outcome must remain blocked for review');
      assert.equal(bankCalls,1,'never repeat external refund while outcome is unknown');
      assert.equal(f.t.payments.refunds.size,1,'bank accepted just one refund');
    }finally{f.t.payments.refund=actual}
  }finally{await f.t.close()}
});
