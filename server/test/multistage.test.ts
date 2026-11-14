import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, ok, type T } from './helpers.ts';

let t: T;
let client: { token: string; id: string };
let outsider: { token: string; id: string };

before(async () => {
  t = await setup();
  client = await t.login('+79993330001');
  outsider = await t.login('+79993330002');
});
after(async () => { await t.close(); });

test('one SOS incident has independently priced stages; duplicate and foreign continuations fail', async () => {
  const original = ok(await t.api('POST', '/api/orders', {
    service: 'electric', isSos: true, zoneId: 'spb', brand: 'Scania',
    address: 'Трасса М-11, стоянка', description: 'Не заводится, требуется выездной электрик',
    paymentMethod: 'cash',
  }, client.token));
  const id: string = original.order.id;
  const next = {
    service: 'tow', isSos: true, zoneId: 'spb', brand: 'Scania',
    description: 'Эвакуация после диагностики', address: 'Трасса М-11, стоянка',
    destination: 'Грузовой сервис в Санкт-Петербурге', cargo: 'tractor',
    paymentMethod: 'cash', continueFrom: id,
  };
  assert.equal((await t.api('POST', '/api/orders', next, client.token)).body.error, 'stage_not_ready');

  // The first stage is a real settled contract. No duplicated stage cost is
  // transferred to the tow auction or its price.
  await t.db.query(
    `update orders set status='completed', result='cause_found',
           result_note='На дороге заменить агрегат невозможно',
           work_amount=150000, completed_at=now() where id=$1`, [id],
  );
  assert.equal((await t.api('POST', '/api/orders', next, outsider.token)).status, 403);
  const beforeTow = ok(await t.api('GET', `/api/orders/${id}`, undefined, client.token));
  assert.equal(beforeTow.canContinueWithTow, true);
  const repairCost = beforeTow.money.total;

  const linked = ok(await t.api('POST', '/api/orders', next, client.token)).order;
  assert.equal(linked.continuationOf, id);
  assert.equal(linked.caseRootId, id);
  assert.equal(linked.service, 'tow');
  assert.equal(linked.brand, 'Scania');
  assert.notEqual(linked.money.total, repairCost);
  assert.equal(linked.caseSummary.confirmedTotal, repairCost, 'only completed stages belong to the confirmed total');
  assert.equal(linked.caseSummary.stages.length, 2);
  assert.equal((await t.api('POST', '/api/orders', next, client.token)).body.error, 'continuation_exists');
  const source = ok(await t.api('GET', `/api/orders/${id}`, undefined, client.token));
  assert.equal(source.canContinueWithTow, false);
  assert.equal(source.caseSummary.multiStage, true);
  assert.equal(source.caseSummary.stages[0].money.total, repairCost);
  assert.equal(source.caseSummary.stages[1].id, linked.id);
  assert.equal(source.caseSummary.confirmedTotal, repairCost);
  assert.equal((await t.api('GET', `/api/orders/${id}`, undefined, outsider.token)).status, 403);
});
