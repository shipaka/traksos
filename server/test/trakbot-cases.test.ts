import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, ok, type T } from './helpers.ts';

let t: T;
let admin: any, reviewer: any, client: any;
before(async () => {
  t = await setup();
  admin = await t.login('+79990000001');
  reviewer = await t.login('+79997778002');
  // Disposable account with independent admin rights to review another author's case.
  await t.db.query("update users set roles=array['admin']::text[] where id=$1",[reviewer.id]);
  client = await t.login('+79997778001');
});
after(() => t.close());

const submission = {
  make: 'Iveco', model: 'Stralis', productionYear: 2013, ecu: 'ECAS',
  code: 'TEST-01',
  symptoms: 'Задний мост не опускается, пульт реагирует',
  checksPerformed: 'Проверили питание и сигнал управления кнопки',
  verifiedFix: 'После устранения дефекта проводки подвеска работает',
  provenanceNote: 'Собственные данные ремонта, личные сведения удалены',
};

test('repair case is pending until manual review, then searchable only by specialist', async () => {
  assert.equal((await t.api('POST', '/api/tech/repair-cases', submission, client.token)).status, 403);
  const created = ok(await t.api('POST','/api/tech/repair-cases',submission,admin.token));
  assert.equal(created.published, false);
  assert.equal(created.reviewState, 'pending');
  const beforeApproval = ok(await t.api('GET','/api/tech/repair-cases?q=TEST-01',undefined,admin.token));
  assert.equal(beforeApproval.items.length, 0);
  const pending = ok(await t.api('GET','/api/admin/tech/repair-cases',undefined,admin.token));
  assert.ok(pending.items.some((x: any)=>x.id === created.id));
  assert.equal((await t.api('GET','/api/admin/tech/repair-cases',undefined,client.token)).status,403);
  assert.equal((await t.api('POST', '/api/admin/tech/repair-cases/'+created.id+'/review',
    {approve:true,note:''},admin.token)).status, 400);
  assert.equal((await t.api('POST','/api/admin/tech/repair-cases/'+created.id+'/review',
    {approve:true,note:'Проверены описание и происхождение данных'},admin.token)).status,403,
    'case author cannot self-approve even with staff role');
  ok(await t.api('POST','/api/admin/tech/repair-cases/'+created.id+'/review',
    {approve:true,note:'Проверены описание и происхождение данных'},reviewer.token));
  const approved = ok(await t.api('GET','/api/tech/repair-cases?q=TEST-01',undefined,admin.token));
  assert.equal(approved.items.length,1);
  assert.equal(approved.items[0].code,'TEST-01');
  assert.equal((await t.api('GET','/api/tech/repair-cases?q=TEST-01',undefined,client.token)).status,403);
});

test('VIN and other personal identifiers are rejected', async () => {
  const r = await t.api('POST','/api/tech/repair-cases',{
    ...submission, symptoms: 'Неисправность при запуске VIN WAUZZZ8V6JA123456',
  },admin.token);
  assert.equal(r.status,400);
  assert.equal(r.body.error,'personal_data');
});
