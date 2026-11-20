// Browser verification of the integrated PREMIUM client UI (not a static mockup).
// Registers a fresh synthetic local-only owner on the isolated CI database.
import { chromium } from 'playwright';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';

const BASE = process.env.BASE_URL ?? 'http://localhost:8080';
const origin = new URL(BASE);
if (!['localhost', '127.0.0.1'].includes(origin.hostname)) {
  throw new Error('Premium visual audit is strictly restricted to a local test server');
}
const OUT = process.env.SHOTS_DIR ?? 'e2e/shots/premium-unified-client';
await mkdir(OUT, { recursive: true });
const phone = '+79990000996'; // Synthetic CI fixture; no actual SMS or customer data
async function post(path, body) {
  const r = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await r.json().catch(() => null);
  if (!r.ok) throw new Error(path + ' returned ' + r.status + ': ' + data?.error);
  return data;
}
const code = await post('/api/auth/code', {phone});
if (!/^\d{4,6}$/.test(code.devCode ?? '')) {
  throw new Error('Local test SMS fixture unavailable: never run against production');
}
const account = await post('/api/auth/verify', {
  phone, code: code.devCode, accountType: 'owner',
  password: 'SyntheticA-' + randomUUID()
});
if (!account.token || !account.user?.roles?.includes('client')) {
  throw new Error('Local owner fixture is not a client');
}
const browser = await chromium.launch();
try {
  for (const width of [390, 1440]) {
    const context = await browser.newContext({
      viewport: { width, height: width < 600 ? 844 : 900 },
      deviceScaleFactor: 1,
      locale: 'ru-RU'
    });
    const page = await context.newPage();
    const errors = [];
    const consoleErrors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', e => { if (e.type() === 'error') consoleErrors.push(e.text()); });
    await page.addInitScript(({token,nativePreview}) => {
      // Approved 618 mobile role UI appears inside Android WebView, not ordinary Chrome.
      // This is the same local-only native bridge used by android-approved-real-screens.
      if(nativePreview) Object.defineProperty(window,'TrakSOSNative',{
        configurable:true,value:{isApp:()=>true,setSession:()=>{},pushToken:()=>'',
        performerOnline:()=>{},appLockEnabled:()=>false,setAppLockEnabled:()=>false}
      });
      localStorage.setItem('traksos.token', token);
      localStorage.setItem('traksos.mode', 'client');
    }, {token:account.token,nativePreview:width<900});
    try {
      await page.goto(BASE + '/#/', {waitUntil: 'domcontentloaded'});
      await page.locator('.app').waitFor({timeout: 20000});
      // Capture any initial legal/onboarding gate for diagnostic visual review.
      await page.screenshot({path: OUT + '/initial-' + width + '.png'});
      console.log('initial visual diagnostics '+width+'px: '+JSON.stringify({errors,consoleErrors}).slice(0,4500));

      // Synthetic owner explicitly accepts only synthetic local test documents.
      for (let attempt = 0; attempt < 6; attempt++) {
        const dialog = page.locator('[role="dialog"]').first();
        if (!await dialog.isVisible().catch(() => false)) break;
        const check = dialog.locator('input[type="checkbox"]');
        if (await check.count()) await check.first().check();
        const accept = dialog.getByRole('button', { name: /Принимаю/ });
        if (!await accept.count()) break;
        await accept.click();
        await dialog.waitFor({state: 'hidden', timeout: 10000});
      }
      const cookie = page.getByRole('button', {name: 'Понятно'});
      if (await cookie.isVisible().catch(() => false)) await cookie.click();
      await page.waitForTimeout(200);
      console.log('visual entry route ' + width + 'px: ' + await page.evaluate(() => location.hash));
      await page.locator(width < 900
        ? '.client-dashboard .and19-client'
        : '.approved-pc.approved-pc-client').waitFor({state:'visible',timeout:20000});
      if (width < 900) {
        // Owner-approved Android 618: four active services and original logo;
        // the old .and19-cover img is not part of the approved React layout.
        await page.locator('.and19-cover h1').waitFor({state:'visible'});
        const logo = await page.locator('.top .tr-approved-brand-logo img').evaluate(img => ({
          loaded:img.complete && img.naturalWidth===274 && img.naturalHeight===46,
          source:img.getAttribute('src'),visible:img.getBoundingClientRect().height>0
        }));
        if (!logo.loaded || !logo.visible || logo.source!=='/traksos-brand-logo-approved-618.png')
          throw Error('Approved original 618 brand missing: '+JSON.stringify(logo));
        const services = page.locator('.and19-services > a');
        if (await services.count()!==4)
          throw Error('Approved Android 618 must show four service entries');
        const targets=['#/sos','#/new/tow','#/services','#/new/consult'];
        for (let i=0;i<targets.length;i++)
          if (await services.nth(i).getAttribute('href')!==targets[i])
            throw Error('Android service navigation mismatch '+i);
        if (await page.locator('.desktop-quick-card,.approved-pc-client').count()!==0)
          throw Error('Desktop workdesk must never mount inside native Android');
      } else {
        // Approved 20 November PC uses the 3-column owner workplace, not
        // the retired .client-dashboard/.client-hero-scania storefront.
        const heading=page.locator('.approved-pc-heading');
        await heading.getByRole('heading',{name:'Владелец автопарка'}).waitFor();
        const photo=await heading.locator('img').evaluate(img=>({
          loaded:img.complete && img.naturalWidth>100,
          visible:img.getBoundingClientRect().height>0
        }));
        if(!photo.loaded||!photo.visible)
          throw Error('Approved owner PC truck illustration missing: '+JSON.stringify(photo));
        if (await page.locator('.approved-pc-three').count()!==1 ||
            await page.locator('.approved-pc-order-heading').count()!==1)
          throw Error('Owner PC active orders and 3-column workplace missing');
        const actions=['#/sos','#/new/tow','#/services','#/orders'];
        for (const href of actions)
          if(!await page.locator('.approved-pc-client a[href="'+href+'"]').count())
            throw Error('Approved owner PC functional service link missing: '+href);
        if(await page.locator('.client-dashboard').count()!==0)
          throw Error('Retired desktop client dashboard was mounted');
      }
      // Older photographic service cards were physically retired at the owner's
      // request. Preserve only verified actual vehicle-model photos in the app.
      const photoDetails = await page.evaluate(async () => {
        const modelPhotos = ['scania-r520-2016.webp','volvo-fh-2013.webp',
          'renault-premium-2006.webp','daf-xf105.webp',
          'man-tgx-2007.webp','mercedes-actros-2019.webp'];
        return await Promise.all(modelPhotos.map(async name => {
          const img = new Image();
          img.src = '/vehicles/models/' + name;
          await img.decode();
          return {name, w:img.naturalWidth, h:img.naturalHeight};
        }));
      });
      if (photoDetails.some(p => p.w < 320 || p.h < 180))
        throw new Error(width + 'px vehicle-model photo quality/availability: ' + JSON.stringify(photoDetails));
      if(width>=900 && await page.locator('.desktop-quick-card').count())
        throw Error('Retired desktop service cards reappeared over approved owner workplace');
      const pageWidth = await page.evaluate(() => ({
        viewport: document.documentElement.clientWidth,
        content: document.documentElement.scrollWidth
      }));
      if (pageWidth.content > pageWidth.viewport + 3)
        throw new Error(width + 'px horizontal overflow: ' + JSON.stringify(pageWidth));
      await page.evaluate(() => scrollTo(0, 0));
      await page.screenshot({path: OUT + '/client-' + width + '.png', fullPage: true});
      await page.screenshot({path: OUT + '/client-' + width + '-viewport.png'});

      await page.goto(BASE + '/#/sos', {waitUntil: 'domcontentloaded'});
      await page.locator('.client-sos-choices').waitFor();
      if (await page.locator('.client-sos-choice').count() !== 3)
        throw new Error(width + 'px SOS directions must be 3');
      await page.screenshot({path:OUT + '/sos-' + width + '.png',fullPage:true});
      await page.getByRole('button', {name:/Выездной мастер/}).click();
      if (await page.locator('.client-sos-specialty').count() !== 5)
        throw new Error(width + 'px expected 5 master specialties');
      await page.screenshot({path:OUT + '/specialties-' + width + '.png',fullPage:true});
      if (errors.length) throw new Error(width + 'px browser exception: ' + errors.join('; '));
      console.log('PASS real client ' + width + 'px: approved 20 Nov PC/618 Android workspace, real SOS, five specialties, no overflow');
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
}
