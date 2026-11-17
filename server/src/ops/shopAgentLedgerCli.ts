/**
 * Sandbox-only operator CLI for isolated evidence-ledger acceptance.
 * Not mounted in API or available to customers. Never run against production.
 *
 * Example (on a real isolated sandbox):
 *   SANDBOX_INSTANCE=true SHOP_AGENT_LEDGER_SANDBOX_CLI=yes \
 *   SHOP_AGENT_ADMIN_ID=<sandbox-admin-uuid> \
 *   npx tsx src/ops/shopAgentLedgerCli.ts report month 2026-11-17
 */
import { readFile } from 'node:fs/promises';
import { createDb } from '../db/index.ts';
import { config } from '../config.ts';
import { ShopAgentEvidenceLedger } from '../services/shopAgentLedger.ts';

if (!config.sandboxInstance || process.env.SHOP_AGENT_LEDGER_SANDBOX_CLI !== 'yes' ||
    !process.env.DATABASE_URL?.toLowerCase().includes('sandbox'))
  throw new Error('This operator utility is disabled outside an explicitly isolated sandbox database');

const adminId = process.env.SHOP_AGENT_ADMIN_ID;
if (!adminId || !/^[0-9a-f-]{36}$/i.test(adminId))
  throw new Error('SHOP_AGENT_ADMIN_ID must be the real UUID of an isolated sandbox administrator');

const [command, ...args] = process.argv.slice(2);
const db = await createDb(config.databaseUrl);
try {
  const actor = await db.one<any>('select id, phone, name, roles, status, owner_id from users where id=$1', [adminId]);
  if (!actor || actor.status !== 'active' || !actor.roles?.includes('admin'))
    throw new Error('No active sandbox administrator with supplied UUID');
  const ledger = new ShopAgentEvidenceLedger(db);
  const parseInput = async (file: string | undefined) => {
    if (!file) throw new Error('JSON file path is required');
    // Do not print the source document (it may contain company information).
    const data = await readFile(file, 'utf8');
    if (data.length > 30000) throw new Error('Input exceeds 30 KB');
    return JSON.parse(data);
  };
  let output: unknown;
  if (command === 'create-line') {
    output = await ledger.createLine(actor, await parseInput(args[0]));
  } else if (command === 'event') {
    if (!args[0]) throw new Error('Line key is required');
    output = await ledger.appendEvent(actor, args[0], await parseInput(args[1]));
  } else if (command === 'inspect') {
    if (!args[0]) throw new Error('Line key is required');
    output = await ledger.inspect(actor, args[0]);
  } else if (command === 'approve') {
    if (!args[0] || !args[1]) throw new Error('Line key and approval reason are required');
    output = await ledger.approve(actor, args[0], args.slice(1).join(' '));
  } else if (command === 'report' || command === 'csv') {
    const kind = args[0];
    if (!['day','week','month','custom'].includes(kind || ''))
      throw new Error('Period must be day, week, month or custom');
    const date = args[1];
    if (!date) throw new Error('Report day is required (YYYY-MM-DD)');
    const until = kind === 'custom' ? args[2] : undefined;
    const inn = kind === 'custom' ? args[3] : args[2];
    if (command === 'report')
      output = await ledger.periodReport(actor, kind as any, date, until, inn);
    else {
      const result = await ledger.exportCsv(actor, kind as any, date, until, inn);
      process.stdout.write(result.csv);
      console.error('CSV snapshot digest: ' + result.digest + ', snapshot ID: ' + result.snapshotId);
      output = undefined;
    }
  } else {
    throw new Error('Commands: create-line <json-file>, event <line-key> <json-file>, inspect <line-key>, approve <line-key> <reason>, report/csv day|week|month|custom <day> [until] [INN]');
  }
  if (output !== undefined) process.stdout.write(JSON.stringify(output, null, 2) + '\n');
} finally {
  await db.close();
}
