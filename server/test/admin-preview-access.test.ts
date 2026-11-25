import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, scryptSync } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
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

test('archived administrator bootstrap refuses before Docker and documents the fixed expiry', () => {
  const dir = mkdtempSync(join(tmpdir(), 'traksos-preview-archive-'));
  try {
    const marker = join(dir, 'docker-called');
    writeFileSync(join(dir, 'docker'), '#!/bin/bash\n: > "$PREVIEW_TEST_MARKER"\nexit 99\n', { mode: 0o700 });
    const script = fileURLToPath(new URL('../../deploy/provision-preview-admin.sh', import.meta.url));
    const result = spawnSync('bash', [script], {
      cwd: dir,
      env: { ...process.env, PATH: dir + ':' + (process.env.PATH ?? ''), PREVIEW_TEST_MARKER: marker },
      encoding: 'utf8', timeout: 5000,
    });
    assert.ifError(result.error);
    assert.equal(result.status, 1);
    assert.equal(existsSync(marker), false);
    assert.match(result.stderr, /ARCHIVED.*2026-11-13/);
    assert.equal(result.stdout, '');
    const doc = readFileSync(new URL('../../deploy/ADMIN-PREVIEW-ACCESS.md', import.meta.url), 'utf8');
    const cross = readFileSync(new URL('../../deploy/TEMPORARY-DEMO-ACCESS.md', import.meta.url), 'utf8');
    assert.match(doc, /АРХИВ/);
    assert.match(doc, /14 ноября 2026 года/);
    assert.match(doc, /12 ролей/);
    assert.match(cross, /архивная первоначальная инициализация/);
    assert.doesNotMatch(doc, /bash deploy\/provision-preview-admin\.sh/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
