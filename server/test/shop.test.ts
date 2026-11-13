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

test('Поиск, компактный кэш и история техники; только вручную подтверждённые аналоги', async () => {
  const first = ok(await t.api('POST', '/api/admin/shop/products', {
    category: 'air', name: 'Датчик давления воздуха', brand: 'TEST-VDO',
    article: 'TS-042', searchTerms: 'пневматика давление', price: 71_000, stock: 4,
  }, admin.token)).id;
  const second = ok(await t.api('POST', '/api/admin/shop/products', {
    category: 'air', name: 'Датчик воздуха аналог', brand: 'TEST-WABCO',
    article: 'ALT-042', price: 68_000, stock: 5,
  }, admin.token)).id;

  const hit = ok(await t.api('GET', '/api/shop/search?q=TS-042&limit=1', undefined, client.token));
  assert.equal(hit.items.length, 1);
  assert.equal(hit.items[0].article, 'TS-042');
  const aliases = ok(await t.api('GET', '/api/shop/search?q=пневматика', undefined, client.token));
  assert.ok(aliases.items.some((p: any) => p.id === first));
  const selection = ok(await t.api('GET', `/api/shop/selection?ids=${first}`, undefined, client.token));
  assert.equal(selection.products[0].brand, 'TEST-VDO');

  const manifest = ok(await t.api('GET', '/api/shop/index/manifest', undefined, client.token));
  assert.equal(manifest.enabled, true);
  assert.ok(manifest.count >= 2);
  const compact = ok(await t.api('GET', '/api/shop/index/page?limit=750', undefined, client.token));
  assert.ok(compact.rows.some((row: any[]) => row[0] === first && row[3] === 'TS-042'));
  assert.ok(compact.rows.every((row: any[]) => row.length === 6), 'нет цен, остатков и личных данных');

  ok(await t.api('POST', `/api/admin/shop/products/${first}/analogs`, {
    analogId: second, source: 'Тестовая проверка', verified: false,
  }, admin.token));
  let analogs = ok(await t.api('GET', `/api/shop/products/${first}/analogs`, undefined, client.token));
  assert.equal(analogs.items.length, 0, 'непроверенные кроссы не выдаём клиенту');
  ok(await t.api('POST', `/api/admin/shop/products/${first}/analogs`, {
    analogId: second, source: 'Тестовая проверка', verified: true,
  }, admin.token));
  analogs = ok(await t.api('GET', `/api/shop/products/${first}/analogs`, undefined, client.token));
  assert.equal(analogs.items[0].id, second);
  assert.equal(analogs.compatibilityConfirmed, false, 'применяемость по VIN отдельно');

  const vehicle = ok(await t.api('POST', '/api/vehicles', {
    brand: 'DAF', model: 'XF 105', plate: 'А001АА', vin: 'XLRTE47MS0E123456',
  }, client.token));
  const order = ok(await t.api('POST', '/api/shop/orders', {
    items: [{ productId: first, qty: 1 }], delivery: 'pickup', vehicleId: vehicle.id,
  }, client.token));
  assert.equal(order.vehicleId, vehicle.id);
  assert.equal(order.items[0].article, 'TS-042');
  const history = ok(await t.api('GET', `/api/shop/history?vehicleId=${vehicle.id}`, undefined, client.token));
  assert.ok(history.items.some((r: any) => r.id === order.id), 'покупка отображается у машины');
  assert.equal((await t.api('POST', '/api/shop/orders', {
    items: [{ productId: first, qty: 1 }], delivery: 'pickup', vehicleId: '00000000-0000-4000-8000-000000000001',
  }, client.token)).status, 403, 'нельзя привязать чужой грузовик');

  ok(await t.api('PUT', '/api/admin/settings/shop', { enabled: false }, admin.token));
  const closed = ok(await t.api('GET', '/api/shop/search?q=TS-042', undefined, client.token));
  assert.equal(closed.items.length, 0, 'магазин закрыт даже если индекс уже существует');
  assert.equal(ok(await t.api('GET', '/api/shop/index/manifest', undefined, client.token)).enabled, false);
  assert.equal((await t.api('POST', '/api/shop/orders', {
    items: [{ productId: first, qty: 1 }], delivery: 'pickup',
  }, client.token)).status, 409);
});
