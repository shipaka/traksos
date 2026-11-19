import { test } from 'node:test';
import assert from 'node:assert/strict';
import { offlineSmallTalk, isOfflineCasual } from '../src/services/trakbotOfflineTalk.ts';
import { composeTrakBotReply } from '../src/services/trakbot.ts';

test('offline bot keeps a friendly, honest tone without selling a service', () => {
  assert.match(composeTrakBotReply('привет', []), /Здорово!/);
  assert.match(composeTrakBotReply('Как дела?', []), /на связи/);
  assert.match(composeTrakBotReply('спасибо', []), /не за что/i);
  assert.match(composeTrakBotReply('Мне скучно', []), /шутку|историю/);
  assert.match(composeTrakBotReply('Устал', []), /вымотать/);
  assert.match(composeTrakBotReply('Нормально', [], {}, ['Как дела?']), /Вот и хорошо/);
  assert.match(composeTrakBotReply('А у тебя?', [], {}, ['Как дела?']), /виртуальный/);
  const answers = [
    'Привет!', 'Как дела?', 'Расскажи шутку', 'Расскажи историю', 'Мне скучно',
  ].map((x) => composeTrakBotReply(x, []));
  assert.doesNotMatch(answers.join(' '), /оформляй заказ|купи услугу|платная подписка|обязательная оплата/i);
});

test('offline jokes vary over subsequent turns and do not require a model', () => {
  const first = offlineSmallTalk('Пошути');
  const second = offlineSmallTalk('Ещё', ['Пошути']);
  const third = offlineSmallTalk('Ещё', ['Ещё', 'Пошути']);
  assert.ok(first && second && third);
  assert.notEqual(first, second);
  assert.notEqual(second, third);
  assert.match(first, /Ещё одну/);
  assert.equal(offlineSmallTalk('Ещё', ['Машина не заводится']), null);
});

test('offline original story unfolds in three parts, then stops naturally', () => {
  const start = offlineSmallTalk('Расскажи историю');
  const middle = offlineSmallTalk('Дальше', ['Расскажи историю']);
  const ending = offlineSmallTalk('Дальше', ['Дальше', 'Расскажи историю']);
  const finished = offlineSmallTalk('Дальше', ['Дальше', 'Дальше', 'Расскажи историю']);
  assert.match(start ?? '', /Термос дальнобойщика/);
  assert.match(middle ?? '', /запасную/);
  assert.match(ending ?? '', /Конец истории/);
  assert.match(finished ?? '', /закончилась/);
  const another = offlineSmallTalk('Расскажи историю', ['Расскажи историю']);
  assert.match(another ?? '', /Самый важный груз/);
});

test('offline entertainment cannot hijack automotive diagnosis or sensitive subjects', () => {
  for (const question of [
    'Привет, мотор троит', 'Привет, ошибка P0087', 'Расскажи шутку про тормоза EBS',
    'SPN 123 FMI 5', 'Привет, заглох двигатель', 'Как дела с возвратом денег?',
    'История моей аварии и травмы', 'Сколько стоит страховка?',
  ]) {
    assert.equal(isOfflineCasual(question), false, question);
    assert.equal(offlineSmallTalk(question), null, question);
  }
  assert.match(composeTrakBotReply('Привет, стартер не крутит', []), /стартер|зажигания/i);
});
