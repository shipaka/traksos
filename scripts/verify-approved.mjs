// Nightly and push-time gate: functional and asset integrity tests.
// Approved PC design: owner's 617.png from 20 Nov; Android and mobile remain separate.
// Never restore retired 14–19 Nov PC visuals or overwrite the approved mobile variant.
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
  // Byte-exact source image explicitly approved 20 Nov, no recoloring or redraw.
  'branding/approved-launcher-master-2026-11-20.png': '9ea519c3d4cc9b24',
  'branding/tracksos-rustore-icon.png': 'c43899c1c510ac6d',
  'web/public/icon-512.png': 'c43899c1c510ac6d',
  'web/public/icon-192.png': 'f48bc0073cf5ec1c',
  // Exact approved images. Deliberate asset changes require a new owner-approved baseline.
  'web/public/tracksos-approved-hero-owner-20261119.webp': '7a7a9acec9ee7f32',
  // Original artwork from owner's 617.png on 20 Nov; keep mobile 19 Nov locked independently.
  'web/public/owner20-artwork-sprite.webp': '401fcedf30e1603b',
  'web/public/owner20-photo-background-approved.webp': '833c162d1fddcef0',
  // Cross-platform owner-selected branding/illustrations. These checks lock bytes,
  // not layout; unchanged native launcher art remains a separate approved asset.
  'web/public/traksos-brand-logo-approved-618.png': '10e9d529a5503140',
  'web/public/traksos-service-scenes-shared.webp': '081ad11beeffb456',
  // Owner-authorized high-resolution equivalents of the same four services, for PC only.
  'web/public/traksos-service-scenes-desktop-hq.webp': '137d36d190895744',
  'android/app/src/main/res/mipmap-mdpi/ic_launcher.png': '2aff2f9c8bb28208',
  'android/app/src/main/res/mipmap-hdpi/ic_launcher.png': 'f46a432d506ce426',
  'android/app/src/main/res/mipmap-xhdpi/ic_launcher.png': 'ed08c9c0041ca46f',
  'android/app/src/main/res/mipmap-xxhdpi/ic_launcher.png': 'ec7089c48d32d46c',
  'android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png': 'f48bc0073cf5ec1c',
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
  'traksos-service-scenes-desktop-hq.webp',
  // Explicitly approved nationwide map for the administrator PC (Russia, not SPb-only).
  'traksos-russia-outline.svg',
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
await asset('web/public/traksos-service-scenes-desktop-hq.webp', 200000);
const unifiedVisuals = await read('web/src/approvedVisuals.ts');
const unifiedClient = await read('web/src/screens/client.tsx');
const unifiedMobile = await read('web/src/screens/androidWorkspaces.tsx');
const unifiedSceneComponent = await read('web/src/approvedServiceIllustration.tsx');
const unifiedShell = await read('web/src/main.tsx');
const unifiedBot = await read('web/src/trakbotMascot.css');
const unifiedOrderPhoto = await read('web/src/approvedOrderTruck.tsx');
const unifiedSceneStyle = await read('web/src/approvedEmptyScene.css');
const unifiedServiceSceneStyle = await read('web/src/approvedServiceScene.css');
const performerEmptySource=await read('web/src/screens/approvedPcCabinets20261120.tsx');
const performerEmptyStyle=await read('web/src/approvedPcCabinets20261120.css');
expect(performerEmptySource.includes('<ApprovedEmptyScene kind="shift"/>') &&
  performerEmptySource.includes('data-orders="0"') &&
  performerEmptySource.includes('!jobs.data?<LoadingBlock error={jobs.error} retry={jobs.reload}/>') &&
  performerEmptyStyle.includes('.approved-pc-performer .approved-pc-shift-empty-body'),
  'performer/tow empty shift preserves API loading, real offer CTA and cinematic illustration without fake work');
const unifiedPerformerEntry=await read('web/src/screens/performer.tsx');
const nativeRoleAcceptance=await read('e2e/android-approved-workspaces.mjs');
expect(unifiedPerformerEntry.includes('if (!p) return <PerformerHub />') &&
  !unifiedPerformerEntry.includes('Заполните профиль') &&
  nativeRoleAcceptance.includes("page.locator('main.performer-onboarding')") &&
  nativeRoleAcceptance.includes("name:'Станьте исполнителем'"),
  'all new performer/tow accounts use one canonical four-step onboarding, never the retired mini-page');
const signedPcBotStyles=await read('web/src/trakbotDock.css');
expect(signedPcBotStyles.includes('Approved signed-in PC inner pages: prominent fixed technician') &&
  signedPcBotStyles.includes('width:84px;min-width:84px;height:84px;min-height:84px;') &&
  signedPcBotStyles.includes('.app:not(.guest-app)> .trakbot-dock'),
  'signed-in PC detail pages keep the approved larger floating technician without an old pill');
const ownerPcUiContract=await read('web/src/screens/ownerDesktopHome20261120.css');
expect(ownerPcUiContract.includes('Source-sprite crop contract:') &&
  ownerPcUiContract.includes('rgba(0,0,0,.9) 12%,#000 24%') &&
  ownerPcUiContract.includes('rgba(0,0,0,.9) 13%,#000 27%') &&
  !ownerPcUiContract.includes('transparent 43%,#000 75%') &&
  !ownerPcUiContract.includes('transparent 53%,#000 84%') &&
  !ownerPcUiContract.includes('rgba(0,0,0,.50) 18%,#000 42%'),
  '617 desktop uses one effective artwork crop, not stacked contradictory mask patches');
const botDockContract=await read('web/src/trakbotDock.css');
expect(ownerPcUiContract.includes('UI CONTRACT 21.11: canonical desktop guest mascot') &&
  ownerPcUiContract.includes('owner20-feature::before') &&
  ownerPcUiContract.includes('radial-gradient(ellipse at 50% 53%') &&
  !ownerPcUiContract.includes('width:40px!important;min-width:40px!important;') &&
  !botDockContract.includes('a full-width cyan-edged launcher'),
  'single desktop guest TrakBot/cinematic tile contract, not conflicting old pill or 40px fallback');
const roleSidebarSource=await read('web/src/main.tsx');
const navGlyphSource=await read('web/src/navGlyph.tsx');
expect(roleSidebarSource.includes('<NavGlyph glyph={ic}/>') &&
  navGlyphSource.includes("glyph === '⚒'") &&
  navGlyphSource.includes("glyph === 'ⓘ'") &&
  navGlyphSource.includes("glyph === '⚿'"),
  'signed-in desktop navigation shares consistent approved vector pictograms with mobile');
const ownerPcHeader = await read('web/src/screens/ownerDesktopHome20261120.tsx');
expect(unifiedVisuals.includes("logo: '/traksos-brand-logo-approved-618.png'") &&
  unifiedVisuals.includes("trakbotHello: '/trakbot-approved-hello.webp'") &&
  unifiedVisuals.includes("trakbotReactions: '/trakbot-approved-30.webp'") &&
  unifiedVisuals.includes("serviceScenes: '/traksos-service-scenes-shared.webp'") &&
  unifiedVisuals.includes("desktopServiceScenes: '/traksos-service-scenes-desktop-hq.webp'") &&
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
  // Both signed-in workspaces use current as the selected live order.
  (unifiedMobile.match(/<ApprovedOrderTruck order=\{current\} \/>/g)?.length ?? 0)>=2 &&
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
  unifiedSceneComponent.includes('APPROVED_VISUALS.desktopServiceScenes') &&
  unifiedSceneComponent.includes('APPROVED_VISUALS.serviceScenes') &&
  unifiedServiceSceneStyle.includes('background-image:var(--tr-service-mobile);') &&
  unifiedServiceSceneStyle.includes('background-image:var(--tr-service-desktop);') &&
  unifiedServiceSceneStyle.includes('@media(min-width:900px)') &&
  unifiedServiceSceneStyle.includes('width:88px;') &&
  unifiedServiceSceneStyle.includes('height:52.5px;') &&
  unifiedServiceSceneStyle.includes('background-size:352px 52.5px;') &&
  !unifiedServiceSceneStyle.includes('transform:scale(.51);') &&
  !unifiedServiceSceneStyle.includes('transform:scale(1.03);') &&
  ['0 0','-88px 0','-176px 0','-264px 0'].every((pos,i)=>
    unifiedServiceSceneStyle.includes('.and19-services>a>.tr-service-illustration--'+sharedSceneKeys[i]+'{background-position:'+pos+'}')
  ),
  'same four services with HQ PC photographs and owner-approved mobile pictures; preserve label geometry');

// The 617 desktop home is a standalone component. Old public-landing
// selectors cannot silently reintroduce its predecessor's hero or crop.
// On mobile the approved guest palette is graphite/orange, never magenta.
const formerDesktopReference = await read('web/src/trackReference.css');
const currentMobileGuest = await read('web/src/mobileBrowser.css');
expect(!formerDesktopReference.includes('.guest-app .public-landing .public-hero-visual'),
  'no retired desktop guest hero overlays; preserve signed-in client artwork');
expect(!currentMobileGuest.includes('#fa5793'),
  'approved guest mobile benefits cannot revert to the old magenta accent');
const formerHeroCss = await read('web/src/approvedHeroImage20261119.css');
expect(!formerHeroCss.includes('@media(min-width:900px)') &&
  !formerHeroCss.includes('@media(min-width:1251px)'),
  'retired 19 Nov desktop guest hero overrides cannot return alongside standalone 617 home');

for (const file of ['web/src/finalCanon.css','web/src/trackPhotos.css']) {
  let exists = false;
  try { await stat(file); exists = true; } catch {}
  expect(!exists, 'retired photo/layout stylesheet cannot be bundled: '+file);
}

const landing = await read('web/src/screens/login.tsx');
expect(landing.includes("!native.isApp && window.matchMedia('(min-width: 900px)').matches") &&
  !landing.includes("useState(() => window.matchMedia('(min-width: 900px)').matches)"),
  'native WebView must never switch unauthenticated users to the desktop 617 landing');
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
expect(heroVisualE2E.includes("tracksos-approved-hero-owner-20261119") &&
  heroVisualE2E.includes("owner20-photo-background-approved.webp") &&
  heroVisualE2E.includes("main.approved-pc.approved-pc-client") &&
  heroVisualE2E.includes("main.client-dashboard .and19-workspace.and19-client") &&
  !heroVisualE2E.includes("page.locator('.client-dashboard .desktop-hero')"),
  'browser visual gate tests approved 617/618 real guest and account screens, never obsolete desktop-hero or fake phone hero');


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
const nativeWide = await read('web/src/nativeWide20261121.css');
expect(unifiedShell.includes("import './nativeWide20261121.css';") &&
  nativeWide.includes('html.traksos-native .app:not(.guest-app) .and19-workspace') &&
  nativeWide.includes('html.traksos-native .guest-app .public-hero-visual') &&
  nativeWide.includes('html.traksos-native .app .desktop-sidebar') &&
  nativeWide.includes('html.traksos-native .app:not(.guest-app) .tabbar'),
  'wide Android WebViews use only the 618 native shell, including guest entry and bottom navigation');
expect(androidAcceptance.includes("Object.defineProperty(window,'TrakSOSNative'") &&
  androidAcceptance.includes("['master_service'") &&
  androidAcceptance.includes('for(const width of [320,390])'),
  'Android visual acceptance exercises the native bridge, hybrid workspace and narrow widths');

expect(androidCss.includes('.and19-workspace') && browserCss.includes('html.traksos-compact-guest') && shell.includes("classList.add('traksos-compact-guest')") && shell.includes('guest-app guest-home') && !browserCss.includes(':is(') && !browserCss.includes(':has(') && !currentCss.includes(':has('),
  'Android guest shares the approved narrow-screen public layout; authenticated Android cabinets remain separate');
expect(!currentCss.includes('.and19-workspace') && !currentCss.includes('.app.role-performer'),
  'public 19 Nov CSS does not rewrite signed-in Android or performer workspaces');

const css = await read('web/src/styles.css');
expect(css.includes('--public-orange:#ff6a13') && !css.includes('--public-pink') &&
  !css.includes('color:#f757a0') && !css.includes('color:#dd8caf'),
  'approved public guest accent is orange, not the retired magenta');
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
expect(!demo.includes('Открыть старый учебный тренажёр') &&
  !demo.includes('setFallback(true)'),
  'approved admin role launcher cannot fall back into obsolete role trainers');
expect(shell.includes("b === 'test-center' ? <AdminTestCenter roleId={route[2]} fullFidelity />") &&
  !shell.includes('serviceSandbox') && !shell.includes('ServicePreview'),
  'admin test center imports only the full-fidelity role sandbox');
const retiredTraining=[
  'customerTrainingCabinet.tsx','fleetTrainingCabinet.tsx','performerTrainingCabinet.tsx',
  'insurerTrainingCabinet.tsx','inspectionTrainingCabinet.tsx',
  'moderatorTrainingCabinet.tsx','masterServiceTrainingCabinet.tsx'
];
for(const filename of retiredTraining){
  let found=false;
  try{await stat('web/src/screens/'+filename);found=true;}catch{/* absent */}
  expect(!found,'retired mock training module must be physically removed: '+filename);
}
expect(!demo.includes('TrainingCabinet')&&!demo.includes('SandboxCabinet')&&
  !demo.includes('initialTickets(')&&!demo.includes('function RoleScenario'),
  'no synthetic role workspaces can be bundled into the real admin test center');
for(const role of ['client','owner','driver','master','tow','service','master_service','insurer','moderator','admin']) {
  expect(demo.includes("id:'"+role+"'"), 'safe demo role exists: '+role);
}
const labels = await read('web/src/dict.ts');
const native = await read('android/app/src/main/java/ru/traksos/app/MainActivity.kt');

await asset('branding/approved-launcher-master-2026-11-20.png', 2000000);
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
// Launcher PNGs are now generated from the owner-approved 20 Nov cinematic icon.
// Notification icons remain unchanged; never use the launcher for notifications.
for (const icon of ["android/app/src/main/res/drawable-mdpi/ic_notify.png","android/app/src/main/res/drawable-hdpi/ic_notify.png","android/app/src/main/res/drawable-xhdpi/ic_notify.png","android/app/src/main/res/drawable-xxhdpi/ic_notify.png","android/app/src/main/res/drawable-xxxhdpi/ic_notify.png"]) {
  await asset(icon, 400);
}

expect(createHash('sha256').update(await readFile('web/public/icon-512.png')).digest('hex') ===
       createHash('sha256').update(await readFile('branding/tracksos-rustore-icon.png')).digest('hex'),
  'RuStore and PWA 512 use the same owner-approved cinematic icon');
const iconBytes=(path)=>readFile(path);
const byteHash=async(path)=>createHash('sha256').update(await iconBytes(path)).digest('hex');
expect(await byteHash('web/public/icon-192.png') ===
       await byteHash('android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png'),
  'Android xxXHDPI 192 and PWA 192 use the same exact approved icon bytes');
const pwaManifest=JSON.parse(await read('web/public/manifest.webmanifest'));
expect((await read('web/index.html')).includes('icon-192.png?v=approved-20261120') &&
       (await read('web/index.html')).includes('manifest.webmanifest?v=approved-20261120') &&
       pwaManifest.icons?.some(i=>i.src==='icon-192.png?v=approved-20261120'&&i.sizes==='192x192') &&
       pwaManifest.icons?.some(i=>i.src==='icon-512.png?v=approved-20261120'&&i.sizes==='512x512') &&
       (await read('android/app/src/main/AndroidManifest.xml')).includes('android:icon="@mipmap/ic_launcher"'),
  'updated icon reaches Android launcher, cached browser favicons and PWA manifest');
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
// Six image files are bundled now. A seventh CC0 R440 is merely a
// plate-mask-checked SOURCE record until a reviewed WebP is actually imported.
expect(photoSourceManifest.items.length===7 &&
  photoSourceManifest.items.filter(x=>x.id!=='scania-r440-2010').length===6 &&
  photoSourceManifest.items.filter(x=>x.id!=='scania-r440-2010').every(x=>photoCatalog.includes(x.id+'.webp')) &&
  photoSourceManifest.items.some(x=>x.id==='scania-r440-2010' && x.model==='r440' &&
    x.license==='CC0 1.0' && Array.isArray(x.redact) && x.redact.length>=3) &&
  !photoCatalog.includes('scania-r440-2010.webp') &&
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

// The owner explicitly requires every accessible Android section to follow
// the approved home language: a real menu, real role routes and restrained
// animation. Source checks supplement, not replace, actual APK screenshots.
const mobileRoleMenu = await read('web/src/mobileRoleMenu.tsx');
const innerAndroidStyle = await read('web/src/androidInternalSections20261120.css');
const androidRealScreens = await read('e2e/android-approved-real-screens.mjs');
const mobileMenuBlock = shell.slice(shell.indexOf('const mobileTabs:'),shell.indexOf('const accountLinks:'));
// Exactly seven real role menus; the retired fake STO variant must never be counted.
expect((mobileMenuBlock.match(/\['\/menu', 'menu', 'Меню'\]/g)??[]).length === 7 &&
  shell.includes("const shellHref=(href:string)=>'#'+href;") &&
  !mobileMenuBlock.includes("['/profile', '◉', 'Меню']") &&
  !mobileMenuBlock.includes("['/menu', '◉', 'Меню']") &&
  shell.includes("case 'menu': screen =") &&
  shell.includes("<MobileRoleMenu mode={mode}") &&
  shell.includes("onLogout={safeLogout}") &&
  !shell.includes("mobileTabs.length > 0 && !(route[0] === 'work'") &&
  mobileRoleMenu.includes('quick.filter') &&
  mobileRoleMenu.includes('uniqueEntries(account') &&
  mobileRoleMenu.includes('uniqueEntries(help') &&
  mobileRoleMenu.includes('tr-mobile-menu-logout'),
  'All seven Android roles have a real accessible menu and section/account/help actions, including settings and documents');
expect(shell.includes("import './androidInternalSections20261120.css';") &&
  innerAndroidStyle.includes('html.traksos-native') &&
  innerAndroidStyle.includes('main:not(.client-dashboard):not(.work-live-dashboard)') &&
  innerAndroidStyle.includes('tr-mobile-menu-links') &&
  innerAndroidStyle.includes('trAndroidInnerEnter') &&
  innerAndroidStyle.includes('prefers-reduced-motion:reduce') &&
  !innerAndroidStyle.includes('infinite') &&
  !innerAndroidStyle.includes(".app:not(.guest-app) .top {") &&
  !innerAndroidStyle.includes(".app:not(.guest-app) .tabbar {"),
  'All secondary Android screens have one coherent style, protected approved dashboards and reduced-motion support');
expect(androidRealScreens.includes("owner+'-menu-android-390.png") ||
  (androidRealScreens.includes("role+'-menu-android-390.png") &&
  androidRealScreens.includes("role+'-menu-android-320.png") &&
  androidRealScreens.includes("bottom Menu vanished inside profile/settings")),
  'Real authenticated Android CI must capture and validate each role menu, including 320/390px and settings');

// The dashboard must be functional, not just visually styled:
// assigned master info is furnished by real API projection, and the truck,
// order and chat always lead to three correct authorized destinations.
const androidWorkspaceLive = await read('web/src/screens/androidWorkspaces.tsx');
const ordersServiceLive = await read('server/src/services/orders.ts');
const androidReviewLive = await read('web/src/screens/androidDesignReview.tsx');
const androidOrderReviewTest = await read('e2e/android-apk-design-review.mjs');
const innerSectionComponent = await read('web/src/mobileSectionChrome.tsx');
expect(ordersServiceLive.includes('perf.name as performer_name') &&
  ordersServiceLive.includes('perf.rating::float as performer_rating') &&
  ordersServiceLive.includes('perf.rating_count as performer_rating_count') &&
  ordersServiceLive.includes('left join users perf on perf.id=o.performer_id') &&
  !ordersServiceLive.includes('perf.phone as performer_phone'),
  'Android assigned-master card uses authorized real public API name/rating, never private phone');
expect(androidWorkspaceLive.includes('current?.performer_name') &&
  androidWorkspaceLive.includes("current.performer_rating") &&
  androidWorkspaceLive.includes('and19-order-photo-link') &&
  androidWorkspaceLive.includes("current.vehicle_id ? '#/garage/' + current.vehicle_id") &&
  (androidWorkspaceLive.includes("current.id + '?chat=1'") ||
   androidWorkspaceLive.includes("current.id+'?chat=1'")) &&
  androidWorkspaceLive.includes('vehicleReferencePhoto(vehicleBrand, vehicleModel, vehicleYear)') &&
  androidWorkspaceLive.includes('current.money.amount') &&
  androidWorkspaceLive.includes('current.money.clientFee'),
  'Android client order has three distinct links, exact-model vehicle image, real price breakdown and master rating');
expect(androidReviewLive.includes("money: { amount: 1000000, clientFee: 50000, total: 1050000 }") &&
  androidReviewLive.includes("vehicle_id: 'SYNTHETIC-VEHICLE'") &&
  androidOrderReviewTest.includes('Client Android order routing/kopeck pricing/rating wrong'),
  'Android synthetic screenshot review has realistically scaled kopecks and verifies actual destinations');
expect(shell.includes('MobileSectionChrome title={sectionLabel} homeHref={workspaceHref}') &&
  shell.includes("const innerSection = !!me && native.isApp") &&
  innerSectionComponent.includes('href={\'#\'+homeHref}') &&
  innerSectionComponent.includes('href="#/menu"') &&
  innerAndroidStyle.includes('tr-native-section-path') &&
  androidRealScreens.includes("view.chrome?.menu!=='#/menu'"),
  'Every native Android inner page has a real role-scope breadcrumb, consistent menu and accessible back navigation');

const navGlyphs = await read('web/src/navGlyph.tsx');
const reviewWithNav = await read('web/src/screens/androidDesignReview.tsx');
expect(mobileMenuBlock.includes("['/work/chats', 'chat', 'Чат']") &&
  mobileMenuBlock.includes("['/garage', 'truck', 'Техника']") &&
  mobileMenuBlock.includes("['/orders', 'clipboard', 'Заявки']") &&
  mobileMenuBlock.includes("['/menu', 'menu', 'Меню']") &&
  ['menu','chat','truck','clipboard'].every(icon=>navGlyphs.includes("glyph === '"+icon+"'")) &&
  reviewWithNav.includes("['chat','Чат']") &&
  reviewWithNav.includes("['truck','Техника']") &&
  reviewWithNav.includes("['menu','Меню']"),
  '618 Android footer icons are actual matching SVGS: chat, truck, clipboard, menu, identical in live and preview');

// Every navigation release must update the built-in training/help at the
// same time: users must never be told to look for the Android menu at the top.
const appTour = await read('web/src/screens/roleTour.tsx');
const appTraining = await read('web/src/screens/training.tsx');
const appIntroduction = await read('web/src/screens/platformIntro.tsx');
const appContextHelp = await read('web/src/screens/contextHelp.tsx');
expect(appTour.includes('.tabbar a[href="#/menu"]') &&
  appTraining.includes('нижнее «Меню»') &&
  appIntroduction.includes('нижнюю кнопку «Меню»') &&
  !appIntroduction.includes('«Меню» вверху.') &&
  appContextHelp.includes("menu: ['Меню и разделы'"),
  'Android navigation, tutorials and contextual help describe the same actual bottom Menu and real sections');

// Original 618.png is an acceptance CONTRACT, not a source for invented data.
// Client: exactly 5 fixed bottom slots, no obsolete shop tile, four working
// services, real route/time/vehicle, and an uncluttered speaking-truck bot.
const liveAndroidNav = shell.slice(shell.indexOf('const mobileTabs:'),shell.indexOf('const accountLinks:'));
const ownerNav818 = liveAndroidNav.match(/\[\['\/', '⌂', 'Главная'\], \['\/orders', 'clipboard', 'Заявки'\], \['\/air', '◌', 'Эфир'\], \['\/garage', 'truck', 'Техника'\], \['\/menu', 'menu', 'Меню'\]\]/g) ?? [];
const approvedNavCSS = await read('web/src/approvedBottomNavigation20261120.css');
const appPerformer = await read('web/src/screens/performer.tsx');
expect(ownerNav818.length === 1 &&
  approvedNavCSS.includes('grid-template-columns:repeat(5,minmax(0,1fr));') &&
  !unifiedMobile.includes('className="and19-equipment and19-parts-shortcut"') &&
  unifiedMobile.includes('Новая заявка на сервис') &&
  shell.includes('!native.isApp && !isAuthEntry') &&
  shell.includes("['/work/chats', 'chat', 'Чат']"),
  '618.png client exactly five bottom tabs, four original services, separate shop in Menu, no floating native bot');

expect(unifiedMobile.includes('function MobileTimeline({ order }') &&
  unifiedMobile.includes('order.accepted_at') &&
  unifiedMobile.includes('order.en_route_at') &&
  unifiedMobile.includes('order.arrived_at') &&
  unifiedMobile.includes('order.dispatch_eta_minutes') &&
  unifiedMobile.includes('function orderNavigationHref(') &&
  unifiedMobile.includes('Number.isFinite(lat)') &&
  unifiedMobile.includes('traksos-native') &&
  ordersServiceLive.includes('o.accepted_at, o.en_route_at, o.arrived_at') &&
  ordersServiceLive.includes('d.road_eta_minutes') &&
  ordersServiceLive.includes('o.address, o.lat, o.lng'),
  '618.png shows actual order stage times, geocoded navigation and dispatch-age ETA, never fabricated clocks or stale live GPS claims');

expect(unifiedMobile.includes("action:'depart'|'arrive'|'start_work'") &&
  unifiedMobile.includes("post('/api/orders/'+current.id+'/step'") &&
  unifiedMobile.includes("current.status==='working'") &&
  unifiedMobile.includes('className="and19-stage-complete is-disabled"') &&
  unifiedMobile.includes('commissionPct') &&
  unifiedMobile.includes('money.payout') &&
  appPerformer.includes('todayCount={todayCount}') &&
  appPerformer.includes('reloadJobs={jobs.reload}'),
  '618.png master next-step confirmation, disabled premature finish and private real commission/payout');

const photoMigration = await read('server/migrations/20261120_order_photos.sql');
const photoService = await read('server/src/services/orderPhotos.ts');
const appServer = await read('server/src/app.ts');
const photoWidgets = await read('web/src/screens/orderPhotos.tsx');
const photoStyle = await read('web/src/screens/orderPhotos.css');
const orderDetail = await read('web/src/screens/order.tsx');
const androidActivity = await read('android/app/src/main/java/ru/traksos/app/MainActivity.kt');
const androidManifest = await read('android/app/src/main/AndroidManifest.xml');
const androidPhotoPaths = await read('android/app/src/main/res/xml/file_paths.xml');
const photoIntegrationTest = await read('server/test/orderPhotos.test.ts');
expect(photoMigration.includes('create table if not exists order_photos') &&
  photoService.includes("createCipheriv('aes-256-gcm'") &&
  photoService.includes("createDecipheriv('aes-256-gcm'") &&
  photoService.includes("this.orders.actorOf(user,order)!=='performer'") &&
  photoService.includes('select * from orders where id=$1 for update') &&
  photoService.includes('MAX_PER_ORDER = 12') &&
  appServer.includes("r.post('/api/orders/:id/photos', performerRoles") &&
  appServer.includes("r.get('/api/orders/:id/photos/:photoId/file', true") &&
  orderDetail.includes('<OrderPhotoGallery orderId={id}/>') &&
  unifiedMobile.includes('<OrderPhotoCapture orderId={current.id} reviewOnly={reviewOnly}/>') &&
  photoWidgets.includes("toDataURL('image/jpeg'") &&
  photoWidgets.includes('if(reviewOnly)return') &&
  photoStyle.includes('.tr-order-photo-gallery') &&
  androidActivity.includes('FileProvider.getUriForFile(') &&
  androidActivity.includes('MediaStore.ACTION_IMAGE_CAPTURE') &&
  androidManifest.includes('androidx.core.content.FileProvider') &&
  androidPhotoPaths.includes('<cache-path name="order-photos"') &&
  photoIntegrationTest.includes('stranger.token'),
  '618.png Foto is REAL encrypted participant-scoped evidence and Android native chooser; debug photo never uploads');


// All ten independently renderable PC roles share the owner-approved 617
// contract from 900px. A mismatch with mobile's 899px maximum can silently
// resurrect retired `Home` markup on 900–999px tablets or small laptops.
// The legacy guest PIN demo was a collection of fake training mini-cabinets.
// The only permitted visual sandbox is the authenticated full-fidelity build.
const retiredDemo=await read('web/src/screens/demoPreview.tsx');
const realTestCenter=await read('web/src/screens/adminTestCenter.tsx');
expect(retiredDemo.includes('Старый демонстрационный просмотр закрыт') &&
  retiredDemo.includes('tr-approved-route-unavailable') &&
  !retiredDemo.includes('AdminTestCenter') &&
  !retiredDemo.includes('operatorDemoSession') &&
  !retiredDemo.includes('/api/public/demo/unlock'),
  'public PIN preview must never restore obsolete simulated role cabinets');
expect(!unifiedShell.includes('operator-demo-app') &&
  !unifiedShell.includes('operator-demo-badge') &&
  !css.includes('.app.operator-demo-app'),
  'retired guest preview cannot mount a separate obsolete header and CSS shell');
expect(realTestCenter.includes('FullFidelityRoleLauncher') &&
  realTestCenter.includes("'/api/admin/sandbox/ticket'") &&
  realTestCenter.includes('<NavGlyph glyph={r.icon}/>') &&
  realTestCenter.includes("id:'tow',icon:'tow'") &&
  realTestCenter.includes("id:'master',icon:'wrench'") &&
  !realTestCenter.includes('TrainingCabinet') &&
  !realTestCenter.includes('SandboxCabinet'),
  'test center contains only signed isolated full-fidelity role launcher, no fake dashboard');
expect(!/\.sandbox-(?:workspace|nav|panel|ticket|scenario|bars|metric|feature|fleet|bays|route|road-flow|hero|breadcrumb|footer)\b/.test(css),
  'retired mock role UI may not ship dead CSS selectors');
const liveBaseSource=await read('web/src/screens/base.tsx');
expect(!unifiedShell.includes('serviceSandbox') && !unifiedShell.includes('ServicePreview') &&
  !liveBaseSource.includes('servicePreviewApi') && !liveBaseSource.includes('inServicePreview'),
  'obsolete mock routes and adapters cannot be bundled');
for (const oldPath of ['web/src/screens/servicePreview.tsx','web/src/demo/servicePreviewApi.ts']) {
  let remains=false;
  try { await stat(oldPath); remains=true; } catch { /* physical removal required */ }
  expect(!remains, 'retired STO preview source must be deleted: '+oldPath);
}
const pcSource=await read('web/src/screens/approvedPcCabinets20261120.tsx');
const pcCss=await read('web/src/approvedPcCabinets20261120.css');
const courierPcCss=await read('web/src/screens/approvedPcCourier20261120.css');
const pcMap=await read('web/public/traksos-russia-outline.svg');
expect(pcSource.includes("export type ApprovedPCRole") &&
  ['driver','owner','master','tow','service','insurer','inspection','courier','moderator','admin']
    .every(role=>pcSource.includes("'"+role+"'")) &&
  pcSource.includes("useDesktopSize()") &&
  pcSource.includes("window.matchMedia('(min-width: 900px)')") &&
  pcCss.includes("@media(min-width:900px)") &&
  pcCss.includes("@media (min-width:900px) and (max-width:1199px)") &&
  !pcCss.includes('@media(min-width:1000px)') &&
  unifiedShell.includes('ApprovedPcDesk') &&
  unifiedShell.includes("approvedPcCabinets20261120.css"),
  'ten real desktop role workspaces start at 900px, without a legacy breakpoint gap');
expect(courierPcCss.includes('@media(min-width:900px)') &&
  !courierPcCss.includes('@media(min-width:1000px)'),
  'approved PC courier stylesheet must activate at the 900px router breakpoint; no unstyled 960px truck');
expect(pcSource.includes("get<any[]>('/api/orders')") &&
  pcSource.includes("get<any[]>('/api/orders?as=performer')") &&
  pcSource.includes("get<any[]>('/api/performer/auctions')") &&
  pcSource.includes("get<any>('/api/base')") &&
  pcSource.includes("'/api/insurer/inspections'") &&
  pcSource.includes("'/api/insurer/requests'") &&
  pcSource.includes("get<any>('/api/admin/summary')") &&
  pcSource.includes("'/api/mod/cases?kind='") &&
  pcSource.includes('OfferForm') &&
  pcSource.includes('RoadsideMap') &&
  pcSource.includes('APPROVED_VISUALS.trakbotHello'),
  'desktop cards, bids, inspections, moderation, map and bot use real API/approved assets');
expect(pcSource.includes("href={'#/order/'+o.id+'?chat=1'}") &&
  pcSource.includes('owner?get<any>(\'/api/fleet\')') &&
  pcSource.includes('fleet.data?.cars') &&
  pcSource.includes('dateIso(new Date') &&
  pcSource.includes("get<any>('/api/orders/'+o.id)") &&
  pcSource.includes('Math.abs(event.lat)<=90'),
  'drivers and fleet owners have real order detail, order tabs, calendar and safe GPS handling');
expect(pcMap.includes('viewBox="620 35 530 220"') &&
  pcCss.includes("traksos-russia-outline.svg") &&
  pcSource.includes('Без выдуманных точек')===false &&
  pcSource.includes('Никаких выдуманных точек'),
  'admin shows nationwide geographic outline without invented route markers');


// New approved interactive PC contracts. These checks prevent empty placeholders,
// accidental early completion, and broken main actions from re-entering the repo.
const pcE2E=await read('e2e/approved-pc-active-work.mjs');
expect(pcSource.includes('function SelectedPerformerCase(') &&
  pcSource.includes("'depart',label:'Выехал'") &&
  pcSource.includes("'arrive',label:'Подтвердить прибытие'") &&
  pcSource.includes("'start_work',label:'Начать работу'") &&
  pcSource.includes("d.you==='performer'") &&
  pcSource.includes("+'/step',{action:step.action}") &&
  pcSource.includes('OrderPhotoGallery') &&
  pcSource.includes('OrderPhotoCapture') &&
  pcSource.includes('approved-pc-techbook') &&
  pcSource.includes("['work','Работа',null]"),
  'real selected master/tow next-step sequence, picture report and internal case tabs');
expect(pcSource.includes('function SelectedServiceCase(') &&
  pcSource.includes('RequestCard key={selected.id}') &&
  pcSource.includes("get<any>('/api/bookings/'+booking.id)") &&
  pcSource.includes("const expected=g?.expected||[]") &&
  pcSource.includes("expected.length") &&
  (await read('web/src/screens/base.tsx')).includes('export function RequestCard('),
  'new STO request actions and selected real repair stages without fake counts');
expect(pcSource.includes('approved-pc-active-order-nav') &&
  pcSource.includes('active.map((o:any)=>[String(o.id)') &&
  !pcSource.includes('onChange={()=>{}}') &&
  pcSource.includes('approved-pc-order-table') &&
  pcSource.includes('approved-pc-fleet-vehicle-row') &&
  pcSource.includes('function Calendar(') &&
  pcSource.includes('appointments.map((item:any)'),
  'owner active multi-order tabs, repair table, real fleet, and clickable calendar entries');
expect(pcE2E.includes('SYNTHETIC local API data') &&
  pcE2E.includes("['localhost','127.0.0.1']") &&
  pcE2E.includes("serviceWorkers:'block'") &&
  pcE2E.includes('synthetic:true,production:false') &&
  pcE2E.includes("const changes={depart:'en_route',arrive:'arrived',start_work:'working'}"),
  'signed-in real-browser synthetic fixture clearly labelled and state sequence guarded');

if (failures.length) {
  console.error('Approved design gate: '+failures.length+' failure(s).');
  process.exitCode=1;
} else console.log('Approved TrakSos design gate: all code invariants passed.');
