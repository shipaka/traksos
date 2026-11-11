import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VehicleServiceRequests } from '../src/services/vehicleServiceRequests.ts';

const owner = { id: 'owner-1', roles: [] } as any;
const driver = { id: 'driver-1', owner_id: 'owner-1', roles: [] } as any;
const admin = { id: 'admin-1', roles: ['admin'] } as any;
const moderator = { id: 'mod-1', roles: ['moderator'] } as any;
const outsider = { id: 'outsider-1', roles: [] } as any;

function mockDb(current: any = { id: 'request-1', kind: 'inspection', status: 'submitted' }) {
  const calls: Array<{ sql: string; params: any[] }> = [];
  const db: any = {
    one: async (sql: string, params: any[]) => {
      calls.push({ sql, params });
      if (sql.startsWith('select * from vehicle_service_requests')) return current;
      if (sql.startsWith('update vehicle_service_requests')) return { ...current, status: sql.includes("set status='cancelled'") ? 'cancelled' : params[1] };
      return null;
    },
    tx: async (fn: any) => fn(db),
  };
  return { db, calls };
}

test('non-staff cannot change status or view staff queue', async () => {
  const { db, calls } = mockDb();
  const service = new VehicleServiceRequests(db);
  await assert.rejects(service.setStatus(outsider, 'request-1', 'in_review'));
  await assert.rejects(service.queue(outsider));
  assert.equal(calls.length, 0);
});

test('staff can perform allowed transitions but cannot skip states', async () => {
  const { db } = mockDb();
  const service = new VehicleServiceRequests(db);
  const result = await service.setStatus(admin, 'request-1', 'in_review');
  assert.equal(result.status, 'in_review');
  await assert.rejects(service.setStatus(moderator, 'request-1', 'completed'));
});

test('completed requests cannot transition again', async () => {
  const { db } = mockDb({ id: 'request-1', kind: 'inspection', status: 'completed' });
  await assert.rejects(new VehicleServiceRequests(db).setStatus(admin, 'request-1', 'in_review'));
});

test('insurance completion requires a valid policy expiry', async () => {
  const { db } = mockDb({ id: 'request-1', kind: 'insurance', status: 'sent_to_partner', policy_expires_on: null });
  const service = new VehicleServiceRequests(db);
  await assert.rejects(service.setStatus(admin, 'request-1', 'completed'));
  await assert.rejects(service.setStatus(admin, 'request-1', 'completed', undefined, '2026-02-30'));
  const result = await service.setStatus(admin, 'request-1', 'completed', undefined, '2027-02-28');
  assert.equal(result.status, 'completed');
});

test('cancellation SQL restricts status, owner and driver permission', async () => {
  const { db, calls } = mockDb();
  const service = new VehicleServiceRequests(db);
  const cancelledByOwner = await service.cancel(owner, 'request-1');
  const cancelledByDriver = await service.cancel(driver, 'request-2');
  assert.equal(cancelledByOwner.status, 'cancelled');
  assert.equal(cancelledByDriver.status, 'cancelled');
  assert.match(calls[0].sql, /status in \('submitted','in_review','need_documents'\)/);
  assert.match(calls[0].sql, /owner_id=\$2/);
  assert.match(calls[1].sql, /requested_by=\$3/);
  assert.match(calls[1].sql, /v\.driver_id=\$3/);
  assert.match(calls[1].sql, /fleet->'allow'/);
  assert.deepEqual(calls[1].params, ['request-2', 'owner-1', 'driver-1']);
});

test('cancellation fails when no eligible request is updated', async () => {
  const db: any = { one: async () => null };
  await assert.rejects(new VehicleServiceRequests(db).cancel(driver, 'request-1'));
});
