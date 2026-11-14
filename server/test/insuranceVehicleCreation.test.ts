import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VehicleServiceRequests } from '../src/services/vehicleServiceRequests.ts';

const owner = { id: 'owner-1', roles: ['client'] } as any;
const driver = { id: 'driver-1', owner_id: 'owner-1', roles: ['driver'] } as any;
const details = { applicant: { firstName: 'Иван', lastName: 'Иванов' }, vehicle: {
  brand: 'Scania', model: 'R500', year: '2007', plate: 'А123АА77',
  vin: 'YS2R4X20001234567', trailerPlate: '',
}};
const insurance = { agentId: 'agent-1', details };

function mock(existing: any[] = []) {
  const statements: { sql: string; params: any[] }[] = [];
  const db: any = {
    tx: async (fn: any) => fn(db),
    one: async (sql: string, params: any[]) => {
      statements.push({ sql, params });
      if (sql.startsWith('select id from users')) return { id: owner.id };
      if (sql.startsWith('insert into vehicles')) return { id: 'new-vehicle' };
      if (sql.startsWith('select id, driver_id, brand')) return { id: params[0], driver_id: null, brand: 'Scania', model: 'R500', year: 2007, plate: 'А123АА77', vin: details.vehicle.vin };
      if (sql.includes('from users') && sql.includes('insurer')) return { id: insurance.agentId };
      if (sql.startsWith('insert into vehicle_service_requests')) return { id: 'request-1', vehicle_id: params[2] };
      return null;
    },
    query: async (sql: string, params: any[]) => {
      statements.push({ sql, params });
      if (sql.includes('select id,brand,model,year,plate,vin')) return existing;
      return [];
    },
  };
  return { db, statements };
}

test('insurance without garage vehicle creates one and persists VIN', async () => {
  const { db, statements } = mock();
  const created = await new VehicleServiceRequests(db).create(owner, undefined, 'insurance', '', insurance);
  assert.equal(created.vehicle_id, 'new-vehicle');
  const insert = statements.find(x => x.sql.startsWith('insert into vehicles'))!;
  assert.match(insert.sql, /vin/);
  assert.equal(insert.params[6], details.vehicle.vin);
});

test('matching VIN and plate reuse an existing vehicle', async () => {
  const { db, statements } = mock([{ id: 'existing', brand: 'Scania', model: 'R500',
    year: 2007, plate: 'А123АА77', vin: details.vehicle.vin }]);
  const created = await new VehicleServiceRequests(db).create(owner, undefined, 'insurance', '', insurance);
  assert.equal(created.vehicle_id, 'existing');
  assert.equal(statements.some(x => x.sql.startsWith('insert into vehicles')), false);
});

test('conflicting VIN or vehicle attributes reject instead of merging', async () => {
  const { db, statements } = mock([{ id: 'existing', brand: 'Scania', model: 'R500',
    year: 2008, plate: 'А123АА77', vin: details.vehicle.vin }]);
  await assert.rejects(new VehicleServiceRequests(db).create(owner, undefined, 'insurance', '', insurance), /VIN|госномер/);
  assert.equal(statements.some(x => x.sql.startsWith('insert into vehicles')), false);
});

test('driver cannot silently add a vehicle to the company garage', async () => {
  const { db, statements } = mock();
  await assert.rejects(new VehicleServiceRequests(db).create(driver, undefined, 'insurance', '', insurance));
  assert.equal(statements.some(x => x.sql.startsWith('insert into vehicles')), false);
});

test('selected garage vehicle cannot be insured with a different VIN', async () => {
  const { db, statements } = mock();
  const changed = { ...insurance, details: {
    ...details, vehicle: { ...details.vehicle, vin: 'YS2R4X20009999999' },
  }};
  await assert.rejects(
    new VehicleServiceRequests(db).create(owner, 'existing-vehicle', 'insurance', '', changed),
    /VIN|не совпадают/,
  );
  assert.equal(statements.some(x => x.sql.startsWith('insert into vehicle_service_requests')), false);
});

test('selected garage vehicle accepts matching details', async () => {
  const { db } = mock();
  const created = await new VehicleServiceRequests(db).create(owner, 'existing-vehicle', 'insurance', '', insurance);
  assert.equal(created.vehicle_id, 'existing-vehicle');
});
