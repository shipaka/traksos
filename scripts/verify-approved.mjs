// Nightly and push-time gate: functional and asset integrity tests.
// Current owner-approved public design is 19 Nov: SOS, Air, STO, ECU, Parts, Insurance.
// Never restore the deleted 14 Nov design or the interim 18 Nov nine-card layout.
// Artwork still requires visual inspection; source-level tests cannot prove logo pixels.
// This only verifies invariants; visual fidelity is additionally checked via screenshots.
import { readFile, readdir, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const read = (path) => readFile(path, 'utf8');
const failures = [];
function expect(ok, description) {
  if (ok) console.log('OK: ' + description);
  else { console.error('FAIL: ' + description); failures.push(description); }
}
const LOCKED_ASSETS = {
  'android/app/src/main/res/drawable-xxxhdpi/ic_notify.png': 'b076e31adbe265e3',
  'android/app/src/main/res/drawable-xxhdpi/ic_notify.png': '99977763f15a882c',
  'android/app/src/main/res/drawable-xhdpi/ic_notify.png': '99e8a55cd6eb58ef',
  'android/app/src/main/res/drawable-hdpi/ic_notify.png': '051234c95f35fd2f',
  'android/app/src/main/res/drawable-mdpi/ic_notify.png': 'd8b301cdb07e6d88',
  'branding/tracksos-rustore-icon.png': '2583f9590d32107b',
  'web/public/icon-512.png': '2583f9590d32107b',
  'web/public/icon-192.png': 'fa6451ff36f1fec3',
  // Exact approved images. Deliberate asset changes require a new owner-approved baseline.
  'web/public/tracksos-approved-hero-owner-20261119.webp': '7a7a9acec9ee7f32',
  // Original artwork from owner's 617.png on 20 Nov; keep mobile 19 Nov locked independently.
  'web/public/owner20-artwork-sprite.webp': '401fcedf30e1603b',
  'web/public/owner20-photo-background-approved.webp': '833c162d1fddcef0',
  // Cross-platform owner-selected branding/illustrations. These checks lock bytes,
  // not layout; unchanged native launcher art remains a separate approved asset.
  'web/public/traksos-brand-logo-approved-618.png': '10e9d529a5503140',
  'web/public/traksos-service-scenes-shared.webp': '081ad11beeffb456',
  'android/app/src/main/res/mipmap-mdpi/ic_launcher.png': '327f52a2d6e836e9',
  'android/app/src/main/res/mipmap-hdpi/ic_launcher.png': 'f797b183e93c4bad',
  'android/app/src/main/res/mipmap-xhdpi/ic_launcher.png': '27ea3b5ebbfe86ce',
  'android/app/src/main/res/mipmap-xxhdpi/ic_launcher.png': '3d47c3852548579f',
  'android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png': 'fa6451ff36f1fec3',
  'android/app/src/main/res/drawable-nodpi/splash_truck.webp': '7a7a9acec9ee7f32',
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
// Build gate: a previously approved design must not return through role CSS,
// mobile JSX or an old asset copied into the PWA service-worker cache.
const retiredVisuals = [
  'tracksos-approved-map.webp',
  'tracksos-hero-rescue-hq.webp',
  'tracksos-hero-service-hq.webp',
  'tracksos-photo-consult.webp',
  'tracksos-photo-master.webp',
  'tracksos-photo-sto.webp',
  'tracksos-photo-tow.webp',
  'tracksos-partner-insurer-approved.webp',
  'tracksos-partner-master-approved.webp',
  'tracksos-partner-sto-approved.webp',
  'tracksos-partner-tow-approved.webp',
  'tracksos-road-atmosphere.svg',
  'tracksos-visual-consult.svg',
  'tracksos-visual-guide.svg',
  'tracksos-visual-inspection.svg',
  'tracksos-visual-insurance.svg',
  'tracksos-visual-parts.svg',
  'tracksos-visual-sto.svg',
  'tracksos-visual-tow.svg',
  'tracksos-visual-van.svg',
  'tracksos-approved-scenic-hero.webp', 'tracksos-approved-scania-r520.webp',
  'tracksos-approved-truck.webp', 'traksos-final-hero.webp',
  'traksos-final-insurance.webp', 'traksos-final-parts.webp',
];
async function activeWebFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async entry => {
    const path = dir + '/' + entry.name;
    return entry.isDirectory() ? activeWebFiles(path) : /\.(?:css|ts|tsx|html)$/.test(entry.name) ? [path] : [];
  }));
  return nested.flat();
}
const retiredReferences = [];
const activeFiles = await activeWebFiles('web/src');
expect(activeFiles.length >= 100, 'approved-design guard scans all web/src source files');
for (const file of activeFiles) {
  const source = await read(file);
  for (const name of retiredVisuals) if (source.includes(name)) retiredReferences.push(file + ' → ' + name);
}
expect(retiredReferences.length === 0,
  'no retired 14–18 Nov imagery in active web/Android code' +
  (retiredReferences.length ? ': ' + retiredReferences.join('; ') : ''));


// Hard allowlist: only the owner's 19 Nov branding + original Tech №3 can
// enter the active public image root. Vehicle model photos have their own
// validated generation/brand registry in /vehicles/models; do not delete it.
const allowedPublicVisuals = new Set([
  'icon-192.png','icon-512.png',
  'tracksos-approved-hero-owner-20261119.webp',
  'trakbot-approved-30.webp','trakbot-approved-hello.webp',
  'owner20-artwork-sprite.webp',
  'owner20-photo-background-approved.webp',
  'traksos-brand-logo-approved-618.png',
  'traksos-service-scenes-shared.webp',
]);
const visualRootEntries = await readdir('web/public',{withFileTypes:true});
const unexpectedVisuals = visualRootEntries.filter(entry =>
  entry.isFile() && /\.(?:png|webp|svg|jpg|jpeg|avif|gif)$/i.test(entry.name) &&
  !allowedPublicVisuals.has(entry.name)).map(entry=>entry.name);
expect(unexpectedVisuals.length===0,
  'no obsolete artwork or unapproved new images in live public assets' +
  (unexpectedVisuals.length ? ': '+unexpectedVisuals.join(', ') : ''));
await asset('web/public/owner20-artwork-sprite.webp', 20000);
await asset('web/public/owner20-photo-background-approved.webp', 15000);
// The superseded 617-only raster logo must not be served as an alternative
// wordmark: the owner requested the exact 618 Android logo on all surfaces.
for(const alternateLogo of [
  'owner20-header-logo-approved.webp',
  'tracksos-approved-header-logo-20261119.webp',
  'tracksos-approved-logo-owner-20261119.webp'
]) {
  let present=false;
  try { await stat('web/public/'+alternateLogo); present=true; } catch {}
  expect(!present,'retired competing brand raster absent from active public root: '+alternateLogo);
}
await asset('web/public/traksos-brand-logo-approved-618.png', 16000);
await asset('web/public/traksos-service-scenes-shared.webp', 16000);
const unifiedVisuals = await read('web/src/approvedVisuals.ts');
const unifiedClient = await read('web/src/screens/client.tsx');
const unifiedMobile = await read('web/src/screens/androidWorkspaces.tsx');
const unifiedShell = await read('web/src/main.tsx');
const unifiedBot = await read('web/src/trakbotMascot.css');
const unifiedOrderPhoto = await read('web/src/approvedOrderTruck.tsx');
const unifiedSceneStyle = await read('web/src/approvedEmptyScene.css');
const unifiedServiceSceneStyle = await read('web/src/approvedServiceScene.css');
const ownerPcHeader = await read('web/src/screens/ownerDesktopHome20261120.tsx');
expect(unifiedVisuals.includes("logo: '/traksos-brand-logo-approved-618.png'") &&
  unifiedVisuals.includes("trakbotHello: '/trakbot-approved-hello.webp'") &&
  unifiedVisuals.includes("trakbotReactions: '/trakbot-approved-30.webp'") &&
  unifiedVisuals.includes("serviceScenes: '/traksos-service-scenes-shared.webp'") &&
  unifiedShell.includes('src={APPROVED_VISUALS.logo}') &&
  unifiedClient.includes('ApprovedServiceIllustration') &&
  unifiedMobile.includes('ApprovedServiceIllustration') &&
  unifiedClient.includes('ApprovedEmptyScene') &&
  unifiedMobile.includes('ApprovedEmptyScene') &&
  unifiedBot.includes('trakbot-approved-30.webp') &&
  unifiedBot.includes('trakbot-approved-hello.webp'),
  'Desktop, mobile browser and Android WebView must use same branded art, approved bot and truthful empty scenes');
expect(!unifiedShell.includes('<span className="logo">Trak<b>Sos</b></span>') &&
  !unifiedMobile.includes('src="/tracksos-approved-hero-owner-20261119.webp"'),
  'no alternate text-only header or independently hard-coded Android truck illustration');
expect(unifiedOrderPhoto.includes("vehicleReferencePhoto(brand,model,year)") &&
  unifiedOrderPhoto.includes('is-illustration') &&
  unifiedClient.includes('<ApprovedOrderTruck order={o} />') &&
  unifiedMobile.includes('<ApprovedOrderTruck order={current} />') &&
  unifiedMobile.includes('<ApprovedOrderTruck order={active[0]} />') &&
  unifiedSceneStyle.includes('prefers-reduced-motion:reduce') &&
  ownerPcHeader.includes('src={APPROVED_VISUALS.logo}') &&
  !ownerPcHeader.includes('function TruckLogo()'),
  'one exact-generation truck photo source with honest fallback, reduced motion and identical public/Android brand');
// The approved Android layout must keep its four service slots and original
// 10px label size, while displaying the exact same four atlas crops as PC.
const sharedSceneKeys=['repair','tow','service','consult'];
const sharedScenePositions=['0 0','-176px 0','-352px 0','-528px 0'];
expect(sharedSceneKeys.every((kind,i)=>
  unifiedServiceSceneStyle.includes('.tr-service-illustration--'+kind+'{background-position:'+sharedScenePositions[i]+'}') &&
  unifiedMobile.includes('<ApprovedServiceIllustration kind="'+kind+'" />')) &&
  ['Выездной мастер','Эвакуатор','СТО','Консультация'].every(
    label=>unifiedMobile.includes('className="and19-service-label">'+label+'</span>')
  ) &&
  unifiedServiceSceneStyle.includes('.and19-services>a>.and19-service-label') &&
  unifiedServiceSceneStyle.includes('font-size:inherit;') &&
  unifiedServiceSceneStyle.includes('width:88px;') &&
  unifiedServiceSceneStyle.includes('height:52.5px;') &&
  unifiedServiceSceneStyle.includes('background-size:352px 52.5px;') &&
  !unifiedServiceSceneStyle.includes('transform:scale(.51);') &&
  !unifiedServiceSceneStyle.includes('transform:scale(1.03);') &&
  ['0 0','-88px 0','-176px 0','-264px 0'].every((pos,i)=>
    unifiedServiceSceneStyle.includes('.and19-services>a>.tr-service-illustration--'+sharedSceneKeys[i]+'{background-position:'+pos+'}')
  ),
  'same PC/Android service photos with direct-size mobile raster paint; no extra GPU raster scaling');

for (const file of ['web/src/finalCanon.css','web/src/trackPhotos.css']) {
  let exists = false;
  try { await stat(file); exists = true; } catch {}
  expect(!exists, 'retired photo/layout stylesheet cannot be bundled: '+file);
}

const landing = await read('web/src/screens/login.tsx');
const catalogue = await read('web/src/guestCatalog.ts');
const roleCss = await read('web/src/roleShared20261119.css');
const currentCss = await read('web/src/currentApproved20261119.css');
// Regression guard: removing legacy visual assets must never leave broken CSS references.
expect(!roleCss.includes('traksos-final-insurance.webp') &&
  !roleCss.includes('tracksos-partner-insurer-approved.webp') &&
  roleCss.includes('.guest-app .partner-art-insurer{--partner-art:linear-gradient('),
  'retired insurer background cannot return; partner screen keeps a nonempty branded fallback');

expect(!landing.includes('public-track-extra-art') && !landing.includes('public-track-insurance-art'),
  'all retired photographic ghost slots were physically removed from public service cards');
const approvedPhoto = 'tracksos-approved-hero-owner-20261119.webp';
const approvedHeroLayer = await read('web/src/approvedHeroImage20261119.css');
expect(approvedHeroLayer.includes('object-fit:contain!important') &&
  approvedHeroLayer.includes('.public-app-phone-truck') &&
  !approvedHeroLayer.includes('#f3197c'),
  'Android promo phone cannot crop approved logo into a retro magenta fragment');
const heroVisualE2E = await read('e2e/approved-truck-hero.mjs');
expect(currentCss.includes(approvedPhoto) && approvedHeroLayer.includes(approvedPhoto)
  && !currentCss.includes('tracksos-approved-scenic-hero.webp'),
  'guest home has one approved Nov 19 truck image, with no legacy image fallback');
expect(heroVisualE2E.includes("tracksos-approved-hero-owner-20261119(?:-[A-Za-z0-9]+)")
  && heroVisualE2E.includes("info.photo.includes('tracksos-approved-scenic-hero')"),
  'browser screenshot gate rejects obsolete 14 Nov hero and requires actual owner image');


/* A retired guest stylesheet must never silently redraw the approved 19 Nov
   desktop / mobile-browser page. Signed-in cabinet selectors remain intact. */
for (const path of ['web/src/trackVisual.css', 'web/src/trackPolish.css', 'web/src/trackScenic.css']) {
  const retainedRoleStyles = await read(path);
  expect(!/\\.guest-app\\b|\\.public-[\\w-]+\\b|\\.track-guest-tabbar\\b/.test(retainedRoleStyles),
    'obsolete public layout cannot leak from signed-in cabinet stylesheet: ' + path);
}
const shell = await read('web/src/main.tsx');
const androidCss = await read('web/src/androidApproved20261119.css');
const browserCss = await read('web/src/mobileBrowser.css');
expect(browserCss.includes('@supports (aspect-ratio: 2 / 1)') && browserCss.includes('height: 156px !important') && browserCss.includes('top: auto !important;right: auto !important;bottom: auto !important;left: auto !important'),
  'legacy Android WebView must reserve visible uncropped truck photo and reset absolute offsets');
const androidAcceptance = await read('e2e/android-approved-workspaces.mjs');
expect(androidAcceptance.includes("Object.defineProperty(window,'TrakSOSNative'") &&
  androidAcceptance.includes("['master_service'") &&
  androidAcceptance.includes('for(const width of [320,390])'),
  'Android visual acceptance exercises the native bridge, hybrid workspace and narrow widths');

expect(androidCss.includes('.and19-workspace') && browserCss.includes('html.traksos-compact-guest') && shell.includes("classList.add('traksos-compact-guest')") && shell.includes('guest-app guest-home') && !browserCss.includes(':is(') && !browserCss.includes(':has(') && !currentCss.includes(':has('),
  'Android guest shares the approved narrow-screen public layout; authenticated Android cabinets remain separate');
expect(!currentCss.includes('.and19-workspace') && !currentCss.includes('.app.role-performer'),
  'public 19 Nov CSS does not rewrite signed-in Android or performer workspaces');

const css = await read('web/src/styles.css');
// The retired pre-19-Nov hero may remain in role-only visuals but must never be
// a CSS fallback for the owner-approved public landing. Prevent old art regressing
// into a future deploy even when the final CSS file changes its order.
expect(!/\.public-landing \.public-hero-visual\s*\{[^}]*tracksos-approved-(?:truck|scania-r520)\.webp/.test(css),
  'obsolete truck art cannot reappear as the public home background');
// The following old public images have no live source readers. Reject their
// return to the distributable public directory (they otherwise enter the PWA cache).
for (const name of ['tracksos-approved-map.webp','tracksos-hero-rescue-hq.webp','tracksos-hero-service-hq.webp','tracksos-photo-consult.webp','tracksos-photo-master.webp','tracksos-photo-sto.webp','tracksos-photo-tow.webp','tracksos-partner-insurer-approved.webp','tracksos-partner-master-approved.webp','tracksos-partner-sto-approved.webp','tracksos-partner-tow-approved.webp','tracksos-road-atmosphere.svg','tracksos-visual-consult.svg','tracksos-visual-guide.svg','tracksos-visual-inspection.svg','tracksos-visual-insurance.svg','tracksos-visual-parts.svg','tracksos-visual-sto.svg','tracksos-visual-tow.svg','tracksos-visual-van.svg', 'tracksos-approved-scenic-hero.webp','tracksos-approved-scania-r520.webp',
  'tracksos-approved-truck.webp','traksos-final-hero.webp',
                    'traksos-final-insurance.webp','traksos-final-parts.webp']) {
  let exists = false;
  try { await stat('web/public/' + name); exists = true; } catch { /* expected */ }
  expect(!exists, 'retired public asset absent: ' + name);
}
const nativeSplash = await read('android/app/src/main/java/ru/traksos/app/SeasonalStartupOverlay.kt');
expect(nativeSplash.includes('R.drawable.splash_truck') && !nativeSplash.includes('seasonal_splash/') &&
  !nativeSplash.includes('Сезонный фон') && !nativeSplash.includes('TrakSOSNative-weather'),
  'Android startup uses only 19 Nov approved image, without old seasonal backgrounds or caption');
for (const name of ['autumn.webp','spring.webp','summer.webp','winter.webp']) {
  let present = false;
  try { await stat('android/app/src/main/assets/seasonal_splash/'+name); present = true; } catch {}
  expect(!present, 'retired pre-17 Nov Android scene is absent: '+name);
}
expect(landing.includes('/icon-192.png') &&
       shell.includes('src={APPROVED_VISUALS.logo}') &&
       !shell.includes('tracksos-approved-logo-owner-20261119.webp'),
       'mobile promo preserves approved launcher icon and shares 618 brand with Android and desktop');
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

await asset('web/public/tracksos-approved-hero-owner-20261119.webp', 50000);
await asset('android/app/src/main/res/drawable-nodpi/splash_truck.webp', 2000);
await asset('android/app/src/main/res/mipmap-mdpi/ic_launcher.png', 1200);
await asset('android/app/src/main/res/mipmap-hdpi/ic_launcher.png', 1800);
await asset('android/app/src/main/res/mipmap-xhdpi/ic_launcher.png', 2500);
await asset('android/app/src/main/res/mipmap-xxhdpi/ic_launcher.png', 3500);
await asset('android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png', 5000);
await asset('web/public/icon-192.png', 5000);
await asset('web/public/icon-512.png', 25000);
await asset('branding/tracksos-rustore-icon.png', 25000);
// These PNG resources have been rebuilt directly from the owner's 19 Nov PNG:
// truck silhouette / wordmark. Pre-17 Nov launcher and notification bytes fail.
for (const icon of ["android/app/src/main/res/drawable-mdpi/ic_notify.png","android/app/src/main/res/drawable-hdpi/ic_notify.png","android/app/src/main/res/drawable-xhdpi/ic_notify.png","android/app/src/main/res/drawable-xxhdpi/ic_notify.png","android/app/src/main/res/drawable-xxxhdpi/ic_notify.png"]) {
  await asset(icon, 400);
}

expect(createHash('sha256').update(await readFile('web/public/icon-512.png')).digest('hex') ===
       createHash('sha256').update(await readFile('branding/tracksos-rustore-icon.png')).digest('hex'),
  'RuStore and PWA 512 use the same owner-approved cinematic icon');
expect((await read('web/index.html')).includes('icon-192.png') &&
       (await read('web/public/manifest.webmanifest')).includes('icon-512.png'),
  'browser favicon and PWA manifest use approved raster artwork');
expect(!css.includes('tracksos-approved-map.webp') && css.includes('public-map-static'), 'pre-17 Nov map bitmap is excluded from active website');
expect(!css.includes("url('../public/truck-scene.svg')"), 'old cartoon truck is not the active hero image');
expect(landing.includes('public-map-static'), 'public map does not depend on network services');
expect(!landing.includes('openstreetmap.org/export/embed'), 'no third-party iframe is required for offline public map');
expect(landing.includes('Пример расположения услуг.'), 'demo map explicitly labels fictional service markers');
expect(landing.includes('yandex.ru/maps/'), 'guest static map opens real Yandex Maps on click');
expect(landing.includes('Санкт-Петербург и Ленинградская область'), 'launch region is shown');
expect(shell.includes("import './roleShared20261119.css';") && !shell.includes("import './finalCanon.css';"), 'the obsolete 14 Nov public CSS was physically removed');
expect(!roleCss.includes('.public-landing'), 'old guest-home selectors absent from retained role styles');
expect(shell.includes('guest-site-nav'), 'the guest PC has horizontal navigation, not an alternative sidebar');
expect(!currentCss.includes('tracksos-hero-rescue-hq') && !currentCss.includes('tracksos-hero-service-hq') && currentCss.includes(approvedPhoto),
  'every hero slide excludes pre-17 Nov cinematics and uses the owner-approved 19 Nov source');
expect(!/tracksos-photo-|tracksos-partner-(?:tow|master|sto|insurer)-approved/.test(roleCss),
  'partner UX never loads 14–15 Nov photography');
expect(landing.includes("const [role, setRole] = useState<JoinRole | null>(null)"),
  'partner role is chosen explicitly before viewing role-specific examples');
const finalServices = [
  "{ id:'sos', icon:'⚠', title:'SOS'",
  "{ id:'air', icon:'◉', title:'Эфир'",
  "{ id:'sto', icon:'⚒', title:'СТО'",
  "{ id:'ecu', icon:'▣', title:'ЭБУ'",
  "{ id:'parts', icon:'⚙', title:'Запчасти'",
  "{ id:'insurance', icon:'◇', title:'Страхование'",
];
let previous = -1;
for (const item of finalServices) {
  const index = catalogue.indexOf(item);
  expect(index > previous, 'approved 19 Nov public tiles are present and ordered: ' + item);
  previous = index;
}
expect(landing.includes('PUBLIC_HOME_TILES.map') && landing.includes('href={href}'),
  'approved home links use real routes for all six public tiles');
expect(shell.includes("route[0] === 'explore'") && shell.includes("route[0] === 'company'") && shell.includes("route[0] === 'offers'"),
  'public catalogue, Company and Offers have real routes');
expect(shell.includes('guest-mobile-catalog') && shell.includes('guest-nav-group'),
  'guest catalogue links work on mobile and desktop');
// The first hero slide uses a dynamic label; verify the actual actions,
// not the superseded static text markup.
expect(landing.includes("heroSlide === 0 ? go('register')") &&
  landing.includes("heroSlide === 0 ? 'Зарегистрироваться'") &&
  landing.includes('href="#/explore/guide">Как это работает</a>'),
  'approved 19 Nov hero opens registration and explains the platform');
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
const approvedMasterWindow = await read('web/src/screens/performerOrderWindow.tsx');
const liveOrderUi = await read('web/src/screens/order.tsx');
expect(shell.includes("effMode === 'performer' && isPerformer && b") &&
  shell.includes("<PerformerOrderWindow id={b} initialTab=") &&
  approvedMasterWindow.includes('<Work background/>') &&
  approvedMasterWindow.includes('<Order id={id} initialTab={initialTab}/>') &&
  approvedMasterWindow.includes('role="dialog"') &&
  approvedMasterWindow.includes("go('work')"),
  'approved 18 Nov performer popup shows live dashboard and real order with close/ESC, not fake cards');
expect(['Работа','Клиент и ТС','Расчёт','Чат','История'].every(label=>liveOrderUi.includes(label)) &&
  liveOrderUi.includes("ptab === 'finance' ? <Money d={d} />") &&
  liveOrderUi.includes("ptab === 'chat' ? <Chat id={id} status={d.status} />"),
  'approved performer order separates live work/vehicle/finance/chat/history in real tabs');

console.log('VISUAL APPROVAL PENDING: exact 19 Nov source PNG vs real Chromium on the final commit.');

const vehicleVisual=await read('web/src/vehicleVisual.tsx');
const performerUi=await read('web/src/screens/performer.tsx');
const garageUi=await read('web/src/screens/client.tsx');
const fleetUi=await read('web/src/screens/fleet.tsx');
const photoCatalog=await read('web/src/vehiclePhotoCatalog.ts');
const photoSourceManifest=JSON.parse(await read('scripts/vehiclePhotoSources.json'));
expect(photoSourceManifest.items.length===6 &&
  photoSourceManifest.items.every(x=>photoCatalog.includes(x.id+'.webp')) &&
  vehicleVisual.includes('vehiclePhotoCatalog.ts') &&
  vehicleVisual.includes('Точное фото модели пока не добавлено') &&
  !vehicleVisual.includes('tracksos-hero-service-hq.webp') &&
  !vehicleVisual.includes('tracksos-photo-master.webp') &&
  fleetUi.includes('<VehicleModelPhoto brand={c.brand} model={c.model} year={c.year}/>') &&
  photoCatalog.includes('yearRequired:true'),
  '19 Nov photo gate: six locally optimized model+generation WebPs; no unrelated fallback, wrong year or manufacturer');
expect(performerUi.includes('<VehiclePhotoLink compact') &&
  performerUi.includes('/vehicle') &&
  shell.includes("'garage': screen = isCustomer ? <Garage focusVehicleId={b} />"),
  'approved mobile truck tap opens assigned work-order history and owner garage deep link');
expect(liveOrderUi.includes("ptab === 'vehicle'") &&
  liveOrderUi.includes('historyOnly={ptab ===') &&
  liveOrderUi.includes('История обслуживания · без сумм') &&
  garageUi.includes('initialOpen={focusVehicleId===v.id}') &&
  fleetUi.includes('href={`#/garage/${c.id}`}'),
  'vehicle history views are real, role-scoped and reachable from photo in master, garage and fleet');

if (failures.length) {
  console.error('Approved design gate: '+failures.length+' failure(s).');
  process.exitCode=1;
} else console.log('Approved TrakSos design gate: all code invariants passed.');
