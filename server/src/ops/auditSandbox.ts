// Read-only release gate for the live-like sandbox. This MUST be run against
// the sandbox Postgres volume, never the production database.
import { config } from '../config.ts';
import { createDb } from '../db/index.ts';
import { SANDBOX_ROLES, SANDBOX_USER_PHONE } from '../services/sandboxTickets.ts';

function require(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error('SANDBOX AUDIT FAILED: ' + message);
}

require(config.sandboxInstance, 'SANDBOX_INSTANCE is not enabled');
require(new URL(config.databaseUrl).pathname.toLowerCase().includes('sandbox'), 'database is not isolated');
require(config.sms.provider === 'log' && config.push.provider === 'log' &&
  config.payments.provider === 'mock', 'external notification or payment provider enabled');
require(process.env.TRAKSOS_SANDBOX_MOCK_CHECKOUT === 'true',
  'fake checkout must be explicitly enabled for full scenario testing');
const db = await createDb(config.databaseUrl);
try {
  require(db.driver === 'pg','real PostgreSQL required (not in-memory mini driver)');
  const roster = await db.query<{phone:string;roles:string[];status:string;id:string}>(
    'select id,phone,roles,status from users where phone=any($1::text[])',
    [SANDBOX_ROLES.map(role => SANDBOX_USER_PHONE[role])]);
  const byPhone = new Map(roster.map(user => [user.phone,user]));
  for (const role of SANDBOX_ROLES) {
    const p = SANDBOX_USER_PHONE[role];
    const u = byPhone.get(p);
    const expected = role === 'inspection' ? 'inspection_operator' :
      role === 'owner' || role === 'client' ? 'client' :
      role === 'master_service' ? 'master' : role;
    require(u?.status === 'active' && u.roles.includes(expected),
      'test participant is missing or inactive: ' + role);
    if (role === 'master_service') require(u.roles.includes('service'),
      'dual-role master does not have service access');
  }
  const registered = await db.one<{n:string}>('select count(*)::text as n from users');
  require(Number(registered?.n) >= SANDBOX_ROLES.length, 'synthetic roster is incomplete');

  // The client, master, tow truck and insurer must be different REAL user rows:
  // only their identity is fictional; all server-side transitions are shared.
  for (const role of ['master','tow','service'] as const) {
    const u = byPhone.get(SANDBOX_USER_PHONE[role])!;
    if (role === 'service') {
      const center = await db.one('select id from service_centers where owner_id=$1',[u.id]);
      require(!!center,'synthetic service station not registered');
    } else {
      const profile = await db.one<{verification:string}>(
        'select verification from performer_profiles where user_id=$1',[u.id]);
      require(profile?.verification === 'approved','provider not verified: ' + role);
    }
  }
  const owner = byPhone.get(SANDBOX_USER_PHONE.owner)!;
  const driver = byPhone.get(SANDBOX_USER_PHONE.driver)!;
  const relation = await db.one<{owner_id:string}>('select owner_id from users where id=$1',[driver.id]);
  require(relation?.owner_id === owner.id, 'fleet driver is not attached to its synthetic owner');
  const vehicles = await db.one<{n:string}>(
    'select count(*)::text as n from vehicles where owner_id=$1',[owner.id]);
  require(Number(vehicles?.n) > 0, 'fleet has no sample vehicles');

  // Financial conservation is tested on actual ledger rows created by the SAME
  // engine as production. Never compare against a manually hard-coded demo total.
  const unbalanced = await db.query<{order_id:string | null;balance:string}>(
    'select order_id::text, sum(amount)::text as balance from ledger_entries ' +
    'group by order_id having sum(amount)<>0 limit 10');
  require(unbalanced.length === 0,
    'client/performer/platform ledger does not balance for ' + unbalanced.length + ' order groups');
  const orphaned = await db.query<{id:string}>(`
    select p.id from payments p
    where p.provider='mock' and p.provider_payment_id is not null
      and not exists (select 1 from sandbox_mock_payments sp where sp.id=p.provider_payment_id)
    limit 10
  `);
  require(orphaned.length === 0,
    'payment references a missing durable sandbox mock provider operation');
  const unsafeRefund = await db.one<{n:string}>(`
    select count(*)::text as n from sandbox_mock_payments
    where refunded>captured or captured>total
  `);
  require(Number(unsafeRefund?.n) === 0,'sandbox captured/refunded amounts exceed totals');

  const orders = await db.one<{total:string;completed:string}>(`
    select count(*)::text as total,
      count(*) filter (where status='completed')::text as completed from orders
  `);
  console.log(JSON.stringify({
    sandbox:true, database:'isolated', mode:'real-order-logic/fictitious-money',
    checkedRoles:SANDBOX_ROLES.length, users:Number(registered?.n),
    actualOrders:Number(orders?.total), completedOrders:Number(orders?.completed),
    ledgerBalanced:true, providerReferencesValid:true, externalPayments:false,
  },null,2));
} finally {
  await db.close();
}
