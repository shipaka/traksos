import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, ok, type T } from './helpers.ts';

// Мой парк: лимиты водителя, подтверждение владельцем, права, вход по QR-наклейке.

let t: T;
let owner: { token: string; id: string };
let driver: { token: string; id: string };
let vehicleId: string;
let qr: string;

before(async () => {
  t = await setup();
  owner = await t.login('+79991112233');
  vehicleId = ok(await t.api('POST', '/api/vehicles', { brand: 'DAF', model: 'XF', plate: 'а482км178' }, owner.token)).id;
  qr = ok(await t.api('GET', '/api/fleet', undefined, owner.token)).cars[0].qrCode;
});
after(() => t.close());

test('водитель входит по QR-наклейке; прежний теряет доступ; своя машина владельца — нельзя', async () => {
  const info = ok(await t.api('GET', `/api/qr/${qr}`));
  assert.equal(info.brand, 'DAF');
  assert.ok(!info.plate.includes('482'), 'госномер на публичной странице скрыт');
  assert.equal((await t.api('POST', `/api/qr/${qr}/join`, {}, owner.token)).status, 400);
  driver = await t.login('+79993334455');
  ok(await t.api('POST', `/api/qr/${qr}/join`, {}, driver.token));
  const f = ok(await t.api('GET', '/api/fleet', undefined, owner.token));
  assert.equal(f.cars[0].driver.id, driver.id);
  assert.match(f.cars[0].driver.phone, /\*\*\*/);
  const other = await t.login('+79993334466');
  ok(await t.api('POST', `/api/qr/${qr}/join`, {}, other.token));
  assert.equal(ok(await t.api('GET', '/api/vehicles', undefined, driver.token)).length, 0, 'прежний водитель машину больше не видит');
  ok(await t.api('POST', `/api/qr/${qr}/join`, {}, driver.token));
  const fresh = ok(await t.api('POST', `/api/fleet/vehicles/${vehicleId}/new-qr`, {}, owner.token));
  assert.notEqual(fresh.cars[0].qrCode, qr);
  assert.equal(fresh.cars[0].driver, null, 'новая наклейка — водителя снимаем');
  assert.equal((await t.api('GET', `/api/qr/${qr}`)).status, 404, 'старая наклейка не действует');
  qr = fresh.cars[0].qrCode;
  ok(await t.api('POST', `/api/qr/${qr}/join`, {}, driver.token));
});

test('лимит на заказ: дороже — ждёт владельца; подтвердил — ищем; отказал — отменено; SOS — всегда', async () => {
  ok(await t.api('PUT', '/api/fleet', { mode: 'limit', perOrder: 100_000 }, owner.token));
  const r = ok(await t.api('GET', '/api/fleet/rules', undefined, driver.token));
  assert.equal(r.perOrder, 100_000);
  const a = ok(await t.api('POST', '/api/orders', { service: 'electric', zoneId: 'spb', vehicleId, description: 'Не горит свет' }, driver.token)).order;
  assert.equal(a.status, 'awaiting_owner');
  const f = ok(await t.api('GET', '/api/fleet', undefined, owner.token));
  assert.equal(f.pending.length, 1);
  assert.equal((await t.api('POST', `/api/orders/${a.id}/owner-decision`, { approve: true }, driver.token)).status, 404, 'водитель сам себе не подтверждает');
  assert.notEqual(ok(await t.api('POST', `/api/orders/${a.id}/owner-decision`, { approve: true }, owner.token)).status, 'awaiting_owner');
  ok(await t.api('POST', `/api/orders/${a.id}/cancel`, { reason: 'тест' }, driver.token));

  const b = ok(await t.api('POST', '/api/orders', { service: 'electric', zoneId: 'spb', vehicleId, description: 'Опять свет' }, driver.token)).order;
  const no = ok(await t.api('POST', `/api/orders/${b.id}/owner-decision`, { approve: false, reason: 'Дотяни до базы' }, owner.token));
  assert.equal(no.status, 'cancelled');
  assert.equal(no.cancelReason, 'Дотяни до базы');

  const sos = ok(await t.api('POST', '/api/orders', { service: 'electric', zoneId: 'spb', vehicleId, isSos: true, description: 'Встал на КАД' }, driver.token)).order;
  assert.notEqual(sos.status, 'awaiting_owner', 'SOS — без подтверждения');
  ok(await t.api('POST', `/api/orders/${sos.id}/cancel`, { reason: 'тест' }, driver.token));

  const c = ok(await t.api('POST', '/api/orders', { service: 'consult', vehicleId }, driver.token)).order;
  assert.notEqual(c.status, 'awaiting_owner', 'консультация дешевле лимита — сразу');
  ok(await t.api('POST', `/api/orders/${c.id}/cancel`, { reason: 'тест' }, driver.token));
});

test('«всё через меня» и запреты: эвакуатор и запись в сервис', async () => {
  ok(await t.api('PUT', '/api/fleet', { mode: 'approve', allow: { tow: false, service: false } }, owner.token));
  const c = ok(await t.api('POST', '/api/orders', { service: 'consult', vehicleId }, driver.token)).order;
  assert.equal(c.status, 'awaiting_owner');
  ok(await t.api('POST', `/api/orders/${c.id}/cancel`, { reason: 'тест' }, driver.token));
  assert.equal((await t.api('POST', '/api/orders', { service: 'tow', zoneId: 'spb', vehicleId, cargo: 'tractor' }, driver.token)).status, 403);
  const sosTow = ok(await t.api('POST', '/api/orders', { service: 'tow', zoneId: 'spb', vehicleId, cargo: 'tractor', isSos: true }, driver.token)).order;
  assert.notEqual(sosTow.status, 'awaiting_owner', 'SOS водителю доступен всегда');
  ok(await t.api('POST', `/api/orders/${sosTow.id}/cancel`, { reason: 'тест' }, driver.token));
  const fs = ok(await t.api('GET', '/api/fleet', undefined, owner.token));
  assert.equal(fs.settings.allow.tow, false);
  assert.equal(fs.settings.allow.repair, true);
  assert.equal((await t.api('GET', '/api/fleet', undefined, driver.token)).status, 400, 'парк видит только владелец');
});

test('владелец не может назначить себя водителем; снятый водитель не видит историю машины',async()=>{
  const self=await t.api('POST',`/api/vehicles/${vehicleId}/driver`,{phone:'+79991112233'},owner.token);
  assert.equal(self.status,400);
  const before=ok(await t.api('GET','/api/fleet',undefined,owner.token));
  assert.equal(before.cars[0].driver.id,driver.id);
  const history=ok(await t.api('GET',`/api/vehicles/${vehicleId}/history`,undefined,driver.token));
  assert.equal(history.summary.spent,null);
  assert.ok(history.items.every((item:any)=>item.amount===null&&item.lines===null));
  ok(await t.api('POST',`/api/vehicles/${vehicleId}/driver`,{phone:null},owner.token));
  assert.equal((await t.api('GET',`/api/vehicles/${vehicleId}/history`,undefined,driver.token)).status,404);
  assert.equal(ok(await t.api('GET','/api/vehicles',undefined,driver.token)).length,0);
});

test('расходы водителя ограничены текущим парком и не переполняют int32', async () => {
  // The preceding history ACL regression deliberately detached this driver.
  // Re-establish the initial assignment through the actual QR flow.
  const oldQr = ok(await t.api('GET', '/api/fleet', undefined, owner.token)).cars[0].qrCode;
  ok(await t.api('POST', `/api/qr/${oldQr}/join`, {}, driver.token));
  // Existing SOS exception permits creating an order despite approval mode.
  const oldOrder = ok(await t.api('POST', '/api/orders', {
    service: 'consult', vehicleId, isSos: true, description: 'Тест старого автопарка',
  }, driver.token)).order;
  // Synthetic stored amounts only; no payment provider calls to create these amounts.
  await t.db.query(`update orders set status='completed', call_out_amount=1500000000,
    work_amount=1000000000, created_at=now() where id=$1`, [oldOrder.id]);
  const beforeMove = ok(await t.api('GET', '/api/fleet', undefined, owner.token));
  assert.equal(beforeMove.cars[0].driver.monthSpent, 2500000000);
  assert.equal(ok(await t.api('GET', '/api/fleet/rules', undefined, driver.token)).monthSpent, 2500000000);

  const nextOwner = await t.login('+79993334477');
  const nextVehicle = ok(await t.api('POST', '/api/vehicles', {
    brand: 'DAF', model: 'XF', plate: 'а483км178',
  }, nextOwner.token)).id;
  const nextQr = ok(await t.api('GET', '/api/fleet', undefined, nextOwner.token)).cars[0].qrCode;
  ok(await t.api('POST', `/api/fleet/vehicles/${vehicleId}/new-qr`, {}, owner.token));
  ok(await t.api('POST', `/api/qr/${nextQr}/join`, {}, driver.token));
  ok(await t.api('PUT', '/api/fleet', { mode: 'limit', perMonth: 100000 }, nextOwner.token));
  const nextFleet = ok(await t.api('GET', '/api/fleet', undefined, nextOwner.token));
  assert.equal(nextFleet.cars[0].driver.monthSpent, 0);
  assert.equal(ok(await t.api('GET', '/api/fleet/rules', undefined, driver.token)).monthSpent, 0);
  const nextOrder = ok(await t.api('POST', '/api/orders', { service: 'consult', vehicleId: nextVehicle }, driver.token)).order;
  assert.notEqual(nextOrder.status, 'awaiting_owner', 'старые расходы не расходуют лимит нового владельца');
  const stored = await t.db.one<{ client_id: string }>('select client_id from orders where id=$1', [oldOrder.id]);
  assert.equal(stored?.client_id, owner.id, 'история старого парка не переносится');
});

test('параллельные заявки резервируют лимит атомарно; повтор ключа и SOS сохраняются', async () => {
  const fleetOwner = await t.login('+79993334488');
  const fleetDriver = await t.login('+79993334499');
  const car = ok(await t.api('POST', '/api/vehicles', { brand: 'DAF', model: 'XF' }, fleetOwner.token)).id;
  const sticker = ok(await t.api('GET', '/api/fleet', undefined, fleetOwner.token)).cars[0].qrCode;
  ok(await t.api('POST', `/api/qr/${sticker}/join`, {}, fleetDriver.token));
  const amount = (await t.app.settings.all()).pricing.consult?.price ?? 70000;
  ok(await t.api('PUT', '/api/fleet', { mode: 'limit', perMonth: amount }, fleetOwner.token));

  // Keep the real HTTP/ACL/DB/create path, but freeze dispatch and payment
  // after commit: a no-performer outcome would legitimately release budget.
  const originalLaunch = t.app.orders.launch;
  t.app.orders.launch = async (actor, order) => ({
    order: await t.app.orders.view(actor, order.id), confirmationUrl: null,
  });
  const send = async (key: string, description: string, isSos = false) => {
    const res = await fetch(t.base + '/api/orders', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + fleetDriver.token, 'idempotency-key': key },
      body: JSON.stringify({ service: 'consult', vehicleId: car, description, isSos }),
    });
    return ok({ status: res.status, body: await res.json() }).order;
  };
  try {
    const [a, b, repeat] = await Promise.all([
      send('fleet-limit-a-20261125', 'A'),
      send('fleet-limit-b-20261125', 'B'),
      send('fleet-limit-a-20261125', 'A'),
    ]);
    assert.equal(a.id, repeat.id);
    assert.notEqual(a.id, b.id);
    assert.deepEqual([a.status, b.status].sort(), ['awaiting_owner', 'searching']);
    assert.equal(ok(await t.api('GET', '/api/fleet/rules', undefined, fleetDriver.token)).monthSpent, amount);
    const replay = await send('fleet-limit-a-20261125', 'A');
    assert.equal(replay.id, a.id);
    const sos = await send('fleet-limit-sos-20261125', 'SOS', true);
    assert.equal(sos.status, 'searching');
    const rows = await t.db.query('select status from orders where client_id=$1 and created_by=$2', [fleetOwner.id, fleetDriver.id]);
    assert.equal(rows.length, 3);
    assert.equal(rows.filter(r => r.status === 'awaiting_owner').length, 1);
    assert.equal(ok(await t.api('GET', '/api/fleet/rules', undefined, fleetDriver.token)).monthSpent, 2 * amount);
  } finally {
    t.app.orders.launch = originalLaunch;
  }
});

test('конкурирующие решения владельца, повторы и откат события', async () => {
  const fleetOwner = await t.login('+79993334501');
  const fleetDriver = await t.login('+79993334502');
  const car = ok(await t.api('POST', '/api/vehicles', { brand: 'DAF', model: 'XF' }, fleetOwner.token)).id;
  const sticker = ok(await t.api('GET', '/api/fleet', undefined, fleetOwner.token)).cars[0].qrCode;
  ok(await t.api('POST', `/api/qr/${sticker}/join`, {}, fleetDriver.token));
  ok(await t.api('PUT', '/api/fleet', { mode: 'approve' }, fleetOwner.token));
  const create = async () => ok(await t.api('POST', '/api/orders', { service: 'consult', vehicleId: car }, fleetDriver.token)).order;
  const decide = (id: string, approve: boolean, reason?: string) => t.api('POST', `/api/orders/${id}/owner-decision`, { approve, reason }, fleetOwner.token);
  const decisions = (id: string) => t.db.query("select type,data from order_events where order_id=$1 and type in ('owner_approved','owner_rejected')", [id]);
  const notices = (id: string) => t.db.query("select title from notifications where user_id=$1 and data->>'orderId'=$2 and title in ('Владелец подтвердил заказ','Владелец отклонил заказ')", [fleetDriver.id,id]);
  const chat = (id: string) => t.db.query("select body from chat_messages where order_id=$1 and kind='system' and body like 'Владелец отклонил заказ:%'", [id]);
  const originalLaunch = t.app.orders.launch;
  const originalEvent = t.app.orders.event;
  const launched: string[] = [];
  t.app.orders.launch = async (actor, order) => {
    launched.push(order.id);
    return { order: await t.app.orders.view(actor, order.id), confirmationUrl: null };
  };
  try {
    const a = await create();
    const [yes, no] = await Promise.all([decide(a.id,true),decide(a.id,false,'Отказ')]);
    assert.deepEqual([yes.status,no.status].sort(), [200,409]);
    const approved = yes.status === 200;
    const event = await decisions(a.id);
    assert.equal(event.length,1);
    assert.equal(event[0].type,approved ? 'owner_approved' : 'owner_rejected');
    assert.equal((await notices(a.id)).length,1);
    assert.equal((await chat(a.id)).length,approved ? 0 : 1);
    assert.equal(launched.filter(id=>id===a.id).length,approved ? 1 : 0);
    assert.equal((await decide(a.id,approved,approved ? undefined : 'Отказ')).status,200);
    assert.equal((await decide(a.id,!approved,'Отказ')).status,409);
    assert.equal((await decisions(a.id)).length,1);
    assert.equal((await notices(a.id)).length,1);
    assert.equal(launched.filter(id=>id===a.id).length,approved ? 1 : 0);

    const b = await create();
    const rejections = await Promise.all([decide(b.id,false,'Не сейчас'),decide(b.id,false,'Не сейчас')]);
    assert.deepEqual(rejections.map(r=>r.status),[200,200]);
    assert.equal((await decisions(b.id)).length,1);
    assert.equal((await notices(b.id)).length,1);
    assert.equal((await chat(b.id)).length,1);
    assert.equal((await decide(b.id,false,'Другая причина')).status,409);

    const c = await create();
    t.app.orders.event = async (...args) => {
      if (args[1]===c.id && args[3]==='owner_rejected') throw new Error('synthetic decision event failure');
      return originalEvent.apply(t.app.orders,args);
    };
    assert.equal((await decide(c.id,false,'Откат')).status,500);
    t.app.orders.event = originalEvent;
    assert.equal((await t.db.one('select status from orders where id=$1',[c.id]))?.status,'awaiting_owner');
    assert.equal((await decisions(c.id)).length,0);
    assert.equal((await notices(c.id)).length,0);
    assert.equal((await chat(c.id)).length,0);
    assert.equal((await decide(c.id,false,'Откат')).status,200);
    assert.equal((await decisions(c.id)).length,1);

    const d = await create();
    ok(await t.api('POST', `/api/fleet/vehicles/${car}/new-qr`, {}, fleetOwner.token));
    assert.equal((await decide(d.id,false,'Водитель снят')).status,200);
    assert.equal((await decisions(d.id)).length,1);
    assert.equal((await notices(d.id)).length,0);
    assert.equal((await chat(d.id)).length,1);
  } finally {
    t.app.orders.launch = originalLaunch;
    t.app.orders.event = originalEvent;
  }
});

test('параллельная замена QR и вход по старой наклейке не возвращают доступ', async () => {
  const fleetOwner = await t.login('+79993334511');
  const fleetDriver = await t.login('+79993334512');
  const car = ok(await t.api('POST', '/api/vehicles', { brand: 'DAF', model: 'XF' }, fleetOwner.token)).id;
  const sticker = ok(await t.api('GET', '/api/fleet', undefined, fleetOwner.token)).cars[0].qrCode;
  const [rotate, join] = await Promise.all([
    t.api('POST', `/api/fleet/vehicles/${car}/new-qr`, {}, fleetOwner.token),
    t.api('POST', `/api/qr/${sticker}/join`, {}, fleetDriver.token),
  ]);
  ok(rotate);
  assert.ok([200, 404].includes(join.status), 'вход возможен только до отзыва наклейки');
  const final = ok(await t.api('GET', '/api/fleet', undefined, fleetOwner.token)).cars[0];
  assert.notEqual(final.qrCode, sticker);
  assert.equal(final.driver, null);
  assert.equal((await t.api('GET', `/api/qr/${sticker}`)).status, 404);
  assert.equal((await t.api('POST', `/api/qr/${sticker}/join`, {}, fleetDriver.token)).status, 404);
  assert.equal(ok(await t.api('GET', '/api/vehicles', undefined, fleetDriver.token)).length, 0);
  assert.equal((await t.db.one('select owner_id from users where id=$1', [fleetDriver.id]))?.owner_id, null);
  // The replacement sticker remains usable; revocation must not lock out a legitimate driver.
  ok(await t.api('POST', `/api/qr/${final.qrCode}/join`, {}, fleetDriver.token));
  assert.equal(ok(await t.api('GET', '/api/fleet', undefined, fleetOwner.token)).cars[0].driver.id, fleetDriver.id);
});

test('две одновременные привязки водителя к разным паркам дают ровно одну машину', async () => {
  const firstOwner = await t.login('+79993334513');
  const secondOwner = await t.login('+79993334514');
  const fleetDriver = await t.login('+79993334515');
  const firstCar = ok(await t.api('POST', '/api/vehicles', { brand: 'DAF', model: 'XF' }, firstOwner.token)).id;
  const secondCar = ok(await t.api('POST', '/api/vehicles', { brand: 'DAF', model: 'XF' }, secondOwner.token)).id;
  const firstQr = ok(await t.api('GET', '/api/fleet', undefined, firstOwner.token)).cars[0].qrCode;
  const secondQr = ok(await t.api('GET', '/api/fleet', undefined, secondOwner.token)).cars[0].qrCode;
  const [first, second] = await Promise.all([
    t.api('POST', `/api/qr/${firstQr}/join`, {}, fleetDriver.token),
    t.api('POST', `/api/qr/${secondQr}/join`, {}, fleetDriver.token),
  ]);
  // A stale client token may fail live-role revalidation after the first conversion.
  assert.equal([first, second].filter(r => r.status === 200).length, 1);
  assert.ok([first, second].every(r => [200, 403, 409].includes(r.status)));
  const winner = first.status === 200 ? firstOwner : secondOwner;
  const winnerCar = first.status === 200 ? firstCar : secondCar;
  const loser = first.status === 200 ? secondOwner : firstOwner;
  const loserQr = first.status === 200 ? secondQr : firstQr;
  const loserCar = first.status === 200 ? secondCar : firstCar;
  assert.equal(ok(await t.api('GET', '/api/fleet', undefined, winner.token)).cars[0].driver.id, fleetDriver.id);
  assert.equal(ok(await t.api('GET', '/api/fleet', undefined, loser.token)).cars[0].driver, null);
  const assignments = await t.db.query('select id, owner_id from vehicles where driver_id=$1', [fleetDriver.id]);
  assert.deepEqual(assignments.map(r => [r.id, r.owner_id]), [[winnerCar, winner.id]]);
  assert.equal((await t.db.one('select owner_id from users where id=$1', [fleetDriver.id]))?.owner_id, winner.id);
  assert.equal((await t.api('GET', `/api/vehicles/${loserCar}/history`, undefined, fleetDriver.token)).status, 404);
  assert.equal((await t.api('POST', `/api/qr/${loserQr}/join`, {}, fleetDriver.token)).status, 409);
});

test('сбой доставки уведомления не блокирует единственный запуск подтверждённой заявки', async () => {
  const fleetOwner = await t.login('+79993334516');
  const fleetDriver = await t.login('+79993334517');
  const car = ok(await t.api('POST', '/api/vehicles', { brand: 'DAF', model: 'XF' }, fleetOwner.token)).id;
  const sticker = ok(await t.api('GET', '/api/fleet', undefined, fleetOwner.token)).cars[0].qrCode;
  ok(await t.api('POST', `/api/qr/${sticker}/join`, {}, fleetDriver.token));
  ok(await t.api('PUT', '/api/fleet', { mode: 'approve' }, fleetOwner.token));
  const order = ok(await t.api('POST', '/api/orders', { service: 'consult', vehicleId: car }, fleetDriver.token)).order;
  assert.equal(order.status, 'awaiting_owner');
  const originalDeliver = t.app.notifier.deliverStored;
  const originalLaunch = t.app.orders.launch;
  let launchCount = 0;
  let deliveryCount = 0;
  t.app.notifier.deliverStored = async (...args) => {
    if (args[1].type === 'order' && args[1].orderId === order.id && args[1].status === 'searching') {
      deliveryCount++;
      throw new Error('synthetic post-commit delivery failure');
    }
    return originalDeliver.apply(t.app.notifier, args);
  };
  // Exercise the real decision transaction, not external payments or dispatch.
  t.app.orders.launch = async (actor, launched) => {
    assert.equal(launched.id, order.id);
    launchCount++;
    return { order: await t.app.orders.view(actor, launched.id), confirmationUrl: null };
  };
  try {
    const approve = () => t.api('POST', `/api/orders/${order.id}/owner-decision`, { approve: true }, fleetOwner.token);
    assert.equal(ok(await approve()).status, 'searching');
    assert.equal(ok(await approve()).status, 'searching');
    assert.equal(deliveryCount, 1);
    assert.equal(launchCount, 1);
    const events = await t.db.query("select type from order_events where order_id=$1 and type='owner_approved'", [order.id]);
    assert.equal(events.length, 1);
    const inbox = await t.db.query("select id from notifications where user_id=$1 and data->>'orderId'=$2 and title='Владелец подтвердил заказ'", [fleetDriver.id, order.id]);
    assert.equal(inbox.length, 1);
  } finally {
    t.app.notifier.deliverStored = originalDeliver;
    t.app.orders.launch = originalLaunch;
  }
});

test('решение владельца проверяет действующий аккаунт даже при устаревшем контексте', async () => {
  const fleetOwner = await t.login('+79993334518');
  const fleetDriver = await t.login('+79993334519');
  const car = ok(await t.api('POST', '/api/vehicles', { brand: 'DAF', model: 'XF' }, fleetOwner.token)).id;
  const sticker = ok(await t.api('GET', '/api/fleet', undefined, fleetOwner.token)).cars[0].qrCode;
  ok(await t.api('POST', `/api/qr/${sticker}/join`, {}, fleetDriver.token));
  ok(await t.api('PUT', '/api/fleet', { mode: 'approve' }, fleetOwner.token));
  const order = ok(await t.api('POST', '/api/orders', { service: 'consult', vehicleId: car }, fleetDriver.token)).order;
  const actor = { id: fleetOwner.id, phone: '+79993334518', name: null,
    roles: ['client'], status: 'active', owner_id: null };
  const reject = () => t.app.orders.ownerDecision(actor, order.id, false, 'Тест полномочий');
  const denied = (error: unknown) => !!error && typeof error === 'object' &&
    'status' in error && error.status === 404;
  const events = () => t.db.query("select type from order_events where order_id=$1 and type in ('owner_approved','owner_rejected')", [order.id]);
  try {
    await t.db.query('update users set deleted_at=now() where id=$1', [fleetOwner.id]);
    await assert.rejects(reject, denied);
    assert.equal((await t.db.one('select status from orders where id=$1', [order.id]))?.status, 'awaiting_owner');
    assert.equal((await events()).length, 0);
  } finally {
    await t.db.query('update users set deleted_at=null where id=$1', [fleetOwner.id]);
  }
  // A deleted driver with a historical assignment must not get a new inbox entry.
  try {
    await t.db.query('update users set deleted_at=now() where id=$1', [fleetDriver.id]);
    assert.equal((await reject()).status, 'cancelled');
    const inbox = await t.db.query("select id from notifications where user_id=$1 and data->>'orderId'=$2 and title='Владелец отклонил заказ'", [fleetDriver.id, order.id]);
    assert.equal(inbox.length, 0);
  } finally {
    await t.db.query('update users set deleted_at=null where id=$1', [fleetDriver.id]);
  }
  try {
    await t.db.query('update users set deleted_at=now() where id=$1', [fleetOwner.id]);
    await assert.rejects(reject, denied);
    assert.equal((await events()).length, 1);
  } finally {
    await t.db.query('update users set deleted_at=null where id=$1', [fleetOwner.id]);
  }
  assert.equal((await reject()).status, 'cancelled');
  assert.equal((await events()).length, 1);
});

test('месячный лимит учитывает только текущий календарный месяц по Москве', async () => {
  const fleetOwner = await t.login('+79993334520');
  const fleetDriver = await t.login('+79993334521');
  const car = ok(await t.api('POST', '/api/vehicles', { brand: 'DAF', model: 'XF' }, fleetOwner.token)).id;
  const sticker = ok(await t.api('GET', '/api/fleet', undefined, fleetOwner.token)).cars[0].qrCode;
  ok(await t.api('POST', `/api/qr/${sticker}/join`, {}, fleetDriver.token));
  ok(await t.api('PUT', '/api/fleet', { mode: 'approve' }, fleetOwner.token));
  const order = ok(await t.api('POST', '/api/orders', { service: 'consult', vehicleId: car }, fleetDriver.token)).order;
  assert.equal(order.status, 'awaiting_owner');
  // Synthetic accounting fixture in the disposable database; no provider call.
  // All four checks use one transaction and the same PostgreSQL clock.
  await t.db.tx(async q => {
    const amount = 12345;
    const offsets = [
      { offset: '-1 microsecond', expected: 0 },
      { offset: '0 seconds', expected: amount },
      { offset: '1 month -1 microsecond', expected: amount },
      { offset: '1 month', expected: 0 },
    ];
    for (const { offset, expected } of offsets) {
      await q.query(`update orders set status='completed', call_out_amount=$2, work_amount=0,
        created_at=((date_trunc('month', now() at time zone 'Europe/Moscow') + $3::interval) at time zone 'Europe/Moscow')
        where id=$1`, [order.id, amount, offset]);
      assert.equal(await t.app.orders.monthSpent(fleetDriver.id, fleetOwner.id, q), expected, offset);
    }
    // Restore the date so later diagnostics are not polluted by a future row.
    await q.query('update orders set created_at=now() where id=$1', [order.id]);
  });
});

test('новая заявка автопарка требует действующих владельца и водителя даже для SOS', async () => {
  const fleetOwner = await t.login('+79993334522');
  const fleetDriver = await t.login('+79993334523');
  const car = ok(await t.api('POST', '/api/vehicles', { brand: 'DAF', model: 'XF' }, fleetOwner.token)).id;
  const sticker = ok(await t.api('GET', '/api/fleet', undefined, fleetOwner.token)).cars[0].qrCode;
  ok(await t.api('POST', `/api/qr/${sticker}/join`, {}, fleetDriver.token));
  ok(await t.api('PUT', '/api/fleet', { mode: 'approve' }, fleetOwner.token));
  // Simulate authorization already captured by an in-flight request.
  const actor = { id: fleetDriver.id, phone: '+79993334523', name: null,
    roles: ['driver'], status: 'active', owner_id: fleetOwner.id };
  const create = (isSos: boolean) => t.app.orders.create(actor, { service: 'consult', vehicleId: car, isSos });
  const denied = (error: unknown) => !!error && typeof error === 'object' &&
    'status' in error && error.status === 403;
  const rows = () => t.db.query('select id from orders where client_id=$1 and created_by=$2', [fleetOwner.id, fleetDriver.id]);
  const originalLaunch = t.app.orders.launch;
  let launches = 0;
  t.app.orders.launch = async (user, order) => {
    launches++;
    return { order: await t.app.orders.view(user, order.id), confirmationUrl: null };
  };
  try {
    for (const id of [fleetOwner.id, fleetDriver.id]) {
      try {
        await t.db.query('update users set deleted_at=now() where id=$1', [id]);
        await assert.rejects(() => create(false), denied);
        await assert.rejects(() => create(true), denied);
        assert.equal((await rows()).length, 0);
        assert.equal(launches, 0);
      } finally {
        await t.db.query('update users set deleted_at=null where id=$1', [id]);
      }
    }
    // A valid driver keeps the existing emergency bypass and normal approval.
    assert.equal((await create(false)).order.status, 'awaiting_owner');
    assert.equal((await create(true)).order.status, 'searching');
    assert.equal((await rows()).length, 2);
    assert.equal(launches, 1);
  } finally {
    t.app.orders.launch = originalLaunch;
  }
});

test('ожидающая подтверждения заявка, события и уведомление сохраняются атомарно', async () => {
  const fleetOwner = await t.login('+79993334524');
  const fleetDriver = await t.login('+79993334525');
  const car = ok(await t.api('POST', '/api/vehicles', { brand: 'DAF', model: 'XF' }, fleetOwner.token)).id;
  const sticker = ok(await t.api('GET', '/api/fleet', undefined, fleetOwner.token)).cars[0].qrCode;
  ok(await t.api('POST', `/api/qr/${sticker}/join`, {}, fleetDriver.token));
  ok(await t.api('PUT', '/api/fleet', { mode: 'approve' }, fleetOwner.token));
  const actor = { id: fleetDriver.id, phone: '+79993334525', name: null,
    roles: ['driver'], status: 'active', owner_id: fleetOwner.id };
  const create = () => t.app.orders.create(actor, { service: 'consult', vehicleId: car }, 'fleet-approval-atomic-20261125');
  const originalEvent = t.app.orders.event;
  const originalDelivery = t.app.notifier.deliverStored;
  let deliveries = 0;
  try {
    t.app.orders.event = async (...args) => {
      if (args[3] === 'owner_approval_requested') throw new Error('synthetic approval event failure');
      return originalEvent.apply(t.app.orders, args);
    };
    await assert.rejects(create, /synthetic approval event failure/);
    assert.equal((await t.db.query('select id from orders where client_id=$1 and created_by=$2', [fleetOwner.id, fleetDriver.id])).length, 0);
    assert.equal((await t.db.query("select id from notifications where user_id=$1 and title='Водитель просит подтвердить заказ'", [fleetOwner.id])).length, 0);
    t.app.orders.event = originalEvent;
    t.app.notifier.deliverStored = async (...args) => {
      if (args[1].type === 'order' && args[1].status === 'awaiting_owner') {
        deliveries++;
        throw new Error('synthetic postcommit delivery failure');
      }
      return originalDelivery.apply(t.app.notifier, args);
    };
    const first = (await create()).order;
    assert.equal(first.status, 'awaiting_owner');
    const replay = (await create()).order;
    assert.equal(replay.id, first.id);
    assert.equal(deliveries, 1);
    const events = await t.db.query("select type from order_events where order_id=$1 and type in ('created','owner_approval_requested') order by id", [first.id]);
    assert.deepEqual(events.map(e => e.type), ['created','owner_approval_requested']);
    const inbox = await t.db.query("select id from notifications where user_id=$1 and data->>'orderId'=$2 and title='Водитель просит подтвердить заказ'", [fleetOwner.id, first.id]);
    assert.equal(inbox.length, 1);
  } finally {
    t.app.orders.event = originalEvent;
    t.app.notifier.deliverStored = originalDelivery;
  }
});
