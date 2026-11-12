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
    if (width === 390) {
      const overflow = await page.evaluate(() => ({
        viewport: document.documentElement.clientWidth,
        content: document.documentElement.scrollWidth,
      }));
      if (overflow.content > overflow.viewport + 2) {
        throw new Error('Mobile website has horizontal overflow: ' + JSON.stringify(overflow));
      }
    }
    if (width === 1440) {
      await page.getByRole('heading', { name: /Техпомощь и ремонт грузовиков/ }).waitFor();
      await page.getByRole('button', { name: 'Войти в кабинет' }).waitFor();
    } else if (width === 390) {
      await page.getByRole('button', { name: 'Войти в кабинет' }).waitFor();
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
      await page.getByRole('button', { name: 'Войти в кабинет' }).click();
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
      await page.goto(base + '/#/fleet/finances');
      await page.getByRole('heading', { name: 'Финансы автопарка' }).waitFor();
      await page.getByRole('combobox', { name: 'Статус оплаты' }).waitFor();
      await page.getByRole('button', { name: 'Скачать CSV' }).waitFor();
      await page.locator('.finance-toolbar').waitFor({ state: 'visible' });
      await page.locator('.toast').waitFor({ state: 'hidden', timeout: 8000 });
      if (screenshotDir) await page.screenshot({ path: screenshotDir + '/site-client-desktop.png', fullPage: false });
    }
    if (errors.length) throw new Error(name + ': ' + errors.join('; '));
    await page.close();
  }
  // Desktop admin is a workspace with a secondary section navigator, not a horizontal mobile ribbon.
  const adminPage = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'ru-RU' });
  await adminPage.goto(base + '/#/');
  await adminPage.getByRole('button', { name: 'Войти в кабинет' }).click();
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
  await adminPage.getByText('Загружаю…', { exact: true }).waitFor({ state: 'hidden', timeout: 15000 });
  await adminPage.locator('.toast').waitFor({ state: 'hidden', timeout: 8000 });
  if (process.argv[2]) await adminPage.screenshot({ path: process.argv[2] + '/site-admin-desktop.png', fullPage: false });
  await adminPage.close();
  // Small mobile BROWSER (not Android WebView): verify authenticated header and profile access.
  const smallWeb = await browser.newPage({ viewport: { width: 360, height: 780 }, locale: 'ru-RU' });
  await smallWeb.goto(base + '/#/');
  await smallWeb.getByRole('button', { name: 'Войти в кабинет' }).click();
  await smallWeb.locator('input[type=tel]').fill('+79990009125');
  await smallWeb.getByRole('button', { name: 'Получить код' }).click();
  const webHint = await smallWeb.getByText(/Тестовый режим: код/).textContent();
  const webCode = webHint.match(/[0-9]{4,6}/);
  if (!webCode) throw new Error('Mobile browser demo sign-in code unavailable');
  await smallWeb.locator('input[autocomplete=one-time-code]').fill(webCode[0]);
  await smallWeb.getByRole('button', { name: 'Войти', exact: true }).click();
  await smallWeb.locator('.website .top-profile-link').waitFor({ state: 'visible' });
  for (const width of [360, 390]) {
    await smallWeb.setViewportSize({ width, height: 780 });
    const measure = await smallWeb.evaluate(() => {
      const header = document.querySelector('.top');
      const actions = document.querySelector('.top > .row');
      const profile = document.querySelector('.top-profile-link');
      return {
        viewport: document.documentElement.clientWidth,
        content: document.documentElement.scrollWidth,
        header: header?.getBoundingClientRect().width ?? 0,
        actions: actions?.getBoundingClientRect().right ?? 0,
        profile: profile?.getBoundingClientRect().right ?? 0,
      };
    });
    if (measure.content > measure.viewport + 2 || measure.actions > measure.viewport + 1 ||
        measure.profile > measure.viewport + 1) {
      throw new Error('Mobile website header or labels exceed viewport: ' + JSON.stringify(measure));
    }
  }
  await smallWeb.getByRole('link', { name: 'Личный профиль' }).click();
  await smallWeb.getByRole('heading', { name: 'Профиль' }).waitFor();
  if (process.argv[2]) await smallWeb.screenshot({ path: process.argv[2] + '/site-mobile-profile.png', fullPage: false });
  await smallWeb.close();
  // Android WebView imitation: the familiar Profile icon must be the rightmost bottom tab.
  const mobileContext = await browser.newContext({ viewport: { width: 360, height: 780 }, locale: 'ru-RU' });
  await mobileContext.addInitScript(() => {
    window.TrakSOSNative = {
      isApp: () => true, setSession: () => {}, pushToken: () => '',
      performerOnline: () => {},
    };
  });
  const mobileApp = await mobileContext.newPage();
  await mobileApp.goto(base + '/#/');
  await mobileApp.getByRole('button', { name: 'Войти по номеру' }).click();
  await mobileApp.locator('input[type=tel]').fill('+79990009124');
  await mobileApp.getByRole('button', { name: 'Получить код' }).click();
  const appHint = await mobileApp.getByText(/Тестовый режим: код/).textContent();
  const appCode = appHint.match(/[0-9]{4,6}/);
  if (!appCode) throw new Error('Android demo code not shown');
  await mobileApp.locator('input[autocomplete=one-time-code]').fill(appCode[0]);
  await mobileApp.getByRole('button', { name: 'Войти', exact: true }).click();
  const nav = mobileApp.locator('.native-app .tabbar');
  await nav.waitFor({ state: 'visible' });
  const lastTab = nav.locator('a').last();
  if (await lastTab.textContent() !== '👤Профиль') throw new Error('Profile must be the rightmost Android tab');
  const clippedTabs = await nav.locator('a').evaluateAll((items) =>
    items.filter((item) => item.scrollWidth > item.clientWidth + 2).map((item) => item.textContent));
  if (clippedTabs.length) throw new Error('Bottom tab labels are clipped: ' + clippedTabs.join(', '));
  const appOverflow = await mobileApp.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    content: document.documentElement.scrollWidth,
  }));
  if (appOverflow.content > appOverflow.viewport + 2) {
    throw new Error('Android UI has horizontal overflow: ' + JSON.stringify(appOverflow));
  }
  await lastTab.click();
  await mobileApp.getByRole('heading', { name: 'Профиль' }).waitFor();
  if (await mobileApp.locator('.website-sidebar:visible').count()) throw new Error('Android shows desktop sidebar');
  if (process.argv[2]) await mobileApp.screenshot({ path: process.argv[2] + '/android-profile-nav.png', fullPage: false });
  await mobileContext.close();
  console.log('Website and Android navigation verified: profile last, no clipped desktop sidebar');
} finally {
  await browser.close();
}
