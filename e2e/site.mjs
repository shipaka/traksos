import { chromium } from 'playwright';

const base = process.env.BASE_URL ?? 'http://localhost:8080';
const browser = await chromium.launch();
try {
  for (const [name, width, height] of [['desktop', 1440, 900], ['tablet', 900, 800], ['mobile', 390, 844]]) {
    const page = await browser.newPage({ viewport: { width, height }, locale: 'ru-RU' });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(base + '/#/');
    await page.locator('.website').waitFor();
    await page.locator('.site-nav').waitFor({ state: 'visible' });
    if (await page.locator('.tabbar:visible').count()) throw new Error(name + ': mobile tabbar visible on website');
    const rootWidth = await page.locator('.app').evaluate((el) => el.getBoundingClientRect().width);
    if (width === 1440 && rootWidth < 900) throw new Error('Desktop shell is too narrow: ' + rootWidth);
    if (width === 390 && rootWidth > 390) throw new Error('Mobile page overflows: ' + rootWidth);
    if (width === 1440) {
      await page.getByRole('heading', { name: /Помощь грузовикам на дороге/ }).waitFor();
      await page.getByRole('button', { name: 'Войти в личный кабинет' }).waitFor();
    } else if (width === 390) {
      await page.getByRole('button', { name: 'Войти по номеру' }).waitFor();
    }
    const screenshotDir = process.argv[2];
    if (screenshotDir) {
      await (await import('node:fs/promises')).mkdir(screenshotDir, { recursive: true });
      await page.screenshot({ path: screenshotDir + '/site-' + name + '.png', fullPage: false });
    }
    if (errors.length) throw new Error(name + ': ' + errors.join('; '));
    await page.close();
  }
  console.log('Website layout verified on 390, 900 and 1440 px');
} finally {
  await browser.close();
}
