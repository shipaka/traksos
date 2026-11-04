import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, ok, type T } from './helpers.ts';

let t: T;
let admin: any, client: any, stranger: any;

before(async () => {
  t = await setup();
  admin = await t.login('+79990000001');
  client = await t.login('+79997770001');
  stranger = await t.login('+79997770002');
});
after(() => t.close());

test('поддержка: обращение по заявке и без, ответы, закрытие; чужое не видно; уведомления', async () => {
  const o = ok(await t.api('POST', '/api/orders', { service: 'electric', zoneId: 'spb' }, client.token)).order;
  const th = ok(await t.api('POST', '/api/support', { topic: 'Мастер не приехал', text: 'Жду уже час, позвоните 8 921 000-00-00', orderId: o.id }, client.token));
  assert.equal(th.order.id, o.id);
  assert.ok(!th.messages[0].body.includes('000-00-00'), 'номер в обращении скрыт');
  // В чат заявки пришло системное сообщение
  const chat = ok(await t.api('GET', `/api/orders/${o.id}/messages`, undefined, client.token));
  assert.ok(chat.messages.some((m: any) => m.body.includes('Подключили поддержку')));
  // Повторное «позвать» по той же заявке — в то же обращение
  const again = ok(await t.api('POST', '/api/support', { topic: 'Мастер не приехал', text: 'Ещё жду', orderId: o.id }, client.token));
  assert.equal(again.id, th.id);
  assert.equal(again.messages.length, 2);

  // Сотрудник видит в очереди, отвечает — клиенту уведомление
  const q = ok(await t.api('GET', '/api/admin/support', undefined, admin.token));
  assert.equal(q[0].id, th.id);
  assert.equal(q[0].waiting, true, 'последнее слово за клиентом — выше в очереди');
  ok(await t.api('POST', `/api/support/${th.id}/messages`, { body: 'Ищем вам другого мастера' }, admin.token));
  const seen = ok(await t.api('GET', `/api/support/${th.id}`, undefined, client.token));
  assert.equal(seen.messages.at(-1).from_staff, true);
  const notes = ok(await t.api('GET', '/api/me/notifications', undefined, client.token));
  assert.ok(notes.unread >= 1);
  assert.ok(notes.items.some((n: any) => n.kind === 'support'));
  ok(await t.api('POST', '/api/me/notifications/read', {}, client.token));
  assert.equal(ok(await t.api('GET', '/api/me/notifications', undefined, client.token)).unread, 0);

  // Чужому не видно, чужую заявку не «позвать»
  assert.equal((await t.api('GET', `/api/support/${th.id}`, undefined, stranger.token)).status, 403);
  assert.equal((await t.api('POST', '/api/support', { topic: 'Другое', text: 'тест', orderId: o.id }, stranger.token)).status, 403);

  // Закрыли — писать нельзя, понятная ошибка
  ok(await t.api('POST', `/api/support/${th.id}/close`, {}, admin.token));
  assert.equal((await t.api('POST', `/api/support/${th.id}/messages`, { body: 'а ещё' }, client.token)).body.error, 'closed');
  // Без заявки
  const gen = ok(await t.api('POST', '/api/support', { topic: 'Не работает приложение', text: 'Не приходит код' }, stranger.token));
  assert.equal(gen.order, null);
  assert.equal(ok(await t.api('GET', '/api/support', undefined, stranger.token)).length, 1);
});
