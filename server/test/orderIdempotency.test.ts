import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, ok } from './helpers.ts';

test('12 concurrent SOS submits with same key create exactly ONE order and ONE bank hold',
  {timeout:60000},async()=>{
  const t=await setup();
  try {
    const admin=await t.login('+79990000001');
    const customer=await t.login('+79998884441');
    const another=await t.login('+79998884442');
    ok(await t.api('PUT','/api/admin/settings/payments',{online:true},admin.token));
    const key='order-test-concurrent-sos-123';
    const data={service:'electric',zoneId:'spb',paymentMethod:'online',description:'Повтор при плохой связи'};
    const send=async(user:{token:string},body:unknown=data)=> {
      const r=await fetch(t.base+'/api/orders',{
        method:'POST',
        headers:{'content-type':'application/json',authorization:`Bearer ${user.token}`,
          'idempotency-key':key},
        body:JSON.stringify(body),
      });
      return {status:r.status,body:await r.json()};
    };
    const copies=await Promise.all(Array.from({length:12},()=>send(customer)));
    assert.ok(copies.every(x=>x.status===200),JSON.stringify(copies));
    const ids=[...new Set(copies.map(x=>x.body.order.id))];
    assert.equal(ids.length,1,'same request key always maps to one SOS order');
    const orders=await t.db.query<any>('select id from orders where created_by=$1',[customer.id]);
    assert.equal(orders.length,1);
    const pays=await t.db.query<any>('select * from payments where order_id=$1',[ids[0]]);
    assert.equal(pays.length,1);
    assert.equal(pays[0].kind,'call_out');
    assert.equal(t.payments.payments.size,1);
    // Concurrent replays may return before the winning request has finished
    // obtaining the bank link. They must never return a *different* link.
    const urls=copies.map(x=>x.body.confirmationUrl).filter(Boolean);
    assert.ok(urls.every(u=>u===pays[0].confirmation_url));
    const createdEvents=await t.db.query<any>(
      "select id from order_events where order_id=$1 and type='created'",[ids[0]]);
    assert.equal(createdEvents.length,1);
    const changed=await send(customer,{...data,description:'Другая машина и другое обращение'});
    assert.equal(changed.status,409);
    assert.equal(changed.body.error,'idempotency_conflict');
    assert.equal((await t.db.query('select id from orders where created_by=$1',[customer.id])).length,1);
    const separately=await send(another);
    assert.equal(separately.status,200,'same key from another account is isolated');
    assert.notEqual(separately.body.order.id,ids[0]);
  } finally {await t.close();}
});
