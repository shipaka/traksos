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

test('Обновление локального каталога — только изменённые артикулы, без цен и персональных данных', async () => {
  ok(await t.api('PUT', '/api/admin/settings/shop', { enabled: true }, admin.token));
  const v0 = ok(await t.api('GET', '/api/shop/index/manifest', undefined, client.token));
  assert.match(v0.revision, /^\d+$/, 'версия изменений — последовательность, не timestamp');
  const product = ok(await t.api('POST', '/api/admin/shop/products', {
    category: 'trailer_brakes', name: 'Колодки тормозные прицепа TEST',
    brand: 'TEST-BPW', article: 'TR-100', price: 99_000, stock: 1,
  }, admin.token));
  const v1 = ok(await t.api('GET', '/api/shop/index/manifest', undefined, client.token));
  assert.ok(BigInt(v1.revision) > BigInt(v0.revision), 'новый артикул добавлен в журнал');
  const changes = ok(await t.api('GET',
    `/api/shop/index/changes?after=${v0.revision}&limit=50`, undefined, client.token));
  assert.ok(changes.rows.some((row: any[]) => row[1] === product.id &&
    row[2] === 'trailer_brakes' && row[4] === 'TR-100'));
  assert.ok(changes.rows.every((row: any[]) => row.length === 2 || row.length === 7));
  assert.ok(!JSON.stringify(changes.rows).includes('99000'), 'в офлайн-справочнике нет цен');

  const configured = ok(await t.api('GET', '/api/shop?light=1', undefined, client.token));
  assert.ok(configured.categoryGroups.some((group: any) => group.id === 'trailer' &&
    group.categories.includes('trailer_brakes')));
  const catalog = ok(await t.api('GET', '/api/shop/search?category=trailer_brakes', undefined, client.token));
  assert.ok(catalog.items.some((row: any) => row.id === product.id));

  ok(await t.api('PUT', `/api/admin/shop/products/${product.id}`, { price: 85_000 }, admin.token));
  const priceOnly = ok(await t.api('GET', '/api/shop/index/manifest', undefined, client.token));
  assert.equal(priceOnly.revision, v1.revision, 'цена не заставляет скачивать текстовый справочник');
  ok(await t.api('PUT', `/api/admin/shop/products/${product.id}`, { name: 'Тормозные колодки BPW TEST' }, admin.token));
  const renamed = ok(await t.api('GET', `/api/shop/index/changes?after=${priceOnly.revision}`, undefined, client.token));
  assert.ok(renamed.rows.some((row: any[]) => row[1] === product.id && row[5] === 'Тормозные колодки BPW TEST'));

  const beforeHide = renamed.revision;
  ok(await t.api('DELETE', `/api/admin/shop/products/${product.id}`, undefined, admin.token));
  const hidden = ok(await t.api('GET', `/api/shop/index/changes?after=${beforeHide}`, undefined, client.token));
  assert.ok(hidden.rows.some((row: any[]) => row.length === 2 && row[1] === product.id), 'скрытый товар удаляется из кэша');
  assert.equal(ok(await t.api('GET', '/api/shop/search?category=trailer_brakes', undefined, client.token)).items.some((row: any) => row.id === product.id), false);

  const next = ok(await t.api('GET', `/api/shop/index/changes?after=${v0.revision}&limit=1`, undefined, client.token));
  assert.equal(next.rows.length, 1);
  assert.ok(next.next, 'большую ленту изменений можно получать порциями');
  assert.equal((await t.api('GET', '/api/shop/index/changes?after=broken', undefined, client.token)).status, 400);
  ok(await t.api('PUT', '/api/admin/settings/shop', { enabled: false }, admin.token));
  const locked = ok(await t.api('GET', '/api/shop/index/changes?after=0', undefined, client.token));
  assert.equal(locked.enabled, false);
  assert.equal(locked.rows.length, 0, 'покупатели не получают каталог до открытия магазина');
});

test('Артикулы Автоконтинента доступны только администратору, без подключения поставщика', async () => {
  const product = ok(await t.api('POST', '/api/admin/shop/products', {
    category: 'trailer_axles', name: 'Ступица оси прицепа TEST', article: 'OUR-011',
    brand: 'TEST-BPW', price: 10_000, stock: null,
  }, admin.token));
  const uri = `/api/admin/shop/products/${product.id}/supplier`;
  const blank = ok(await t.api('GET', uri, undefined, admin.token));
  assert.equal(blank.article, null);
  assert.equal(blank.connected, false);
  assert.equal((await t.api('GET', uri, undefined, client.token)).status, 403);
  assert.equal((await t.api('PUT', uri, {
    article: 'AK-ABC-111', verified: true, sourceNote: '',
  }, admin.token)).status, 400, 'нельзя подтверждать без источника');
  assert.equal((await t.api('PUT', uri, {
    article: 'AK-ABC-111', sourceNote: 'Каталог поставщика TEST', verified: false,
  }, client.token)).status, 403);

  const saved = ok(await t.api('PUT', uri, {
    article: 'AK-ABC-111', brand: 'TEST-PROVIDER', verified: true,
    sourceNote: 'Каталог поставщика TEST, ручная сверка',
  }, admin.token));
  assert.equal(saved.article, 'AK-ABC-111');
  assert.equal(saved.verified, true);
  assert.equal(saved.connected, false, 'не заявляем активную интеграцию без API');
  const status = ok(await t.api('GET', '/api/admin/shop/supplier/status', undefined, admin.token));
  assert.equal(status.connected, false);
  assert.equal(status.automaticOrders, false);
  assert.ok(status.verified >= 1);
  assert.equal((await t.api('GET', '/api/admin/shop/supplier/status', undefined, client.token)).status, 403);

  ok(await t.api('PUT', '/api/admin/settings/shop', { enabled: true }, admin.token));
  const publicData = ok(await t.api('GET', '/api/shop/search?q=OUR-011', undefined, client.token));
  const record = publicData.items.find((p: any) => p.id === product.id);
  assert.ok(record);
  assert.equal(record.article, 'OUR-011');
  assert.equal('supplier_article' in record, false);
  assert.ok(!JSON.stringify(publicData).includes('AK-ABC-111'), 'в клиентском поиске нет артикула поставщика');
  const localPage = ok(await t.api('GET', '/api/shop/index/page?limit=1000', undefined, client.token));
  assert.ok(!JSON.stringify(localPage).includes('AK-ABC-111'), 'поставщик не попадает в офлайн кэш');

  ok(await t.api('DELETE', uri, undefined, admin.token));
  assert.equal(ok(await t.api('GET', uri, undefined, admin.token)).article, null);
  ok(await t.api('PUT', '/api/admin/settings/shop', { enabled: false }, admin.token));
});

test('CSV-справочник: проверка прав, безопасный импорт, повтор без дублей и ручная публикация', async () => {
  const batch = {
    sourceNote: 'Тестовый каталог с разрешением для тестовых данных',
    rightsConfirmed: true,
    rows: [
      { brand: 'TEST-WABCO', article: 'QA-REF-001', name: 'Датчик ABS прицепа тестовый',
        category: 'trailer_ebs', searchTerms: 'тормозной датчик' },
      { brand: 'TEST-BPW', article: 'QA-REF-002', name: 'Тестовая ступица прицепа',
        category: 'trailer_axles', searchTerms: 'ступичный узел' },
    ],
  };
  const path = '/api/admin/shop/catalog/import';
  assert.equal((await t.api('POST', path, { ...batch, rightsConfirmed: false }, admin.token)).status, 400,
    'отказ без подтверждения прав на загрузку');
  assert.equal((await t.api('POST', path, { ...batch, rows: [batch.rows[0], batch.rows[0]] }, admin.token)).status, 400,
    'повтор одного номера внутри пакета запрещён');
  assert.equal((await t.api('POST', path, {
    ...batch, rows: [{ ...batch.rows[0], category: 'untrusted_category' }],
  }, admin.token)).status, 400, 'неизвестные категории не импортируются');
  assert.equal((await t.api('POST', path, batch, client.token)).status, 403,
    'обычный клиент не может импортировать');
  const initial = ok(await t.api('GET', '/api/admin/shop/catalog/stats', undefined, admin.token));
  const preview = ok(await t.api('POST', path, { ...batch, dryRun: true }, admin.token));
  assert.equal(preview.newRows, 2);
  assert.equal(preview.published, 0);
  assert.equal(ok(await t.api('GET', '/api/admin/shop/catalog/stats', undefined, admin.token)).total, initial.total,
    'предварительная проверка не меняет базу');
  const imported = ok(await t.api('POST', path, { ...batch, dryRun: false }, admin.token));
  assert.equal(imported.newRows, 2);
  assert.equal(imported.published, 0);
  const staged = ok(await t.api('GET', '/api/admin/shop/catalog?state=pending', undefined, admin.token));
  const entry = staged.items.find((p: any) => p.article === 'QA-REF-001');
  assert.ok(entry && !entry.reviewed, 'импортированные номера требуют проверки');
  assert.equal((await t.api('GET', '/api/admin/shop/catalog', undefined, client.token)).status, 403);
  const closed = ok(await t.api('GET', '/api/shop/catalog/search?q=QA-REF-001', undefined, client.token));
  assert.equal(closed.enabled, false);
  assert.equal(closed.items.length, 0);

  ok(await t.api('POST', `/api/admin/shop/catalog/${entry.id}/review`, { reviewed: true }, admin.token));
  ok(await t.api('PUT', '/api/admin/settings/shop', { enabled: true }, admin.token));
  const result = ok(await t.api('GET', '/api/shop/catalog/search?q=ABS%20прицепа', undefined, client.token));
  assert.ok(result.items.some((p: any) => p.id === entry.id));
  assert.ok(!JSON.stringify(result).includes(batch.sourceNote), 'источник импорта не отдаём покупателю');
  assert.ok(result.items.every((p: any) => !('price' in p) && !('stock' in p)),
    'каталожные позиции без выдуманных цен и остатков');
  assert.equal((await t.api('POST', '/api/shop/orders', {
    items: [{ productId: entry.id, qty: 1 }], delivery: 'pickup',
  }, client.token)).status, 409, 'ссылку на справочник нельзя оформить как товар');

  ok(await t.api('POST', path, { ...batch, dryRun: false }, admin.token));
  const afterRepeat = ok(await t.api('GET', '/api/admin/shop/catalog?state=approved&q=QA-REF-001', undefined, admin.token));
  assert.equal(afterRepeat.total, 1, 'повторная загрузка не плодит дубли и не сбрасывает подтверждение');
  const changed = { ...batch, rows: [{ ...batch.rows[0], name: 'Изменённый тестовый датчик ABS' }] };
  ok(await t.api('POST', path, { ...changed, dryRun: false }, admin.token));
  const afterChange = ok(await t.api('GET', '/api/shop/catalog/search?q=QA-REF-001', undefined, client.token));
  assert.equal(afterChange.items.length, 0, 'изменение исходного номера требует повторной проверки');
  ok(await t.api('PUT', '/api/admin/settings/shop', { enabled: false }, admin.token));
});
