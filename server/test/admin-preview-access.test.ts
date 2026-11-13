import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, scryptSync } from 'node:crypto';
import { setup, type T } from './helpers.ts';

test('temporary admin preview expires for both password login and existing API sessions', async () => {
  const t: T = await setup();
  try {
    const phone = '+79990000001'; // CI-only allowlisted fixture; never a real operator number.
    const seed = await t.login(phone, 'master');
    // Regression: PostgreSQL must not infer $1 as both uuid and text (42P08).
    await t.db.query(
      `insert into audit_log(actor_id,action,target,data)
       values ($1::uuid,'staff.preview_admin_created',$1::text,$2::jsonb)`,
      [seed.id, { via: 'local_vps', noSms: true }],
    );
    const audit = await t.db.one<{ n: number }>(
      "select count(*)::int as n from audit_log where action='staff.preview_admin_created' and actor_id=$1",
      [seed.id],
    );
    assert.equal(audit?.n, 1);

    const password = 'CI-only-admin-preview-password';
    const salt = randomBytes(16).toString('hex');
    const hash = `scrypt:${salt}:${scryptSync(password, Buffer.from(salt, 'hex'), 64).toString('hex')}`;
    await t.db.query('update users set password_hash=$1, admin_preview_until=$2 where id=$3',
      [hash, new Date('2099-01-01T00:00:00Z'), seed.id]);

    const login = await t.api('POST', '/api/auth/login', { phone, password });
    assert.equal(login.status, 200);
    assert.ok(login.body.token);
    assert.equal((await t.api('GET', '/api/me', undefined, login.body.token)).status, 200);

    await t.db.query('update users set admin_preview_until=$1 where id=$2',
      [new Date('2000-01-01T00:00:00Z'), seed.id]);
    assert.equal((await t.api('POST', '/api/auth/login', { phone, password })).status, 401);
    assert.equal((await t.api('GET', '/api/me', undefined, login.body.token)).status, 401);
    assert.equal((await t.api('GET', '/api/me', undefined, seed.token)).status, 401);

    // Ordinary password access is not subject to this optional, nullable preview gate.
    await t.db.query('update users set admin_preview_until=null where id=$1', [seed.id]);
    assert.equal((await t.api('POST', '/api/auth/login', { phone, password })).status, 200);
  } finally {
    await t.close();
  }
});
