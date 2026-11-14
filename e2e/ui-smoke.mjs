// TrackSOS: smoke-test the public interface in an actual Chromium browser.
// This complements the code/design gate with working clicks and responsive layout.
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL ?? 'http://localhost:8080';
const browser = await chromium.launch();
const assert = (condition, message) => { if (!condition) throw new Error(message); };

try {
  for (const width of [360, 390, 768, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 844 }, locale: 'ru-RU' });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(BASE + '/#/', { waitUntil: 'domcontentloaded' });
    await page.locator('.public-landing').waitFor({ timeout: 15000 });

    const data = await page.evaluate(() => {
      const hero = document.querySelector('.public-hero-visual');
      const map = document.querySelector('.public-map-static');
      const header = document.querySelector('.guest-header-actions');
      const heroCss = hero && getComputedStyle(hero).backgroundImage;
      const mapCss = map && getComputedStyle(map).backgroundImage;
      return {
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
        heroCss, mapCss,
        loginCount: header?.querySelectorAll('a[href="#/login"]').length ?? 0,
        registerCount: header?.querySelectorAll('a[href="#/register"]').length ?? 0,
        serviceTiles: document.querySelectorAll('.public-service-tile').length,
      };
    });
    assert(data.scrollWidth <= data.clientWidth + 2,
      width + 'px: horizontal overflow ' + data.scrollWidth + '/' + data.clientWidth);
    assert(data.loginCount === 1 && data.registerCount === 1,
      width + 'px: duplicated/missing login or registration buttons');
    assert(data.serviceTiles === 4, width + 'px: unexpected public services count');
    assert(data.heroCss?.includes('tracksos-approved-scania-r520'),
      width + 'px: approved truck artwork is not displayed');
    assert(data.mapCss?.includes('tracksos-approved-map'),
      width + 'px: approved regional map is not displayed');

    for (const name of ['tracksos-approved-scania-r520.webp','tracksos-approved-map.webp']) {
      const check = await page.evaluate(async (asset) => {
        const res = await fetch('/' + asset);
        const blob = await res.blob();
        return res.ok && blob.type.startsWith('image/') && blob.size > 10_000;
      }, name);
      assert(check, width + 'px: approved image cannot be loaded: ' + name);
    }

    // Main SOS action: it must open a real number-confirmation form.
    await page.getByRole('button', { name: 'Помощь в дороге' }).click();
    await page.getByRole('heading', { name: 'Помощь на дороге', exact: true }).waitFor();

    // Header entry points must work on every tested phone/desktop viewport.
    await page.goto(BASE + '/#/login');
    await page.getByRole('heading', { name: 'Вход по номеру телефона' }).waitFor();
    await page.goto(BASE + '/#/register');
    await page.getByRole('heading', { name: 'Регистрация в ТракSOS' }).waitFor();
    for (const label of ['Владелец / автопарк', 'Водитель автопарка',
      'Я мастер', 'Я эвакуаторщик', 'Я рембаза (сервис)',
      'Мастер и своя СТО', 'Я представитель страховой компании']) {
      assert(await page.getByRole('button', { name: label }).isVisible(),
        width + 'px: missing registration category: ' + label);
    }
    // Every publicly offered provider cabinet must work from /register,
    // not only via the separate /join link.
    for (const label of ['Я мастер', 'Я эвакуаторщик',
      'Я рембаза (сервис)', 'Мастер и своя СТО',
      'Я представитель страховой компании']) {
      await page.getByRole('button', { name: label }).click();
      await page.getByRole('heading', { name: 'Работать с ТракSOS' }).waitFor();
      assert(await page.getByRole('button', { name: label }).getAttribute('aria-pressed') === 'true',
        width + 'px: registration category not selected: ' + label);
      await page.getByRole('button', { name: 'Назад к выбору кабинета' }).click();
      await page.getByRole('heading', { name: 'Регистрация в ТракSOS' }).waitFor();
    }
    assert(errors.length === 0, width + 'px: browser errors: ' + errors.join('; '));
    console.log('OK: viewport ' + width + 'px, 4 directions, approved assets, SOS/login/register, no overflow');
    await context.close();
  }
} finally {
  await browser.close();
}
