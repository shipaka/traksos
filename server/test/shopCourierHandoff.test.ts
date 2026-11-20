import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {setup,ok,type T} from './helpers.ts';
import {receiptCodeEquals,courierNextStage} from '../src/services/shopCourierDeliveries.ts';
import {validateRoles} from '../src/domain/roles.ts';

let t:T;
let admin:{token:string;id:string};
let buyer:{token:string;id:string};
let courier:{token:string;id:string};
let stranger:{token:string;id:string};
before(async()=>{
  t=await setup();
  admin=await t.login('+79990000001');
  buyer=await t.login('+79990000601');
  courier=await t.login('+79990000602');
  stranger=await t.login('+79990000603');
  // Synthetic courier is provisioned by server-side admin in this disposable
  // database. Public self-registration must never grant this role.
  await t.db.query(`update users set roles=array['courier']::text[] where id=$1`,[courier.id]);
});
after(()=>t.close());

test('courier is a separate and non-client role with ordered milestones',()=>{
  assert.throws(()=>validateRoles(['client'],['courier']),/отдельный аккаунт/);
  assert.throws(()=>validateRoles(['master'],['courier']),/отдельный аккаунт/);
  assert.throws(()=>validateRoles(['insurer'],['courier']),/отдельный аккаунт/);
  assert.equal(courierNextStage('assigned'),'picked_up');
  assert.equal(courierNextStage('picked_up'),'en_route');
  assert.equal(courierNextStage('en_route'),'arrived');
  assert.equal(courierNextStage('arrived'),null);
  assert.equal(receiptCodeEquals('id','nonce','000000'),false);
  assert.equal(receiptCodeEquals('id','nonce','ABCDEF'),false);
});

test('real delivery: courier verifies, then buyer separately confirms receiving parts',async()=>{
  const p=ok(await t.api('POST','/api/admin/shop/products',
    {name:'Тестовые тормозные колодки',price:36000,stock:2},admin.token));
  ok(await t.api('PUT','/api/admin/settings/shop',{enabled:true,delivery:true},admin.token));
  const order=ok(await t.api('POST','/api/shop/orders',
    {items:[{productId:p.id,qty:1}],delivery:'delivery',address:'Тестовый пункт доставки, 22'},buyer.token));
  assert.equal((await t.api('GET','/api/courier/jobs',undefined,stranger.token)).status,403);
  assert.equal((await t.api('POST',`/api/admin/shop/orders/${order.id}/courier`,
    {courierId:courier.id},stranger.token)).status,403);
  assert.equal((await t.api('POST',`/api/admin/shop/orders/${order.id}/courier`,
    {courierId:courier.id},admin.token)).status,409,'не собран — нельзя назначить');
  ok(await t.api('POST',`/api/admin/shop/orders/${order.id}/status`,
    {status:'confirmed'},admin.token));
  ok(await t.api('POST',`/api/admin/shop/orders/${order.id}/status`,
    {status:'ready'},admin.token));
  const d=ok(await t.api('POST',`/api/admin/shop/orders/${order.id}/courier`,
    {courierId:courier.id},admin.token));
  assert.equal(d.status,'assigned');

  const own=ok(await t.api('GET','/api/courier/jobs',undefined,courier.token));
  assert.equal(own.length,1);
  assert.equal(own[0].id,d.id);
  assert.equal(own[0].deliveryAddress,'Тестовый пункт доставки, 22');
  assert.equal('code' in own[0],false,'courier must not receive code');
  assert.equal('client_phone' in own[0],false,'no personal buyer phone');
  assert.equal((await t.api('GET',`/api/courier/jobs/${d.id}`,undefined,buyer.token)).status,403);
  assert.equal((await t.api('GET',`/api/courier/jobs/${d.id}`,undefined,stranger.token)).status,403);
  assert.equal((await t.api('GET',`/api/shop/orders/${order.id}/receipt-code`,undefined,courier.token)).status,404);

  const receipt=ok(await t.api('GET',`/api/shop/orders/${order.id}/receipt-code`,undefined,buyer.token));
  assert.match(receipt.code,/^\d{6}$/);
  assert.equal(receipt.verified,false);
  assert.equal(receipt.buyerConfirmationRequired,true);
  assert.equal((await t.api('POST',`/api/shop/orders/${order.id}/confirm-received`,{},buyer.token)).status,409);
  assert.equal((await t.api('POST',`/api/courier/jobs/${d.id}/verify`,{code:receipt.code},courier.token)).status,409);
  assert.equal((await t.api('POST',`/api/courier/jobs/${d.id}/stage`,{status:'arrived'},courier.token)).status,409);
  assert.equal((await t.api('POST',`/api/admin/shop/orders/${order.id}/status`,{status:'done'},admin.token)).status,409);

  const presence=ok(await t.api('PUT','/api/courier/presence',{online:true},courier.token));
  assert.equal(presence.online,true);
  ok(await t.api('POST',`/api/courier/jobs/${d.id}/stage`,{status:'picked_up'},courier.token));
  ok(await t.api('POST',`/api/courier/jobs/${d.id}/stage`,{status:'en_route'},courier.token));
  ok(await t.api('POST',`/api/courier/jobs/${d.id}/stage`,{status:'arrived'},courier.token));
  const incorrect=receipt.code==='111111'?'222222':'111111';
  assert.equal((await t.api('POST',`/api/courier/jobs/${d.id}/verify`,{code:incorrect},courier.token)).status,400);
  assert.equal((await t.api('POST',`/api/courier/jobs/${d.id}/verify`,{code:incorrect},courier.token)).status,400);
  const afterBad=ok(await t.api('GET',`/api/courier/jobs/${d.id}`,undefined,courier.token));
  assert.equal(afterBad.codeAttemptsRemaining,3,'wrong attempts are committed and limited');
  ok(await t.api('POST',`/api/courier/jobs/${d.id}/verify`,{code:receipt.code},courier.token));
  const afterVerification=ok(await t.api('GET',`/api/courier/jobs/${d.id}`,undefined,courier.token));
  assert.equal(afterVerification.status,'code_verified','verification is not final receipt');
  assert.equal((await t.api('POST',`/api/admin/shop/orders/${order.id}/status`,{status:'done'},admin.token)).status,409);
  assert.equal((await t.api('POST',`/api/shop/orders/${order.id}/confirm-received`,{},courier.token)).status,404);
  const buyerView=ok(await t.api('GET',`/api/shop/orders/${order.id}/receipt-code`,undefined,buyer.token));
  assert.equal(buyerView.verified,true);
  const completed=ok(await t.api('POST',`/api/shop/orders/${order.id}/confirm-received`,{},buyer.token));
  assert.equal(completed.customerConfirmed,true);
  assert.equal(ok(await t.api('GET',`/api/courier/jobs/${d.id}`,undefined,courier.token)).status,'received');
  assert.equal(ok(await t.api('GET','/api/shop/orders',undefined,buyer.token)).find((o:any)=>o.id===order.id).status,'done');
  ok(await t.api('POST',`/api/shop/orders/${order.id}/confirm-received`,{},buyer.token));
  const events=await t.db.query<{action:string}>(`select action from audit_log where target=$1`,[d.id]);
  assert.equal(events.filter(e=>e.action==='courier.customer_received').length,1,'idempotent buyer confirmation');
  assert.equal(events.filter(e=>e.action==='courier.code_rejected').length,2);
});

test('fleet owner sees purchase but cannot access driver-only courier handoff code',async()=>{
  const driver=await t.login('+79990000604','driver');
  await t.db.query('update users set owner_id=$2 where id=$1',[driver.id,buyer.id]);
  const product=ok(await t.api('POST','/api/admin/shop/products',
    {name:'Тестовый датчик тормозов',price:9000,stock:2},admin.token));
  const order=ok(await t.api('POST','/api/shop/orders',{
    items:[{productId:product.id,qty:1}],delivery:'delivery',
    address:'Тестовый адрес водителя, дом 4'
  },driver.token));
  ok(await t.api('POST',`/api/admin/shop/orders/${order.id}/status`,{status:'confirmed'},admin.token));
  ok(await t.api('POST',`/api/admin/shop/orders/${order.id}/status`,{status:'ready'},admin.token));
  ok(await t.api('POST',`/api/admin/shop/orders/${order.id}/courier`,{courierId:courier.id},admin.token));
  const fleetOrders=ok(await t.api('GET','/api/shop/orders',undefined,buyer.token));
  const fleetHistory=ok(await t.api('GET','/api/shop/history',undefined,buyer.token));
  assert.equal(fleetOrders.find((o:any)=>o.id===order.id)?.courierStatus,'assigned');
  assert.equal(fleetOrders.find((o:any)=>o.id===order.id)?.canConfirmCourierReceipt,false);
  assert.equal(fleetHistory.items.find((o:any)=>o.id===order.id)?.canConfirmCourierReceipt,false);
  assert.equal((await t.api('GET',`/api/shop/orders/${order.id}/receipt-code`,undefined,buyer.token)).status,404);
  assert.equal((await t.api('POST',`/api/shop/orders/${order.id}/confirm-received`,{},buyer.token)).status,404);
  const own=ok(await t.api('GET','/api/shop/orders',undefined,driver.token));
  assert.equal(own.find((o:any)=>o.id===order.id)?.canConfirmCourierReceipt,true);
  const receipt=ok(await t.api('GET',`/api/shop/orders/${order.id}/receipt-code`,undefined,driver.token));
  assert.match(receipt.code,/^\d{6}$/);
});
