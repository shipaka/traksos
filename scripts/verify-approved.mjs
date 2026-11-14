// Nightly and push-time gate: approved TrackSOS identity is not replaced silently.
// This only verifies invariants; visual fidelity is additionally checked via screenshots.
import { readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const read = (path) => readFile(path, 'utf8');
const failures = [];
function expect(ok, description) {
  if (ok) console.log('OK: ' + description);
  else { console.error('FAIL: ' + description); failures.push(description); }
}
const LOCKED_ASSETS = {
  // Exact approved images. Deliberate asset changes require a new owner-approved baseline.
  'web/public/tracksos-approved-truck.webp': 'a6013f354586e669',
  // Exact crop of the original approved Scania R520 reference (no UI baked in).
  'web/public/tracksos-approved-scania-r520.webp': 'f72c2075c44e46a7',
  'web/public/tracksos-approved-map.webp': '994097c8c01b2c80',
  'android/app/src/main/res/drawable-nodpi/splash_truck.webp': '5217954dcb773ecf',
};
async function asset(path, minBytes = 5000) {
  try {
    const a = await stat(path);
    expect(a.size >= minBytes, path + ' exists (' + a.size + ' bytes)');
    if (a.size < minBytes) return;
    const md5 = createHash('sha256').update(await readFile(path)).digest('hex').slice(0, 16);
    console.log('  Asset SHA256 prefix: ' + md5);
    if (LOCKED_ASSETS[path]) {
      expect(md5 === LOCKED_ASSETS[path], 'approved image unchanged: ' + path);
    }
  } catch { expect(false, path + ' is present'); }
}
const landing = await read('web/src/screens/login.tsx');
const css = await read('web/src/styles.css');
const shell = await read('web/src/main.tsx');
const demo = await read('web/src/screens/adminTestCenter.tsx');
expect(shell.includes("const serviceSandbox = isAdmin && a === 'admin' && b === 'test-center' && route[2] === 'service'") &&
  /const fullRole[^=]*= isAdmin && a === 'admin' && b === 'test-center' && PREVIEW_ROLES\.includes/.test(shell) &&
  shell.includes('fullRole ? <FullRolePreviewPage role={fullRole} parts={route.slice(3)} />') &&
  shell.includes('<AdminTestCenter roleId={route[2]} />') &&
  shell.includes('previewRole={fullRole}') &&
  shell.includes('onClickCapture={fullRole ? handlePreviewClick : undefined}'),
  'admin-only full role previews and real service sandbox are routed explicitly');
expect(!demo.includes("from '../api.ts'") && !demo.includes('fetch(') && !demo.includes('XMLHttpRequest'),
  'sandbox performs no real API traffic or requests');
for(const role of ['client','owner','driver','master','tow','service','master_service','insurer','moderator','admin']) {
  expect(demo.includes("id:'"+role+"'"), 'safe demo role exists: '+role);
}
const labels = await read('web/src/dict.ts');
const native = await read('android/app/src/main/java/ru/traksos/app/MainActivity.kt');

await asset('web/public/tracksos-approved-truck.webp', 15000);
await asset('web/public/tracksos-approved-scania-r520.webp', 40000);
await asset('web/public/tracksos-approved-map.webp', 15000);
await asset('android/app/src/main/res/drawable-nodpi/splash_truck.webp', 2000);
expect(css.includes("url('../public/tracksos-approved-scania-r520.webp')"), 'public hero uses approved Scania R520 crop');
expect(landing.includes('src="/tracksos-approved-scania-r520.webp"'), 'app teaser uses same approved Scania R520');
expect(css.includes("url('../public/tracksos-approved-map.webp')"), 'public demo map is a bundled image');
expect(!css.includes("url('../public/truck-scene.svg')"), 'old cartoon truck is not the active hero image');
expect(landing.includes('public-map-static'), 'public map does not depend on network services');
expect(!landing.includes('openstreetmap.org/export/embed'), 'no third-party iframe is required for offline public map');
expect(landing.includes('Демонстрационная карта'), 'demo map is explicitly labelled');
expect(landing.includes('Санкт-Петербург и Ленинградская область'), 'launch region is shown');
expect(shell.includes('guest-header-actions'), 'public header provides sign-in and registration');
expect(landing.includes('Выбор кабинета при регистрации'), 'registration exposes a complete public account chooser');
for(const name of ['Я мастер','Я эвакуаторщик','Я рембаза (сервис)','Мастер и своя СТО','Я представитель страховой компании',
  'Владелец / автопарк','Водитель автопарка']) {
  expect(landing.includes(name), 'approved registration category is available: '+name);
}
expect(landing.includes("roles.includes('moderator') return '#/as/moderator'") ||
       landing.includes("roles.includes('moderator')) return '#/as/moderator'"),
       'moderator enters the restricted cabinet instead of the administrator panel');
expect(!landing.includes('public-bottom-auth'), 'no duplicate sign-in/register controls at page end');
expect(landing.includes('RuStore') && !landing.includes('Google Play'), 'only RuStore is promoted');
expect(native.includes('BundledWeb(this)'), 'APK loads bundled web interface');
expect(labels.includes('Шиномонтаж') && labels.includes('Эвакуатор') && labels.includes('Электрик'), 'truck services remain present');

const publicPart = landing.slice(landing.indexOf('if (!intent) return ('), landing.indexOf('\n  return (\n    <main>', landing.indexOf('if (!intent) return (')));
for (const word of ['Аптека', 'Химчистка', 'Авиабилеты', 'Покупка авиабилетов', 'Магазин лекарств']) {
  expect(!publicPart.includes(word), 'no unrelated public services: ' + word);
}
if (failures.length) {
  console.error('Approved design gate: ' + failures.length + ' failure(s).');
  process.exitCode = 1;
} else console.log('Approved TrackSOS design gate: all invariants passed.');
