import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, ok, type T } from './helpers.ts';
import { composeTrakBotReply, extractDtcCodes } from '../src/services/trakbot.ts';

let t: T;
let admin: any, client: any, stranger: any;
before(async () => {
  t = await setup();
  admin = await t.login('+79990000001');
  client = await t.login('+79997777001');
  stranger = await t.login('+79997777002');
});
after(() => t.close());

test('TrakBot: code parsing, no fabricated diagnosis, no hard sell', () => {
  assert.deepEqual(extractDtcCodes('Ошибка P0087 и p0420, повтор P0087'), ['P0087', 'P0420']);
  assert.deepEqual(extractDtcCodes('SPN 1234 FMI 5'), []);
  const response = composeTrakBotReply('Scania ошибка P0087', [
    { code: 'P0087', title_en: 'Fuel rail pressure low', title_ru: 'Низкое давление в рампе',
      detail_ru: 'Требует проверки', detail_en: null, source_url: 'editorial',
      review_state: 'pilot', protocol: 'OBD2', make: 'GENERIC' },
  ]);
  assert.match(response, /P0087/);
  assert.match(response, /не подтверждённый диагноз/i);
  assert.doesNotMatch(response, /оплат|купи|заплат|подписк/i);
  const unknown = composeTrakBotReply('U3210', []);
  assert.match(unknown, /проверенной расшифровки пока нет/i);
  assert.doesNotMatch(unknown, /замени|сломался|точно вышел из строя/i);
  const risk = composeTrakBotReply('неисправны тормоза EBS', []);
  assert.match(risk, /не продолжайте движение/i);
});

test('Private TrakBot: consent to chat, separate user histories, no billing, no leaks to order feed', async () => {
  const empty = ok(await t.api('GET', '/api/trakbot/messages', undefined, client.token));
  assert.equal(empty.messages.length, 0);
  const a = ok(await t.api('POST', '/api/trakbot/answer', {
    message: 'Iveco Stralis P0087', vehicle: { make: 'Iveco', model: 'Stralis', year: 2013, ecu: 'EDC' },
  }, client.token));
  assert.equal(a.freePilot, true);
  assert.equal(a.chargeAllowed, false);
  assert.equal(a.coverage, 'generic_found');
  assert.match(a.message.body, /P0087/);
  assert.match(a.message.body, /Iveco/);
  const own = ok(await t.api('GET', '/api/trakbot/messages', undefined, client.token));
  assert.equal(own.messages.length, 2);
  assert.equal(own.messages[0].role, 'user');
  assert.equal(own.messages[1].role, 'bot');
  const other = ok(await t.api('GET', '/api/trakbot/messages', undefined, stranger.token));
  assert.equal(other.messages.length, 0);
  const b = ok(await t.api('POST', '/api/trakbot/answer', { message: 'SPN 123 FMI 2' }, stranger.token));
  assert.equal(b.coverage, 'not_supported');
  assert.equal(b.handoffSuggested, true);
  assert.equal(b.chargeAllowed, false);
  assert.equal((await t.api('GET', '/api/trakbot/messages')).status, 401);
});

test('Technical codes are hidden from ordinary clients and accessible to staff', async () => {
  assert.equal((await t.api('GET', '/api/tech/codes?q=P0087', undefined, client.token)).status, 403);
  const list = ok(await t.api('GET', '/api/tech/codes?q=P0087', undefined, admin.token));
  assert.ok(list.items.some((x: any) => x.code === 'P0087'));
  assert.ok(list.items[0].source_license);
});

test('TrakBot rejects oversized inputs', async () => {
  assert.equal((await t.api('POST','/api/trakbot/answer',{message:'x'.repeat(701)},client.token)).status,400);
});


test('TrakBot masks phone and VIN before persisting private chat text', async () => {
  ok(await t.api('POST','/api/trakbot/answer',{
    message: 'Ошибка P0087, звоните +7 (911) 123-45-67, VIN WAUZZZ8V6JA123456',
  }, client.token));
  const result = ok(await t.api('GET','/api/trakbot/messages',undefined,client.token));
  const recent = result.messages.slice(-2);
  assert.match(recent[0].body, /\[номер скрыт\]/);
  assert.match(recent[0].body, /\[VIN скрыт\]/);
  assert.doesNotMatch(recent[0].body, /911|WAUZZZ8V6JA123456/);
});
