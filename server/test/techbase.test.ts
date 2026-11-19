import test from 'node:test';
import assert from 'node:assert/strict';
import { TECHBASE_CATALOG, techBaseAudience, techBaseForRoles } from '../src/domain/techbase.ts';

test('specialist links do not leak to driver or unrelated authenticated roles', () => {
  assert.deepEqual(techBaseAudience(['client']), ['driver']);
  assert.deepEqual(techBaseAudience(['driver']), ['driver']);
  assert.deepEqual(techBaseAudience(['master']), ['driver','master']);
  assert.deepEqual(techBaseAudience(['service']), ['driver','master']);
  assert.deepEqual(techBaseAudience(['insurer']), []);
  assert.ok(techBaseForRoles(['client']).every(x=>x.audience==='driver'));
  assert.deepEqual(techBaseForRoles(['client'],'master'), []);
  assert.deepEqual(techBaseForRoles(['insurer']), []);
  assert.ok(techBaseForRoles(['master'],'master').some(x=>x.id==='bpw-tsb'));
});

test('all catalogue records have provenance and explicit applicability warnings', () => {
  assert.ok(TECHBASE_CATALOG.length >= 15);
  const ids = new Set<string>();
  for (const item of TECHBASE_CATALOG) {
    assert.ok(!ids.has(item.id), item.id);
    ids.add(item.id);
    assert.equal(new URL(item.url).protocol, 'https:');
    assert.ok(item.source && item.reviewedOn && item.warning && item.applicability);
    assert.ok(['driver','master'].includes(item.audience));
    assert.ok(['truck','trailer','component'].includes(item.kind));
    // An electrical/pneumatic component document is never implicitly matched
    // to all trucks of a brand without checking its installed part number.
    if (item.kind === 'component') assert.equal(item.vehicleMake, null);
  }
});

test('catalogue is links-only, without storing PDF content or VINs', () => {
  assert.ok(TECHBASE_CATALOG.every(d => !Object.hasOwn(d,'fileContent') && !Object.hasOwn(d,'vin')));
});
