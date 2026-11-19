import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { resolveGuideDestination, ASSISTANT_ADVISORY } from '../src/services/trakbotGuide.ts';
import { setup, ok, type T } from './helpers.ts';

test('navigation is whitelisted, role-aware and never launches an action', () => {
  const client = resolveGuideDestination('Где мои заявки?', ['client']);
  assert.equal(client?.destination.path, '/orders');
  const master = resolveGuideDestination('Где мои заявки?', ['master']);
  assert.equal(master?.destination.path, '/work/jobs');
  assert.equal(resolveGuideDestination('открой магазин', ['insurer']), null);
  assert.equal(resolveGuideDestination('где справочник ошибок', ['client']), null);
  assert.equal(resolveGuideDestination('покажи ошибку P0087', ['client']), null);
  assert.equal(resolveGuideDestination('как поменять пароль?', ['client'])?.destination.path, '/profile');
  assert.equal(resolveGuideDestination('как работает TrakSOS', ['client'])?.destination.path, '/help');
  assert.equal(resolveGuideDestination('Клиент не хочет платить по заявке', ['master'])?.destination.path,'/help/case/refuses-to-pay');
  assert.equal(resolveGuideDestination('Клиент не хочет платить по заявке', ['driver']),null);
  assert.equal(resolveGuideDestination('Мастер не приехал', ['client'])?.destination.path,'/help/case/no-show');
  assert.equal(resolveGuideDestination('Мастер не приехал', ['service']),null);
  assert.equal(resolveGuideDestination('Не согласен с суммой счёта', ['client'])?.destination.path,'/help/case/bill-changed');
  assert.equal(resolveGuideDestination('Хочу пройти форс-мажорные сценарии', ['insurer'])?.destination.path,'/help');
  assert.match(ASSISTANT_ADVISORY, /не заменяют очный осмотр/);
  assert.match(ASSISTANT_ADVISORY, /законом/);
});

let t: T;
let user: any, stranger: any;
before(async () => {
  t = await setup();
  user = await t.login('+79997779001');
  stranger = await t.login('+79997779002');
});
after(() => t.close());

test('client private guide stores only an explicit safe link; no public broadcast', async () => {
  const answer = ok(await t.api('POST', '/api/trakbot/answer',
    {message:'Где мои заявки?'}, user.token));
  assert.equal(answer.message.action_path, '/orders');
  assert.equal(answer.message.action_label, 'Мои заявки');
  assert.equal(answer.chargeAllowed, false);
  const history = ok(await t.api('GET', '/api/trakbot/messages', undefined, user.token));
  assert.equal(history.messages.at(-1).action_path, '/orders');
  const other = ok(await t.api('GET', '/api/trakbot/messages', undefined, stranger.token));
  assert.equal(other.messages.length, 0);
  const noAction = ok(await t.api('POST','/api/trakbot/answer',{message:'Привет, как дела?'},user.token));
  assert.equal(noAction.message.action_path, null);
});

test('role-unsafe navigation does not appear for client', async () => {
  const answer = ok(await t.api('POST', '/api/trakbot/answer',
    {message:'где техническая база ошибок'}, user.token));
  assert.equal(answer.message.action_path, null);
});

test('history deletion is user-scoped, explicit and cannot remove another conversation', async () => {
  const outside = ok(await t.api('POST', '/api/trakbot/answer',
    {message:'Привет, другой пользователь'}, stranger.token));
  assert.equal(outside.chargeAllowed, false);
  assert.equal((await t.api('DELETE', '/api/trakbot/messages')).status, 401);
  const removed = ok(await t.api('DELETE', '/api/trakbot/messages', undefined, user.token));
  assert.equal(removed.cleared, true);
  const history = ok(await t.api('GET', '/api/trakbot/messages', undefined, user.token));
  assert.equal(history.messages.length, 0);
  const someoneElse = ok(await t.api('GET', '/api/trakbot/messages', undefined, stranger.token));
  assert.equal(someoneElse.messages.length, 2);
});
