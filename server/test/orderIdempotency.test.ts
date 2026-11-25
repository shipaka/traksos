import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
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
    const data={service:'electric',regionId:'spb',zoneId:'spb',address:'Санкт-Петербург, тестовая парковка',paymentMethod:'online',description:'Повтор при плохой связи'};
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
    // The browser canonicalizes field order to reuse the same key after an
    // ambiguous network response. The server must agree with that canonical
    // meaning, not the order in which the form built the JSON properties.
    const reordered=Object.fromEntries(Object.entries(data).reverse());
    const replay=await send(customer,reordered);
    assert.equal(replay.status,200,'reordered but identical fields are the same request');
    assert.equal(replay.body.order.id,ids[0]);
    assert.equal((await t.db.query('select id from orders where created_by=$1',[customer.id])).length,1);
    assert.equal(t.payments.payments.size,1,'a harmless replay must not reserve money twice');
    const changed=await send(customer,{...data,description:'Другая машина и другое обращение'});
    assert.equal(changed.status,409);
    assert.equal(changed.body.error,'idempotency_conflict');
    assert.equal((await t.db.query('select id from orders where created_by=$1',[customer.id])).length,1);
    const separately=await send(another);
    assert.equal(separately.status,200,'same key from another account is isolated');
    assert.notEqual(separately.body.order.id,ids[0]);
    // A pre-upgrade stored hash used JSON.stringify without sorting. Replays
    // of such orders must remain valid after deploying canonical hashing.
    // Historical service hashes were computed AFTER Zod parsing, which puts
    // fields in the declared API schema order (not the incoming wire order).
    const legacyParsed={
      service:data.service,description:data.description,address:data.address,
      zoneId:data.zoneId,regionId:data.regionId,paymentMethod:data.paymentMethod,
    };
    const legacyHash=createHash('sha256').update(JSON.stringify(legacyParsed)).digest('hex');
    await t.db.query('update orders set create_request_hash=$1 where id=$2',[legacyHash,separately.body.order.id]);
    const legacyReplay=await send(another);
    assert.equal(legacyReplay.status,200,'existing raw-JSON fingerprints remain replayable');
    assert.equal(legacyReplay.body.order.id,separately.body.order.id);
    // The HTTP endpoint uses Zod, which rebuilds objects in schema order.
    // Exercise OrdersService itself so this regression really covers the
    // previously non-canonical nested input rather than just Zod parsing.
    const actor=await t.db.one<any>(
      'select id,phone,name,roles,status,owner_id from users where id=$1',[customer.id]);
    assert.ok(actor);
    const directKey='order-direct-nested-repeat-123';
    const directData={
      service:'electric',regionId:'spb',zoneId:'spb',paymentMethod:'online',
      address:'Санкт-Петербург, тестовая парковка',
      description:'Direct service retry after mobile reconnect',
      site:{place:'road',road:{highway:'М10',km:41,side:'right'}},
    };
    const first=await t.app.orders.create(actor,directData as any,directKey);
    const reorderedNested={
      ...Object.fromEntries(Object.entries(directData).reverse()),
      site:{road:{side:'right',km:41,highway:'М10'},place:'road'},
    };
    const same=await t.app.orders.create(actor,reorderedNested as any,directKey);
    assert.equal(same.order.id,first.order.id,
      'service must not reject logically identical nested objects with reordered keys');
    assert.equal((await t.db.query('select id from orders where id=$1',[first.order.id])).length,1);
  } finally {await t.close();}
});
