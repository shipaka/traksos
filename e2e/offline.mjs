// TrakSOS public web offline test: the UI shell must work on slow/absent internet,
// but /api/* MUST fail offline instead of serving stale user data.
import { chromium } from 'playwright';

const base = process.env.BASE_URL ?? 'http://localhost:8080';
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 390, height: 844 },
  serviceWorkers: 'allow', locale: 'ru-RU' });
try {
  const page = await context.newPage();
  await page.goto(base + '/#/', { waitUntil: 'load' });
  await page.locator('.public-landing').waitFor({ timeout: 15000 });
  await page.waitForFunction(() =>
    navigator.serviceWorker?.controller?.state === 'activated', null, { timeout: 20000 });
  // Give the precache one turn to finalize before shutting off connectivity.
  await context.setOffline(true);
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 15000 });
  await page.locator('.public-landing').waitFor({ timeout: 15000 });
  await page.getByRole('link', { name: 'Зарегистрироваться' }).first().waitFor();
  const hasApiCache = await page.evaluate(async () => {
    try { await fetch('/api/health', { cache: 'no-store' }); return true; }
    catch { return false; }
  });
  if (hasApiCache) throw new Error('SECURITY: API response was unexpectedly available while offline');
  console.log('OK: cached public UI works offline; live API remains network-only');
} finally {
  await browser.close();
}
