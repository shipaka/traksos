import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, ok } from './helpers.ts';

test('SOS hold: bank created payment then response lost; same idempotence key recovers it', {timeout:60000},async()=>{
  const t=await setup();
  try {
    const admin=await t.login('+79990000001');
    const client=await t.login('+79998883331');
    ok(await t.api('PUT','/api/admin/settings/payments',{online:true},admin.token));
    const original=t.payments.createPayment.bind(t.payments);
    let sent=0;
    t.payments.createPayment=async req=>{
      const response=await original(req);
      if(!req.capture){sent++;throw new Error('hold created but network response lost');}
      return response;
    };
    try {
      const created=ok(await t.api('POST','/api/orders',
        {service:'electric',zoneId:'spb',paymentMethod:'online'},client.token));
      const id=created.order.id;
      assert.equal(created.confirmationUrl,null);
      const intent=await t.db.one<any>(
        "select i.*,p.provider_payment_id,p.status as payment_status from payment_create_intents i join payments p on p.id=i.payment_id where i.order_id=$1",
        [id]);
      assert.equal(intent.status,'needs_review');
      assert.equal(intent.provider_payment_id,null);
      assert.equal(sent,1);
      assert.equal(t.payments.payments.size,1);
      t.payments.createPayment=original;
      await t.db.query("update payment_create_intents set last_attempt_at=now()-interval '2 minutes' where id=$1",[intent.id]);
      assert.equal(await t.app.payments.reconcileWorkPayment(intent.payment_id),'ready');
      const pay=await t.db.one<any>('select * from payments where id=$1',[intent.payment_id]);
      assert.ok(pay.provider_payment_id);
      assert.ok(pay.confirmation_url);
      assert.equal(t.payments.payments.size,1,'the hold is the original bank transaction');
      ok(await t.api('POST',`/api/dev/mock-pay/${pay.provider_payment_id}`));
      assert.equal((await t.db.one<any>('select status from payments where id=$1',[pay.id])).status,'held');
    }finally {t.payments.createPayment=original;}
  }finally {await t.close();}
});

test('SOS hold: webhook arrives before create reply and securely binds provider id once', {timeout:60000},async()=>{
  const t=await setup();
  try {
    const admin=await t.login('+79990000001');
    const client=await t.login('+79998883332');
    ok(await t.api('PUT','/api/admin/settings/payments',{online:true},admin.token));
    const original=t.payments.createPayment.bind(t.payments);
    let hook:any;
    t.payments.createPayment=async req=>{
      const response=await original(req);
      if(!req.capture){
        t.payments.simulate(response.id,'held');
        hook=await t.api('POST','/api/payments/webhook',{paymentId:response.id});
      }
      return response;
    };
    try {
      const created=ok(await t.api('POST','/api/orders',
        {service:'electric',zoneId:'spb',paymentMethod:'online'},client.token));
      assert.equal(hook?.status,200,JSON.stringify(hook));
      assert.equal(created.order.id.length,36);
      const pay=await t.db.one<any>("select * from payments where order_id=$1 and kind='call_out'",[created.order.id]);
      assert.equal(pay.status,'held');
      assert.ok(pay.provider_payment_id);
      assert.equal(t.payments.payments.size,1);
      const same=await Promise.all(Array.from({length:12},
        ()=>t.api('POST','/api/payments/webhook',{paymentId:pay.provider_payment_id})));
      assert.ok(same.every(x=>x.status===200),JSON.stringify(same));
      assert.equal(t.payments.payments.size,1);
    }finally {t.payments.createPayment=original;}
  }finally {await t.close();}
});

test('SOS hold: provider success then local SQL rollback is recovered with same key', {timeout:60000},async()=>{
  const t=await setup();
  try {
    const admin=await t.login('+79990000001');
    const client=await t.login('+79998883333');
    ok(await t.api('PUT','/api/admin/settings/payments',{online:true},admin.token));
    await t.db.exec(`create function reject_hold_bind() returns trigger as $$
      begin if new.kind='call_out' and new.provider_payment_id is not null then
        raise exception 'forced hold bind rollback'; end if;
        return new; end $$ language plpgsql;
      create trigger hold_bind_fails before update on payments
        for each row execute function reject_hold_bind();`);
    const created=ok(await t.api('POST','/api/orders',
      {service:'electric',zoneId:'spb',paymentMethod:'online'},client.token));
    const intent=await t.db.one<any>(
      'select * from payment_create_intents where order_id=$1',[created.order.id]);
    assert.equal(intent.status,'needs_review');
    assert.equal(t.payments.payments.size,1);
    await t.db.exec('drop trigger hold_bind_fails on payments; drop function reject_hold_bind();');
    await t.db.query("update payment_create_intents set last_attempt_at=now()-interval '2 minutes' where id=$1",[intent.id]);
    assert.equal(await t.app.payments.reconcileWorkPayment(intent.payment_id),'ready');
    assert.equal(t.payments.payments.size,1);
  }finally {await t.close();}
});
