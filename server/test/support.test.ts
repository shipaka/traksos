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

test('статистика: считает заявки, доли и деньги без ошибок на пустых и непустых данных', async () => {
  const s = ok(await t.api('GET', '/api/admin/stats?days=30', undefined, admin.token));
  assert.ok(s.totals.created >= 1);
  assert.equal(typeof s.people.support_open, 'number');
  assert.ok(Array.isArray(s.byDay) && s.byDay.length >= 1);
  assert.equal((await t.api('GET', '/api/admin/stats', undefined, client.token)).status, 403);
});


test('linked support intake rolls back ticket and initial message if durable staff inbox fails',async()=>{
  const owner=await t.login('+79997770003');
  const order=ok(await t.api('POST','/api/orders',{service:'electric',zoneId:'spb'},owner.token)).order;
  const payload={topic:'Другое',text:'Учебное обращение по заявке',orderId:order.id};
  await t.db.exec(`create function reject_linked_support_inbox() returns trigger language plpgsql as $$ begin
    if new.kind='support' then raise exception 'synthetic linked inbox failure'; end if;
    return new; end $$;
    create trigger reject_linked_support_inbox before insert on notifications
      for each row execute function reject_linked_support_inbox();`);
  try{
    const failed=await t.api('POST','/api/support',payload,owner.token);
    assert.ok(failed.status>=400,'inbox failure must reject the whole intake');
    assert.equal(await t.db.one('select id from support_tickets where user_id=$1 and order_id=$2',[owner.id,order.id]),null);
    assert.equal(await t.db.one("select id from order_events where order_id=$1 and type='support_called'",[order.id]),null);
  }finally{
    await t.db.exec('drop trigger reject_linked_support_inbox on notifications; drop function reject_linked_support_inbox();');
  }
  const ticket=ok(await t.api('POST','/api/support',payload,owner.token));
  assert.equal(ticket.messages.length,1);
  const notices=await t.db.query<{user_id:string}>(
    "select user_id from notifications where kind='support' and data->>'ticketId'=$1",[ticket.id]);
  assert.deepEqual(notices,[{user_id:admin.id}]);
  assert.equal((await t.db.query("select id from order_events where order_id=$1 and type='support_called'",[order.id])).length,1);
  const later=ok(await t.api('POST','/api/support',{...payload,text:'Дополнительная информация'},owner.token));
  assert.equal(later.id,ticket.id);
  assert.equal(later.messages.length,2);
});
