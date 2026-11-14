import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const BASE = process.env.BASE_URL ?? 'http://localhost:8080';
const OUT = process.env.SHOTS_DIR ?? 'e2e/public-shots';
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({ headless: true });
const failures = [];
const results = [];

function check(value, message) {
  if (!value) throw new Error(message);
}

async function verifyPage(page, label) {
  await page.locator('.app').waitFor();
  const layout = await page.evaluate(() => {
    const viewport = document.documentElement.clientWidth;
    const overflow = document.documentElement.scrollWidth - viewport;
    const offending = [...document.querySelectorAll('input,button,a,section,main,header')]
      .filter(el => { const r = el.getBoundingClientRect(); return r.width > 0 && (r.right > viewport + 2 || r.left < -2); })
      .slice(0, 8).map(el => [el.tagName, el.className, Math.round(el.getBoundingClientRect().right)]);
    return { viewport, overflow, offending };
  });
  check(layout.overflow <= 2, label + ': horizontal scroll: ' + JSON.stringify(layout));
  check(layout.offending.length === 0, label + ': offscreen interactive/layout elements: ' + JSON.stringify(layout));
  results.push({ label, ...layout });
}

async function run(width, height, mobile) {
  const context = await browser.newContext({
    viewport: { width, height }, deviceScaleFactor: 1, isMobile: mobile,
    hasTouch: mobile, locale: 'ru-RU'
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const suffix = width + 'x' + height;
  try {
    await page.goto(BASE + '/#/', { waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: /Помощь грузовикам.*24\/7/i }).waitFor();
    check(await page.getByRole('button', { name: 'Помощь в дороге' }).isVisible(), 'SOS not visible');
    check(await page.getByRole('button', { name: 'Как это работает?' }).isVisible(), 'How it works not visible');
    const image = await page.locator('.public-hero-visual').evaluate(async el => {
      const bg = getComputedStyle(el).backgroundImage;
      const match = bg.match(/url\(["']?([^"')]+)["']?\)/);
      if (!match) return { ok: false, bg };
      const img = new Image();
      img.src = match[1];
      await img.decode().catch(() => {});
      return { ok: img.naturalWidth > 0, width: img.naturalWidth, height: img.naturalHeight };
    });
    check(image.ok, 'Hero image failed to load: ' + JSON.stringify(image));
    if (mobile && width <= 430) {
      const heroGeometry = await page.evaluate(() => {
        const visual = document.querySelector('.public-hero-visual')?.getBoundingClientRect();
        const paragraph = document.querySelector('.public-hero-copy > p')?.getBoundingClientRect();
        const actions = document.querySelector('.public-actions')?.getBoundingClientRect();
        if (!visual || !paragraph || !actions) return null;
        return { pictureTop: visual.top, pictureBottom: visual.bottom,
          paragraphTop: paragraph.top, actionsTop: actions.top, pictureWidth: visual.width };
      });
      check(heroGeometry && heroGeometry.pictureWidth >= width * .75,
        suffix + ': picture shrunk into a narrow column: ' + JSON.stringify(heroGeometry));
      check(heroGeometry.pictureBottom <= heroGeometry.paragraphTop + 2,
        suffix + ': approved artwork must be above description on mobile: ' + JSON.stringify(heroGeometry));
      check(heroGeometry.actionsTop >= heroGeometry.paragraphTop - 2,
        suffix + ': hero buttons overlap title or artwork: ' + JSON.stringify(heroGeometry));
    }
    await verifyPage(page, suffix + ':home');
    await page.screenshot({ path: OUT + '/home-' + suffix + '.png', fullPage: true });

    await page.goto(BASE + '/#/register');
    await page.getByRole('heading', { name: /Регистрация в ТракSOS/ }).waitFor();
    check(await page.getByRole('button', { name: 'Владелец / автопарк' }).isVisible(), 'Owner option missing');
    const driver = page.getByRole('button', { name: 'Водитель автопарка' });
    check(await driver.isVisible(), 'Driver option missing');
    await driver.click();
    check(await driver.getAttribute('aria-pressed') === 'true', 'Driver option not selected');
    check(await page.getByText(/владелец сможет привязать/).isVisible(), 'Driver invite text missing');
    await verifyPage(page, suffix + ':register');
    await page.screenshot({ path: OUT + '/register-' + suffix + '.png', fullPage: true });

    await page.goto(BASE + '/#/join');
    await page.getByRole('heading', { name: 'Работать с ТракSOS' }).waitFor();
    for (const name of [
      'Я мастер', 'Я эвакуаторщик', 'Я рембаза (сервис)',
      'Мастер и своя СТО', 'Я представитель страховой компании'
    ]) check(await page.getByRole('button', { name: new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }).isVisible(), 'Missing performer category: ' + name);
    await verifyPage(page, suffix + ':join');
    await page.screenshot({ path: OUT + '/join-' + suffix + '.png', fullPage: true });

    await page.goto(BASE + '/#/login');
    await page.getByRole('heading', { name: 'Вход по номеру телефона' }).waitFor();
    check(await page.locator('input[type=password]').isVisible(), 'Password login unavailable');
    await verifyPage(page, suffix + ':login');
    await page.screenshot({ path: OUT + '/login-' + suffix + '.png', fullPage: true });
    check(errors.length === 0, 'JS exceptions: ' + errors.join(' | '));
  } catch (e) {
    failures.push({ viewport: suffix, error: e.message });
  } finally {
    await context.close();
  }
}
try {
  for (const [w, h, mobile] of [
    [320, 720, true], [360, 780, true], [390, 844, true], [430, 932, true],
    [768, 1024, true], [1024, 768, false], [1440, 900, false]
  ]) await run(w, h, mobile);
} finally {
  await browser.close();
}
console.log(JSON.stringify({ pagesChecked: results.length, failures, results }, null, 2));
if (failures.length) process.exitCode = 1;
