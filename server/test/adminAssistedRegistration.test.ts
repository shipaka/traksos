import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, ok, type T } from './helpers.ts';

let t: T;
let admin: { token: string; id: string };
let client: { token: string; id: string };

before(async () => {
  t = await setup();
  admin = await t.login('+79990000001');
  client = await t.login('+79995550001');
});
after(() => t.close());

test('admin creates new role-specific account without a password/session; invited person activates with own SMS', async () => {
  const phone = '+79995551001';
  const path = '/api/admin/users/manual';
  const payload = { phone, name: 'Проверочный пользователь', roles: ['master', 'service'], reason: 'Регистрация по заявке человека' };
  assert.equal((await t.api('POST', path, payload)).status, 401);
  assert.equal((await t.api('POST', path, payload, client.token)).status, 403);

  const account = ok(await t.api('POST', path, payload, admin.token));
  assert.deepEqual(account.user.roles, ['master', 'service']);
  assert.equal(account.activation, 'sms_reset');
  const row = await t.db.one<any>('select password_hash,registration_kind from users where id=$1', [account.user.id]);
  assert.equal(row.password_hash, null);
  assert.equal(row.registration_kind, 'master_service');
  assert.equal((await t.db.query('select token_hash from sessions where user_id=$1', [account.user.id])).length, 0);
  assert.equal((await t.api('POST', '/api/auth/login', { phone, password: 'UnknownPassword2026' })).status, 401);

  const inviteCode = ok(await t.api('POST', '/api/auth/code', { phone, purpose: 'reset' }));
  const activated = ok(await t.api('POST', '/api/auth/verify', {
    phone, code: inviteCode.devCode, purpose: 'reset',
    accountType: 'owner', role: 'client', password: 'NewPassword12345!',
  }));
  assert.equal(activated.user.id, account.user.id);
  assert.deepEqual(activated.user.roles, ['master', 'service'], 'SMS activation cannot change assigned roles');
  const login = ok(await t.api('POST', '/api/auth/login', { phone, password: 'NewPassword12345!' }));
  assert.deepEqual(login.user.roles, ['master', 'service']);
  assert.equal((await t.api('POST', path, payload, admin.token)).status, 409);
  const logs = await t.db.query<any>("select action from audit_log where target=$1 and action='user.admin_registered'", [account.user.id]);
  assert.equal(logs.length, 1);
});

test('single number cannot be created concurrently; conflicting and staff roles fail closed', async () => {
  const endpoint = '/api/admin/users/manual';
  const p = { phone: '+79995551002', roles: ['client'], reason: 'Проверка параллельных регистраций' };
  const results = await Promise.all(Array.from({ length: 3 }, () => t.api('POST', endpoint, p, admin.token)));
  assert.deepEqual(results.map(r => r.status).sort(), [200,409,409]);
  const dup = await t.db.query('select id from users where phone=$1', [p.phone]);
  assert.equal(dup.length, 1);

  assert.equal((await t.api('POST', endpoint, { ...p, phone:'+79995551003', roles:['client','master'] }, admin.token)).body.error, 'incompatible_roles');
  assert.equal((await t.api('POST', endpoint, { ...p, phone:'+79995551004', roles:['tow','service'] }, admin.token)).body.error, 'incompatible_roles');
  assert.equal((await t.api('POST', endpoint, { ...p, phone:'+79995551005', roles:['admin'] }, admin.token)).status, 400);
  assert.equal((await t.api('POST', endpoint, { ...p, phone:'+79990000001' }, admin.token)).status, 403);
  assert.equal((await t.api('POST', endpoint, { ...p, phone:'not-a-phone' }, admin.token)).body.error, 'bad_phone');
});

test('special operator roles may be provisioned, but unrelated users cannot see reports', async () => {
  const r = ok(await t.api('POST', '/api/admin/users/manual', {
    phone: '+79995551006', name: 'Проверка техосмотра',
    roles:['inspection_operator'], reason:'Ручное назначение отдельной роли',
  }, admin.token));
  assert.deepEqual(r.user.roles, ['inspection_operator']);
  assert.equal((await t.db.one<any>('select registration_kind from users where id=$1',[r.user.id])).registration_kind, null);

  const endpoint = '/api/admin/developer-reports';
  const info = { phone: '+79995552000', category: 'registration', details: 'Сбой при регистрации нового исполнителя' };
  assert.equal((await t.api('POST', endpoint, info, client.token)).status, 403);
  assert.equal((await t.api('GET', endpoint, undefined, client.token)).status, 403);
  const report = ok(await t.api('POST', endpoint, info, admin.token));
  assert.equal(report.status, 'queued');
  const list = ok(await t.api('GET', endpoint, undefined, admin.token));
  assert.ok(list.some((item:any) => item.id === report.id && item.phone === info.phone));
  assert.equal((await t.api('POST', endpoint + '/' + report.id + '/resolve', {}, client.token)).status,403);
  ok(await t.api('POST', endpoint + '/' + report.id + '/resolve', {}, admin.token));
  const closed = ok(await t.api('GET', endpoint, undefined, admin.token)).find((item:any)=>item.id === report.id);
  assert.equal(closed.status, 'resolved');
  assert.equal((await t.db.query("select id from audit_log where target=$1 and action='developer_report.create'", [report.id])).length, 1);
});
