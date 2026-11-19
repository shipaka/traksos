import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, ok, type T } from './helpers.ts';

let t:T; let driver:any, other:any, owner:any, admin:any, master:any, tow:any, service:any;
before(async()=>{
  t=await setup();
  driver=await t.login('+79997778101','driver');
  other=await t.login('+79997778102');
  owner=await t.login('+79997778104','client');
  master=await t.login('+79997778105','master');
  tow=await t.login('+79997778106','tow');
  service=await t.login('+79997778107','service');
  admin=await t.login('+79990000001');
});
after(()=>t.close());

test('public driver text air is isolated and not accessible without auth', async()=>{
  assert.equal((await t.api('GET','/api/air/messages')).status,401);
  const original=ok(await t.api('GET','/api/air/messages',undefined,driver.token));
  assert.equal(original.botEnabled,false);
  assert.deepEqual(original.messages,[]);
  const sent=ok(await t.api('POST','/api/air/messages',{body:'Всем привет, кто сегодня в рейсе?'},driver.token));
  assert.equal(sent.message.isBot,false);
  assert.equal(sent.message.author.startsWith('Водитель '),true);
  assert.equal(sent.botMessage,null);
  const b=ok(await t.api('GET','/api/air/messages',undefined,other.token));
  assert.equal(b.messages.length,1);
  assert.equal(b.messages[0].body,'Всем привет, кто сегодня в рейсе?');
  const privateHistory=ok(await t.api('GET','/api/trakbot/messages',undefined,driver.token));
  assert.equal(privateHistory.messages.length,0);
});

test('driver chat excludes repair partners and is read-only for moderators and admin',async()=>{
  for(const account of [master,tow,service]) {
    assert.equal((await t.api('GET','/api/air/messages',undefined,account.token)).status,403);
    assert.equal((await t.api('POST','/api/air/messages',{body:'Привет из СТО'},account.token)).status,403);
  }
  const own=ok(await t.api('GET','/api/air/messages',undefined,owner.token));
  assert.equal(own.canPost,true);
  const fromOwner=ok(await t.api('POST','/api/air/messages',{body:'Владелец автопарка на связи'},owner.token));
  assert.match(fromOwner.message.author,/^Владелец /);
  const ownerMessage=ok(await t.api('GET','/api/air/messages',undefined,driver.token));
  assert.ok(ownerMessage.messages.some((m:any)=>m.body==='Владелец автопарка на связи'));
  const fromDriver=ok(await t.api('GET','/api/air/messages',undefined,driver.token));
  assert.equal(fromDriver.canPost,true);
  const observer=ok(await t.api('GET','/api/air/messages',undefined,admin.token));
  assert.equal(observer.canPost,false);
  assert.equal(observer.canModerate,true);
  assert.equal((await t.api('POST','/api/air/messages',{body:'Реклама от администратора'},admin.token)).status,403);
});

test('staff calls get a clarifying prompt, but private details are never echoed in public air', async()=>{
  const prompt=ok(await t.api('POST','/api/air/messages',{
    body:'@админ у меня конфликт по заявке, телефон +7 999 123 45 67'
  },driver.token));
  assert.equal(prompt.supportSuggested,true);
  assert.match(prompt.botMessage.body,/Уточню|заявк|поведением/);
  assert.match(prompt.botMessage.body,/личн/i);
  const messages=ok(await t.api('GET','/api/air/messages',undefined,other.token));
  assert.equal(messages.messages.at(-2).body,'Хочу обратиться к администратору через личную поддержку.');
  assert.doesNotMatch(JSON.stringify(messages),/999 123 45 67|конфликт по заявке/);
  const mod=ok(await t.api('POST','/api/air/messages',{body:'@модератор помоги разобраться'},driver.token));
  assert.equal(mod.supportSuggested,true);
  assert.match(mod.botMessage.body,/модератор/);
  const tickets=ok(await t.api('GET','/api/support',undefined,driver.token));
  assert.equal(tickets.length,0,'bot cannot auto-create a support ticket');
});

test('bot posting requires admin enablement and exposes explicit bot identity',async()=>{
  assert.equal((await t.api('POST','/api/admin/air/bot',{enabled:true},driver.token)).status,403);
  ok(await t.api('POST','/api/admin/air/bot',{enabled:true},admin.token));
  // 15m cooldown for direct mentions; staff-intake messages do not count.
  const a=ok(await t.api('POST','/api/air/messages',{body:'@TrakBot расскажи шутку'},other.token));
  assert.equal(a.botMessage.isBot,true);
  assert.equal(a.botMessage.author,'TrakBot · бот');
  assert.match(a.botMessage.body,/Ещё одну/);
  const b=ok(await t.api('POST','/api/air/messages',{body:'@TrakBot привет'},other.token));
  assert.equal(b.botMessage,null,'bot must avoid responding repeatedly');
  const changed=ok(await t.api('POST','/api/admin/air/bot',{enabled:false},admin.token));
  assert.equal(changed.botEnabled,false);
  const off=ok(await t.api('POST','/api/air/messages',{body:'@TrakBot расскажи историю'},other.token));
  assert.equal(off.botMessage,null);
});

test('staff can hide abusive content; ordinary users cannot hide messages', async()=>{
  const msg=ok(await t.api('POST','/api/air/messages',{body:'Чай в термосе готов'},other.token));
  assert.equal((await t.api('POST','/api/admin/air/messages/'+msg.message.id+'/hide',{},driver.token)).status,403);
  assert.equal((await t.api('POST','/api/admin/air/messages/0/hide',{},admin.token)).status,400);
  const hidden=ok(await t.api('POST','/api/admin/air/messages/'+msg.message.id+'/hide',{},admin.token));
  assert.equal(hidden.hidden,true);
  const messages=ok(await t.api('GET','/api/air/messages',undefined,driver.token));
  assert.equal(messages.messages.some((x:any)=>x.id===msg.message.id),false);
});

test('links and direct email are rejected while phones and VIN get masked',async()=>{
  const first=await t.api('POST','/api/air/messages',{body:'Пишите test@example.com'},driver.token);
  assert.equal(first.status,400);
  assert.equal((await t.api('POST','/api/air/messages',{body:'https://example.com'},driver.token)).status,400);
  const msg=ok(await t.api('POST','/api/air/messages',{body:'Синий грузовик VIN WAUZZZ8V6JA123456'},driver.token));
  assert.match(msg.message.body,/\[VIN скрыт\]/);
});


test('public air rejects obvious adverts but permits ordinary route and repair discussions',async()=>{
  const ads=[
    'Продам грузовик недорого',
    'Предлагаем услуги грузового ремонта',
    'Скидка на шиномонтаж в выходные',
    'Пишите в личку за эвакуатором',
    'Заходите в наш магазин автозапчастей',
  ];
  for (const body of ads) {
    const r=await t.api('POST','/api/air/messages',{body},owner.token);
    assert.equal(r.status,400,body);
    assert.equal(r.body.error,'air_ads',body);
  }
  const ordinary=ok(await t.api('POST','/api/air/messages',{
    body:'Кто знает, где удобнее остановиться на трассе М11?'
  },owner.token));
  assert.match(ordinary.message.body,/трассе М11/);
  const first=ok(await t.api('POST','/api/air/messages',{
    body:'Еду из Петербурга в Выборг'
  },owner.token));
  assert.match(first.message.body,/Петербурга/);
  const repeat=await t.api('POST','/api/air/messages',{
    body:'Еду из Петербурга в Выборг'
  },owner.token);
  assert.equal(repeat.status,400);
  assert.equal(repeat.body.error,'air_duplicate');
});
