// Run only from a confirmed SSH session within the production app container.
// Generates a one-time temporary code for the isolated fake-data training UI.
// Never grants admin roles, logs into accounts, or writes real user information.
import { randomInt } from 'node:crypto';
import { config, isProd } from '../config.ts';
import { createDb } from '../db/index.ts';
import { demoPinHash } from '../services/operatorDemo.ts';

if (!isProd || process.env.OPERATOR_DEMO_CONFIRM !== 'YES')
  throw new Error('Operator demo code issuance is available only on the confirmed production VPS');
if (config.adminPhones.length !== 1)
  throw new Error('Configure one primary administrator phone before issuing demo access');
const db = await createDb(config.databaseUrl);
try {
  if (db.driver !== 'pg') throw new Error('A real PostgreSQL database is required');
  const pin = randomInt(0, 10_000_000_000).toString().padStart(10,'0');
  const expiration = new Date(Date.now() + 4 * 60 * 60_000);
  await db.tx(async q => {
    await q.query('select pg_advisory_xact_lock(hashtext($1))',['operator:demo:pin']);
    await q.query(
      `insert into operator_demo_grant(id,pin_hash,expires_at,attempts,redeemed_at)
       values (1,$1,$2,0,null)
       on conflict(id) do update set pin_hash=excluded.pin_hash,expires_at=excluded.expires_at,
          attempts=0,redeemed_at=null`,
      [demoPinHash(pin),expiration],
    );
    // A newly issued code revokes all previous demo tabs and sessions.
    await q.query('delete from operator_demo_session');
  });
  console.log('One-time read-only demo code: ' + pin);
  console.log('Code expires (UTC): ' + expiration.toISOString());
  console.log('Open https://traksos.ru/#/preview on the computer. Enter this code there.');
  console.log('After successful redemption the preview session is valid for at most 2 hours.');
  console.log('DO NOT share this terminal output or code in chats/screenshots.');
  console.log('No SMS sent, no real account, admin role, or database records exposed.');
} finally {
  await db.close();
}
