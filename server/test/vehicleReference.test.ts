import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeCatalog, normalizeAlias, vehicleCategoriesForContext, validateReferenceSelection,
  type CatalogSnapshotInput,
} from '../src/domain/vehicleReference.ts';
import { VehicleReferenceService } from '../src/services/vehicleReference.ts';

const sample: CatalogSnapshotInput = {
  sourceRevision: 'sample-2026-11',
  brands: [
    { category: 'truck', key: 'renault', name: 'Renault Trucks', aliases: ['Рено'],
      models: [{ key: 'premium', name: 'Premium', aliases: ['Премиум'], yearFrom: 1996, yearTo: 2013 },
        { key: 't-series', name: 'T', yearFrom: 2013 }] },
    { category: 'trailer', key: 'schmitz', name: 'Schmitz', aliases: ['Шмитц'],
      models: [{ key: 's01', name: 'S01' }] },
    { category: 'passenger', key: 'lada', name: 'LADA',
      models: [{ key: 'granta', name: 'Granta', aliases: ['Гранта'], yearFrom: 2011 }] },
  ],
};
const admin = { id: 'a', roles: ['admin'] } as any;
const driver = { id: 'd', roles: ['driver'] } as any;
const master = { id: 'm', roles: ['master'] } as any;

test('stable digest is independent of import row order and model order', () => {
  const first = normalizeCatalog(sample);
  const reordered = normalizeCatalog({
    sourceRevision: sample.sourceRevision,
    brands: [...sample.brands].reverse().map((b) => ({ ...b, models: [...b.models].reverse() })),
  });
  assert.equal(first.sha256, reordered.sha256);
  assert.equal(first.brandCount, 3);
  assert.equal(first.modelCount, 4);
  assert.equal(first.brands[0].category, 'passenger');
  assert.equal(normalizeAlias('  РЕНО    Trucks  '), 'рено trucks');
});
test('duplicate brand keys, ambiguous aliases and invalid years fail before DB writes', () => {
  assert.throws(() => normalizeCatalog({ sourceRevision: 'v1', brands: [...sample.brands, sample.brands[0]] }));
  assert.throws(() => normalizeCatalog({ sourceRevision: 'v1', brands: [
    sample.brands[0], { ...sample.brands[0], key: 'other', aliases: ['Renault Trucks'] },
  ] }), /ambiguous_brand_alias/);
  assert.throws(() => normalizeCatalog({ sourceRevision: 'v1', brands: [
    { ...sample.brands[0], models: [sample.brands[0].models[0], sample.brands[0].models[0]] },
  ] }), /model_duplicate/);
  assert.throws(() => normalizeCatalog({ sourceRevision: 'v1', brands: [
    { ...sample.brands[0], models: [{ key: 'bad', name: 'Bad', yearFrom: 2025, yearTo: 2000 }] },
  ] }), /year_range_invalid/);
});
test('role-specific category presets do not silently disable heavy vehicle specialists', () => {
  assert.deepEqual(vehicleCategoriesForContext('master'), ['passenger', 'van']);
  assert.ok(vehicleCategoriesForContext('master', { includeHeavy: true }).includes('truck'));
  assert.deepEqual(vehicleCategoriesForContext('client'), ['truck', 'trailer', 'bus', 'van']);
  assert.ok(vehicleCategoriesForContext('insurer', { workflow: 'insurance' }).includes('passenger'));
  assert.throws(() => vehicleCategoriesForContext('forged' as any));
});
test('strict brand->model choice requires same category, selected make and valid year', () => {
  const brand = { key: 'renault', category: 'truck' as const, name: 'Renault Trucks', aliases: [] };
  const model = { key: 'premium', category: 'truck' as const, brandKey: 'renault', name: 'Premium',
    aliases: [], yearFrom: 1996, yearTo: 2013 };
  assert.equal(validateReferenceSelection([brand], [model],
    { category: 'truck', brandKey: 'renault', modelKey: 'premium', year: 2010 }).partsFitmentVerified, false);
  assert.throws(() => validateReferenceSelection([brand], [model],
    { category: 'truck', brandKey: 'other', modelKey: 'premium' }));
  assert.throws(() => validateReferenceSelection([brand], [model],
    { category: 'truck', brandKey: 'renault', modelKey: 'premium', year: 2022 }));
  assert.throws(() => validateReferenceSelection([brand], [model],
    { category: 'passenger', brandKey: 'renault', modelKey: 'premium' }));
});
test('non-admin cannot import or approve source even if role context allows reads', async () => {
  const forbiddenDb: any = { tx: () => { throw Error('Unexpected DB access'); } };
  const service = new VehicleReferenceService(forbiddenDb);
  const source = {
    key: 'internal-curated', name: 'Internal curated', originUrl: 'https://example.org/source',
    licenseName: 'Internal own work', licenseUrl: 'https://example.org/license',
    rightsEvidence: 'Manual legal authorization for redistributed reference dataset',
  };
  await assert.rejects(service.registerSource(driver, source), /только администратор/);
  await assert.rejects(service.approveSource(driver, 'internal-curated', 'Legal review completed'), /только администратор/);
  await assert.rejects(service.revokeSource(driver, 'internal-curated', 'Rights withdrawn'), /только администратор/);
  await assert.rejects(service.stageSnapshot(driver, 'internal-curated', sample), /только администратор/);
  await assert.rejects(service.activateSnapshot(driver, 'internal-curated', 'v1', 'Approved'), /только администратор/);
});
test('unsupported source URL rejected, no source allowed without explicit approval', async () => {
  let created = 0;
  const db: any = {
    tx: async (fn: (q: any) => any) => fn({
      one: async () => { created++; return { source_key: 'internal-curated', state: 'pending', redistribution_approved: false }; },
    }),
  };
  const service = new VehicleReferenceService(db);
  await assert.rejects(service.registerSource(admin, {
    key: 'internal-curated', name: 'Approved', originUrl: 'http://insecure.example/source',
    licenseName: 'Unverified', licenseUrl: 'https://example.org/license',
    rightsEvidence: 'Please review redistribution rights with legal counsel',
  }), /HTTPS/);
  assert.equal(created, 0);
  await assert.rejects(service.stageSnapshot(admin, 'internal-curated', sample), /Источник не допущен/);
});
test('source registration is idempotent and different rights under same key conflict', async () => {
  let stored: any = null;
  const logs: string[] = [];
  const q: any = {
    one: async (sql: string, p: any[]) => {
      if (sql.startsWith('insert into vehicle_ref_sources')) {
        if (stored) return null;
        stored = { source_key: p[0], source_name: p[1], origin_url: p[2], license_name: p[3],
          license_url: p[4], rights_evidence: p[5], state: 'pending' };
        return stored;
      }
      if (sql.startsWith('select * from vehicle_ref_sources')) return stored;
      return null;
    },
    query: async (sql: string) => { logs.push(sql); return []; },
  };
  const service = new VehicleReferenceService({ tx: async (fn: any) => fn(q) } as any);
  const input = { key: 'curated-1', name: 'Curated Set', originUrl: 'https://example.org/source',
    licenseName: 'Owned data', licenseUrl: 'https://example.org/license',
    rightsEvidence: 'Organization has rights to all records in this synthetic example' };
  await service.registerSource(admin, input);
  await service.registerSource(admin, input);
  assert.equal(logs.filter((sql) => sql.startsWith('insert into vehicle_ref_registry_events')).length, 1);
  await assert.rejects(service.registerSource(admin, { ...input, licenseName: 'New license' }),
    /уже зарегистрирован/);
});
test('source snapshot import is idempotent: no duplicated rows or cost of repeated CI', async () => {
  const canonical = normalizeCatalog(sample);
  let staged: any = null;
  let insertBrands = 0, insertModels = 0;
  const q: any = {
    one: async (sql: string, p: any[]) => {
      if (sql.startsWith('select * from vehicle_ref_sources'))
        return { source_key: 'curated-1', state: 'approved', redistribution_approved: true };
      if (sql.startsWith('insert into vehicle_ref_snapshots')) {
        if (staged) return null;
        staged = {
          id: 'snapshot-1', source_key: p[0], revision: p[1], content_sha256: p[2],
          brand_count: p[3], model_count: p[4], state: 'staged',
        };
        return staged;
      }
      if (sql.startsWith('select * from vehicle_ref_snapshots')) return staged;
      return null;
    },
    query: async (sql: string) => {
      if (sql.startsWith('insert into vehicle_ref_brands')) insertBrands++;
      if (sql.startsWith('insert into vehicle_ref_models')) insertModels++;
      return [];
    },
  };
  const service = new VehicleReferenceService({ tx: async (fn: any) => fn(q) } as any);
  const a = await service.stageSnapshot(admin, 'curated-1', sample);
  const b = await service.stageSnapshot(admin, 'curated-1', sample);
  assert.equal(a.contentSha256, canonical.sha256);
  assert.equal(b.contentSha256, a.contentSha256);
  assert.equal(insertBrands, 1);
  assert.equal(insertModels, 1);
  await assert.rejects(service.stageSnapshot(admin, 'curated-1', {
    sourceRevision: sample.sourceRevision,
    brands: [{ ...sample.brands[0], name: 'Changed' }],
  }), /другим содержимым/);
});
test('active reference list filters by role, aliases and source approval on SQL boundary', async () => {
  const calls: Array<{ sql: string; params: any[] }> = [];
  const db: any = {
    query: async (sql: string, params: any[]) => {
      calls.push({ sql, params });
      if (sql.includes('from vehicle_ref_brands'))
        return [{ category: 'truck', key: 'renault', name: 'Renault Trucks',
          aliases: ['Рено'], source_key: 'curated-1' },
        { category: 'passenger', key: 'lada', name: 'LADA', aliases: [], source_key: 'curated-1' }];
      return [];
    },
  };
  const svc = new VehicleReferenceService(db);
  const brands = await svc.brands(driver, 'driver', { q: 'рено' });
  assert.equal(brands.length, 1);
  assert.equal(brands[0].key, 'renault');
  assert.ok(calls[0].sql.includes("redistribution_approved=true"));
  assert.ok(calls[0].params[0].includes('truck'));
  await assert.rejects(svc.brands(driver, 'admin'), /Выбранная роль/);
  await svc.brands(master, 'master');
  assert.deepEqual(calls.at(-1)?.params[0], ['passenger', 'van']);
});


test('isolated PostgreSQL: license gate, staged revisions, rollback and revocation', async () => {
  // TEST_DATABASE_URL is disposable; setup() drops only the isolated test schema.
  const { setup } = await import('./helpers.ts');
  const state = await setup();
  try {
    const actor = await state.db.one<any>(
      "insert into users(phone,roles,status,name) values ('+79990001021',ARRAY['admin']::text[],'active','Catalog admin') returning *");
    const customer = await state.db.one<any>(
      "insert into users(phone,roles,status,name) values ('+79990001022',ARRAY['client']::text[],'active','Catalog client') returning *");
    const service = new VehicleReferenceService(state.db);
    const source = {
      key: 'internal-test-2026', name: 'Internal sample, fictional entries',
      originUrl: 'https://example.org/fictional-truck-list',
      licenseName: 'Internal-only test rights',
      licenseUrl: 'https://example.org/permissions',
      rightsEvidence: 'This snapshot contains a short internal fictional test fixture without third-party imports.',
    };
    assert.equal((await service.registerSource(actor, source)).state, 'pending');
    await assert.rejects(service.stageSnapshot(actor, source.key, sample), /Источник не допущен/);
    assert.equal((await service.approveSource(actor, source.key,
      'Rights evaluated by isolated sandbox administrator only; no production use.'))?.state, 'approved');

    const staged = await service.stageSnapshot(actor, source.key, sample);
    assert.equal(staged.state, 'staged');
    assert.equal(staged.brandCount, 3);
    assert.equal(staged.modelCount, 4);
    assert.equal((await service.stageSnapshot(actor, source.key, sample)).id, staged.id);
    const count = await state.db.one<{ count: number }>(
      'select count(*)::int as count from vehicle_ref_models where snapshot_id=$1', [staged.id]);
    assert.equal(count?.count, 4);
    assert.deepEqual(await service.brands(customer, 'client'), [],
      'staged-only data is never exposed to customer');

    await service.activateSnapshot(actor, source.key, sample.sourceRevision,
      'Manual reviewer approved the versioned test sample for sandbox listing');
    const activeBrands = await service.brands(customer, 'client', { q: 'рено' });
    assert.equal(activeBrands.length, 1);
    assert.equal(activeBrands[0].key, 'renault');
    const activeModels = await service.models(customer, 'client', 'truck', 'renault', { year: 2010 });
    assert.equal(activeModels.length, 1);
    assert.equal(activeModels[0].key, 'premium');
    const selected = await service.validateSelection(customer, 'client',
      { category: 'truck', brandKey: 'renault', modelKey: 'premium', year: 2010 });
    assert.equal(selected.vinDecoded, false);
    assert.equal(selected.partsFitmentVerified, false);
    await assert.rejects(service.validateSelection(customer, 'client',
      { category: 'truck', brandKey: 'renault', modelKey: 'premium', year: 2025 }),
    /catalog_model_unknown_or_wrong_brand/);

    // A later release retires the first snapshot, but leaves it auditable.
    const v2 = { ...sample, sourceRevision: 'sample-2026-12' };
    const next = await service.stageSnapshot(actor, source.key, v2);
    await service.activateSnapshot(actor, source.key, v2.sourceRevision,
      'The second sandbox revision passed documented review');
    const previous = await state.db.one<{ state: string }>(
      'select state from vehicle_ref_snapshots where id=$1', [staged.id]);
    assert.equal(previous?.state, 'retired');
    assert.equal(next.state, 'staged');
    const restored = await service.activateSnapshot(actor, source.key, sample.sourceRevision,
      'Restore previous catalog snapshot after dry-run acceptance');
    assert.equal(restored.unchanged, false);
    const activeCount = await state.db.one<{ count: number }>(
      "select count(*)::int as count from vehicle_ref_snapshots where source_key=$1 and state='active'",
      [source.key]);
    assert.equal(activeCount?.count, 1);
    const entries = await state.db.query<any>(
      'select event_kind from vehicle_ref_registry_events where source_key=$1 order by id',
      [source.key]);
    assert.ok(entries.some((e) => e.event_kind === 'revision_restored'));

    await service.revokeSource(actor, source.key, 'Legal rights revoked: hide catalogue immediately');
    assert.deepEqual(await service.brands(customer, 'client'), []);
    await assert.rejects(service.activateSnapshot(actor, source.key, sample.sourceRevision,
      'Incorrect manual re-approval is forbidden'), /Источник не допущен/);
    await assert.rejects(state.db.query(
      "delete from vehicle_ref_models where snapshot_id=$1", [staged.id]), /immutable/);
    await assert.rejects(service.registerSource(customer, source), /только администратор/);
  } finally {
    await state.close();
  }
});
