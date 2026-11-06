import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, ok, type T } from './helpers.ts';

// Доступ: посторонний не видит и не меняет чужие заявки, записи, машины, покупки, обращения и отзывы.

let t: T;
let admin: { token: string; id: string };
let owner: { token: string; id: string };
let stranger: { token: string; id: string };
let master: { token: string; id: string };
const ids: Record<string, string> = {};

before(async () => {
  t = await setup();
  admin = await t.login('+79990000001');
  owner = await t.login('+79991112233');
  stranger = await t.login('+79997776655');
  master = await t.login('+79992223344', 'master');
  ok(await t.api('PUT', '/api/performer/profile', { kind: 'master', name: 'Иван', specialties: ['electric'], taxStatus: 'self_employed', inn: '780000000001' }, master.token));
  ok(await t.api('POST', `/api/admin/performers/${master.id}/verify`, { decision: 'approved' }, admin.token));
  ok(await t.api('POST', '/api/performer/line', { lineStatus: 'online' }, master.token));
  ids.vehicle = ok(await t.api('POST', '/api/vehicles', { brand: 'DAF', plate: 'а482км178' }, owner.token)).id;
  const o = ok(await t.api('POST', '/api/orders', { service: 'electric', zoneId: 'spb', vehicleId: ids.vehicle, description: 'Свет прицепа' }, owner.token)).order;
  ids.order = o.id;
  ids.ticket = ok(await t.api('POST', '/api/support', { topic: 'Другое', text: 'Вопрос по заявке', orderId: o.id }, owner.token)).id;
  const base = await t.login('+79995556677', 'service');
  const c = ok(await t.api('PUT', '/api/base', { name: 'Шушары-Трак', address: 'Шушары, 50', staff: { electric: 'own' } }, base.token));
  ok(await t.api('POST', `/api/admin/services/${c.center.id}/verify`, { decision: 'approved' }, admin.token));
  const day = new Date(t.clock.now().getTime() + 3 * 3600_000).toISOString().slice(0, 10);
  ids.booking = ok(await t.api('POST', `/api/services/${c.center.id}/book`, { vehicleId: ids.vehicle, need: 'electric', day, arrival: 'self' }, owner.token)).id;
  ok(await t.api('PUT', '/api/admin/settings/shop', { enabled: true }, admin.token));
  const p = ok(await t.api('POST', '/api/admin/shop/products', { name: 'Розетка', price: 1000, stock: 5 }, admin.token));
  ids.shop = ok(await t.api('POST', '/api/shop/orders', { items: [{ productId: p.id, qty: 1 }], delivery: 'pickup' }, owner.token)).id;
});
after(() => t.close());

test('посторонний получает 403/404 на чужое — и ничего не меняется', async () => {
  const deny = [
    ['GET', `/api/orders/${ids.order}`], ['GET', `/api/orders/${ids.order}/messages`], ['GET', `/api/orders/${ids.order}/payments`],
    ['GET', `/api/orders/${ids.order}/reviews`], ['POST', `/api/orders/${ids.order}/messages`, { body: 'привет' }],
    ['POST', `/api/orders/${ids.order}/cancel`, { reason: 'чужая' }], ['POST', `/api/orders/${ids.order}/part`, { mode: 'wait' }],
    ['POST', `/api/orders/${ids.order}/owner-decision`, { approve: false }], ['POST', `/api/orders/${ids.order}/confirm`, {}],
    ['GET', `/api/bookings/${ids.booking}`], ['POST', `/api/bookings/${ids.booking}/cancel`, {}],
    ['GET', `/api/vehicles/${ids.vehicle}/history`], ['DELETE', `/api/vehicles/${ids.vehicle}`],
    ['POST', `/api/vehicles/${ids.vehicle}/driver`, { phone: '+79997776655' }], ['POST', `/api/fleet/vehicles/${ids.vehicle}/new-qr`, {}],
    ['POST', `/api/shop/orders/${ids.shop}/cancel`, {}], ['GET', `/api/support/${ids.ticket}`], ['POST', `/api/support/${ids.ticket}/messages`, { body: 'чужое' }], ['POST', `/api/support/${ids.ticket}/close`, {}],
    ['GET', `/api/users/${owner.id}/reviews`], ['GET', '/api/admin/summary'], ['GET', '/api/mod/cases'], ['GET', '/api/admin/shop/orders'],
  ] as const;
  for (const [m, path, body] of deny) {
    const r = await t.api(m, path, body as any, stranger.token);
    assert.ok([403, 404].includes(r.status), `${m} ${path} → ${r.status}`);
  }
  assert.notEqual(ok(await t.api('GET', `/api/orders/${ids.order}`, undefined, owner.token)).status, 'cancelled');
  assert.equal(ok(await t.api('GET', `/api/bookings/${ids.booking}`, undefined, owner.token)).status, 'new');
  assert.equal(ok(await t.api('GET', '/api/vehicles', undefined, owner.token)).length, 1);
  assert.equal(ok(await t.api('GET', '/api/shop/orders', undefined, owner.token))[0].status, 'new');
  // Отзывы об исполнителе видны всем
  ok(await t.api('GET', `/api/users/${master.id}/reviews`, undefined, stranger.token));
});

test('без входа — только публичное', async () => {
  for (const p of ['/api/orders', '/api/vehicles', '/api/shop', '/api/fleet', '/api/me/export', '/api/bookings']) {
    assert.equal((await t.api('GET', p)).status, 401, p);
  }
  ok(await t.api('GET', '/api/legal'));
});

test('SMS: не больше 8 кодов на номер в сутки', async () => {
  for (let i = 0; i < 8; i++) { ok(await t.api('POST', '/api/auth/code', { phone: '+79990001122' })); t.clock.advance(61); }
  const r = await t.api('POST', '/api/auth/code', { phone: '+79990001122' });
  assert.equal(r.status, 429);
  assert.equal(r.body.error, 'too_many_codes');
});

test('вход по номеру без роли: роли не меняются, новый номер — клиент', async () => {
  const enter = async (phone: string) => {
    const c = ok(await t.api('POST', '/api/auth/code', { phone }));
    t.clock.advance(61);
    return ok(await t.api('POST', '/api/auth/verify', { phone, code: c.devCode })).user;
  };
  const m = await enter('+79992223344');
  assert.deepEqual([...m.roles].sort(), ['master']);
  const fresh = await enter('+79993334455');
  assert.deepEqual(fresh.roles, ['client']);
  const a = await enter('+79990000001');
  assert.ok(a.roles.includes('admin'));
});
