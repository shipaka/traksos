// Run ONLY from the operator's VPS shell, in the app container after the owner
// registers as a master with real SMS and a strong password.
// No phone number, password or code is written to logs or Git.
import { config, isProd } from '../config.ts';
import { createDb } from '../db/index.ts';
import { normalizePhone } from '../util.ts';

if (!isProd || process.env.STAFF_BOOTSTRAP_CONFIRM !== 'YES')
  throw new Error('Staff bootstrap requires production and explicit local confirmation');
if (config.adminPhones.length !== 1 || normalizePhone(config.adminPhones[0]) !== config.adminPhones[0])
  throw new Error('Configure exactly one valid ADMIN_PHONES value on the VPS before bootstrap');
const db = await createDb(config.databaseUrl);
try {
  await db.tx(async q => {
    const user = await q.one<{ id: string; roles: string[]; password_hash: string | null }>(
      'select id,roles,password_hash from users where phone=$1 for update', [config.adminPhones[0]]);
    if (!user || !user.password_hash || !user.roles.includes('master') ||
        user.roles.includes('client') || user.roles.includes('moderator'))
      throw new Error('The designated owner must first complete master registration and set a password');
    const otherAdmins = await q.query<{ id: string }>(
      "select id from users where 'admin'=any(roles) and id<>$1", [user.id]);
    if (otherAdmins.length) throw new Error('An unexpected existing administrator blocks bootstrap; inspect privately');
    if (!user.roles.includes('admin')) {
      await q.query(
        "update users set roles=array_append(roles,'admin') where id=$1", [user.id]);
      await q.query(
        "insert into audit_log(actor_id,action,target,data) values ($1,'staff.bootstrap_admin',$1,$2)",
        [user.id, { via: 'local_vps', userConfirmed: true }]);
    }
    // Require the owner to sign in again after any permission change.
    await q.query('delete from sessions where user_id=$1', [user.id]);
  });
  console.log('OK: designated owner has administrator + master permissions; old sessions revoked');
} finally {
  await db.close();
}
