import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canUseGroundedAi, neutralConversationEligible } from '../src/services/trakbotAi.ts';
import { composeTrakBotReply } from '../src/services/trakbot.ts';

const p0087 = {
  code: 'P0087', title_en: 'Fuel pressure low', title_ru: 'Низкое давление в рампе',
  detail_en: null, detail_ru: 'Давление ниже ожидаемого', source_url: 'pilot',
  review_state: 'pilot', protocol: 'OBD2', make: 'GENERIC',
};

test('conversational driver dialogue asks one relevant follow-up instead of selling', () => {
  const first = composeTrakBotReply('машина не заводится', [], { make: 'Iveco' });
  assert.match(first, /стартер крутит/i);
  const followup = composeTrakBotReply('стартер крутит, но не схватывает', [], {},
    ['машина не заводится']);
  assert.match(followup, /ошибки|код из сканера/i);
  assert.doesNotMatch(followup, /покуп|оплат|платн|подпис|скидк|картой/i);
  const hello = composeTrakBotReply('Привет!', []);
  assert.match(hello, /Здорово!/);
});

test('master gets professional follow-up, not copy of client answer', () => {
  const driver = composeTrakBotReply('P0087', [p0087], {}, [], 'driver');
  const specialist = composeTrakBotReply('P0087', [p0087], {}, [], 'specialist');
  assert.match(driver, /что именно сейчас делает машина/i);
  assert.match(specialist, /измерения|версия блока/i);
  assert.notEqual(driver, specialist);
});

test('do not mistake generic OBD-II for EBS or invent J1939 descriptions', () => {
  const conflict = composeTrakBotReply('P0087', [p0087], { ecu: 'EBS' });
  assert.match(conflict, /формат|другим/i);
  assert.doesNotMatch(conflict, /Давление ниже ожидаемого/i);
  assert.match(conflict, /не продолжайте движение/i);
  assert.match(composeTrakBotReply('SPN 520243 FMI 9', []), /наугад не дам/i);
});

test('external AI only when each code is grounded and user consented', () => {
  const row = { ...p0087 };
  assert.equal(canUseGroundedAi(false, [row], ['P0087'], {}), false);
  assert.equal(canUseGroundedAi(true, [], ['P0087'], {}), false);
  assert.equal(canUseGroundedAi(true, [row], ['P0087'], { ecu: 'EBS' }), false);
  assert.equal(canUseGroundedAi(true, [row], ['P0087'], { ecu: 'EDC' }), true);
  assert.equal(canUseGroundedAi(true, [{...row, review_state:'unverified'}], ['P0087'], {}), false);
  assert.equal(canUseGroundedAi(true, [row], ['P0087','P0299'], {}), false);
});


test('neutral small-talk is human-friendly and never hard-sells', () => {
  const hello = composeTrakBotReply('Как дела?', []);
  assert.match(hello, /на связи/i);
  const thanks = composeTrakBotReply('спасибо', []);
  assert.match(thanks, /не за что/i);
  const who = composeTrakBotReply('ты человек?', []);
  assert.match(who, /автоматический помощник/i);
  const cost = composeTrakBotReply('TrakBot платный?', []);
  assert.match(cost, /сейчас бесплатный/i);
  assert.doesNotMatch([hello,thanks,who,cost].join(' '), /покупайте|оформить заказ|срочно оплачивай/i);
});


test('neutral AI is restricted to harmless small talk and does not receive repair or platform queries', () => {
  assert.equal(neutralConversationEligible('привет, как дела?'), true);
  assert.equal(neutralConversationEligible('расскажи шутку'), true);
  assert.equal(neutralConversationEligible('как дела с тормозами EBS?'), false);
  assert.equal(neutralConversationEligible('покажи мои заявки'), false);
  assert.equal(neutralConversationEligible('сколько стоит платная диагностика'), false);
  assert.equal(neutralConversationEligible('ошибка P0087'), false);
});
