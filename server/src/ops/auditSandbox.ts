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

  // Workshop billing is intentionally separate from ordinary order ledger.
  // Verify every synthetic workshop invoice rather than only the one exercised
  // in the scripted scenario. The customer surcharge must remain <= 5% of
  // labour (no surcharge on parts), subject to the RUB 5000 fee ceiling.
  const serviceInvoices = await db.query<{
    id:string;amount:number;parts_amount:number;fee_base_amount:number;
    client_fee:number;discount:number;commission:number;
    received_amount:number;refunded_amount:number;paid_out_at:string|null;
  }>(`
    select id::text,amount,parts_amount,fee_base_amount,client_fee,discount,
      commission,received_amount,refunded_amount,paid_out_at
    from service_bookings where payment_required=true and amount is not null
  `);
  for (const inv of serviceInvoices) {
    const money = (n:unknown) => Number(n ?? 0);
    const amount=money(inv.amount), parts=money(inv.parts_amount);
    const feeBase=money(inv.fee_base_amount),fee=money(inv.client_fee);
    const discount=money(inv.discount),commission=money(inv.commission);
    const received=money(inv.received_amount),refunded=money(inv.refunded_amount);
    const total=amount+fee-discount;
    require([amount,parts,feeBase,fee,discount,commission,received,refunded,total]
      .every(Number.isSafeInteger),'workshop has non-integer kopecks: '+inv.id);
    require(parts>=0 && parts<=amount && feeBase===amount-parts,
      'STO parts and labour allocation diverged: '+inv.id);
    require(fee>=0 && fee<=Math.min(Math.round(feeBase*0.05),500_000),
      'STO customer fee exceeds agreed ceiling: '+inv.id);
    require(discount>=0 && discount<=amount+fee && commission>=0 &&
      commission<=feeBase,'STO commission or discount exceeds service amount: '+inv.id);
    require(received>=0 && refunded>=0 && refunded<=received &&
      received-refunded<=total,'STO synthetic receipts/refunds exceed customer total: '+inv.id);
    require(!inv.paid_out_at || received-refunded>=total,
      'STO payout recorded before a fully received synthetic invoice: '+inv.id);
  }

  const orders = await db.one<{total:string;completed:string}>(`
    select count(*)::text as total,
      count(*) filter (where status='completed')::text as completed from orders
  `);
  console.log(JSON.stringify({
    sandbox:true, database:'isolated', mode:'real-order-logic/fictitious-money',
    checkedRoles:SANDBOX_ROLES.length, users:Number(registered?.n),
    actualOrders:Number(orders?.total), completedOrders:Number(orders?.completed),
    ledgerBalanced:true, serviceInvoicesChecked:serviceInvoices.length,
    providerReferencesValid:true, externalPayments:false,
  },null,2));
} finally {
  await db.close();
}
