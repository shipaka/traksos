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
      await page.screenshot({ path: screenshotDir + '/site-landing-' + name + '.png', fullPage: false });
    }
    await page.goto(base + '/#/about');
    await page.getByRole('heading', { name: /Не просто вызвать помощь/ }).waitFor();
    const tabs = page.getByRole('tab');
    if (await tabs.count() !== 4) throw new Error(name + ': public feature tour needs four role examples');
    await page.getByRole('tab', { name: 'Автопарк' }).click();
    await page.getByRole('heading', { name: /Каждая машина/ }).waitFor();
    await page.getByRole('tab', { name: 'Партнёры' }).click();
    await page.getByRole('heading', { name: /Рабочий кабинет/ }).waitFor();
    if (await page.locator('.tabbar:visible').count()) throw new Error(name + ': website tour unexpectedly shows app tabbar');
    if (screenshotDir) {
      await page.screenshot({ path: screenshotDir + '/site-' + name + '.png', fullPage: false });
      if (name === 'desktop') {
        await page.locator('.showcase').screenshot({ path: screenshotDir + '/site-feature-tour.png' });
      }
    }
    if (name === 'desktop') {
      await page.goto(base + '/#/');
      await page.getByRole('button', { name: 'Войти в личный кабинет' }).click();
      await page.locator('input[type=tel]').fill('+79990009123');
      await page.getByRole('button', { name: 'Получить код' }).click();
      const hint = await page.getByText(/Тестовый режим: код/).textContent();
      const match = hint.match(/[0-9]{4,6}/);
      if (!match) throw new Error('Demo sign-in code not found');
      await page.locator('input[autocomplete=one-time-code]').fill(match[0]);
      await page.getByRole('button', { name: 'Войти', exact: true }).click();
      await page.locator('.website-workspace').waitFor();
      await page.locator('.website-sidebar').waitFor({ state: 'visible' });
      await page.getByRole('link', { name: /Гараж и история/ }).click();
      await page.getByRole('heading', { name: 'Мой гараж' }).waitFor();
      if (await page.locator('.tabbar:visible').count()) throw new Error('Desktop cabinet uses app navigation');
      if (screenshotDir) await page.screenshot({ path: screenshotDir + '/site-client-desktop.png', fullPage: false });
    }
    if (errors.length) throw new Error(name + ': ' + errors.join('; '));
    await page.close();
  }
  // Desktop admin is a workspace with a secondary section navigator, not a horizontal mobile ribbon.
  const adminPage = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'ru-RU' });
  await adminPage.goto(base + '/#/');
  await adminPage.getByRole('button', { name: 'Войти в личный кабинет' }).click();
  await adminPage.locator('input[type=tel]').fill('+79990000001');
  await adminPage.getByRole('button', { name: 'Получить код' }).click();
  const adminHint = await adminPage.getByText(/Тестовый режим: код/).textContent();
  const adminCode = adminHint.match(/[0-9]{4,6}/);
  if (!adminCode) throw new Error('Admin demo code not available');
  await adminPage.locator('input[autocomplete=one-time-code]').fill(adminCode[0]);
  await adminPage.getByRole('button', { name: 'Войти', exact: true }).click();
  await adminPage.locator('.admin-desktop-shell').waitFor();
  await adminPage.locator('.admin-secondary-nav').waitFor({ state: 'visible' });
  await adminPage.getByRole('button', { name: 'Страхование и ТО' }).click();
  await adminPage.getByRole('heading', { name: /Заявки на страхование и техосмотр/ }).waitFor();
  if (process.argv[2]) await adminPage.screenshot({ path: process.argv[2] + '/site-admin-desktop.png', fullPage: false });
  await adminPage.close();
  console.log('Website layout, public tour, client and admin workspaces verified at 390, 900 and 1440 px');
} finally {
  await browser.close();
}
