import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, ok, type T } from './helpers.ts';

// Консультация по телефону — как в демо: 700 ₽, без выезда и зон; мастер оставляет подсказку;
// клиент подтверждает «Вопрос решён» или вызывает выезд — подсказка переходит, скидка на выезд.

let t: T;
let admin: { token: string; id: string };
let client: { token: string; id: string };
let master: { token: string; id: string };

before(async () => {
  t = await setup();
  admin = await t.login('+79990000001');
  client = await t.login('+79991112233');
  master = await t.login('+79992223344', 'master');
  ok(await t.api('PUT', '/api/performer/profile', {
    kind: 'master', name: 'Иван', specialties: ['electric'], brands: {}, taxStatus: 'self_employed', inn: '780000000001',
    car: { brand: 'Lada Largus', color: 'белый', plate: 'А123ВС78' },
  }, master.token));
  ok(await t.api('POST', `/api/admin/performers/${master.id}/verify`, { decision: 'approved' }, admin.token));
  ok(await t.api('POST', '/api/performer/line', { lineStatus: 'online' }, master.token));
});
after(() => t.close());

async function takeConsult() {
  const c = ok(await t.api('POST', '/api/orders', { service: 'consult', description: 'Стартер щёлкает, приборка гаснет', brand: 'Scania', zoneId: 'ust', night: true }, client.token));
  const o = c.order;
  assert.equal(o.estimate.callOut, 70_000, 'консультация — 700 ₽, зона и ночь не влияют');
  assert.equal(o.estimate.hour, null);
  assert.equal(o.address, null);
  assert.equal(o.limits.floor, o.limits.ceil, 'по консультации не торгуются');
  // своя цена не принимается
  assert.equal((await t.api('POST', `/api/orders/${o.id}/offers`, { price: 90_000 }, master.token)).body.error, 'price_out_of_corridor');
  ok(await t.api('POST', `/api/orders/${o.id}/offers`, {}, master.token));
  const list = ok(await t.api('GET', `/api/orders/${o.id}/offers`, undefined, client.token));
  ok(await t.api('POST', `/api/orders/${o.id}/offers/${list.offers[0].id}/choose`, {}, client.token));
  return o.id as string;
}

test('консультация: подсказка обязательна, «Вопрос решён» — 700 ₽ без сбора', async () => {
  const id = await takeConsult();
  // выезд и работа к консультации не относятся
  assert.equal((await t.api('POST', `/api/orders/${id}/step`, { action: 'depart' }, master.token)).status >= 400, true);
  assert.equal((await t.api('POST', `/api/orders/${id}/consult-finish`, { hints: [], confidence: 'likely' }, master.token)).status, 400);
  const f = ok(await t.api('POST', `/api/orders/${id}/consult-finish`, { hints: ['Масса', 'Стартер'], confidence: 'likely', note: 'проседает напряжение' }, master.token));
  assert.equal(f.status, 'awaiting_confirmation');
  assert.deepEqual(f.consultHint.hints, ['Масса', 'Стартер']);
  assert.equal(f.money.total, 70_000);
  const done = ok(await t.api('POST', `/api/orders/${id}/confirm`, { total: 70_000 }, client.token));
  assert.equal(done.status, 'completed');
});

test('консультация → выезд: подсказка у мастера, скидка 200 ₽ один раз', async () => {
  const id = await takeConsult();
  ok(await t.api('POST', `/api/orders/${id}/consult-finish`, { hints: ['Проводка'], confidence: 'sure' }, master.token));
  const v = ok(await t.api('POST', '/api/orders', { service: 'electric', zoneId: 'spb', fromConsult: id, description: 'После консультации' }, client.token));
  assert.equal(v.order.money.discount, 20_000);
  assert.equal(v.order.discountReason, 'Скидка после консультации');
  assert.deepEqual(v.order.consultFrom.hint.hints, ['Проводка']);
  assert.equal(v.order.brand, 'Scania', 'марка переходит из консультации');
  // повторно та же консультация скидку не даёт
  const again = ok(await t.api('POST', '/api/orders', { service: 'electric', zoneId: 'spb', fromConsult: id }, client.token));
  assert.equal(again.order.money.discount, 0);
  // в консультации видны выезды, вызванные после неё
  const c = ok(await t.api('GET', `/api/orders/${id}`, undefined, client.token));
  assert.equal(c.followUps.length, 2);
  // чужую консультацию не подставить
  const stranger = await t.login('+79994445566');
  assert.equal((await t.api('POST', '/api/orders', { service: 'electric', zoneId: 'spb', fromConsult: id }, stranger.token)).body.error, 'bad_consult');
});

test('консультация закрывается сама через сутки', async () => {
  const id = await takeConsult();
  ok(await t.api('POST', `/api/orders/${id}/consult-finish`, { hints: ['АКБ'], confidence: 'guess' }, master.token));
  t.clock.advance(25 * 3600);
  await t.app.orders.tick();
  const o = ok(await t.api('GET', `/api/orders/${id}`, undefined, client.token));
  assert.equal(o.status, 'completed');
});

test('история машины: все обращения, подсказка и комментарий мастера; удаление машины заявки не ломает', async () => {
  const v = ok(await t.api('POST', '/api/vehicles', { brand: 'DAF', model: 'XF', year: 2016, plate: 'а482км178' }, client.token));
  const c = ok(await t.api('POST', '/api/orders', { service: 'consult', vehicleId: v.id }, client.token));
  assert.equal(c.order.model, 'XF');
  assert.equal(c.order.year, 2016);
  ok(await t.api('POST', `/api/orders/${c.order.id}/offers`, {}, master.token));
  const list = ok(await t.api('GET', `/api/orders/${c.order.id}/offers`, undefined, client.token));
  ok(await t.api('POST', `/api/orders/${c.order.id}/offers/${list.offers[0].id}/choose`, {}, client.token));
  ok(await t.api('POST', `/api/orders/${c.order.id}/consult-finish`, { hints: ['Масса'], confidence: 'sure' }, master.token));
  ok(await t.api('POST', `/api/orders/${c.order.id}/confirm`, { total: 70_000 }, client.token));
  const h = ok(await t.api('GET', `/api/vehicles/${v.id}/history`, undefined, client.token));
  assert.equal(h.summary.total, 1);
  assert.equal(h.summary.spent, 70_000);
  assert.deepEqual(h.items[0].consult_hint.hints, ['Масса']);
  const stranger = await t.login('+79995557788');
  assert.equal((await t.api('GET', `/api/vehicles/${v.id}/history`, undefined, stranger.token)).status, 404);
  ok(await t.api('DELETE', `/api/vehicles/${v.id}`, undefined, client.token));
  assert.equal(ok(await t.api('GET', `/api/orders/${c.order.id}`, undefined, client.token)).status, 'completed');
});

test('кабинет исполнителя: до трёх машин, операции, вопрос по операции виден поддержке', async () => {
  const cars = [{ brand: 'Lada Largus', plate: 'А123ВС78' }, { brand: 'Ford Transit', plate: 'В456ОР78' }];
  const p = ok(await t.api('PUT', '/api/performer/profile', { kind: 'master', cars, car: cars[1] }, master.token));
  assert.equal(p.car.plate, 'В456ОР78');
  assert.equal(p.cars.length, 2);
  assert.equal((await t.api('PUT', '/api/performer/profile', { kind: 'master', cars: [...cars, cars[0], cars[1]] }, master.token)).status, 400);
  assert.equal((await t.api('PUT', '/api/performer/profile', { kind: 'master', cars, car: { brand: 'X', plate: 'Х000ХХ00' } }, master.token)).body.error, 'bad_car');
  ok(await t.api('POST', `/api/admin/performers/${master.id}/adjust`, { amount: 50_000, reason: 'Бонус за ночные выезды' }, admin.token));
  const ledger = ok(await t.api('GET', '/api/performer/ledger', undefined, master.token));
  const bonus = ledger.find((e: any) => e.kind === 'adjustment');
  assert.ok(bonus, 'корректировка видна исполнителю');
  const th = ok(await t.api('POST', '/api/support', { topic: 'Вопрос по операции', text: 'За что начислили?', ledgerEntryId: bonus.id }, master.token));
  assert.equal(th.entry.id, bonus.id);
  const staff = ok(await t.api('GET', `/api/support/${th.id}`, undefined, admin.token));
  assert.equal(staff.entry.amount, 50_000);
  // чужую операцию не спросить
  assert.equal((await t.api('POST', '/api/support', { topic: 'Вопрос', text: 'А это?', ledgerEntryId: bonus.id }, client.token)).status, 404);
  const again = ok(await t.api('GET', '/api/performer/ledger', undefined, master.token));
  assert.equal(again.find((e: any) => e.id === bonus.id).ticket_id, th.id);
});
