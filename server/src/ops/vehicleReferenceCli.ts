/**
 * Sandboxed catalogue lifecycle CLI. The official licence and source must
 * be reviewed by an administrator before staging ANY third-party records.
 * Never run on a live client database or production instance.
 */
import { readFile } from 'node:fs/promises';
import { createDb } from '../db/index.ts';
import { config } from '../config.ts';
import { VehicleReferenceService } from '../services/vehicleReference.ts';

if (!config.sandboxInstance || process.env.VEHICLE_REF_SANDBOX_CLI !== 'yes' ||
    !process.env.DATABASE_URL?.toLowerCase().includes('sandbox'))
  throw new Error('Vehicle reference imports are disabled outside isolated sandbox');
const actorId = process.env.VEHICLE_REF_ADMIN_ID;
if (!actorId || !/^[0-9a-f-]{36}$/i.test(actorId))
  throw new Error('VEHICLE_REF_ADMIN_ID must reference an existing isolated sandbox administrator');

const [command, ...params] = process.argv.slice(2);
const db = await createDb(config.databaseUrl);
try {
  const actor = await db.one<any>(
    'select id,phone,name,roles,status,owner_id from users where id=$1', [actorId]);
  if (!actor || actor.status !== 'active' || !actor.roles?.includes('admin'))
    throw new Error('No active sandbox administrator');
  const service = new VehicleReferenceService(db);
  const jsonFile = async (path: string | undefined) => {
    if (!path) throw new Error('JSON import path is required');
    const data = await readFile(path, 'utf8');
    if (data.length > 2_000_000) throw new Error('Import above 2MB: split by provenance/source revision');
    return JSON.parse(data);
  };
  let result: unknown;
  if (command === 'register-source') {
    result = await service.registerSource(actor, await jsonFile(params[0]));
  } else if (command === 'approve-source') {
    if (!params[0] || !params[1]) throw new Error('Use: approve-source source-key documented-review-reason');
    result = await service.approveSource(actor, params[0], params.slice(1).join(' '));
  } else if (command === 'revoke-source') {
    if (!params[0] || !params[1]) throw new Error('Use: revoke-source source-key reason');
    result = await service.revokeSource(actor, params[0], params.slice(1).join(' '));
  } else if (command === 'stage') {
    if (!params[0]) throw new Error('Use: stage source-key snapshot-json');
    result = await service.stageSnapshot(actor, params[0], await jsonFile(params[1]));
  } else if (command === 'activate') {
    if (!params[0] || !params[1] || !params[2])
      throw new Error('Use: activate source-key revision review-reason');
    result = await service.activateSnapshot(actor, params[0], params[1], params.slice(2).join(' '));
  } else if (command === 'sources') {
    result = await service.listSources(actor);
  } else if (command === 'versions') {
    if (!params[0]) throw new Error('Use: versions source-key');
    result = await service.listVersions(actor, params[0]);
  } else if (command === 'brands') {
    result = await service.brands(actor, 'admin', { q: params[0] || '' });
  } else if (command === 'models') {
    if (!params[0] || !params[1]) throw new Error('Use: models category brand-key');
    result = await service.models(actor, 'admin', params[0] as any, params[1]);
  } else {
    throw new Error('Commands: register-source, approve-source, revoke-source, stage, activate, sources, versions, brands, models');
  }
  if (result !== undefined) process.stdout.write(JSON.stringify(result, null, 2) + '\n');
} finally {
  await db.close();
}
