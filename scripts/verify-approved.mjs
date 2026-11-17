// Nightly and push-time gate: approved TrakSOS identity is not replaced silently.
// This only verifies invariants; visual fidelity is additionally checked via screenshots.
import { readFile, stat, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const read = (path) => readFile(path, 'utf8');
const failures = [];
function expect(ok, description) {
  if (ok) console.log('OK: ' + description);
  else { console.error('FAIL: ' + description); failures.push(description); }
}
const LOCKED_ASSETS = {
  // Exact approved images. Deliberate asset changes require a new owner-approved baseline.
  'web/public/tracksos-approved-truck.webp': '9193ebd1312c2d2e',
  // New 14 November branded high-resolution portrait with correct Scania grille and TrakSOS trailer.
  'web/public/tracksos-approved-scania-r520.webp': '8f5161004a18746f',
  'web/public/tracksos-approved-map.webp': '994097c8c01b2c80',
  // The ONLY final desktop design uses the truck crop and service visuals from owner's last PNG.
  'web/public/traksos-final-hero.webp': 'bfce4ea62b859d80',
  'web/public/traksos-final-insurance.webp': '6cbcba4d541f4ddc',
  'web/public/traksos-final-parts.webp': '0531cbfd715179c3',
  'android/app/src/main/res/mipmap-mdpi/ic_launcher.png': '8325d8040b7a14f1',
  'android/app/src/main/res/mipmap-hdpi/ic_launcher.png': '934c4448c5a758fd',
  'android/app/src/main/res/mipmap-xhdpi/ic_launcher.png': '5022fec38cc1898d',
  'android/app/src/main/res/mipmap-xxhdpi/ic_launcher.png': '22456b8817e2a561',
  'android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png': '70c666ed8cb09e6c',
  'web/public/tracksos-photo-master.webp': 'ba0572aa5c6341ef',
  'web/public/tracksos-photo-tow.webp': '1fdb913351585040',
  'web/public/tracksos-photo-sto.webp': '48e638e981108763',
  'web/public/tracksos-photo-consult.webp': 'c59634316748dde8',
  'web/public/tracksos-hero-rescue-hq.webp': '763702ee90df9466',
  'web/public/tracksos-hero-service-hq.webp': '494a472962520285',
  'web/public/tracksos-partner-tow-approved.webp': '05fe81a6c55c5621',
  'web/public/tracksos-partner-master-approved.webp': 'a6af5a54938a79b7',
  'web/public/tracksos-partner-sto-approved.webp': '2f2830a773e5c50c',
  'web/public/tracksos-partner-insurer-approved.webp': '875b2a3031882b8f',
  'web/public/tracksos-approved-scenic-hero.webp': '9193ebd1312c2d2e',
  'android/app/src/main/res/drawable-nodpi/splash_truck.webp': '75bfacfcdf8c0673',
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
// Android 10 devices can run a WebView without crypto.randomUUID(), although
// crypto.getRandomValues() is present. Check the whole shipped React source,
// not only the order form: message send/nonces in clubs and Driver Air must work.
async function checkOldWebViewUuid(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = dir + '/' + entry.name;
    if (entry.isDirectory()) { await checkOldWebViewUuid(path); continue; }
    if (!/\.[jt]sx?$/.test(entry.name)) continue;
    const lines = (await read(path)).split('\n');
    for (const [index,line] of lines.entries()) {
      const trimmed = line.trim();
      if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue;
      if (/crypto\.randomUUID\s*\(/.test(line)) {
        expect(false, 'old Android WebView unsupported crypto.randomUUID: ' + path +
          ':' + (index+1));
      }
    }
  }
}
await checkOldWebViewUuid('web/src');
const landing = await read('web/src/screens/login.tsx');
const catalogue = await read('web/src/guestCatalog.ts');
const finalCss = await read('web/src/finalCanon.css');
const css = await read('web/src/styles.css');
const shell = await read('web/src/main.tsx');
const demo = await read('web/src/screens/adminTestCenter.tsx');
const serviceDemo = await read('web/src/demo/servicePreviewApi.ts');
expect(!/\bstructuredClone\s*\(/.test(serviceDemo),
  'Android 10 WebView starts without unavailable structuredClone in admin demo module');
expect(shell.includes("const serviceSandbox = isAdmin && a === 'admin' && b === 'test-center' && route[2] === 'service' && route.length > 3") &&
  shell.includes("b === 'test-center' ? (serviceSandbox ? <ServicePreviewPage section={route[3]} sub={route[4]} id={route[5]} /> : <AdminTestCenter roleId={route[2]} fullFidelity />)"),
  'admin-only test center launches full-fidelity real cabinet, with explicit legacy service fallback');
expect(demo.includes("'/api/admin/sandbox/status'") &&
  demo.includes("'/api/admin/sandbox/ticket'") &&
  demo.includes('FullFidelityRoleLauncher') &&
  !demo.includes('XMLHttpRequest'),
  'isolated role handoff only uses admin-only sandbox authorization endpoints');
const oldTraining = await Promise.all([
  'customerTrainingCabinet.tsx','fleetTrainingCabinet.tsx','performerTrainingCabinet.tsx',
].map(name=>read('web/src/screens/'+name)));
expect(oldTraining.every(src=>!src.includes("from '../api.ts'") && !src.includes('fetch(') &&
  !src.includes('XMLHttpRequest')),
  'old legacy training screens remain local-only, with no live production API calls');
for(const role of ['client','owner','driver','master','tow','service','master_service','insurer','moderator','admin']) {
  expect(demo.includes("id:'"+role+"'"), 'safe demo role exists: '+role);
}
const labels = await read('web/src/dict.ts');
const native = await read('android/app/src/main/java/ru/traksos/app/MainActivity.kt');

await asset('web/public/tracksos-approved-truck.webp', 15000);
await asset('web/public/tracksos-approved-scania-r520.webp', 40000);
await asset('web/public/tracksos-approved-map.webp', 15000);
await asset('web/public/traksos-final-hero.webp', 100000);
await asset('web/public/traksos-final-insurance.webp', 25000);
await asset('web/public/traksos-final-parts.webp', 25000);
await asset('web/public/tracksos-photo-master.webp', 30000);
await asset('web/public/tracksos-photo-tow.webp', 30000);
await asset('web/public/tracksos-photo-sto.webp', 30000);
await asset('web/public/tracksos-photo-consult.webp', 30000);
await asset('web/public/tracksos-approved-scenic-hero.webp', 50000);
await asset('web/public/tracksos-hero-rescue-hq.webp', 300000);
await asset('web/public/tracksos-hero-service-hq.webp', 300000);
await asset('web/public/tracksos-partner-tow-approved.webp', 200000);
await asset('web/public/tracksos-partner-master-approved.webp', 200000);
await asset('web/public/tracksos-partner-sto-approved.webp', 200000);
await asset('web/public/tracksos-partner-insurer-approved.webp', 200000);
await asset('android/app/src/main/res/drawable-nodpi/splash_truck.webp', 2000);
await asset('android/app/src/main/res/mipmap-mdpi/ic_launcher.png', 1200);
await asset('android/app/src/main/res/mipmap-hdpi/ic_launcher.png', 1800);
await asset('android/app/src/main/res/mipmap-xhdpi/ic_launcher.png', 2500);
await asset('android/app/src/main/res/mipmap-xxhdpi/ic_launcher.png', 3500);
await asset('android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png', 5000);
await asset('web/public/icon-192.png', 5000);
await asset('web/public/icon-512.png', 25000);
await asset('branding/tracksos-rustore-icon.png', 25000);
expect(createHash('sha256').update(await readFile('web/public/icon-512.png')).digest('hex') ===
       createHash('sha256').update(await readFile('branding/tracksos-rustore-icon.png')).digest('hex'),
  'RuStore and PWA 512 use the same owner-approved cinematic icon');
expect((await read('web/index.html')).includes('icon-192.png') &&
       (await read('web/public/manifest.webmanifest')).includes('icon-512.png'),
  'browser favicon and PWA manifest use approved raster artwork');
expect(css.includes("url('../public/tracksos-approved-scania-r520.webp')"), 'public hero uses approved Scania R520 crop');
expect(landing.includes('src="/tracksos-approved-scania-r520.webp"'), 'app teaser uses same approved Scania R520');
expect(css.includes("url('../public/tracksos-approved-map.webp')"), 'public demo map is a bundled image');
expect(!css.includes("url('../public/truck-scene.svg')"), 'old cartoon truck is not the active hero image');
expect(landing.includes('public-map-static'), 'public map does not depend on network services');
expect(!landing.includes('openstreetmap.org/export/embed'), 'no third-party iframe is required for offline public map');
expect(landing.includes('Пример расположения услуг.'), 'demo map explicitly labels fictional service markers');
expect(landing.includes('yandex.ru/maps/'), 'guest static map opens real Yandex Maps on click');
// Federal product positioning supersedes the original local launch copy.
expect(landing.includes('Единая платформа для России'), 'federal brand positioning is visible');
expect(landing.includes('Реальная доступность выездных специалистов'), 'local availability is stated honestly');
expect(!landing.includes('Санкт-Петербург и Ленинградская область'), 'obsolete local marketing copy was removed');
expect(shell.includes("import './finalCanon.css';"), 'the only final design layer is loaded by the real app');
expect(shell.includes('guest-site-nav'), 'the guest PC has horizontal navigation, not an alternative sidebar');
expect(finalCss.includes('public-hero-slide-approved') && finalCss.includes("url('../public/tracksos-approved-scenic-hero.webp')"), 'the final guest hero uses the approved full Scania photo without baked controls');
expect(finalCss.includes("url('../public/tracksos-hero-rescue-hq.webp')") &&
  finalCss.includes("url('../public/tracksos-hero-service-hq.webp')"),
  'second and third homepage slides use separate high-resolution cinematic assets');
for (const suffix of ['tow','master','sto','insurer']) {
  expect(finalCss.includes("tracksos-partner-" + suffix + "-approved.webp"),
    'selected partner illustration for '+suffix+' remains local to TrakSOS');
}
expect(landing.includes("const [role, setRole] = useState<JoinRole | null>(null)"),
  'partner role is chosen explicitly so opening illustration starts on Scania');
expect(finalCss.includes('grid-template-columns:repeat(6,minmax(0,1fr))'), 'six photographic service cards in desktop row');
const finalServices = [
  "{ id: 'tow', icon: '↗', title: 'Эвакуация'",
  "{ id: 'van', icon: '⚒', title: 'Выездной мастер'",
  "{ id: 'sto', icon: '▤', title: 'СТО и сервисы'",
  "{ id: 'insurance', icon: '◇', title: 'Страхование'",
  "{ id: 'parts', icon: '⚙', title: 'Запчасти'",
  "{ id: 'consult', icon: '☏', title: 'Консультации'",
];
let previous = -1;
for (const item of finalServices) {
  const index = catalogue.indexOf(item);
  expect(index > previous, 'approved 6 services are present and ordered: ' + item);
  previous = index;
}
expect(landing.includes('SERVICE_TILES.map') && landing.includes('Далее'),
  'six photographic services link to public previews with Далее action');
expect(shell.includes("route[0] === 'explore'") && shell.includes("route[0] === 'company'") && shell.includes("route[0] === 'offers'"),
  'public catalogue, Company and Offers have real routes');
expect(shell.includes('guest-mobile-catalog') && shell.includes('guest-nav-group'),
  'guest catalogue links work on mobile and desktop');
expect(landing.includes('>Войти</button>') && landing.includes('>Регистрация</button>'),
  'approved hero calls to action open login and client registration');
try { await stat('web/public/approved-desktop.html'); expect(false, 'superseded static demo was deleted'); }
catch { console.log('OK: superseded static HTML mockup not present'); }

expect(shell.includes('guest-header-actions'), 'public header provides sign-in and registration');
expect(landing.includes('Выбор кабинета при регистрации'), 'client registration has a separate account-type choice');
for(const name of ['Владелец / автопарк','Водитель автопарка']) {
  expect(landing.includes(name), 'client type selectable: '+name);
}
for(const name of ["id: 'master', name: 'Мастер'", "id: 'tow', name: 'Эвакуаторщик'",
  "id: 'service', name: 'СТО'", "id: 'insurer', name: 'Страховой агент'"]) {
  expect(landing.includes(name), 'exactly 4 partner entry types are available: '+name);
}
expect(!landing.includes("id: 'master_service'"), 'hybrid role is not a fifth public partner registration choice');
expect(landing.includes('MASTER_SPECIALTIES.map'), 'master chooses specialties during registration');
expect(!landing.includes('Помогите — нужна помощь'), 'legacy help button removed from login');
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
} else console.log('Approved TrakSOS design gate: all invariants passed.');
