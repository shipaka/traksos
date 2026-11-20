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
    await page.addInitScript(token => {
      localStorage.setItem('traksos.token', token);
      localStorage.setItem('traksos.mode', 'client');
    }, account.token);
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
      await page.locator(width < 900 ? '.client-dashboard' : '.approved-pc-client').waitFor({timeout: 20000});
      if (width < 900) {
        // A signed-in mobile BROWSER shows the responsive real Home. Only the
        // native Android bridge renders .and19-client (tested separately).
        if (await page.locator('.and19-client, .approved-pc-client').count() !== 0)
          throw Error('Mobile browser mounted a native or desktop-only cabinet');
        const truck = await page.locator('.client-hero-scania').evaluate(img => ({
          loaded: img.complete && img.naturalWidth > 100,
          fit: getComputedStyle(img).objectFit,
          visible: img.getBoundingClientRect().width > 0 && getComputedStyle(img).display !== 'none'
        }));
        if (!truck.loaded || !truck.visible || truck.fit !== 'contain')
          throw Error('Responsive browser truck missing or cropped: ' + JSON.stringify(truck));
        const cards = page.locator('.client-dashboard .desktop-quick-card');
        if (await cards.count() !== 4 || await page.locator('.client-dashboard-hubs > a').count() !== 4)
          throw Error('Mobile browser lost its four help routes or cabinet destinations');
        if (!await cards.first().isVisible())
          throw Error('Mobile browser help actions are present but hidden');
      } else {
        // >=1000px uses the approved 20 Nov PC workspace, not the retired
        // client-dashboard hero/cards. Do not reintroduce those to satisfy CI.
        if (await page.locator('.client-dashboard, .and19-client').count() !== 0)
          throw Error('Old dashboard unexpectedly mounted on approved PC');
        const heading = page.locator('.approved-pc-client .approved-pc-heading');
        await heading.waitFor({state:'visible'});
        if (!(await heading.innerText()).includes('Владелец автопарка'))
          throw Error('Approved owner workspace heading missing');
        const truck = await heading.locator('img').evaluate(img => ({
          loaded: img.complete && img.naturalWidth > 100,
          fit: getComputedStyle(img).objectFit
        }));
        if (!truck.loaded || truck.fit !== 'contain')
          throw Error('Approved PC workspace artwork missing: ' + JSON.stringify(truck));
        if (!await page.locator('.approved-pc-three').isVisible())
          throw Error('Approved PC three-column workspace missing');
        for (const route of ['#/sos', '#/new/tow', '#/services', '#/orders']) {
          if (!(await page.locator('.approved-pc-client a[href="' + route + '"]').count()))
            throw Error('Approved PC workspace missing working destination ' + route);
        }
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
      // Both layouts must keep the owner-approved routes, without rendering
      // the retired desktop home (native APK is covered by its own smoke test).
      if (width >= 900 && await page.locator('.desktop-quick-card').count() !== 0)
        throw Error('Retired PC service cards resurfaced in the approved workspace');
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
      console.log('PASS real client ' + width + 'px: correct browser workspace, real routes, SOS, specialties, no overflow');
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
}
