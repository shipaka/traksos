import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, ok } from './helpers.ts';

test('СТО 200 000 ₽: две комиссии с независимыми потолками, роли, поступления и возврат', {timeout:90000},async()=>{
  const t=await setup();
  try {
    const admin=await t.login('+79990000001');
    const client=await t.login('+79994000001');
    const service=await t.login('+79994000002','service');
    const c=ok(await t.api('PUT','/api/base',{name:'Рембаза Север',
      address:'Санкт-Петербург, Софийская 14', staff:{electric:'own'}},service.token));
    const centerId=c.center.id;
    ok(await t.api('POST',`/api/admin/services/${centerId}/verify`,{decision:'approved'},admin.token));
    const vehicleId=ok(await t.api('POST','/api/vehicles',
      {brand:'Renault',model:'Premium',year:2010,plate:'А111АА78'},client.token)).id;
    const day=new Date(t.clock.now().getTime()+3*3600_000).toISOString().slice(0,10);
    const b=ok(await t.api('POST',`/api/services/${centerId}/book`,
      {vehicleId,need:'electric',day,arrival:'self'},client.token));
    ok(await t.api('POST',`/api/base/bookings/${b.id}/respond`,{action:'accept'},service.token));
    ok(await t.api('POST',`/api/base/bookings/${b.id}/status`,{status:'arrived'},service.token));
    ok(await t.api('POST',`/api/base/bookings/${b.id}/ready`,{works:['Электрика']},service.token));

    const worker=ok(await t.api('POST',`/api/base/bookings/${b.id}/invoice`,
      {amount:20_000_000},service.token));
    const customer=ok(await t.api('GET',`/api/bookings/${b.id}`,undefined,client.token));
    assert.equal(customer.clientFee,500_000,'client surcharge is capped at 5,000 rubles');
    assert.equal(customer.clientFeePct,5);
    assert.equal(customer.toPay,20_500_000,'customer pays 205k');
    assert.equal(customer.commission,undefined,'customer must not see STO fee');
    assert.equal(worker.commission,500_000,'STO fee is independently capped');
    assert.equal(worker.payout,19_500_000,'STO receives 195k');
    assert.equal(worker.clientFee,undefined,'STO must not see client surcharge');
    assert.equal(worker.toPay,undefined,'STO must not see the client invoice total');

    const again=await t.api('POST',`/api/base/bookings/${b.id}/invoice`,{amount:20_000_000},service.token);
    assert.equal(again.status,409,'the invoice cannot be issued twice');
    await t.app.settings.set('fees',{clientFeePct:3,serviceCommissionPct:4},admin.id);
    const snapshot=ok(await t.api('GET',`/api/bookings/${b.id}`,undefined,client.token));
    assert.equal(snapshot.clientFee,500_000,'changing settings cannot reprice signed invoices');
    assert.equal(snapshot.toPay,20_500_000);
    const workerAfter=ok(await t.api('GET',`/api/bookings/${b.id}`,undefined,service.token));
    assert.equal(workerAfter.commission,500_000);

    ok(await t.api('POST',`/api/bookings/${b.id}/confirm`,{agree:true,stars:5},client.token));
    assert.equal((await t.api('POST',`/api/admin/bookings/${b.id}/paid`,
      {reference:'STO-PAYOUT-200K'},admin.token)).status,409,'work confirmation is not proof of payment');
    assert.equal((await t.api('GET','/api/admin/service-finance',undefined,client.token)).status,403);
    assert.equal((await t.api('POST',`/api/admin/bookings/${b.id}/payment-events`,
      {kind:'receipt',amount:100,method:'online',reference:'STO-FAKE-RECEIPT'},service.token)).status,403);

    const event=(kind:'receipt'|'refund',amount:number,reference:string)=>
      t.api('POST',`/api/admin/bookings/${b.id}/payment-events`,
        {kind,amount,method:'invoice',reference},admin.token);
    ok(await event('receipt',1_000_000,'STO-RECEIPT-1'));
    assert.equal((await event('receipt',1_000_000,'STO-RECEIPT-1')).status,409,
      'one banking reference cannot be recorded twice');
    assert.equal((await event('refund',1_500_000,'STO-REFUND-TOO-MUCH')).status,409);
    ok(await event('refund',300_000,'STO-REFUND-1'));
    assert.equal((await t.api('POST',`/api/admin/bookings/${b.id}/paid`,
      {reference:'STO-PAYOUT-EARLY'},admin.token)).status,409);
    ok(await event('receipt',19_800_000,'STO-RECEIPT-2'));
    assert.equal((await event('receipt',100,'STO-EXCESS-RECEIPT')).status,409);

    const r=ok(await t.api('GET',`/api/admin/bookings/${b.id}/payment-events`,undefined,admin.token));
    assert.equal(r.invoice.total,20_500_000);
    assert.equal(r.invoice.netReceived,20_500_000);
    assert.equal(r.invoice.outstanding,0);
    assert.equal(r.invoice.paymentStatus,'received');
    assert.equal(r.events.length,3);
    assert.equal((await t.api('POST',`/api/admin/bookings/${b.id}/paid`,{},admin.token)).status,409,
      'payout must have a real external transfer reference');
    ok(await t.api('POST',`/api/admin/bookings/${b.id}/paid`,
      {reference:'STO-PAYOUT-200K'},admin.token));
    assert.equal((await t.api('POST',`/api/admin/bookings/${b.id}/paid`,
      {reference:'STO-PAYOUT-200K-REPEAT'},admin.token)).status,409,'no duplicate payout');

    ok(await event('refund',50_000,'STO-REFUND-AFTER-PAYOUT'));
    const after=ok(await t.api('GET',`/api/admin/bookings/${b.id}/payment-events`,undefined,admin.token));
    assert.equal(after.invoice.recoveryNeeded,true,'refund after payout needs manual recourse');
    assert.equal(after.invoice.outstanding,50_000);
    const adminRegister=ok(await t.api('GET','/api/admin/service-finance',undefined,admin.token));
    const invoice=adminRegister.find((x:any)=>x.id===b.id);
    assert.equal(invoice.client_fee,500_000);
    assert.equal(invoice.commission,500_000);
    assert.equal(invoice.recoveryNeeded,true);
    assert.equal(invoice.payout_reference,'STO-PAYOUT-200K');
    const actions=await t.db.query(
      "select action from audit_log where target=$1 and action like 'service.%'",[b.id]);
    assert.ok(actions.some((x:any)=>x.action==='service.payment.receipt'));
    assert.ok(actions.some((x:any)=>x.action==='service.payment.refund'));
    assert.ok(actions.some((x:any)=>x.action==='service.paid_out'));
  } finally {await t.close();}
});

test('старые счета СТО после миграции сохраняют прежние клиентские суммы', {timeout:90000},async()=>{
  const t=await setup();
  try {
    const admin=await t.login('+79990000001');
    const client=await t.login('+79994000011');
    const service=await t.login('+79994000012','service');
    const c=ok(await t.api('PUT','/api/base',
      {name:'Рембаза Легаси',address:'Санкт-Петербург, 2-я улица, 10'},service.token));
    ok(await t.api('POST',`/api/admin/services/${c.center.id}/verify`,{decision:'approved'},admin.token));
    const day=new Date(t.clock.now().getTime()+3*3600_000).toISOString().slice(0,10);
    const b=ok(await t.api('POST',`/api/services/${c.center.id}/book`,
      {need:'electric',day,arrival:'self'},client.token));
    ok(await t.api('POST',`/api/base/bookings/${b.id}/respond`,{action:'accept'},service.token));
    ok(await t.api('POST',`/api/base/bookings/${b.id}/status`,{status:'arrived'},service.token));
    ok(await t.api('POST',`/api/base/bookings/${b.id}/ready`,{works:['Электрика']},service.token));
    // This fixture intentionally simulates a pre-migration invoice retained by the DB defaults.
    await t.db.query(`update service_bookings set status='invoiced',amount=$2,commission=$3,
      invoiced_at=now() where id=$1`,[b.id,1_000_000,50_000]);
    const legacy=ok(await t.api('GET',`/api/bookings/${b.id}`,undefined,client.token));
    assert.equal(legacy.clientFee,0);
    assert.equal(legacy.toPay,1_000_000);
    assert.equal(legacy.paymentStatus,'legacy_not_verified');
    ok(await t.api('POST',`/api/bookings/${b.id}/confirm`,{agree:true},client.token));
    assert.equal((await t.api('POST',`/api/admin/bookings/${b.id}/payment-events`,
      {kind:'receipt',amount:1_000_000,method:'invoice',reference:'LEGACY-NO-REPRICE'},admin.token)).status,409);
    const paid=ok(await t.api('POST',`/api/admin/bookings/${b.id}/paid`,{},admin.token));
    assert.equal(paid.ok,true,'legacy payout rule is not retroactively tightened');
  } finally {await t.close();}
});

test('отдельные запчасти не облагаются 5% за ремонт и не влияют на оба лимита', {timeout:90000},async()=>{
  const t=await setup();
  try {
    const admin=await t.login('+79990000001');
    const client=await t.login('+79994000021');
    const service=await t.login('+79994000022','service');
    const c=ok(await t.api('PUT','/api/base',{
      name:'Рембаза Запчасти',address:'Ленинградская область, Гатчина, д.1'
    },service.token));
    ok(await t.api('POST',`/api/admin/services/${c.center.id}/verify`,{decision:'approved'},admin.token));
    const day=new Date(t.clock.now().getTime()+3*3600_000).toISOString().slice(0,10);
    const booking=ok(await t.api('POST',`/api/services/${c.center.id}/book`,
      {need:'electric',day,arrival:'self'},client.token));
    ok(await t.api('POST',`/api/base/bookings/${booking.id}/respond`,{action:'accept'},service.token));
    ok(await t.api('POST',`/api/base/bookings/${booking.id}/status`,{status:'arrived'},service.token));
    ok(await t.api('POST',`/api/base/bookings/${booking.id}/ready`,{works:['Электрика']},service.token));
    assert.equal((await t.api('POST',`/api/base/bookings/${booking.id}/invoice`,
      {amount:20_000_000,partsAmount:20_000_001},service.token)).status,400);
    const worker=ok(await t.api('POST',`/api/base/bookings/${booking.id}/invoice`,
      {amount:20_000_000,partsAmount:15_000_000},service.token));
    const customer=ok(await t.api('GET',`/api/bookings/${booking.id}`,undefined,client.token));
    assert.equal(worker.feeBaseAmount,5_000_000,'50k labor');
    assert.equal(worker.partsAmount,15_000_000,'150k spares');
    assert.equal(worker.commission,250_000,'STO 5% of labor, not parts');
    assert.equal(worker.payout,19_750_000,'200k minus 2.5k');
    assert.equal(customer.clientFee,250_000,'customer 5% of labor, not parts');
    assert.equal(customer.toPay,20_250_000,'202.5k');
    assert.equal(worker.clientFee,undefined);
    assert.equal(customer.commission,undefined);
    const stored=await t.db.one<any>(
      'select amount,parts_amount,fee_base_amount,client_fee from service_bookings where id=$1',[booking.id]);
    assert.deepEqual([stored.amount,stored.parts_amount,stored.fee_base_amount,stored.client_fee],
      [20_000_000,15_000_000,5_000_000,250_000]);
  } finally {await t.close();}
});
