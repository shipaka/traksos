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
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(token => {
      localStorage.setItem('traksos.token', token);
      localStorage.setItem('traksos.mode', 'client');
    }, account.token);
    try {
      await page.goto(BASE + '/#/', {waitUntil: 'domcontentloaded'});
      await page.locator('.app').waitFor({timeout: 20000});
      // Capture any initial legal/onboarding gate for diagnostic visual review.
      await page.screenshot({path: OUT + '/initial-' + width + '.png'});

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
      console.log('PASS premium real client ' + width + 'px: Scania, 4 services, 4 hubs, SOS, 5 specialties, no overflow');
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
}
