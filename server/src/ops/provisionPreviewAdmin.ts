// Operator-only, first-account bootstrap for an owner who cannot receive SMS yet.
// Run solely via deploy/provision-preview-admin.sh on the production VPS.
// No public route, shared PIN, .env secret, SMS bypass or fixture data.
import { randomBytes, randomInt, scryptSync } from 'node:crypto';
import { config, isProd } from '../config.ts';
import { createDb } from '../db/index.ts';
import { normalizePhone } from '../util.ts';

if (!isProd || process.env.STAFF_PREVIEW_BOOTSTRAP_CONFIRM !== 'YES')
  throw new Error('Only an explicitly confirmed local production VPS invocation is allowed');
if (config.adminPhones.length !== 1 || normalizePhone(config.adminPhones[0]) !== config.adminPhones[0])
  throw new Error('Exactly one correctly normalized ADMIN_PHONES number is required');
const phone = config.adminPhones[0];
if (config.moderatorPhones.includes(phone) || config.insurerPrimaryPhone === phone ||
    config.recoveryContactPhone === phone)
  throw new Error('The protected administrator number conflicts with another restricted staff number');

// Ten-digit one-time preview code, typed into the existing password field.
// No code, phone, or plaintext password is stored in source or logs.
const password = randomInt(0, 10_000_000_000).toString().padStart(10, '0');
const salt = randomBytes(16).toString('hex');
const passwordHash = `scrypt:${salt}:${scryptSync(password, Buffer.from(salt, 'hex'), 64).toString('hex')}`;
// This is a ONE-EVENING preview, not a reusable daily bypass.
// 14 Nov 2026 00:00 Moscow time is 13 Nov 2026 21:00 UTC.
const expiresAt = new Date('2026-11-13T21:00:00.000Z');
if (Date.now() >= expiresAt.getTime())
  throw new Error('Today\'s preview window has ended; temporary owner login is no longer available');
const db = await createDb(config.databaseUrl);
try {
  if (db.driver !== 'pg') throw new Error('Real PostgreSQL is required');
  await db.tx(async q => {
    await q.query('select pg_advisory_xact_lock(hashtext($1))', ['staff:initial_preview_admin']);
    const users = await q.one<{ n: number }>('select count(*)::int as n from users');
    if (!users || users.n !== 0)
      throw new Error('Refusing to modify an existing account: preview bootstrap requires an empty user database');
    const record = await q.one<{ id: string }>(
      `insert into users(phone,roles,name,registration_kind,password_hash,admin_preview_until)
         values ($1,array['admin','master'],'Администратор TrakSOS','master',$2,$3)
         returning id`,
      [phone, passwordHash, expiresAt],
    );
    if (!record) throw new Error('Unable to create the preview administrator');
    await q.query(
      `insert into audit_log(actor_id,action,target,data)
         values ($1::uuid,'staff.preview_admin_created',$1::text,$2::jsonb)`,
      [record.id, { via: 'local_vps', expiresAt: expiresAt.toISOString(), noSms: true }],
    );
  });
  console.log('OK: created one restricted administrator + master account.');
  console.log('Temporary 10-digit login code (shown only here): ' + password);
  console.log('Expires at (UTC): ' + expiresAt.toISOString());
  console.log('On the site: enter the single ADMIN_PHONES number in Phone and this code in Password.');
  console.log('Do NOT send this code in chat, screenshots or support tickets.');
} finally {
  await db.close();
}
