import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const BASE = process.env.BASE_URL ?? 'http://localhost:8080';
const OUT = process.argv[2] ?? 'e2e/shots';
await mkdir(OUT, { recursive: true });
const browser = await chromium.launch();
try {
  for (const target of [
    // Owner's final 20 Nov reference (real JSX/CSS screenshot, not the reference PNG).
    { name: '00-public-owner20-1536x864', viewport: { width: 1536, height: 864 }, isMobile: false },
    { name: '00-public-approved-target-1602x981', viewport: { width: 1602, height: 981 }, isMobile: false },
    { name: '00-public-canon-1672', viewport: { width: 1672, height: 941 }, isMobile: false },
    { name: '00-public-pc', viewport: { width: 1440, height: 900 }, isMobile: false },
    { name: '00-public-mobile', viewport: { width: 390, height: 844 }, isMobile: true },
    { name: '00-public-mobile-360', viewport: { width: 360, height: 800 }, isMobile: true },
    { name: '00-public-mobile-320', viewport: { width: 320, height: 640 }, isMobile: true },
  ]) {
    const context = await browser.newContext({
      viewport: target.viewport, locale: 'ru-RU', deviceScaleFactor: 1,
      isMobile: target.isMobile, hasTouch: target.isMobile,
    });
    const page = await context.newPage();
    await page.goto(BASE + '/#/', { waitUntil: 'domcontentloaded' });
    if(target.viewport.width >= 900){
      await page.locator('.owner20-home').waitFor({ timeout: 15000 });
      await page.locator('.owner20-quick a').first().waitFor();
      // Asset availability is a precondition for claiming a real screenshot
      // of the owner-approved 20 Nov artwork, not an HTML-only placeholder.
      await page.evaluate(async () => {
        for (const [path,w,h] of [
          ['/owner20-artwork-sprite.webp',1018,446],
          ['/owner20-photo-background-approved.webp',1536,324],
          ['/traksos-brand-logo-approved-618.png',274,46],
        ]) {
          const response=await fetch(path);
          if(!response.ok)throw Error('Approved visual unavailable: '+path+' HTTP '+response.status);
          const bitmap=await createImageBitmap(await response.blob());
          if(bitmap.width!==w||bitmap.height!==h)
            throw Error('Approved visual incorrect size: '+path+' '+bitmap.width+'x'+bitmap.height);
          bitmap.close();
        }
      });
    }else{
      await page.locator('.public-landing').waitFor({ timeout: 15000 });
      await page.locator('.public-service-tile').first().waitFor();
    }
    await page.evaluate(async () => { await document.fonts.ready; });
    await page.screenshot({ path: `${OUT}/${target.name}-viewport.png` });
    await page.screenshot({ path: `${OUT}/${target.name}.png`, fullPage: true });
    await context.close();
  }
} finally {
  await browser.close();
}
