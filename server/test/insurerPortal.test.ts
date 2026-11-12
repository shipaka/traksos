import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, ok, type T } from './helpers.ts';

// Сквозная проверка границ доступа: админ передаёт страховщику одну заявку,
// партнёр видит только её и может оформить полис, клиент получает результат.
let t: T;
let admin: { id: string; token: string };
let insurer: { id: string; token: string };
let client: { id: string; token: string };

before(async () => {
  t = await setup();
  admin = await t.login('+79990000001');
  insurer = await t.login('+79990000041');
  // Роль страховщика назначается администратором; публичная саморегистрация запрещена.
  await t.db.query('update users set roles=$2 where id=$1', [insurer.id, ['insurer']]);
  client = await t.login('+79990000042');
});
after(() => t.close());

test('страховщик видит только назначенный полис, не имеет доступа к админке и техосмотру', async () => {
  const vehicle = ok(await t.api('POST', '/api/vehicles', { brand: 'Scania', model: 'R', plate: 'А001АА78' }, client.token));
  const second = ok(await t.api('POST', '/api/vehicles', { brand: 'DAF', model: 'XF', plate: 'А002АА78' }, client.token));
  const insurance = ok(await t.api('POST', '/api/vehicle-service-requests',
    { vehicleId: vehicle.id, kind: 'insurance', comment: 'Нужен полис' }, client.token));
  const extra = ok(await t.api('POST', '/api/vehicle-service-requests',
    { vehicleId: second.id, kind: 'insurance' }, client.token));

  assert.equal((await t.api('GET', '/api/admin/vehicle-service-requests', undefined, insurer.token)).status, 403);
  assert.equal(ok(await t.api('GET', '/api/insurer/requests', undefined, insurer.token)).length, 0);

  ok(await t.api('PATCH', `/api/admin/vehicle-service-requests/${insurance.id}`, { status: 'in_review' }, admin.token));
  ok(await t.api('PATCH', `/api/admin/vehicle-service-requests/${insurance.id}`, { status: 'sent_to_partner' }, admin.token));

  const partners = ok(await t.api('GET', '/api/admin/insurers', undefined, admin.token));
  assert.ok(partners.some((p: any) => p.id === insurer.id));
  ok(await t.api('POST', `/api/admin/vehicle-service-requests/${insurance.id}/assign-insurer`,
    { insurerId: insurer.id }, admin.token));

  const mine = ok(await t.api('GET', '/api/insurer/requests', undefined, insurer.token));
  assert.equal(mine.length, 1);
  assert.equal(mine[0].id, insurance.id);
  assert.equal(mine[0].kind, 'insurance');

  assert.equal((await t.api('PATCH', `/api/insurer/requests/${extra.id}`,
    { status: 'rejected', note: 'Чужая заявка' }, insurer.token)).status, 403);
  assert.equal((await t.api('PATCH', `/api/insurer/requests/${insurance.id}`,
    { status: 'rejected' }, insurer.token)).status, 400, 'причина отказа обязательна');

  const completed = ok(await t.api('PATCH', `/api/insurer/requests/${insurance.id}`,
    { status: 'completed', policyExpiresOn: '2028-12-31', note: 'Полис оформлен' }, insurer.token));
  assert.equal(completed.status, 'completed');
  const history = ok(await t.api('GET', `/api/vehicles/${vehicle.id}/service-history`, undefined, client.token));
  assert.ok(history.some((x: any) => x.id === insurance.id && x.status === 'completed'));
  assert.equal((await t.api('POST', `/api/admin/vehicle-service-requests/${extra.id}/assign-insurer`,
    { insurerId: insurer.id }, insurer.token)).status, 403);
});
