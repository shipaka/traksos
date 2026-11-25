import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {setup,ok,type T} from './helpers.ts';

let t:T,client:{id:string;token:string};
before(async()=>{t=await setup();client=await t.login('+79997810701');});
after(()=>t?.close());

test('deferred site intent cannot become an immediate order or payment',async()=>{
  const before=await t.db.one<any>('select count(*)::int as n from orders where client_id=$1',[client.id]);
  const payments=await t.db.one<any>('select count(*)::int as n from payments');
  const invites=await t.db.one<any>('select count(*)::int as n from order_dispatch');
  const live=t.app.hub.log.length;
  for(const site of [
    {when:'today'},{when:'tomorrow'},{when:'tomorrow',time:'11:00'},
    {when:'now',time:'11:00'},{time:'14:00'},
  ]){
    const r=await t.api('POST','/api/orders',{service:'electric',zoneId:'spb',paymentMethod:'online',site},client.token);
    assert.equal(r.status,409,JSON.stringify(r.body));
    assert.equal(r.body.error,'planned_order_not_ready');
  }
  assert.equal((await t.db.one<any>('select count(*)::int as n from orders where client_id=$1',[client.id]))?.n,before.n);
  assert.equal((await t.db.one<any>('select count(*)::int as n from payments'))?.n,payments.n);
  assert.equal((await t.db.one<any>('select count(*)::int as n from order_dispatch'))?.n,invites.n);
  assert.equal(t.app.hub.log.length,live);
});

test('explicit immediate intent and normal SOS remain available',async()=>{
  for(const body of [
    {service:'electric',zoneId:'spb',site:{when:'now',time:'   '}},
    {service:'electric',zoneId:'spb',isSos:true},
  ]){
    const r=ok(await t.api('POST','/api/orders',body,client.token));
    assert.ok(r.order.id);
    assert.ok(['searching','no_performer','accepted'].includes(r.order.status));
  }
});
