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
  for (const width of [320, 360, 390, 768, 1440]) {
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
      await page.locator('.client-dashboard').waitFor({timeout: 20000});
      const truck = await page.locator('.client-hero-scania').evaluate(img => ({
        loaded: img.complete && img.naturalWidth > 100,
        fit: getComputedStyle(img).objectFit,
        visible: getComputedStyle(img).display !== 'none'
      }));
      if (!truck.loaded || !truck.visible || truck.fit !== 'contain')
        throw new Error(width + 'px approved Scania image issue: ' + JSON.stringify(truck));
      const cards = await page.locator('.client-dashboard .desktop-quick-card').count();
      const hubs = await page.locator('.client-dashboard-hubs > a').count();
      if (cards !== 4 || hubs !== 4)
        throw new Error(width + 'px wrong card counts: ' + cards + '/' + hubs);
      // Keep the four service-photo cards intact. Daily Driver Air is a
      // first-view SOS peer, not a stealth fifth service-card or privileged chat.
      const airEntry = page.locator('.desktop-air-action[href="#/air"]');
      if (!await airEntry.isVisible())
        throw new Error(width + 'px: Driver Air is not visible beside SOS');
      const hero = page.locator('.client-dashboard .desktop-hero');
      if (await hero.locator('.desktop-primary-action[href="#/sos"]').count() !== 1 ||
          await hero.locator('.desktop-air-action[href="#/air"]').count() !== 1)
        throw new Error(width + 'px: SOS and Air must share the first hero');
      const ecuEntry = page.locator('.ecu-discovery--home');
      await ecuEntry.waitFor({timeout: 12000});
      if (!await ecuEntry.isVisible() ||
          await ecuEntry.locator('a[href="#/new/ecu"]').count() !== 1 ||
          !await ecuEntry.locator('h2').getByText('Специалист по ЭБУ').count())
        throw new Error(width + 'px: actual ECU order is not discoverable from the dashboard');

      // Confirm actual high-resolution bundled photos load, not only CSS URLs.
      const photoDetails = await page.evaluate(async () => {
        const keys = ['master', 'tow', 'sto', 'consult'];
        return await Promise.all(keys.map(async key => {
          const img = new Image();
          img.src = '/tracksos-photo-' + key + '.webp';
          await img.decode();
          return { key, w: img.naturalWidth, h: img.naturalHeight };
        }));
      });
      if (photoDetails.some(p => p.w < 700 || p.h < 480))
        throw new Error(width + 'px service-photo quality/availability: ' + JSON.stringify(photoDetails));
      for (const [index, key] of ['master', 'tow', 'sto', 'consult'].entries()) {
        const bg = await page.locator('.desktop-quick-card').nth(index).evaluate(el =>
          getComputedStyle(el).backgroundImage);
        if (!bg.includes('tracksos-photo-' + key))
          throw new Error(width + 'px service-photo CSS mismatch: ' + key + '/' + bg);
      }
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
      // Stationary ECU is a dedicated customer service, not emergency SOS.
      if(await page.locator('.ecu-discovery--sos').count())
        throw new Error(width+'px: stationary ECU wrongly appears in SOS');
      await page.goto(BASE+'/#/',{waitUntil:'domcontentloaded'});
      const ecuFromHome=page.locator('.ecu-discovery--home a[href="#/new/ecu"]');
      await ecuFromHome.waitFor({timeout:15000});
      await ecuFromHome.click();
      await page.waitForURL(/#\/new\/ecu(?:\?|$)/,{timeout:12000});
      await page.getByRole('heading',{name:'Специалист по ЭБУ',exact:true}).waitFor({timeout:15000});
      await page.locator('#f-car').waitFor({timeout:15000});
      await page.locator('#f-what').waitFor();
      await page.locator('#f-ecu-station').waitFor();
      if(await page.locator('#f-agree input[type="checkbox"]').count())
        throw new Error(width+'px: ECU cannot be prepriced before diagnostics');
      const ecuFormWidth=await page.evaluate(()=>({
        viewport:document.documentElement.clientWidth,
        content:document.documentElement.scrollWidth
      }));
      if(ecuFormWidth.content>ecuFormWidth.viewport+3)
        throw new Error(width+'px ECU order form overflow: '+JSON.stringify(ecuFormWidth));
      await page.screenshot({path:OUT+'/ecu-form-'+width+'.png',fullPage:true});
      if (errors.length) throw new Error(width + 'px browser exception: ' + errors.join('; '));
      console.log('PASS premium client '+width+'px: Scania, SOS+Air, 4 services, independent ECU station form, 3 SOS, 5 roadside specialties, no overflow');
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
}
