import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setup,ok} from './helpers.ts';

test('courier: concurrent assignment retries do not rotate the receipt nonce or duplicate notifications', {timeout:60000},async()=>{
 const t=await setup();
 try{
  const admin=await t.login('+79990000001');
  const buyer=await t.login('+79996671101');
  const courierA=await t.login('+79996671102');
  const courierB=await t.login('+79996671103');
  await t.db.query("update users set roles=array['courier']::text[] where id=any($1::uuid[])",
   [[courierA.id,courierB.id]]);
  const p=ok(await t.api('POST','/api/admin/shop/products',
    {name:'Тестовый датчик давления для доставки',price:21500,stock:3},admin.token));
  ok(await t.api('PUT','/api/admin/settings/shop',{enabled:true,delivery:true},admin.token));
  const order=ok(await t.api('POST','/api/shop/orders',{
   items:[{productId:p.id,qty:1}],delivery:'delivery',address:'Тестовая доставка, дом 33',
  },buyer.token));
  for(const status of ['confirmed','ready'])
   ok(await t.api('POST',`/api/admin/shop/orders/${order.id}/status`,{status},admin.token));
  const route=`/api/admin/shop/orders/${order.id}/courier`;
  const initial=await Promise.all(Array.from({length:12},
   ()=>t.api('POST',route,{courierId:courierA.id},admin.token)));
  assert.ok(initial.every(x=>x.status===200),JSON.stringify(initial));
  const ids=new Set(initial.map(x=>x.body.id));
  assert.equal(ids.size,1,'concurrent retries use a single real delivery row');
  const id=initial[0].body.id;
  const before=await t.db.one<{code_nonce:string;updated_at:Date}>(
   'select code_nonce,updated_at from shop_courier_deliveries where id=$1',[id]);
  assert.ok(before?.code_nonce);
  const sentA=await t.db.one<{n:number}>(
   "select count(*)::int as n from notifications where user_id=$1 and kind='shop'",
   [courierA.id]);
  assert.equal(sentA?.n,1,'a single new job notification rather than 12 alerts');
  const audA=await t.db.one<{n:number}>(
   "select count(*)::int as n from audit_log where target=$1 and action='courier.assign'",
   [id]);
  assert.equal(audA?.n,1);
  ok(await t.api('POST',route,{courierId:courierA.id},admin.token));
  const repeat=await t.db.one<{code_nonce:string;updated_at:Date}>(
   'select code_nonce,updated_at from shop_courier_deliveries where id=$1',[id]);
  assert.equal(repeat?.code_nonce,before?.code_nonce,'retry does not rotate secret');
  assert.equal(new Date(repeat!.updated_at).getTime(),new Date(before!.updated_at).getTime(),
   'retry is a true no-op');
  assert.equal((await t.db.one<{n:number}>(
   "select count(*)::int as n from notifications where user_id=$1 and kind='shop'",
   [courierA.id]))?.n,1);

  const reassign=ok(await t.api('POST',route,{courierId:courierB.id},admin.token));
  assert.equal(reassign.id,id,'courier change stays on the same delivery record');
  assert.equal((await t.api('GET',`/api/courier/jobs/${id}`,undefined,courierA.token)).status,404);
  assert.equal((await t.api('POST',`/api/courier/jobs/${id}/stage`,
   {status:'picked_up'},courierA.token)).status,404);
  assert.equal((await t.api('GET',`/api/courier/jobs/${id}`,undefined,courierB.token)).status,200);
  assert.notEqual((await t.db.one<{code_nonce:string}>(
   'select code_nonce from shop_courier_deliveries where id=$1',[id]))?.code_nonce,before!.code_nonce,
   'reassignment rotates unused secret');
  assert.equal((await t.db.one<{n:number}>(
   "select count(*)::int as n from notifications where user_id=$1 and kind='shop'",
   [courierA.id]))?.n,2,'the old courier receives one removal notification');
  assert.equal((await t.db.one<{n:number}>(
   "select count(*)::int as n from notifications where user_id=$1 and kind='shop'",
   [courierB.id]))?.n,1);

  // A first pickup is valid only while the shop order is ready.
  await t.db.query("update shop_orders set status='shipped' where id=$1",[order.id]);
  assert.equal((await t.api('POST',`/api/courier/jobs/${id}/stage`,
   {status:'picked_up'},courierB.token)).status,409);
  await t.db.query("update shop_orders set status='ready' where id=$1",[order.id]);
  ok(await t.api('POST',`/api/courier/jobs/${id}/stage`,{status:'picked_up'},courierB.token));
  assert.equal((await t.db.one<{status:string}>(
   'select status from shop_orders where id=$1',[order.id]))?.status,'shipped');

  await t.db.query("update shop_orders set status='ready' where id=$1",[order.id]);
  assert.equal((await t.api('POST',`/api/courier/jobs/${id}/stage`,
   {status:'en_route'},courierB.token)).status,409,'cannot advance inconsistent shipment');
  await t.db.query("update shop_orders set status='shipped' where id=$1",[order.id]);
  ok(await t.api('POST',`/api/courier/jobs/${id}/stage`,{status:'en_route'},courierB.token));
  ok(await t.api('POST',`/api/courier/jobs/${id}/stage`,{status:'arrived'},courierB.token));
  const receipt=ok(await t.api('GET',`/api/shop/orders/${order.id}/receipt-code`,
   undefined,buyer.token));
  ok(await t.api('POST',`/api/courier/jobs/${id}/verify`,{code:receipt.code},courierB.token));
  ok(await t.api('POST',`/api/shop/orders/${order.id}/confirm-received`,{},buyer.token));
  assert.equal((await t.db.one<{status:string}>(
   'select status from shop_orders where id=$1',[order.id]))?.status,'done');
 }finally{await t.close();}
});
