import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, ok } from './helpers.ts';

async function fixture() {
  const t = await setup();
  const admin = await t.login('+79990000001');
  const client = await t.login('+79998880071');
  const master = await t.login('+79998880072','master');
  ok(await t.api('PUT','/api/performer/profile',{
    kind:'master',name:'Тестовый мастер',specialties:['electric'],
    taxStatus:'self_employed',inn:'780000000555',
  },master.token));
  ok(await t.api('POST',`/api/admin/performers/${master.id}/verify`,
    {decision:'approved'},admin.token));
  ok(await t.api('POST','/api/performer/line',{lineStatus:'online'},master.token));
  ok(await t.api('PUT','/api/admin/settings/payments',{online:true},admin.token));

  async function orderBeforeConfirmation() {
    const created = ok(await t.api('POST','/api/orders',
      {service:'electric',zoneId:'spb',paymentMethod:'online'},client.token));
    const id=created.order.id as string;
    ok(await t.api('POST',`/api/dev/mock-pay/${created.confirmationUrl.split('/').pop()}`));
    ok(await t.api('POST',`/api/orders/${id}/offers`,{},master.token));
    const offers=ok(await t.api('GET',`/api/orders/${id}/offers`,undefined,client.token));
    ok(await t.api('POST',`/api/orders/${id}/offers/${offers.offers[0].id}/choose`,{},client.token));
    ok(await t.api('POST',`/api/orders/${id}/step`,{action:'arrive'},master.token));
    await t.db.query("update orders set estimate=estimate - 'hour' where id=$1",[id]);
    ok(await t.api('POST',`/api/orders/${id}/amount`,
      {extras:[{name:'Детали',amount:75000}],result:'solved'},master.token));
    return id;
  }
  async function confirm(id:string) {
    return t.api('POST',`/api/orders/${id}/confirm`,{},client.token);
  }
  async function state(id:string) {
    return t.db.one<any>(
      `select i.*,p.status as payment_status,p.provider_payment_id,p.total as payment_total
        from payment_create_intents i join payments p on p.id=i.payment_id
        where i.order_id=$1`,[id]);
  }
  return {t,admin,client,master,orderBeforeConfirmation,confirm,state};
}

test('work payment: bank created, HTTP response lost, retry with original key once', {timeout:60000}, async()=>{
  const f=await fixture();
  try{
    const id=await f.orderBeforeConfirmation();
    const original=f.t.payments.createPayment.bind(f.t.payments);
    let sent=0;
    f.t.payments.createPayment=async req=>{
      const result=await original(req);
      if(req.capture){sent++;throw new Error('lost bank response after successful creation');}
      return result;
    };
    try {
      assert.equal((await f.confirm(id)).status,200);
      const intent=await f.state(id);
      assert.equal(intent.status,'needs_review');
      assert.equal(intent.provider_payment_id,null);
      assert.equal(intent.attempts,1);
      assert.equal(sent,1);
      assert.equal(f.t.payments.payments.size,2,'only one call-out and one work payment');
      assert.equal((await f.t.db.query('select id from payouts where order_id=$1',[id])).length,0);
      assert.equal((await f.t.api('GET','/api/admin/payment-creations',undefined,f.client.token)).status,403);
      const pending=ok(await f.t.api('GET','/api/admin/payment-creations',undefined,f.admin.token));
      assert.equal(pending.filter((x:any)=>x.payment_id===intent.payment_id).length,1);

      f.t.payments.createPayment=original;
      await f.t.db.query(
        "update payment_create_intents set last_attempt_at=now()-interval '2 minutes', checked_at=now()-interval '2 minutes' where id=$1",
        [intent.id]);
      const retry=await f.t.app.payments.reconcileWorkPayment(intent.payment_id);
      assert.equal(retry,'ready');
      const recovered=await f.state(id);
      assert.equal(recovered.status,'ready');
      assert.ok(recovered.provider_payment_id);
      assert.equal(f.t.payments.payments.size,2,'identical idempotence key cannot create new transaction');
      const again=await Promise.all(Array.from({length:12},
        ()=>f.t.app.payments.reconcileWorkPayment(intent.payment_id)));
      assert.ok(again.every(x=>x==='ready'));
      const payment=await f.t.db.one<any>('select * from payments where id=$1',[intent.payment_id]);
      f.t.payments.simulate(payment.provider_payment_id,'captured');
      const events=await Promise.all(Array.from({length:12},
        ()=>f.t.api('POST','/api/payments/webhook',{paymentId:payment.provider_payment_id})));
      assert.ok(events.every(x=>x.status===200),JSON.stringify(events));
      assert.equal((await f.t.db.query('select id from payouts where order_id=$1',[id])).length,1);
      assert.equal((await f.t.db.query(
        "select id from order_events where order_id=$1 and type='paid'",[id])).length,1);
    } finally {f.t.payments.createPayment=original;}
  }finally{await f.t.close();}
});

test('work payment: bank creation succeeds, SQL bind rolls back, same-key recovery succeeds', {timeout:60000},async()=>{
  const f=await fixture();
  try{
    const id=await f.orderBeforeConfirmation();
    await f.t.db.exec(`create function reject_work_payment_bind() returns trigger as $$
      begin if new.kind='work' and new.provider_payment_id is not null then
        raise exception 'forced SQL rollback after provider creation'; end if;
        return new; end $$ language plpgsql;
      create trigger work_payment_bind_fails before update on payments
        for each row execute function reject_work_payment_bind();`);
    assert.equal((await f.confirm(id)).status,200);
    const pending=await f.state(id);
    assert.equal(pending.status,'needs_review');
    assert.equal(pending.provider_payment_id,null);
    assert.equal(f.t.payments.payments.size,2);
    await f.t.db.exec(
      'drop trigger work_payment_bind_fails on payments; drop function reject_work_payment_bind();');
    await f.t.db.query(
      "update payment_create_intents set last_attempt_at=now()-interval '2 minutes' where id=$1",
      [pending.id]);
    assert.equal(await f.t.app.payments.reconcileWorkPayment(pending.payment_id),'ready');
    assert.equal(f.t.payments.payments.size,2);
    assert.ok((await f.state(id)).provider_payment_id);
  }finally{await f.t.close();}
});

test('work payment: webhook before original response recovers by verified metadata', {timeout:60000},async()=>{
  const f=await fixture();
  try{
    const id=await f.orderBeforeConfirmation();
    const original=f.t.payments.createPayment.bind(f.t.payments);
    let firstWebhook:any;
    f.t.payments.createPayment=async req=>{
      const result=await original(req);
      if(req.capture){
        f.t.payments.simulate(result.id,'captured');
        firstWebhook=await f.t.api('POST','/api/payments/webhook',{paymentId:result.id});
      }
      return result;
    };
    try {
      const answer=await f.confirm(id);
      assert.equal(answer.status,200,JSON.stringify(answer));
      assert.equal(firstWebhook?.status,200,JSON.stringify(firstWebhook));
      const intent=await f.state(id);
      assert.equal(intent.status,'ready');
      assert.ok(intent.provider_payment_id);
      assert.equal(f.t.payments.payments.size,2);
      assert.equal((await f.t.db.query('select id from payouts where order_id=$1',[id])).length,1);
      assert.equal((await f.t.db.query(
        "select id from order_events where order_id=$1 and type='paid'",[id])).length,1);
    }finally{f.t.payments.createPayment=original;}
  }finally{await f.t.close();}
});

test('work payment: expired bank idempotence window blocks retry even for admin', {timeout:60000},async()=>{
  const f=await fixture();
  try{
    const id=await f.orderBeforeConfirmation();
    const original=f.t.payments.createPayment.bind(f.t.payments);
    let attempts=0;
    f.t.payments.createPayment=async req=>{
      const result=await original(req);
      if(req.capture){attempts++;throw new Error('lost response');}
      return result;
    };
    try {
      assert.equal((await f.confirm(id)).status,200);
      const intent=await f.state(id);
      await f.t.db.query(
        `update payment_create_intents set first_sent_at=now()-interval '25 hours',
          last_attempt_at=now()-interval '2 hours',checked_at=now()-interval '2 hours'
          where id=$1`,[intent.id]);
      assert.equal(await f.t.app.payments.reconcileWorkPayment(intent.payment_id),'not_claimed');
      assert.equal(attempts,1,'no unsafe second creation beyond provider guarantee');
      assert.equal(f.t.payments.payments.size,2);
      assert.equal((await f.state(id)).status,'needs_review');
    }finally{f.t.payments.createPayment=original;}
  }finally{await f.t.close();}
});
