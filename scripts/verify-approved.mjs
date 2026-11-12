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
async function asset(path, minBytes = 5000) {
  try {
    const a = await stat(path);
    expect(a.size >= minBytes, path + ' exists (' + a.size + ' bytes)');
    if (a.size < minBytes) return;
    const md5 = createHash('sha256').update(await readFile(path)).digest('hex').slice(0, 16);
    console.log('  Asset SHA256 prefix: ' + md5);
  } catch { expect(false, path + ' is present'); }
}
const landing = await read('web/src/screens/login.tsx');
const css = await read('web/src/styles.css');
const shell = await read('web/src/main.tsx');
const labels = await read('web/src/dict.ts');
const native = await read('android/app/src/main/java/ru/traksos/app/MainActivity.kt');

await asset('web/public/tracksos-approved-truck.webp', 15000);
await asset('web/public/tracksos-approved-map.webp', 15000);
await asset('android/app/src/main/res/drawable-nodpi/splash_truck.webp', 2000);
expect(css.includes("url('/tracksos-approved-truck.webp')"), 'public hero uses approved real truck asset');
expect(css.includes("url('/tracksos-approved-map.webp')"), 'public demo map is a bundled image');
expect(!css.includes("url('../public/truck-scene.svg')"), 'old cartoon truck is not the active hero image');
expect(landing.includes('public-map-static'), 'public map does not depend on network services');
expect(!landing.includes('openstreetmap.org/export/embed'), 'no third-party iframe is required for offline public map');
expect(landing.includes('Демонстрационная карта'), 'demo map is explicitly labelled');
expect(landing.includes('Санкт-Петербург и Ленинградская область'), 'launch region is shown');
expect(shell.includes('guest-header-actions'), 'public header provides sign-in and registration');
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
