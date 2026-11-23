import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setup, ok } from './helpers.ts';

test('support: real topics, separate account queues, author replies, close and 409 on stale chat', async () => {
  const t = await setup();
  try {
    const owner = await t.login('+79997774101','client');
    const other = await t.login('+79997774102','client');
    const admin = await t.login('+79990000001');
    const topics = ok(await t.api('GET','/api/support/topics')) as string[];
    assert.ok(Array.isArray(topics) && topics.includes('Другое'),
      'topic picker must use actual backend choices, not hard-coded UI placeholders');
    const first = ok(await t.api('POST','/api/support',{
      topic:'Другое',text:'Нужна помощь с работой приложения'
    },owner.token));
    const otherTicket = ok(await t.api('POST','/api/support',{
      topic:'Другое',text:'Отдельный вопрос второго пользователя'
    },other.token));
    assert.equal(first.status,'open');
    assert.equal(first.messages.length,1);
    assert.equal(first.messages[0].body,'Нужна помощь с работой приложения');

    const ownerList = ok(await t.api('GET','/api/support',undefined,owner.token));
    const otherList = ok(await t.api('GET','/api/support',undefined,other.token));
    assert.ok(ownerList.some((ticket:any)=>ticket.id===first.id));
    assert.ok(ownerList.every((ticket:any)=>ticket.id!==otherTicket.id));
    assert.ok(otherList.some((ticket:any)=>ticket.id===otherTicket.id));
    assert.ok(otherList.every((ticket:any)=>ticket.id!==first.id));
    assert.equal((await t.api('GET','/api/support/'+first.id,undefined,other.token)).status,403);
    assert.equal((await t.api('POST','/api/support/'+first.id+'/messages',{
      body:'Попытка ответить в чужое обращение'
    },other.token)).status,403);

    // The POST itself returns the updated full thread; the UI must not rely
    // on a second GET racing a stale websocket event to display the message.
    const responded = ok(await t.api('POST','/api/support/'+first.id+'/messages',{
      body:'Проверил соединение, ошибка повторяется'
    },owner.token));
    assert.equal(responded.id,first.id);
    assert.equal(responded.status,'open');
    assert.equal(responded.messages.length,2);
    assert.equal(responded.messages[1].body,'Проверил соединение, ошибка повторяется');
    const staffReply = ok(await t.api('POST','/api/support/'+first.id+'/messages',{
      body:'Проверяем обращение, ответ придёт в этот чат'
    },admin.token));
    assert.equal(staffReply.messages.length,3);
    assert.equal(staffReply.messages[2].from_staff,true);
    const closed = ok(await t.api('POST','/api/support/'+first.id+'/close',{},owner.token));
    assert.equal(closed.status,'closed');
    assert.ok(closed.messages.at(-1)?.body.includes('закрыто'));
    const stale = await t.api('POST','/api/support/'+first.id+'/messages',{
      body:'Старое окно после закрытия'
    },owner.token);
    assert.equal(stale.status,409,'offline/stale composer must not silently append to a closed ticket');
    assert.equal(stale.body.error,'closed');

    const next = ok(await t.api('POST','/api/support',{
      topic:'Другое',text:'Новый вопрос после закрытия'
    },owner.token));
    assert.notEqual(next.id,first.id);
    assert.equal(next.status,'open');
    assert.equal(ok(await t.api('GET','/api/support/'+first.id,undefined,owner.token)).messages.length,
      closed.messages.length,'closed ticket history stays immutable');
  } finally { await t.close(); }
});

test('support notifications: one-user reads never affect another account inbox', async () => {
  const t = await setup();
  try {
    const owner = await t.login('+79997774103','client');
    const other = await t.login('+79997774104','client');
    const admin = await t.login('+79990000001');
    const issue = ok(await t.api('POST','/api/support',{
      topic:'Не работает приложение',text:'Проверка уведомления по обращению'
    },owner.token));
    ok(await t.api('POST','/api/support/'+issue.id+'/messages',{
      body:'Ответ по вашему обращению'
    },admin.token));
    const ownerInbox = ok(await t.api('GET','/api/me/notifications',undefined,owner.token));
    const message = ownerInbox.items.find((n:any)=>
      n.kind==='support' && n.data?.ticketId===issue.id);
    assert.ok(message && !message.read_at,
      'real support reply must produce an unread ticket-linked notification');
    const otherMessage = await t.db.one<{id:number}>(`
      insert into notifications(user_id,kind,title,body,data)
      values ($1,'support','Другой пользователь','Только ему','{}'::jsonb) returning id`,[other.id]);
    assert.ok(otherMessage);
    assert.equal((await t.api('POST','/api/me/notifications/'+message.id+'/read',
      {},other.token)).status,404);
    const receipt = ok(await t.api('POST','/api/me/notifications/'+message.id+'/read',{},owner.token));
    assert.equal(receipt.ok,true);
    assert.ok(receipt.readAt);
    assert.equal(ok(await t.api('GET','/api/me/notifications',undefined,other.token)).unread,1);
    ok(await t.api('POST','/api/me/notifications/read',{},owner.token));
    assert.equal(ok(await t.api('GET','/api/me/notifications',undefined,owner.token)).unread,0);
    assert.equal(ok(await t.api('GET','/api/me/notifications',undefined,other.token)).unread,1);
  } finally { await t.close(); }
});

test('support UI guard: real topics and 60-minute policy; unread state resets per account', () => {
  const code = readFileSync(new URL('../../web/src/screens/support.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(code, /обычно за 15 минут|отвечаем круглосуточно/i,
    'never advertise an invented 15-minute staffed response guarantee');
  assert.match(code, /get\('\/api\/support\/topics'\)/);
  assert.match(code, /Повторить загрузку тем/);
  assert.match(code, /maxLength=\{2000\}/,
    'UI must match the server 2000-character limit');
  assert.match(code, /setN\(0\)/,
    'unread badge must clear immediately when the user identity changes');
  assert.match(code, /generation/,
    'a stale previous-account response must not repopulate unread badges');
  assert.match(code, /\[me\?\.id\]/,
    'user-specific lists must follow actual authentication identity');
});
