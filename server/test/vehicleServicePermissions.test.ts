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
  assert.equal(result?.status, 'in_review');
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
  assert.equal(result?.status, 'completed');
});

test('staff cannot complete insurance with an already expired policy', async () => {
  const { db, calls } = mockDb({ id: 'request-1', kind: 'insurance', status: 'sent_to_partner', policy_expires_on: null });
  await assert.rejects(
    new VehicleServiceRequests(db).setStatus(admin, 'request-1', 'completed', undefined, '2000-01-01'),
    /позже сегодняшнего дня/,
  );
  assert.equal(calls.some(c => c.sql.startsWith('update vehicle_service_requests')), false);
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

test('policy renewal rejects impossible dates before any database query', async () => {
  let queries = 0;
  const db: any = { one: async () => { queries++; return null; } };
  const service = new VehicleServiceRequests(db);
  for (const date of ['2026-02-29', '2027-02-30', '2027-13-01', '2027-01-00', '2027/01/01', 'not-a-date']) {
    await assert.rejects(service.renewPolicy(owner, 'request-1', date), /Некорректная дата/);
  }
  assert.equal(queries, 0);
});

test('driver cannot renew a policy even with a valid date', async () => {
  let queries = 0;
  const db: any = { one: async () => { queries++; return null; } };
  await assert.rejects(new VehicleServiceRequests(db).renewPolicy(driver, 'request-1', '2028-02-29'));
  assert.equal(queries, 0);
});

test('valid leap-day renewal re-arms reminders on a completed insurance request', async () => {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const db: any = {
    one: async (sql: string, params: unknown[]) => {
      calls.push({ sql, params });
      return { id: 'request-1', kind: 'insurance', status: 'completed', policy_expires_on: params[2] };
    },
  };
  const result = await new VehicleServiceRequests(db).renewPolicy(owner, 'request-1', '2028-02-29');
  assert.equal(result.policy_expires_on, '2028-02-29');
  assert.deepEqual(calls[0].params, ['request-1', owner.id, '2028-02-29']);
  assert.match(calls[0].sql, /kind='insurance' and status='completed'/);
  for (const column of ['reminder_30_sent_at', 'reminder_7_sent_at', 'reminder_1_sent_at']) {
    assert.match(calls[0].sql, new RegExp(column + '=null'));
  }
});

test('driver sees only authorized kinds and their assigned vehicle requests', async () => {
  const calls: Array<{ sql: string; params: any[] }> = [];
  const db: any = {
    one: async () => ({ fleet: { allow: { insurance: true, inspection: false } } }),
    query: async (sql: string, params: any[]) => {
      calls.push({ sql, params });
      return [];
    },
  };
  await new VehicleServiceRequests(db).mine(driver);
  assert.deepEqual(calls[0].params, ['owner-1', 'driver-1', ['insurance']]);
  assert.match(calls[0].sql, /v\.driver_id=\$2/);
  assert.match(calls[0].sql, /r\.kind = any\(\$3::text\[\]\)/);
});

test('driver cannot inspect request history for someone else assigned vehicle', async () => {
  let queries = 0;
  const db: any = {
    one: async () => ({ id: 'vehicle-1', driver_id: 'other-driver' }),
    query: async () => { queries++; return []; },
  };
  await assert.rejects(new VehicleServiceRequests(db).history(driver, 'vehicle-1'));
  assert.equal(queries, 0);
});

test('owner history includes both service kinds without driver restrictions', async () => {
  const queries: any[][] = [];
  const db: any = {
    one: async () => ({ id: 'vehicle-1', driver_id: 'driver-1' }),
    query: async (_sql: string, params: any[]) => { queries.push(params); return []; },
  };
  await new VehicleServiceRequests(db).history(owner, 'vehicle-1');
  assert.deepEqual(queries[0], ['vehicle-1', 'owner-1', ['insurance', 'inspection']]);
});

test('owner can create a request for their vehicle and remains the requester', async () => {
  const calls: Array<{ sql: string; params: any[] }> = [];
  const db: any = {
    one: async (sql: string, params: any[]) => {
      calls.push({ sql, params });
      if (sql.startsWith('select id, driver_id from vehicles')) return { id: 'vehicle-1', driver_id: 'driver-1' };
      if (sql.startsWith('select id from vehicle_service_requests')) return null;
      if (sql.startsWith('insert into vehicle_service_requests')) return { id: 'request-1', owner_id: owner.id, requested_by: owner.id, kind: 'insurance' };
      return null;
    },
    tx: async (fn: any) => fn(db),
  };
  const result = await new VehicleServiceRequests(db).create(owner, 'vehicle-1', 'insurance', 'Нужен полис');
  assert.equal(result.requested_by, owner.id);
  assert.deepEqual(calls.find(c => c.sql.startsWith('insert into vehicle_service_requests'))?.params,
    [owner.id, owner.id, 'vehicle-1', 'insurance', 'Нужен полис']);
  assert.match(calls[1].sql, /for update/);
});

test('driver cannot create a service request when the owner disabled the service', async () => {
  let inserts = 0;
  const db: any = {
    one: async (sql: string) => {
      if (sql.startsWith('select id, driver_id from vehicles')) return { id: 'vehicle-1', driver_id: driver.id };
      if (sql.startsWith('select fleet from users')) return { fleet: { allow: { insurance: false } } };
      if (sql.startsWith('insert into vehicle_service_requests')) inserts++;
      return null;
    },
    tx: async (fn: any) => fn(db),
  };
  await assert.rejects(new VehicleServiceRequests(db).create(driver, 'vehicle-1', 'insurance'), /не разрешил/);
  assert.equal(inserts, 0);
});

test('request creation rejects duplicates before inserting another active request', async () => {
  let inserts = 0;
  const db: any = {
    one: async (sql: string) => {
      if (sql.startsWith('select id, driver_id from vehicles')) return { id: 'vehicle-1', driver_id: 'driver-1' };
      if (sql.startsWith('select id from vehicle_service_requests')) return { id: 'existing-request' };
      if (sql.startsWith('insert into vehicle_service_requests')) inserts++;
      return null;
    },
    tx: async (fn: any) => fn(db),
  };
  await assert.rejects(new VehicleServiceRequests(db).create(owner, 'vehicle-1', 'inspection'), /активная заявка/);
  assert.equal(inserts, 0);
});

test('driver reassignment before transaction lock prevents request creation', async () => {
  let inserts = 0;
  let vehicleReads = 0;
  const db: any = {
    one: async (sql: string) => {
      if (sql.startsWith('select id, driver_id from vehicles')) {
        vehicleReads++;
        return { id: 'vehicle-1', driver_id: vehicleReads === 1 ? driver.id : 'other-driver' };
      }
      if (sql.startsWith('insert into vehicle_service_requests')) inserts++;
      return null;
    },
    tx: async (fn: any) => fn(db),
  };
  await assert.rejects(new VehicleServiceRequests(db).create(driver, 'vehicle-1', 'inspection'), /Машина не найдена/);
  assert.equal(vehicleReads, 2);
  assert.equal(inserts, 0);
});

test('rejection and document requests require an explanation visible to the client', async () => {
  for (const status of ['rejected', 'need_documents'] as const) {
    let updates = 0;
    const db: any = {
      one: async (sql: string) => {
        if (sql.startsWith('select * from vehicle_service_requests')) {
          return { id: 'request-1', kind: 'inspection', status: 'in_review', staff_note: null };
        }
        if (sql.startsWith('update vehicle_service_requests')) updates++;
        return null;
      },
      tx: async (fn: any) => fn(db),
    };
    const service = new VehicleServiceRequests(db);
    await assert.rejects(service.setStatus(admin, 'request-1', status), /причину отказа или список/);
    assert.equal(updates, 0);
  }
});

test('staff can request documents when a reason is provided', async () => {
  const { db, calls } = mockDb({ id: 'request-1', kind: 'inspection', status: 'in_review', staff_note: null });
  const result = await new VehicleServiceRequests(db).setStatus(admin, 'request-1', 'need_documents', 'Пришлите фото свидетельства');
  assert.equal(result?.status, 'need_documents');
  const update = calls.find(c => c.sql.startsWith('update vehicle_service_requests'));
  assert.equal(update?.params[2], 'Пришлите фото свидетельства');
});

test('vehicle service history includes timeline only after ownership check', async () => {
  const captured: Array<{ sql: string; params: unknown[] }> = [];
  const db: any = {
    one: async () => ({ id: 'vehicle-1', driver_id: 'driver-1' }),
    query: async (sql: string, params: unknown[]) => {
      captured.push({ sql, params });
      return [];
    },
  };
  await new VehicleServiceRequests(db).history(owner, 'vehicle-1');
  assert.equal(captured.length, 1);
  assert.match(captured[0].sql, /vehicle_service_request_events e/);
  assert.match(captured[0].sql, /r\.requested_by/);
  assert.match(captured[0].sql, /e\.request_id=r\.id/);
  assert.match(captured[0].sql, /r\.vehicle_id=\$1 and r\.owner_id=\$2/);
  assert.deepEqual(captured[0].params, ['vehicle-1', 'owner-1', ['insurance', 'inspection']]);
});

test('a prior staff comment cannot be reused as the reason for a new rejection', async () => {
  const { db, calls } = mockDb({
    id: 'request-1', kind: 'inspection', status: 'sent_to_partner',
    staff_note: 'Передали партнёру для обработки',
  });
  await assert.rejects(new VehicleServiceRequests(db).setStatus(admin, 'request-1', 'rejected'), /причину отказа/);
  assert.equal(calls.some(c => c.sql.startsWith('update vehicle_service_requests')), false);
});

test('a new explicit rejection reason is accepted', async () => {
  const { db, calls } = mockDb({
    id: 'request-1', kind: 'inspection', status: 'sent_to_partner',
    staff_note: 'Передали партнёру для обработки',
  });
  const result = await new VehicleServiceRequests(db).setStatus(admin, 'request-1', 'rejected', 'Нет доступного партнёра');
  assert.equal(result?.status, 'rejected');
  const update = calls.find(c => c.sql.startsWith('update vehicle_service_requests'));
  assert.equal(update?.params[2], 'Нет доступного партнёра');
});

test('old document request note is cleared after completing a later inspection stage', async () => {
  const { db, calls } = mockDb({
    id: 'request-1', kind: 'inspection', status: 'sent_to_partner',
    staff_note: 'Пришлите фото свидетельства',
  });
  await new VehicleServiceRequests(db).setStatus(admin, 'request-1', 'completed');
  const update = calls.find(c => c.sql.startsWith('update vehicle_service_requests'));
  assert.equal(update?.params[2], null);
});

test('new staff note is preserved on a later status transition', async () => {
  const { db, calls } = mockDb({
    id: 'request-1', kind: 'inspection', status: 'sent_to_partner',
    staff_note: 'Нужны документы',
  });
  await new VehicleServiceRequests(db).setStatus(admin, 'request-1', 'completed', 'Техосмотр завершён');
  const update = calls.find(c => c.sql.startsWith('update vehicle_service_requests'));
  assert.equal(update?.params[2], 'Техосмотр завершён');
});
