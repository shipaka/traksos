import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, ok, type T } from './helpers.ts';

let t: T;
let admin: { token: string; id: string };
let client: { token: string; id: string };
let master: { token: string; id: string };
let father: { token: string; id: string };
let vehicleId: string;

before(async () => {
  t = await setup();
  admin = await t.login('+79990000001');
  client = await t.login('8 (999) 111-22-33');
  master = await t.login('+7 999 222-33-44', 'master');
  father = await t.login('+79993334455', 'master');
});
after(() => t.close());

const ringingFor = (userId: string) =>
  t.app.hub.log.filter((l) => l.userId === userId && l.event.type === 'incoming_call').map((l) => l.event.orderId);
const auctionFor = (userId: string) =>
  t.app.hub.log.filter((l) => l.userId === userId && l.event.type === 'auction').map((l) => l.event.orderId);

/** Исполнитель откликается, клиент выбирает его отклик */
async function take(orderId: string, performer: { token: string }, by: { token: string } = client, price?: number) {
  ok(await t.api('POST', `/api/orders/${orderId}/offers`, price ? { price } : {}, performer.token));
  const list = ok(await t.api('GET', `/api/orders/${orderId}/offers`, undefined, by.token));
  return ok(await t.api('POST', `/api/orders/${orderId}/offers/${list.offers[0].id}/choose`, {}, by.token));
}

test('вход: код, неверный код, повтор раньше минуты', async () => {
  const c = await t.api('POST', '/api/auth/code', { phone: '+79995556677' });
  assert.equal(c.status, 200);
  assert.match(c.body.devCode, /^\d{4}$/);
  assert.equal((await t.api('POST', '/api/auth/code', { phone: '+79995556677' })).status, 429);
  const bad = await t.api('POST', '/api/auth/verify', { phone: '+79995556677', code: '00000'.slice(0, 4) === c.body.devCode ? '1111' : '0000' });
  assert.equal(bad.body.error, 'wrong_code');
  assert.equal((await t.api('GET', '/api/me')).status, 401);
  const me = ok(await t.api('GET', '/api/me', undefined, admin.token));
  assert.ok(me.roles.includes('admin'));
});

test('исполнители: профиль, проверка, выход на линию', async () => {
  for (const [u, name, lat] of [[master, 'Иван', 59.55], [father, 'Отец', 59.95]] as const) {
    const p = ok(await t.api('PUT', '/api/performer/profile', {
      kind: 'master', name, specialties: ['electric', 'diag'], brands: { Scania: 'excellent', MAN: 'refuse' },
      taxStatus: 'self_employed', inn: '780000000001', car: { brand: 'Lada Largus', color: 'белый', plate: 'А123ВС78' },
    }, u.token));
    assert.equal(p.verification, 'pending');
    const early = await t.api('POST', '/api/performer/line', { lineStatus: 'online' }, u.token);
    assert.equal(early.body.error, 'not_verified');
    ok(await t.api('POST', `/api/admin/performers/${u.id}/verify`, { decision: 'approved' }, admin.token));
    ok(await t.api('POST', '/api/performer/line', { lineStatus: 'online' }, u.token));
    ok(await t.api('POST', '/api/performer/location', { lat, lng: 30.9 }, u.token));
    ok(await t.api('POST', '/api/me/push-token', { provider: 'rustore', token: `rustore-token-${name}` }, u.token));
  }
  ok(await t.api('POST', `/api/admin/performers/${father.id}/priority`, { isPriority: true }, admin.token));
  // цена вне коридора
  const r = await t.api('PUT', '/api/performer/profile', { kind: 'master', callOutPrice: 4_000_000 }, master.token);
  assert.equal(r.body.error, 'price_out_of_corridor');
});

test('полный путь: SOS → приоритетный отказался → мастер принял → чат → сумма → отзывы', async () => {
  vehicleId = ok(await t.api('POST', '/api/vehicles', { brand: 'Scania', year: 2009, plate: 'в777ор178' }, client.token)).id;

  const est = ok(await t.api('POST', '/api/pricing/estimate', { service: 'electric', zoneId: 'tos' }));
  assert.equal(est.callOut, 565_000); // 1 500 + 83 км × 50 = 5 650 ₽

  const created = ok(await t.api('POST', '/api/orders', {
    service: 'electric', isSos: true, problem: 'no_start', description: 'Не заводится, щёлкает стартер',
    address: 'Тосно, трасса М-11, стоянка', lat: 59.54, lng: 30.88, zoneId: 'tos', vehicleId,
  }, client.token));
  const id = created.order.id;
  assert.equal(created.order.status, 'searching');
  assert.equal(created.order.brand, 'Scania');

  // Сначала звонит «отцу» (приоритет), он отклоняет — заявка уходит на общие торги
  assert.deepEqual(ringingFor(father.id), [id]);
  assert.deepEqual(auctionFor(master.id), []);
  assert.equal(t.push.sent.at(-1)!.msg.kind, 'call');
  // Мастер не может откликнуться, пока заявка у приоритетных
  assert.equal((await t.api('POST', `/api/orders/${id}/offers`, {}, master.token)).status, 403);
  ok(await t.api('POST', `/api/orders/${id}/decline`, {}, father.token));
  assert.deepEqual(auctionFor(master.id), [id]);
  const open = ok(await t.api('GET', '/api/performer/auctions', undefined, master.token));
  assert.equal(open[0].order_id, id);
  assert.deepEqual(open[0].limits, { usual: 565_000, floor: 480_000, ceil: 735_000 });
  // Цена ниже пола не принимается
  assert.equal((await t.api('POST', `/api/orders/${id}/offers`, { price: 400_000 }, master.token)).body.error, 'price_out_of_corridor');

  const acc = await take(id, master, client, 520_000);
  assert.equal(acc.status, 'accepted');
  assert.equal(acc.money.callOut, 520_000);
  const seen = ok(await t.api('GET', `/api/orders/${id}`, undefined, client.token));
  assert.equal(seen.performer.name, 'Иван');
  assert.equal(seen.performer.car.plate, 'А123ВС78');
  assert.deepEqual(seen.actions, ['cancel']);

  // Чат: номер скрывается, «напрямую» — отметка модератору
  const msg = ok(await t.api('POST', `/api/orders/${id}/messages`, { body: 'Звоните 8 921 123-45-67, договоримся напрямую' }, master.token));
  assert.equal(msg.masked, true);
  assert.ok(!msg.body.includes('123-45-67'));
  ok(await t.api('POST', `/api/orders/${id}/messages`, { body: 'Жду у машины', kind: 'quick' }, client.token));
  const chat = ok(await t.api('GET', `/api/orders/${id}/messages`, undefined, client.token));
  assert.ok(chat.messages.some((m: any) => m.sender_role === 'system'));
  assert.equal(chat.messages.filter((m: any) => m.sender_role === 'performer').length, 1);
  assert.equal(ok(await t.api('GET', '/api/admin/chat/flagged', undefined, admin.token)).length, 1);
  assert.equal((await t.api('GET', `/api/orders/${id}/messages`, undefined, father.token)).status, 403);

  // Статусы по порядку; нельзя перепрыгнуть
  assert.equal((await t.api('POST', `/api/orders/${id}/amount`, { workAmount: 1 }, master.token)).body.error, 'bad_status');
  ok(await t.api('POST', `/api/orders/${id}/step`, { action: 'depart' }, master.token));
  ok(await t.api('POST', `/api/orders/${id}/step`, { action: 'arrive' }, master.token));
  ok(await t.api('POST', `/api/orders/${id}/step`, { action: 'start_work' }, master.token));
  const prop = ok(await t.api('POST', `/api/orders/${id}/amount`, { workAmount: 210_000, result: 'solved', note: 'Клемма массы' }, master.token));
  assert.equal(prop.status, 'awaiting_confirmation');
  // 5 200 + 2 100 = 7 300 ₽ + сбор 5% 365 ₽ = 7 665 ₽
  assert.deepEqual(prop.money, { callOut: 520_000, work: 210_000, amount: 730_000, clientFee: 36_500, discount: 0, total: 766_500 });

  // Мастер не может подтвердить за клиента; клиент спорит, мастер называет заново, клиент подтверждает
  assert.equal((await t.api('POST', `/api/orders/${id}/confirm`, {}, master.token)).status, 403);
  ok(await t.api('POST', `/api/orders/${id}/dispute`, { reason: 'Договаривались на час' }, client.token));
  ok(await t.api('POST', `/api/orders/${id}/amount`, { workAmount: 150_000, result: 'solved' }, master.token));
  assert.equal((await t.api('POST', `/api/orders/${id}/confirm`, { total: 766_500 }, client.token)).body.error, 'amount_changed');
  const done = ok(await t.api('POST', `/api/orders/${id}/confirm`, { total: 703_500 }, client.token));
  assert.equal(done.status, 'completed');

  // Наличные: мастер должен площадке сбор + 5% (33 500 + 33 500)
  const bal = ok(await t.api('GET', '/api/performer/balance', undefined, master.token));
  assert.equal(bal.cash_debt, 67_000);
  assert.equal(bal.paused, false);

  // Отзывы друг о друге, вес по рейтингу автора
  ok(await t.api('POST', `/api/orders/${id}/review`, { stars: 5, tags: ['Приехал быстро'] }, client.token));
  ok(await t.api('POST', `/api/orders/${id}/review`, { stars: 4, tags: ['Оплатил сразу'] }, master.token));
  assert.equal((await t.api('POST', `/api/orders/${id}/review`, { stars: 1 }, client.token)).body.error, 'already_reviewed');
  const me = ok(await t.api('GET', '/api/me', undefined, master.token));
  assert.equal(me.rating, 5);
  assert.equal(me.performer.line_status, 'online');
});

test('онлайн-оплата выключена по умолчанию', async () => {
  const r = await t.api('POST', '/api/orders', { service: 'electric', zoneId: 'spb', paymentMethod: 'online' }, client.token);
  assert.equal(r.status, 403);
  assert.equal(r.body.error, 'payment_method_disabled');
  const pricing = ok(await t.api('GET', '/api/pricing'));
  assert.equal(pricing.payments.online, false);
});

test('пропущенные вызовы: 30 секунд, следующий, после трёх подряд — «не на линии»', async () => {
  ok(await t.api('POST', '/api/performer/line', { lineStatus: 'offline' }, master.token));
  for (let i = 0; i < 3; i++) {
    const o = ok(await t.api('POST', '/api/orders', { service: 'electric', zoneId: 'spb', lat: 59.9, lng: 30.3 }, client.token)).order;
    assert.deepEqual(ringingFor(father.id).at(-1), o.id);
    t.clock.advance(31);
    assert.equal(await t.app.orders.tick(), 1);
    const v = ok(await t.api('GET', `/api/orders/${o.id}`, undefined, client.token));
    assert.equal(v.status, 'no_performer');
  }
  const p = ok(await t.api('GET', '/api/performer/profile', undefined, father.token));
  assert.equal(p.line_status, 'offline');
});

test('агентская оплата: выезд замораживается, работа списывается, выплата мастеру, отчёт агента', async () => {
  ok(await t.api('PUT', '/api/admin/settings/payments', { online: true }, admin.token));
  ok(await t.api('POST', '/api/performer/line', { lineStatus: 'online' }, master.token));

  const c = ok(await t.api('POST', '/api/orders', { service: 'electric', zoneId: 'spb', paymentMethod: 'online' }, client.token));
  const id = c.order.id;
  assert.match(c.confirmationUrl, /mock-pay/);
  assert.deepEqual(auctionFor(master.id).filter((x) => x === id), [], 'до оплаты выезда никому не звоним');

  const payId = c.confirmationUrl.split('/').pop();
  ok(await t.api('POST', `/api/dev/mock-pay/${payId}`));
  assert.deepEqual(auctionFor(master.id).at(-1), id);
  await take(id, master);
  ok(await t.api('POST', `/api/orders/${id}/step`, { action: 'arrive' }, master.token));
  ok(await t.api('POST', `/api/orders/${id}/amount`, { workAmount: 150_000, result: 'solved' }, master.token));
  ok(await t.api('POST', `/api/orders/${id}/confirm`, {}, client.token));

  const pays = ok(await t.api('GET', `/api/orders/${id}/payments`, undefined, client.token));
  // Заморожен потолок: 1 950 ₽ + сбор 97,50 ₽; работа 1 500 ₽ + 75 ₽
  assert.deepEqual(pays.map((p: any) => [p.kind, p.status, p.total]), [['call_out', 'held', 204_750], ['work', 'pending', 157_500]]);
  ok(await t.api('POST', `/api/dev/mock-pay/${t.payments.payments.size && [...t.payments.payments.keys()].at(-1)}`));
  const after = ok(await t.api('GET', `/api/orders/${id}/payments`, undefined, client.token));
  assert.deepEqual(after.map((p: any) => [p.status, p.total]), [['captured', 157_500], ['captured', 157_500]]);
  assert.equal(after[0].refunded_amount, 47_250, 'лишнее из замороженного вернулось клиенту');

  // Учёт сходится: клиент −3 150, мастер +2 850, площадка +300
  const sums = await t.db.query(`select account, sum(amount)::int s from ledger_entries where order_id=$1 group by account order by account`, [id]);
  assert.deepEqual(sums, [{ account: 'client', s: -315_000 }, { account: 'performer', s: 285_000 }, { account: 'platform', s: 30_000 }]);

  const run = ok(await t.api('POST', '/api/admin/payouts/run', {}, admin.token));
  assert.equal(run[0].status, 'paid');
  assert.equal(t.payments.payouts[0].amount, 285_000);
  const bal = ok(await t.api('GET', '/api/performer/balance', undefined, master.token));
  assert.equal(bal.paid, 285_000);
  assert.equal(bal.to_pay, 0);

  const report = ok(await t.api('GET', '/api/admin/agent-report?period=2026-12', undefined, admin.token));
  const mine = report.find((r: any) => r.performer_id === master.id);
  assert.equal(mine.orders, 2);
  assert.equal(mine.cash_orders, 1);
  assert.equal(mine.to_performer, 285_000);
});

test('отмена после принятия: исполнителю 25% выезда, остальное клиенту', async () => {
  const c = ok(await t.api('POST', '/api/orders', { service: 'electric', zoneId: 'spb', paymentMethod: 'online' }, client.token));
  ok(await t.api('POST', `/api/dev/mock-pay/${c.confirmationUrl.split('/').pop()}`));
  await take(c.order.id, master);
  const v = ok(await t.api('POST', `/api/orders/${c.order.id}/cancel`, { reason: 'Завелась сама' }, client.token));
  assert.equal(v.status, 'cancelled');
  assert.equal(v.cancelStage, 'accepted');
  const pay = ok(await t.api('GET', `/api/orders/${c.order.id}/payments`, undefined, client.token))[0];
  assert.equal(pay.status, 'partially_refunded');
  // Заморожено 2 047,50 ₽, удержано 25% выезда и сбора (393,75 ₽), вернулось 1 653,75 ₽
  assert.equal(pay.refunded_amount, 165_375);
});

test('водитель: вход по своему номеру, вызов на машину владельца', async () => {
  ok(await t.api('POST', `/api/vehicles/${vehicleId}/driver`, { phone: '+79997778899' }, client.token));
  const driver = await t.login('+79997778899');
  const cars = ok(await t.api('GET', '/api/vehicles', undefined, driver.token));
  assert.equal(cars.length, 1);
  ok(await t.api('POST', '/api/performer/line', { lineStatus: 'online' }, master.token));
  const o = ok(await t.api('POST', '/api/orders', { service: 'electric', zoneId: 'spb', vehicleId }, driver.token)).order;
  const ownerView = ok(await t.api('GET', `/api/orders/${o.id}`, undefined, client.token));
  assert.equal(ownerView.you, 'client');
  assert.equal(ownerView.vehicle.plate, 'В777ОР178');
});
