import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const BASE = process.env.BASE_URL ?? 'http://localhost:8080';
const OUT = process.argv[2] ?? 'e2e/shots';
await mkdir(OUT, { recursive: true });
const browser = await chromium.launch();
try {
  for (const target of [
    { name: '00-public-canon-1672', viewport: { width: 1672, height: 941 }, isMobile: false },
    { name: '00-public-pc', viewport: { width: 1440, height: 900 }, isMobile: false },
    { name: '00-public-mobile', viewport: { width: 390, height: 844 }, isMobile: true },
  ]) {
    const context = await browser.newContext({
      viewport: target.viewport, locale: 'ru-RU', deviceScaleFactor: 1,
      isMobile: target.isMobile, hasTouch: target.isMobile,
    });
    const page = await context.newPage();
    await page.goto(BASE + '/#/', { waitUntil: 'domcontentloaded' });
    await page.locator('.public-landing').waitFor({ timeout: 15000 });
    await page.locator('.public-service-tile').first().waitFor();
    await page.evaluate(async () => { await document.fonts.ready; });
    await page.screenshot({ path: `${OUT}/${target.name}-viewport.png` });
    await page.screenshot({ path: `${OUT}/${target.name}.png`, fullPage: true });
    await context.close();
  }
} finally {
  await browser.close();
}
