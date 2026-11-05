import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, ok, type T } from './helpers.ts';

// Магазин: выключатель «скоро», товары от админа, заказ клиента, резерв склада, статусы, отмена с возвратом на склад.

let t: T;
let admin: { token: string; id: string };
let client: { token: string; id: string };
let socket: string;
let kit: string;

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

before(async () => {
  t = await setup();
  admin = await t.login('+79990000001');
  client = await t.login('+79991112233');
});
after(() => t.close());

test('выключен: клиент видит «скоро», заказ не принимается; товары видит только админ', async () => {
  socket = ok(await t.api('POST', '/api/admin/shop/products', { category: 'socket', name: 'Розетка 15-контактная', spec: '24 В · ISO 12098', price: 120_000, stock: 3, photoDataUrl: PNG }, admin.token)).id;
  kit = ok(await t.api('POST', '/api/admin/shop/products', { category: 'kit', name: 'Тревожный чемоданчик', price: 450_000, isKit: true }, admin.token)).id;
  assert.equal((await t.api('POST', '/api/admin/shop/products', { name: 'Х', price: 1 }, client.token)).status, 403);
  const c = ok(await t.api('GET', '/api/shop', undefined, client.token));
  assert.equal(c.enabled, false);
  assert.equal(c.products.length, 0);
  assert.match(c.closedTitle, /скоро/i);
  assert.equal((await t.api('POST', '/api/shop/orders', { items: [{ productId: socket, qty: 1 }], delivery: 'pickup' }, client.token)).status, 409);
});

test('включили: витрина, наборы сверху, фото; заказ резервирует наличие; «под заказ» не трогает склад', async () => {
  ok(await t.api('PUT', '/api/admin/settings/shop', { enabled: true, pickupAddress: 'Шушары, склад ТракSOS' }, admin.token));
  const c = ok(await t.api('GET', '/api/shop', undefined, client.token));
  assert.equal(c.enabled, true);
  assert.equal(c.products[0].id, kit, 'набор — первым');
  const s = c.products.find((p: any) => p.id === socket);
  assert.equal(s.inStock, true);
  assert.equal(s.hasPhoto, true);
  const ph = await fetch(`${t.base}/api/shop/products/${socket}/photo`);
  assert.equal(ph.headers.get('content-type'), 'image/png');
  assert.equal((await t.api('POST', '/api/shop/orders', { items: [{ productId: socket, qty: 1 }], delivery: 'delivery' }, client.token)).status, 400, 'доставка без адреса');
  assert.equal((await t.api('POST', '/api/shop/orders', { items: [{ productId: socket, qty: 1 }], delivery: 'pickup', payment: 'invoice' }, client.token)).status, 400, 'счёт — только компании');
  const o = ok(await t.api('POST', '/api/shop/orders', { items: [{ productId: socket, qty: 2 }, { productId: kit, qty: 1 }], delivery: 'delivery', address: 'КАД, 45 км' }, client.token));
  assert.equal(o.goodsTotal, 2 * 120_000 + 450_000);
  assert.equal(o.total, o.goodsTotal + 50_000);
  assert.equal(o.items.find((i: any) => i.productId === kit).inStock, false, 'набор — под заказ');
  const p = ok(await t.api('GET', '/api/admin/shop/products', undefined, admin.token)).find((x: any) => x.id === socket);
  assert.equal(p.stock, 1, 'зарезервировали 2 из 3');
  assert.ok(t.app.hub.log.some((l) => l.userId === admin.id && l.event.type === 'shop'), 'админу пришло уведомление');
});

test('статусы заказа; отмена возвращает на склад; выключили магазин — заказы у клиента остаются', async () => {
  const [o] = ok(await t.api('GET', '/api/shop/orders', undefined, client.token));
  assert.equal(o.status, 'new');
  assert.equal((await t.api('POST', `/api/admin/shop/orders/${o.id}/status`, { status: 'done' }, admin.token)).status, 409, 'через шаг нельзя');
  ok(await t.api('POST', `/api/admin/shop/orders/${o.id}/status`, { status: 'confirmed', note: 'Привезём завтра до 18:00' }, admin.token));
  assert.equal((await t.api('POST', `/api/shop/orders/${o.id}/cancel`, {}, client.token)).status, 409, 'подтверждённый — отменяет только магазин');
  const c = ok(await t.api('POST', `/api/admin/shop/orders/${o.id}/status`, { status: 'cancelled', note: 'Нет у поставщика' }, admin.token));
  assert.equal(c.cancelReason, 'Нет у поставщика');
  const p = ok(await t.api('GET', '/api/admin/shop/products', undefined, admin.token)).find((x: any) => x.id === socket);
  assert.equal(p.stock, 3, 'вернули на склад');
  const o2 = ok(await t.api('POST', '/api/shop/orders', { items: [{ productId: socket, qty: 1 }], delivery: 'pickup' }, client.token));
  ok(await t.api('POST', `/api/shop/orders/${o2.id}/cancel`, {}, client.token));
  ok(await t.api('PUT', '/api/admin/settings/shop', { enabled: false }, admin.token));
  assert.equal(ok(await t.api('GET', '/api/shop/orders', undefined, client.token)).length, 2);
  ok(await t.api('DELETE', `/api/admin/shop/products/${socket}`, undefined, admin.token));
  ok(await t.api('PUT', '/api/admin/settings/shop', { enabled: true }, admin.token));
  assert.equal(ok(await t.api('GET', '/api/shop', undefined, client.token)).products.some((x: any) => x.id === socket), false, 'скрытый товар не виден');
});
