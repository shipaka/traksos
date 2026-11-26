import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setup,ok} from './helpers.ts';
import {ShopCourierDeliveries} from '../src/services/shopCourierDeliveries.ts';

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


test('courier: revoked driver of the same fleet cannot reveal code or confirm a former vehicle parcel', {timeout:60000},async()=>{
 const t=await setup();
 try{
  const admin=await t.login('+79990000001');
  const owner=await t.login('+79996671201');
  const driver=await t.login('+79996671202','driver');
  const courier=await t.login('+79996671203');
  await t.db.query("update users set roles=array['courier']::text[] where id=$1",[courier.id]);
  const car=ok(await t.api('POST','/api/vehicles',{
   brand:'MAN',model:'TGX',year:2018,plate:'А651АА178',
  },owner.token));
  const other=ok(await t.api('POST','/api/vehicles',{
   brand:'MAN',model:'TGS',year:2019,plate:'А652АА178',
  },owner.token));
  const fleet=ok(await t.api('GET','/api/fleet',undefined,owner.token));
  const code=fleet.cars.find((v:any)=>v.id===car.id)?.qrCode;
  assert.ok(code);
  ok(await t.api('POST',`/api/qr/${code}/join`,{},driver.token));
  const p=ok(await t.api('POST','/api/admin/shop/products',{
    name:'Запчасть к MAN для теста отзыва доступа',price:22000,stock:3,
  },admin.token));
  ok(await t.api('PUT','/api/admin/settings/shop',{enabled:true,delivery:true},admin.token));
  const order=ok(await t.api('POST','/api/shop/orders',{
   items:[{productId:p.id,qty:1}],delivery:'delivery',
   address:'Тестовая площадка бывшего водителя, дом 25',vehicleId:car.id,
  },driver.token));
  for(const status of ['confirmed','ready'])
   ok(await t.api('POST',`/api/admin/shop/orders/${order.id}/status`,{status},admin.token));
  const assigned=ok(await t.api('POST',`/api/admin/shop/orders/${order.id}/courier`,
    {courierId:courier.id},admin.token));
  for(const status of ['picked_up','en_route','arrived'])
   ok(await t.api('POST',`/api/courier/jobs/${assigned.id}/stage`,{status},courier.token));
  const codeBefore=ok(await t.api('GET',`/api/shop/orders/${order.id}/receipt-code`,
   undefined,driver.token)).code;
  assert.match(codeBefore,/^\d{6}$/);
  const oldCount=(await t.db.one<{n:number}>(
   "select count(*)::int as n from notifications where user_id=$1 and kind='shop'",
   [driver.id]))!.n;
  // Same legal owner, NEW car: stale fleet ownership alone must not confer
  // access to an old vehicle's delivery or its 6-digit handoff secret.
  ok(await t.api('POST',`/api/vehicles/${other.id}/driver`,
   {phone:'+79996671202'},owner.token));
  assert.equal((await t.db.one<{driver_id:string|null}>(
   'select driver_id from vehicles where id=$1',[car.id]))?.driver_id,null);
  assert.equal((await t.db.one<{owner_id:string|null}>(
   'select owner_id from users where id=$1',[driver.id]))?.owner_id,owner.id);
  assert.equal((await t.api('GET',`/api/shop/orders/${order.id}/receipt-code`,
   undefined,driver.token)).status,404);
  assert.equal((await t.api('POST',`/api/shop/orders/${order.id}/confirm-received`,
   {},driver.token)).status,404);
  assert.equal((await t.api('GET',`/api/shop/orders/${order.id}/receipt-code`,
   undefined,owner.token)).status,404,'owner is not the individual who receives this code');
  const beforeVerify=await t.db.one('select status,code_attempts from shop_courier_deliveries where id=$1',[assigned.id]);
  assert.equal(beforeVerify?.status,'arrived');
  const denied=await t.api('POST',`/api/courier/jobs/${assigned.id}/verify`,
   {code:codeBefore},courier.token);
  assert.equal(denied.status,409);
  assert.equal(denied.body.error,'receipt_buyer_unavailable');
  assert.deepEqual(await t.db.one('select status,code_attempts from shop_courier_deliveries where id=$1',[assigned.id]),beforeVerify,
   'revocation must not consume an attempt or verify a stale receipt');
  assert.equal((await t.db.one<{n:number}>(
   "select count(*)::int as n from notifications where user_id=$1 and kind='shop'",
   [driver.id]))?.n,oldCount,
   'private new verification events cannot reach the former driver');
  assert.equal((await t.api('POST',`/api/shop/orders/${order.id}/confirm-received`,
   {},driver.token)).status,404);
  assert.equal((await t.db.one<{status:string}>(
   'select status from shop_orders where id=$1',[order.id]))?.status,'shipped',
   'revoked driver cannot close or pay an old fleet shipment');
  assert.equal((await t.db.one<{status:string}>(
   'select status from shop_courier_deliveries where id=$1',[assigned.id]))?.status,'arrived');
 }finally{await t.close();}
});


test('courier: captured authorization cannot reveal or advance delivery after role revocation', {timeout:60000},async()=>{
 const t=await setup();
 try{
  const admin=await t.login('+79990000001');
  const buyer=await t.login('+79996671301');
  const courier=await t.login('+79996671302');
  await t.db.query("update users set roles=array['courier']::text[] where id=$1",[courier.id]);
  const captured=await t.db.one<any>('select * from users where id=$1',[courier.id]);
  const service=new ShopCourierDeliveries(t.db,{deliverStored:async()=>{}} as any);
  const p=ok(await t.api('POST','/api/admin/shop/products',
    {name:'Тестовая деталь для проверки роли',price:21500,stock:3},admin.token));
  ok(await t.api('PUT','/api/admin/settings/shop',{enabled:true,delivery:true},admin.token));
  const order=ok(await t.api('POST','/api/shop/orders',{
   items:[{productId:p.id,qty:1}],delivery:'delivery',address:'Тестовый адрес, дом 21',
  },buyer.token));
  for(const status of ['confirmed','ready'])
   ok(await t.api('POST',`/api/admin/shop/orders/${order.id}/status`,{status},admin.token));
  const assigned=ok(await t.api('POST',`/api/admin/shop/orders/${order.id}/courier`,
   {courierId:courier.id},admin.token));
  assert.equal((await service.list(captured)).length,1);
  await t.db.query("update users set roles=array['client']::text[] where id=$1",[courier.id]);
  assert.deepEqual(await service.list(captured),[]);
  await assert.rejects(service.one(captured,assigned.id));
  await assert.rejects(service.progress(captured,assigned.id,'picked_up'),/Доступ курьера отозван/);
  await assert.rejects(service.setPresence(captured,true),/Доступ курьера отозван/);
  assert.equal((await t.db.one<{status:string}>(
   'select status from shop_courier_deliveries where id=$1',[assigned.id]))?.status,'assigned');
  await t.db.query("update users set roles=array['courier']::text[] where id=$1",[courier.id]);
  assert.equal((await service.progress(captured,assigned.id,'picked_up')).status,'picked_up');
 }finally{await t.close();}
});

test('courier: availability and its audit roll back together on audit failure', {timeout:60000},async()=>{
 const t=await setup();
 try{
  const courier=await t.login('+79996671303');
  await t.db.query("update users set roles=array['courier']::text[] where id=$1",[courier.id]);
  const actor=await t.db.one<any>('select * from users where id=$1',[courier.id]);
  const svc=new ShopCourierDeliveries(t.db,{} as any);
  await svc.setPresence(actor,false);
  const delimiter=String.fromCharCode(36,36);
  await t.db.exec('create function reject_courier_availability_audit() returns trigger language plpgsql as '+delimiter+
    " begin if new.action='courier.availability' then raise exception 'synthetic audit outage'; end if; return new; end; "+delimiter+
    '; create trigger reject_courier_availability_audit before insert on audit_log for each row execute function reject_courier_availability_audit();');
  try{
   await assert.rejects(svc.setPresence(actor,true),/synthetic audit outage/);
   assert.equal((await svc.presence(actor)).online,false);
  }finally{
   await t.db.exec('drop trigger reject_courier_availability_audit on audit_log; drop function reject_courier_availability_audit();');
  }
  assert.equal((await svc.setPresence(actor,true)).online,true);
 }finally{await t.close();}
});
