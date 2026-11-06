import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, ok, type T } from './helpers.ts';

// Модератор: спор по сумме, оспоренный отзыв, обжалование блокировки, журнал и «вернуть в очередь».

let t: T;
let admin: { token: string; id: string };
let client: { token: string; id: string };
let master: { token: string; id: string };
let orderId: string;

before(async () => {
  t = await setup();
  admin = await t.login('+79990000001');
  client = await t.login('+79991112233');
  master = await t.login('+79992223344', 'master');
  ok(await t.api('PUT', '/api/performer/profile', { kind: 'master', name: 'Иван', specialties: ['electric'], taxStatus: 'self_employed', inn: '780000000001' }, master.token));
  ok(await t.api('POST', `/api/admin/performers/${master.id}/verify`, { decision: 'approved' }, admin.token));
  ok(await t.api('POST', '/api/performer/line', { lineStatus: 'online' }, master.token));
  const o = ok(await t.api('POST', '/api/orders', { service: 'electric', zoneId: 'spb', description: 'Не горит свет' }, client.token)).order;
  ok(await t.api('POST', `/api/orders/${o.id}/offers`, {}, master.token));
  const l = ok(await t.api('GET', `/api/orders/${o.id}/offers`, undefined, client.token));
  ok(await t.api('POST', `/api/orders/${o.id}/offers/${l.offers[0].id}/choose`, {}, client.token));
  ok(await t.api('POST', `/api/orders/${o.id}/step`, { action: 'arrive' }, master.token));
  ok(await t.api('POST', `/api/orders/${o.id}/amount`, { extras: [{ name: 'Расходники', amount: 300_000 }], result: 'solved' }, master.token));
  orderId = o.id;
});
after(() => t.close());

test('спор по сумме попадает в очередь; решение — сторонам; журнал; вернуть в очередь', async () => {
  ok(await t.api('POST', `/api/orders/${orderId}/dispute`, { reason: 'Работал 20 минут, а не час' }, client.token));
  ok(await t.api('POST', '/api/support', { topic: 'Не согласен с суммой', text: 'Прошу разобраться', orderId }, client.token));
  const q = ok(await t.api('GET', '/api/mod/cases', undefined, admin.token));
  assert.equal(q.counts.dispute, 1, 'повторный сигнал — в тот же случай');
  const id = q.items[0].id;
  const c = ok(await t.api('GET', `/api/mod/cases/${id}`, undefined, admin.token));
  assert.equal(c.order.number > 0, true);
  assert.ok(c.chat.some((m: any) => m.body.includes('не согласен')), 'материалы: чат заявки');
  assert.match(c.text, /Прошу разобраться/);
  assert.equal((await t.api('GET', '/api/mod/cases', undefined, client.token)).status, 403);
  ok(await t.api('POST', `/api/mod/cases/${id}/enter-chat`, {}, admin.token));
  assert.equal((await t.api('POST', `/api/mod/cases/${id}/decide`, { decision: 'hide' }, admin.token)).status, 400, 'решение не из этого вида');
  const d = ok(await t.api('POST', `/api/mod/cases/${id}/decide`, { decision: 'partial', note: 'Оплата за полчаса' }, admin.token));
  assert.equal(d.status, 'resolved');
  assert.equal(d.decisionName, 'Частично');
  assert.ok(d.log.some((l: any) => l.action === 'mod.chat_open'), 'вход в чат — в журнале');
  assert.ok(t.app.hub.log.some((l) => l.userId === master.id && l.event.type === 'mod_case'), 'исполнитель получил решение');
  const log = ok(await t.api('GET', '/api/mod/cases?status=resolved', undefined, admin.token));
  assert.equal(log.items[0].decidedBy !== undefined, true);
  ok(await t.api('POST', `/api/mod/cases/${id}/reopen`, {}, admin.token));
  assert.equal(ok(await t.api('GET', '/api/mod/cases', undefined, admin.token)).counts.dispute, 1);
  ok(await t.api('POST', `/api/mod/cases/${id}/decide`, { decision: 'agreed' }, admin.token));
});

test('оспоренный отзыв не влияет на рейтинг до решения; «скрыть» — убирает', async () => {
  ok(await t.api('POST', `/api/orders/${orderId}/amount`, { extras: [{ name: 'Расходники', amount: 150_000 }], result: 'solved' }, master.token));
  ok(await t.api('POST', `/api/orders/${orderId}/confirm`, {}, client.token));
  ok(await t.api('POST', `/api/orders/${orderId}/review`, { stars: 5 }, client.token));
  ok(await t.api('POST', `/api/orders/${orderId}/review`, { stars: 1, text: 'Ужасный клиент' }, master.token));
  const mine = ok(await t.api('GET', '/api/me/reviews', undefined, client.token));
  assert.equal(mine.length, 1);
  assert.equal((await t.api('POST', `/api/reviews/${mine[0].id}/contest`, { text: 'Я всё оплатил' }, master.token)).status, 404, 'оспорить можно только отзыв о себе');
  ok(await t.api('POST', `/api/reviews/${mine[0].id}/contest`, { text: 'Я всё оплатил, сумму подтвердил' }, client.token));
  assert.equal(ok(await t.api('GET', '/api/me', undefined, client.token)).rating, null, 'оспоренный отзыв в рейтинг не идёт');
  const q = ok(await t.api('GET', '/api/mod/cases?kind=review', undefined, admin.token));
  assert.equal(q.items.length, 1);
  const c = ok(await t.api('GET', `/api/mod/cases/${q.items[0].id}`, undefined, admin.token));
  assert.equal(c.review.stars, 1);
  ok(await t.api('POST', `/api/mod/cases/${c.id}/decide`, { decision: 'hide', note: 'Оскорбление' }, admin.token));
  assert.equal(ok(await t.api('GET', '/api/me/reviews', undefined, client.token)).length, 0, 'скрытый отзыв не показываем');
});

test('обжалование блокировки: заблокированный входит по коду — получает пропуск — отправляет; «принято» снимает блок', async () => {
  ok(await t.api('POST', `/api/admin/users/${master.id}/block`, { blocked: true, reason: 'Оплата мимо площадки' }, admin.token));
  const c = ok(await t.api('POST', '/api/auth/code', { phone: '+79992223344' }));
  const v = await t.api('POST', '/api/auth/verify', { phone: '+79992223344', code: c.devCode });
  assert.equal(v.status, 403);
  const token = v.body.data.appealToken;
  assert.ok(token);
  assert.equal((await t.api('POST', '/api/appeals/blocked', { phone: '+79992223344', appealToken: 'чужой', text: 'Клиент сам предложил наличные, я отказался' })).status, 403);
  ok(await t.api('POST', '/api/appeals/blocked', { phone: '+79992223344', appealToken: token, text: 'Клиент сам предложил наличные, я отказался' }));
  const q = ok(await t.api('GET', '/api/mod/cases?kind=appeal', undefined, admin.token));
  assert.equal(q.items[0].priority, 1, 'блокировка — срочно');
  ok(await t.api('POST', `/api/mod/cases/${q.items[0].id}/decide`, { decision: 'upheld' }, admin.token));
  assert.ok(t.sms.sent.some((m: any) => m.phone === '+79992223344' && /блокировка снята/.test(m.text)), 'решение — по SMS');
  ok(await t.api('POST', '/api/auth/verify', { phone: '+79992223344', code: ok(await (t.clock.advance(61), t.api('POST', '/api/auth/code', { phone: '+79992223344' }))).devCode }));
});
