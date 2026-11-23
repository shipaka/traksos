import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, ok } from './helpers.ts';

const phone = (id: number) => '+7999666' + String(id).padStart(4, '0');

async function buildFleet(t: Awaited<ReturnType<typeof setup>>, n: number) {
  const admin = await t.login('+79990000001');
  const owner = await t.login(phone(n));
  const driver = await t.login(phone(n+1), 'driver');
  ok(await t.api('PUT', '/api/admin/settings/payments', {online:true}, admin.token));
  const vehicle = ok(await t.api('POST', '/api/vehicles', {
    brand:'Scania',model:'R',year:2016,plate:'А'+n+'АА178',
  }, owner.token));
  const cars = ok(await t.api('GET','/api/fleet',undefined,owner.token));
  const qr = cars.cars.find((car:any)=>car.id===vehicle.id)?.qrCode as string;
  assert.ok(qr);
  ok(await t.api('POST','/api/qr/'+qr+'/join',{},driver.token));
  return {admin,owner,driver,vehicle};
}

async function revoked(t: Awaited<ReturnType<typeof setup>>,
  owner:{token:string}, vehicle:{id:string}) {
  ok(await t.api('POST',`/api/fleet/vehicles/${vehicle.id}/new-qr`,{},owner.token));
}

async function inApp(t: Awaited<ReturnType<typeof setup>>, userId:string, orderId:string,
  kind:'payment'|'order') {
  const row=await t.db.one<{count:number}>(`select count(*)::int as count
    from notifications where user_id=$1 and kind=$2 and data->>'orderId'=$3`,
    [userId,kind,orderId]);
  return row?.count ?? 0;
}

test('failed call-out payment after QR revoke notifies owner, never a former driver', {timeout:60000}, async()=>{
  const t=await setup();
  try {
    const {owner,driver,vehicle}=await buildFleet(t,4100);
    const created=ok(await t.api('POST','/api/orders',{
      service:'electric',zoneId:'spb',isSos:true,vehicleId:vehicle.id,
      paymentMethod:'online',description:'Не заводится после остановки',
    },driver.token));
    const orderId=created.order.id as string;
    const p=await t.db.one<{provider_payment_id:string}>(
      "select provider_payment_id from payments where order_id=$1 and kind='call_out'",[orderId]);
    assert.ok(p?.provider_payment_id);
    await revoked(t,owner,vehicle);

    const beforeOwner=await inApp(t,owner.id,orderId,'order');
    const beforeDriver=await inApp(t,driver.id,orderId,'order');
    const startLog=t.app.hub.log.length;
    t.payments.simulate(p!.provider_payment_id,'failed');
    const webhook=await t.api('POST','/api/payments/webhook',
      {paymentId:p!.provider_payment_id});
    assert.equal(webhook.status,200,JSON.stringify(webhook.body));
    assert.equal((await t.db.one<{status:string}>('select status from orders where id=$1',
      [orderId]))?.status,'cancelled');
    assert.equal(await inApp(t,owner.id,orderId,'order'),beforeOwner+1,
      'owner keeps payment-failure information');
    assert.equal(await inApp(t,driver.id,orderId,'order'),beforeDriver,
      'revoked driver must not receive even a cancelled-payment inbox notification');
    assert.equal(t.app.hub.log.slice(startLog).some(log=>
      log.userId===driver.id && log.event.orderId===orderId &&
        (log.event.type==='order'||log.event.type==='payment')),false);
    assert.equal((await t.api('GET',`/api/orders/${orderId}/payments`,
      undefined,driver.token)).status,403);
  } finally { await t.close(); }
});

test('work payment checkout link is visible to real owner, not former driver', {timeout:60000}, async()=>{
  const t=await setup();
  try {
    const {admin,owner,driver,vehicle}=await buildFleet(t,4200);
    const master=await t.login(phone(4202),'master');
    ok(await t.api('PUT','/api/performer/profile',{
      kind:'master',name:'Тестовый исполнитель',specialties:['electric'],
      taxStatus:'self_employed',inn:'780000000555',
    },master.token));
    ok(await t.api('POST',`/api/admin/performers/${master.id}/verify`,
      {decision:'approved'},admin.token));
    ok(await t.api('POST','/api/performer/line',{lineStatus:'online'},master.token));

    const created=ok(await t.api('POST','/api/orders',{
      service:'electric',zoneId:'spb',paymentMethod:'online',
      vehicleId:vehicle.id,description:'Отказ пневматики',
    },driver.token));
    const id=created.order.id as string;
    assert.ok(created.confirmationUrl,'call-out must offer a test checkout');
    ok(await t.api('POST','/api/dev/mock-pay/'+created.confirmationUrl.split('/').pop()));
    ok(await t.api('POST',`/api/orders/${id}/offers`,{},master.token));
    assert.equal((await t.api('GET',`/api/orders/${id}/payments`,
      undefined,master.token)).status,403,
      'a bidding candidate may see an offer, but not the bank checkout URL or client surcharge');
    const bids=ok(await t.api('GET',`/api/orders/${id}/offers`,undefined,driver.token));
    ok(await t.api('POST',`/api/orders/${id}/offers/${bids.offers[0].id}/choose`,
      {},driver.token));
    assert.equal((await t.api('GET',`/api/orders/${id}/payments`,
      undefined,master.token)).status,403,
      'a selected performer still has no access to client bank operations');
    ok(await t.api('POST',`/api/orders/${id}/step`,{action:'arrive'},master.token));
    await t.db.query("update orders set estimate=estimate - 'hour' where id=$1",[id]);
    ok(await t.api('POST',`/api/orders/${id}/amount`,{
      extras:[{name:'Замена оборудования',amount:75000}],result:'solved',
    },master.token));
    await revoked(t,owner,vehicle);
    const firstOwner=await inApp(t,owner.id,id,'payment');
    const firstFormer=await inApp(t,driver.id,id,'payment');
    const startLog=t.app.hub.log.length;

    const confirmed=await t.api('POST',`/api/orders/${id}/confirm`,{},owner.token);
    assert.equal(confirmed.status,200,JSON.stringify(confirmed.body));
    const work=await t.db.one<{provider_payment_id:string|null}>(
      "select provider_payment_id from payments where order_id=$1 and kind='work'",[id]);
    assert.ok(work?.provider_payment_id,'work payment must still be created');
    assert.equal(await inApp(t,owner.id,id,'payment'),firstOwner+1,
      'owner alone receives work checkout link');
    assert.equal(await inApp(t,driver.id,id,'payment'),firstFormer,
      'revoked former driver must not receive work checkout link');
    assert.equal(t.app.hub.log.slice(startLog).some(log=>
      log.userId===driver.id && log.event.orderId===id &&
        log.event.type==='payment'),false);
    assert.equal((await t.api('GET',`/api/orders/${id}/payments`,
      undefined,driver.token)).status,403);
    assert.equal((await t.api('GET',`/api/orders/${id}/payments`,
      undefined,owner.token)).status,200);
  } finally { await t.close(); }
});

test('delayed orphan work payment webhook after revocation never leaks recovered checkout', {timeout:60000}, async()=>{
  const t=await setup();
  try {
    const {admin,owner,driver,vehicle}=await buildFleet(t,4300);
    const master=await t.login(phone(4302),'master');
    ok(await t.api('PUT','/api/performer/profile',{
      kind:'master',name:'Мастер для поздней оплаты',specialties:['electric'],
      taxStatus:'self_employed',inn:'780000000555',
    },master.token));
    ok(await t.api('POST',`/api/admin/performers/${master.id}/verify`,
      {decision:'approved'},admin.token));
    ok(await t.api('POST','/api/performer/line',{lineStatus:'online'},master.token));
    const created=ok(await t.api('POST','/api/orders',{
      service:'electric',zoneId:'spb',paymentMethod:'online',vehicleId:vehicle.id,
    },driver.token));
    const id=created.order.id as string;
    ok(await t.api('POST','/api/dev/mock-pay/'+created.confirmationUrl.split('/').pop()));
    ok(await t.api('POST',`/api/orders/${id}/offers`,{},master.token));
    assert.equal((await t.api('GET',`/api/orders/${id}/payments`,
      undefined,master.token)).status,403,
      'a bidding candidate may see an offer, but not the bank checkout URL or client surcharge');
    const bids=ok(await t.api('GET',`/api/orders/${id}/offers`,undefined,driver.token));
    ok(await t.api('POST',`/api/orders/${id}/offers/${bids.offers[0].id}/choose`,
      {},driver.token));
    assert.equal((await t.api('GET',`/api/orders/${id}/payments`,
      undefined,master.token)).status,403,
      'a selected performer still has no access to client bank operations');
    ok(await t.api('POST',`/api/orders/${id}/step`,{action:'arrive'},master.token));
    await t.db.query("update orders set estimate=estimate - 'hour' where id=$1",[id]);
    ok(await t.api('POST',`/api/orders/${id}/amount`,{
      extras:[{name:'Замена стартера',amount:70000}],result:'solved',
    },master.token));
    const original=t.payments.createPayment.bind(t.payments);
    let lostId:string|null=null;
    t.payments.createPayment=async req=>{
      const response=await original(req);
      if(req.capture) {
        lostId=response.id;
        throw new Error('intentional bank response loss');
      }
      return response;
    };
    try {
      await revoked(t,owner,vehicle);
      assert.equal((await t.api('POST',`/api/orders/${id}/confirm`,{},owner.token)).status,200);
      const pending=await t.db.one<{status:string}>(
        "select i.status from payment_create_intents i join payments p on p.id=i.payment_id where i.order_id=$1 and p.kind='work'",[id]);
      assert.equal(pending?.status,'needs_review');
      assert.ok(lostId,'bank accepted work creation before response was lost');
    } finally {
      t.payments.createPayment=original;
    }
    const firstOwner=await inApp(t,owner.id,id,'payment');
    const firstFormer=await inApp(t,driver.id,id,'payment');
    const startLog=t.app.hub.log.length;
    const webhook=await t.api('POST','/api/payments/webhook',{paymentId:lostId});
    assert.equal(webhook.status,200,JSON.stringify(webhook.body));
    assert.ok((await inApp(t,owner.id,id,'payment'))>firstOwner,
      'owner learns about recovered bank operation');
    assert.equal(await inApp(t,driver.id,id,'payment'),firstFormer,
      'former driver must not get a recovered checkout link');
    assert.equal(t.app.hub.log.slice(startLog).some(log=>
      log.userId===driver.id && log.event.orderId===id &&
      log.event.type==='payment'),false);
  } finally { await t.close(); }
});
