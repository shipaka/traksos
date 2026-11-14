// Полный доступ администратора: каждое действие меняет то, что видят клиент и исполнитель,
// деньги сходятся, всё в журнале.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, ok, type T } from './helpers.ts';

let t: T;
let admin: any, client: any, master: any, other: any;

before(async () => {
  t = await setup();
  admin = await t.login('+79990000001');
  client = await t.login('+79996660001');
  master = await t.login('+79996660002', 'master');
  other = await t.login('+79996660003');
  ok(await t.api('PUT', '/api/performer/profile', { kind: 'master', name: 'Мастер', specialties: ['electric'], taxStatus: 'self_employed', inn: '780000000555' }, master.token));
  ok(await t.api('POST', `/api/admin/performers/${master.id}/verify`, { decision: 'approved' }, admin.token));
  ok(await t.api('POST', '/api/performer/line', { lineStatus: 'online' }, master.token));
  ok(await t.api('PUT', '/api/admin/settings/payments', { online: true }, admin.token));
});
after(() => t.close());

const ledgerZero = async () =>
  assert.deepEqual(await t.db.query(`select order_id from ledger_entries where order_id is not null group by order_id having sum(amount) <> 0`), [], 'проводки сходятся');

/** Заявка: исполнитель выбран, работа названа (сумма в копейках) */
async function orderToConfirm(method: 'cash' | 'online', work: number, c = client) {
  const r = ok(await t.api('POST', '/api/orders', { service: 'electric', zoneId: 'spb', paymentMethod: method }, c.token));
  if (r.confirmationUrl) ok(await t.api('POST', `/api/dev/mock-pay/${r.confirmationUrl.split('/').pop()}`));
  ok(await t.api('POST', `/api/orders/${r.order.id}/offers`, {}, master.token));
  const [f] = ok(await t.api('GET', `/api/orders/${r.order.id}/offers`, undefined, c.token)).offers;
  ok(await t.api('POST', `/api/orders/${r.order.id}/offers/${f.id}/choose`, {}, c.token));
  ok(await t.api('POST', `/api/orders/${r.order.id}/step`, { action: 'arrive' }, master.token));
  // Здесь проверяем деньги, а не таймер: без цены часа вся работа — одной строкой на нужную сумму
  await t.db.query(`update orders set estimate = estimate - 'hour' where id=$1`, [r.order.id]);
  ok(await t.api('POST', `/api/orders/${r.order.id}/amount`, { extras: [{ name: 'Расходники', amount: work }], result: 'solved' }, master.token));
  return r.order.id as string;
}

test('карточка пользователя: всё о человеке в одном месте; поиск по телефону, номеру заявки и госномеру', async () => {
  ok(await t.api('POST', '/api/vehicles', { brand: 'Scania', plate: 'К321ОР78' }, client.token));
  const id = await orderToConfirm('cash', 100_000);
  ok(await t.api('POST', `/api/orders/${id}/confirm`, {}, client.token));
  const card = ok(await t.api('GET', `/api/admin/users/${client.id}`, undefined, admin.token));
  assert.equal(card.asClient.length, 1);
  assert.equal(card.vehicles[0].plate, 'К321ОР78');
  const mcard = ok(await t.api('GET', `/api/admin/users/${master.id}`, undefined, admin.token));
  assert.equal(mcard.asPerformer.length, 1);
  assert.ok(mcard.balance.cash_debt > 0, 'долг мастера по наличным виден');
  assert.ok(mcard.ledger.length > 0);

  const byPlate = ok(await t.api('GET', '/api/admin/search?q=К321', undefined, admin.token));
  assert.equal(byPlate.users[0].id, client.id);
  const byPhone = ok(await t.api('GET', '/api/admin/search?q=6660002', undefined, admin.token));
  assert.equal(byPhone.users[0].id, master.id);
  const num = (await t.db.one('select number from orders where id=$1', [id]))!.number;
  assert.equal(ok(await t.api('GET', `/api/admin/search?q=${num}`, undefined, admin.token)).orders[0].id, id);
  // Обычному пользователю карточки недоступны
  assert.equal((await t.api('GET', `/api/admin/users/${client.id}`, undefined, client.token)).status, 403);
});

test('возврат: частичный за счёт площадки и за счёт исполнителя — видно клиенту, мастеру, учёт сходится', async () => {
  const id = await orderToConfirm('online', 150_000);
  ok(await t.api('POST', `/api/orders/${id}/confirm`, {}, client.token));
  const work = ok(await t.api('GET', `/api/orders/${id}/payments`, undefined, client.token)).find((p: any) => p.kind === 'work');
  ok(await t.api('POST', `/api/dev/mock-pay/${(await t.db.one('select provider_payment_id from payments where id=$1', [work.id]))!.provider_payment_id}`));
  const pays = ok(await t.api('GET', `/api/orders/${id}/payments`, undefined, client.token));
  const callOut = pays.find((p: any) => p.kind === 'call_out');

  // Больше, чем заплачено, не вернуть
  assert.equal((await t.api('POST', `/api/admin/payments/${callOut.id}/refund`, { amount: callOut.total + 1, from: 'platform', reason: 'Ошибка' }, admin.token)).body.error, 'bad_amount');
  ok(await t.api('POST', `/api/admin/payments/${callOut.id}/refund`, { amount: 50_000, from: 'platform', reason: 'Долго ехал' }, admin.token));
  const before = ok(await t.api('GET', '/api/performer/balance', undefined, master.token));
  ok(await t.api('POST', `/api/admin/payments/${work.id}/refund`, { amount: 30_000, from: 'performer', reason: 'Не доделал' }, admin.token));
  const after = ok(await t.api('GET', '/api/performer/balance', undefined, master.token));
  assert.equal(before.to_pay - after.to_pay, 30_000, 'удержание у мастера');

  const seen = ok(await t.api('GET', `/api/orders/${id}/payments`, undefined, client.token));
  assert.equal(seen.find((p: any) => p.id === callOut.id).refunded_amount, 50_000);
  assert.equal(seen.find((p: any) => p.id === callOut.id).status, 'partially_refunded');
  const v = ok(await t.api('GET', `/api/orders/${id}`, undefined, client.token));
  assert.ok(v.events.some((e: any) => e.type === 'refund'));
  assert.ok(t.app.hub.log.some((l) => l.userId === client.id && l.event.status === 'refund'), 'клиенту пришло уведомление');
  assert.equal((await t.api('POST', `/api/admin/payments/${callOut.id}/refund`, { amount: 1000, from: 'platform', reason: 'тест' }, client.token)).status, 403);
  await ledgerZero();
});

test('12 одновременных webhook: один платёж и один комплект проводок', async () => {
  const id = await orderToConfirm('online', 70_000);
  ok(await t.api('POST', `/api/orders/${id}/confirm`, {}, client.token));
  const pay = (await t.db.one<{ provider_payment_id: string }>(
    "select provider_payment_id from payments where order_id=$1 and kind='work'", [id]))!;
  t.payments.simulate(pay.provider_payment_id, 'captured');
  const replies = await Promise.all(Array.from({ length: 12 }, () =>
    t.api('POST', '/api/payments/webhook', { paymentId: pay.provider_payment_id })));
  assert.ok(replies.every(r => r.status === 200), JSON.stringify(replies));
  assert.equal(replies.filter(r => r.body.changed).length, 1);
  const payouts = await t.db.query('select id from payouts where order_id=$1', [id]);
  assert.equal(payouts.length, 1, 'повтор не создаёт вторую выплату');
  const paid = await t.db.query("select id from order_events where order_id=$1 and type='paid'", [id]);
  assert.equal(paid.length, 1, 'оплата подтверждена один раз');
  const ledger = await t.db.query<{ kind: string }>('select kind from ledger_entries where order_id=$1', [id]);
  assert.equal(ledger.filter(x => x.kind === 'payment').length, 1);
  assert.equal(ledger.filter(x => x.kind === 'earning').length, 1);
  await ledgerZero();
  const again = ok(await t.api('POST', '/api/payments/webhook', { paymentId: pay.provider_payment_id }));
  assert.equal(again.changed, false);
});

test('начисление и списание мастеру; выплата не уходит, пока удержания больше начислений', async () => {
  const b0 = ok(await t.api('GET', '/api/performer/balance', undefined, master.token)).to_pay;
  ok(await t.api('POST', `/api/admin/performers/${master.id}/adjust`, { amount: 20_000, reason: 'Компенсация за простой' }, admin.token));
  ok(await t.api('POST', `/api/admin/performers/${master.id}/adjust`, { amount: -5_000, reason: 'Штраф за опоздание' }, admin.token));
  assert.equal(ok(await t.api('GET', '/api/performer/balance', undefined, master.token)).to_pay, b0 + 15_000);
  assert.ok(t.app.hub.log.some((l) => l.userId === master.id && l.event.type === 'balance'));
  const audit = await t.db.query(`select action from audit_log where target=$1 and action='balance.adjust'`, [master.id]);
  assert.equal(audit.length, 2);
});

test('цена для клиента: персональный сбор 0%, бонусы списываются сами, скидка на заявку за счёт площадки', async () => {
  ok(await t.api('POST', `/api/admin/users/${other.id}/fee`, { pct: 0, reason: 'Свой клиент' }, admin.token));
  ok(await t.api('POST', `/api/admin/users/${other.id}/bonus`, { amount: 50_000, reason: 'Подарок за первый заказ' }, admin.token));
  const me = ok(await t.api('GET', '/api/me', undefined, other.token));
  assert.equal(me.bonus, 50_000);
  assert.equal(me.feePct, 0);
  assert.equal(me.personalFee, true);
  // Больше остатка не списать
  assert.equal((await t.api('POST', `/api/admin/users/${other.id}/bonus`, { amount: -60_000, reason: 'Ошибка' }, admin.token)).body.error, 'bad_amount');

  // Наличные: сбор 0%, бонусы 500 ₽ уменьшают то, что клиент отдаёт мастеру; мастер получает своё, площадка доплачивает
  const id = await orderToConfirm('cash', 100_000, other);
  const pre = ok(await t.api('GET', `/api/orders/${id}`, undefined, other.token));
  assert.equal(pre.money.clientFee, 0);
  const bal0 = ok(await t.api('GET', '/api/performer/balance', undefined, master.token));
  ok(await t.api('POST', `/api/orders/${id}/confirm`, { total: pre.money.total }, other.token));
  const done = ok(await t.api('GET', `/api/orders/${id}`, undefined, other.token));
  assert.equal(done.money.discount, 50_000);
  assert.equal(done.money.total, pre.money.total - 50_000);
  assert.equal(ok(await t.api('GET', '/api/me', undefined, other.token)).bonus, 0, 'бонусы потрачены');
  const bal1 = ok(await t.api('GET', '/api/performer/balance', undefined, master.token));
  // Выезд 1 500 + работа 1 000 = 2 500 ₽, сбор 0. Клиент отдал мастеру 2 000 ₽ (500 — бонусами).
  // Мастер должен 5% = 125 ₽, а площадка ему — 500 ₽ бонусов: долг не растёт, в баланс +375 ₽.
  assert.equal(bal1.cash_debt, bal0.cash_debt);
  assert.equal(bal1.to_pay - bal0.to_pay, 37_500);
  await ledgerZero();

  // Скидка админа на конкретную заявку — видна клиенту в сумме
  const id2 = await orderToConfirm('online', 100_000, other);
  ok(await t.api('POST', `/api/admin/orders/${id2}/discount`, { amount: 30_000, reason: 'Извинения за ожидание' }, admin.token));
  const v2 = ok(await t.api('GET', `/api/orders/${id2}`, undefined, other.token));
  assert.equal(v2.money.discount, 30_000);
  ok(await t.api('POST', `/api/orders/${id2}/confirm`, { total: v2.money.total }, other.token));
  const wp = (await t.db.one(`select provider_payment_id, total from payments where order_id=$1 and kind='work'`, [id2]))!;
  assert.equal(wp.total, 100_000 - 30_000, 'оплата работы уменьшена на скидку');
  ok(await t.api('POST', `/api/dev/mock-pay/${wp.provider_payment_id}`));
  await ledgerZero();
});

test('разбор заявки: закрыть спор с суммой, отменить с долей исполнителю; снять с линии', async () => {
  const id = await orderToConfirm('cash', 200_000);
  ok(await t.api('POST', `/api/orders/${id}/dispute`, { reason: 'Договаривались на час' }, client.token));
  const r = ok(await t.api('POST', `/api/admin/orders/${id}/resolve`, { action: 'complete', workAmount: 150_000, reason: 'Решили по видео с места' }, admin.token));
  assert.equal(r.status, 'completed');
  assert.equal(r.money.work, 150_000);
  assert.equal(ok(await t.api('GET', '/api/performer/profile', undefined, master.token)).line_status, 'online');
  assert.ok(t.app.hub.log.some((l) => l.userId === client.id && l.event.orderId === id && l.event.status === 'completed'));
  // Клиент может оставить отзыв как обычно
  ok(await t.api('POST', `/api/orders/${id}/review`, { stars: 4 }, client.token));

  const id2 = await orderToConfirm('online', 100_000);
  const c = ok(await t.api('POST', `/api/admin/orders/${id2}/resolve`, { action: 'cancel', stage: 'arrived', reason: 'Клиент уехал' }, admin.token));
  assert.equal(c.status, 'cancelled');
  assert.equal(c.cancelStage, 'arrived');
  assert.equal((await t.api('POST', `/api/admin/orders/${id2}/resolve`, { action: 'cancel', reason: 'ещё раз' }, admin.token)).body.error, 'closed');
  await ledgerZero();

  ok(await t.api('POST', `/api/admin/performers/${master.id}/offline`, { reason: 'Жалобы клиентов' }, admin.token));
  assert.equal(ok(await t.api('GET', '/api/performer/profile', undefined, master.token)).line_status, 'offline');
  // Админ не может снять роль админа с себя
  assert.equal((await t.api('POST', `/api/admin/users/${admin.id}/roles`, { roles: ['client'] }, admin.token)).body.error, 'self_lockout');
});
