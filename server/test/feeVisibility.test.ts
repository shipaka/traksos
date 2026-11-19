import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, ok } from './helpers.ts';

test('client surcharge is added only in client JSON; worker only sees included commission', { timeout: 60000 }, async () => {
  const t = await setup();
  try {
    const admin = await t.login('+79990000001');
    const client = await t.login('+79993552001');
    const worker = await t.login('+79993552002', 'master');
    ok(await t.api('PUT','/api/performer/profile',
      {kind:'master',name:'Тестовый мастер',specialties:['electric'],taxStatus:'self_employed',inn:'780000000001'},worker.token));
    ok(await t.api('POST',`/api/admin/performers/${worker.id}/verify`,{decision:'approved'},admin.token));
    ok(await t.api('POST','/api/performer/line',{lineStatus:'online'},worker.token));
    const order = ok(await t.api('POST','/api/orders',
      {service:'electric',zoneId:'spb',description:'Проверка разделения комиссии'},client.token)).order;
    ok(await t.api('POST',`/api/orders/${order.id}/offers`,{},worker.token));
    const offers = ok(await t.api('GET',`/api/orders/${order.id}/offers`,undefined,client.token)).offers;
    ok(await t.api('POST',`/api/orders/${order.id}/offers/${offers[0].id}/choose`,{},client.token));

    const clientView = ok(await t.api('GET',`/api/orders/${order.id}`,undefined,client.token));
    const workerView = ok(await t.api('GET',`/api/orders/${order.id}`,undefined,worker.token));
    assert.ok(clientView.money.clientFee > 0);
    assert.equal(clientView.money.total, clientView.money.amount + clientView.money.clientFee);
    assert.equal(workerView.money.amount, clientView.money.amount);
    assert.equal(workerView.money.total, workerView.money.amount);
    assert.equal(workerView.money.cashToCollect, clientView.money.total, 'cash collection is not undercharged');
    assert.equal(workerView.money.commission, Math.round(workerView.money.amount * 0.05));
    assert.equal(workerView.money.payout, workerView.money.amount - workerView.money.commission);
    assert.equal(workerView.money.clientFee, undefined);
    assert.equal(workerView.money.discount, undefined);
    assert.equal(workerView.pointsFee, undefined);
    assert.ok(workerView.events.every((e:any)=>e.data === undefined));
    assert.ok(!JSON.stringify(workerView).includes('"clientFee"'), 'worker payload contains no customer fee key');

    const archive = ok(await t.api('GET','/api/orders?as=performer',undefined,worker.token));
    const own = archive.find((o:any)=>o.id===order.id);
    assert.ok(own);
    assert.equal(own.client_fee_pct,undefined);
    assert.equal(own.discount_amount,undefined);
    assert.equal(own.money.clientFee,undefined);
    assert.equal(own.money.total,own.money.amount);

    await t.app.orders.systemMessage(order.id, 'Исполнитель закрыл выезд: выезд 10 000 ₽ + сбор 500 ₽ = 10 500 ₽. Подтвердите.');
    const clientChat = ok(await t.api('GET',`/api/orders/${order.id}/messages`,undefined,client.token));
    const workerChat = ok(await t.api('GET',`/api/orders/${order.id}/messages`,undefined,worker.token));
    assert.ok(clientChat.messages.some((m:any)=>String(m.body).includes('+ сбор 500')));
    assert.ok(!workerChat.messages.some((m:any)=>String(m.body).includes('+ сбор 500')));
    // Cash accounting stays correct, but the worker API only returns an aggregate debt.
    ok(await t.api('POST',`/api/orders/${order.id}/step`,{action:'arrive'},worker.token));
    ok(await t.api('POST',`/api/orders/${order.id}/amount`,{result:'solved'},worker.token));
    const payable = ok(await t.api('GET',`/api/orders/${order.id}`,undefined,client.token)).money.total;
    ok(await t.api('POST',`/api/orders/${order.id}/confirm`,{total:payable},client.token));
    const history = ok(await t.api('GET','/api/performer/ledger',undefined,worker.token));
    const debt = history.find((entry:any)=>entry.kind==='cash_commission');
    assert.ok(debt && debt.amount<0);
    assert.ok(!String(debt.note).includes('сбор 500'));
    assert.ok(!String(debt.note).includes('Наличные '));
    const paidClient = ok(await t.api('GET',`/api/orders/${order.id}`,undefined,client.token));
    const paidWorker = ok(await t.api('GET',`/api/orders/${order.id}`,undefined,worker.token));
    assert.equal(paidWorker.money.cashToCollect,paidClient.money.total);
    assert.equal(paidWorker.money.clientFee,undefined);
  } finally { await t.close(); }
});
