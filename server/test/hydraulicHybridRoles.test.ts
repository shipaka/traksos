import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { requestedRoles, validateRoles } from '../src/domain/roles.ts';
import { NEEDS, WORKS } from '../src/services/service.ts';

test('the hydraulic station service is first-class, not the Other fallback', () => {
  assert.equal(NEEDS.hydraulics, 'Гидравлика');
  assert(WORKS.includes('Гидравлика'));
});
test('one approved partner holds separate mobile-master and station roles', () => {
  assert.deepEqual(requestedRoles('master_service'), ['master','service']);
  assert.deepEqual(validateRoles([], requestedRoles('master_service')).sort(), ['master','service']);
  assert.throws(() => validateRoles(['client'], ['master','service']), /.*(?=.)/);
  assert.throws(() => validateRoles(['insurer'], ['master','service']), /.*(?=.)/);
});
const repoRoot = new URL('../../', import.meta.url);

test('matching, onboarding and forms know hydraulic as a separate specialization', async () => {
  const [app, orders, publicRoles, master, station, auth] = await Promise.all([
    'server/src/app.ts','server/src/services/orders.ts','web/src/guestCatalog.ts',
    'web/src/screens/performerCabinet.tsx','web/src/screens/base.tsx','web/src/screens/login.tsx'
  ].map(path => readFile(new URL(path,repoRoot),'utf8')));
  assert(app.includes("'tyre', 'hydraulics', 'consult'"));
  assert(orders.includes("'hydraulics', 'tow'"));
  assert(publicRoles.includes("id:'hydraulics'"));
  assert(master.includes("id: 'hydraulics'"));
  assert(station.includes("hydraulics: 'Гидравлика'"));
  assert(auth.includes("partnerAccountType"));
  assert(auth.includes("hybridMasterService"));
  assert.equal((auth.match(/guest-partner-role-' \+ r.id/g)||[]).length,1,
    'hybrid is a checkbox, not an unauthorized fifth partner role tile');
});
