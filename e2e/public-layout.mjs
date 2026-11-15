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

async function run(width, height, mobile, nativePreview = false) {
  const context = await browser.newContext({
    viewport: { width, height }, deviceScaleFactor: 1, isMobile: mobile,
    hasTouch: mobile, locale: 'ru-RU'
  });
  const page = await context.newPage();
  if (nativePreview) await page.addInitScript(() => {
    window.TrakSOSNative = {
      isApp: () => true, setSession: () => {}, pushToken: () => '',
      performerOnline: () => {}, appLockEnabled: () => false,
      setAppLockEnabled: () => false
    };
  });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const suffix = width + 'x' + height + (nativePreview ? '-android-webview' : '');
  try {
    await page.goto(BASE + '/#/', { waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: /TrakSOS.*помощь.*в пути/i }).waitFor();
    check(await page.locator('.public-actions').getByRole('button', { name: 'Войти', exact: true }).isVisible(), 'Hero login is not visible');
    check(await page.locator('.public-actions').getByRole('button', { name: 'Регистрация', exact: true }).isVisible(), 'Hero registration is not visible');
    const image = await page.locator('.public-hero-visual').evaluate(async el => {
      const bg = [getComputedStyle(el).backgroundImage, getComputedStyle(el,'::after').backgroundImage].join(' | ');
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
        const hero = document.querySelector('.public-brand-hero')?.getBoundingClientRect();
        const visual = document.querySelector('.public-hero-visual')?.getBoundingClientRect();
        const copy = document.querySelector('.public-hero-copy')?.getBoundingClientRect();
        const paragraph = document.querySelector('.public-hero-copy > p')?.getBoundingClientRect();
        const actions = document.querySelector('.public-actions')?.getBoundingClientRect();
        const carousel = document.querySelector('.public-hero-carousel')?.getBoundingClientRect();
        if (!hero || !visual || !paragraph || !actions || !carousel || !copy) return null;
        return {heroWidth:hero.width,heroHeight:hero.height,
          pictureWidth:visual.width,pictureHeight:visual.height,
          paragraphTop:paragraph.top,actionsTop:actions.top,copyBottom:copy.bottom,
          carouselTop:carousel.top,carouselHeight:carousel.height };
      });
      check(heroGeometry && Math.abs(heroGeometry.heroWidth-heroGeometry.pictureWidth)<3 &&
        Math.abs(heroGeometry.heroHeight-heroGeometry.pictureHeight)<3,
        suffix + ': artwork must cover the entire banner behind copy: ' + JSON.stringify(heroGeometry));
      check(heroGeometry.actionsTop >= heroGeometry.paragraphTop-2,
        suffix + ': banner actions overlap its paragraph: ' + JSON.stringify(heroGeometry));
      check(heroGeometry.copyBottom < heroGeometry.carouselTop-2,
        suffix + ': carousel controls overlap text and actions: ' + JSON.stringify(heroGeometry));
      check(heroGeometry.carouselHeight>=44,
        suffix + ': hero carousel too small for touch: '+JSON.stringify(heroGeometry));
    }
    await verifyPage(page, suffix + ':home');
    if (mobile && width <= 430) {
      const nav = page.locator('.track-guest-tabbar');
      const navCount = await nav.locator('a').count();
      const vectorCount = await nav.locator('a svg[aria-hidden="true"]').count();
      check(navCount === 4 && vectorCount === 4,
        suffix + ': all four authorized guest tabs must have vector icons, got ' + navCount + '/' + vectorCount);
      for(const forbidden of ['Заявки','Помощь','Запчасти']) {
        check(!(await nav.getByText(forbidden,{exact:true}).count()), suffix + ': protected tab visible before sign-in: '+forbidden);
      }
    }
    // All six approved photographic services must remain in their exact order.
    const services = page.locator('.public-service-tiles > a');
    check(await services.count() === 6, suffix + ': six approved service cards required');
    const labels = await services.locator('b').allTextContents();
    check(JSON.stringify(labels) === JSON.stringify([
      'Эвакуация', 'Выездной мастер', 'СТО и сервисы',
      'Страхование', 'Запчасти', 'Консультации'
    ]), suffix + ': service card order changed: ' + JSON.stringify(labels));
    await page.screenshot({ path: OUT + '/home-' + suffix + '.png', fullPage: true });

    await page.goto(BASE + '/#/register');
    await page.getByRole('heading', { name: /Регистрация в TrakSOS/ }).waitFor();
    check(await page.getByRole('button', { name: 'Владелец / автопарк' }).isVisible(), 'Owner option missing');
    const driver = page.getByRole('button', { name: 'Водитель автопарка' });
    check(await driver.isVisible(), 'Driver option missing');
    await driver.click();
    check(await driver.getAttribute('aria-pressed') === 'true', 'Driver option not selected');
    check(await page.getByText(/владелец сможет привязать/).isVisible(), 'Driver invite text missing');
    await verifyPage(page, suffix + ':register');
    await page.screenshot({ path: OUT + '/register-' + suffix + '.png', fullPage: true });

    await page.goto(BASE + '/#/join');
    await page.getByRole('heading', { name: 'Работать с TrakSOS' }).waitFor();
    for (const name of ['Мастер', 'Эвакуаторщик', 'СТО', 'Страховой агент']) {
      check(await page.getByRole('button', { name: new RegExp('^'+name) }).isVisible(), 'Missing partner category: ' + name);
    }
    check(await page.locator('.auth-desktop-form .opt').count() === 4,
      suffix + ': partner registration must offer exactly 4 roles');
    check(await page.locator('.guest-partner-role').count() === 4,
      suffix + ': all partner roles must use photographic cards');
    check(await page.getByRole('navigation',{name:'Тип регистрации'}).count() === 0,
      suffix + ': partner page repeats client registration tab');
    const partnerImage=page.locator(mobile ? '.guest-partner-mobile-preview' : '.auth-desktop-showcase-photo');
    if(await partnerImage.isVisible())
      check((await partnerImage.evaluate(el=>getComputedStyle(el).backgroundImage)).includes('tracksos-approved-scania-r520'),
        suffix + ': partner signup must start with the neutral Scania artwork');
    check(await page.locator('.guest-partner-role[aria-pressed="true"]').count()===0,
      suffix + ': default partner role must not be preselected');
    await page.getByRole('button',{name:'Мастер',exact:true}).click();
    check(await page.getByRole('button',{name:'Автономщик',exact:true}).isVisible(),
      suffix + ': specializations not visible after selecting master');
    await verifyPage(page, suffix + ':join');
    await page.screenshot({ path: OUT + '/join-' + suffix + '.png', fullPage: true });

    await page.goto(BASE + '/#/login');
    await page.getByRole('heading', { name: 'Вход по номеру телефона' }).waitFor();
    check(await page.locator('input[type=password]').isVisible(), 'Password login unavailable');
    await verifyPage(page, suffix + ':login');
    await page.screenshot({ path: OUT + '/login-' + suffix + '.png', fullPage: true });

    // Guest auth return/re-entry regression for the approved final design.
    const mainTitle = page.getByRole('heading', { name: /TrakSOS.*помощь.*в пути/i });
    const returnedHome = async (context) => {
      await mainTitle.waitFor();
      check(new URL(page.url()).hash === '#/', context + ': stale auth URL after Back');
    };
    await page.getByRole('button', { name: 'Назад', exact: true }).click();
    await returnedHome('login');
    await page.locator('.guest-header-actions').getByRole('link', { name: 'Войти', exact: true }).click();
    await page.locator('input[type=password]').waitFor();
    await page.getByRole('button', { name: 'Забыли пароль?' }).click();
    await page.getByRole('heading', { name: 'Восстановить пароль' }).waitFor();
    await page.getByRole('button', { name: 'Назад', exact: true }).click();
    await returnedHome('reset');
    await page.locator('.guest-header-actions').getByRole('link', { name: 'Войти', exact: true }).click();
    await page.locator('input[type=password]').waitFor();
    await page.goto(BASE + '/#/');
    await page.locator('.guest-header-actions').getByRole('link', { name: 'Зарегистрироваться', exact: true }).click();
    await page.getByRole('heading', { name: 'Регистрация в TrakSOS' }).waitFor();
    await page.getByRole('button', { name: 'Назад', exact: true }).click();
    await returnedHome('register');
    await page.getByRole('link', { name: 'Зарегистрироваться', exact: true }).click();
    await page.getByRole('heading', { name: 'Регистрация в TrakSOS' }).waitFor();
    check(await page.getByRole('button', { name: 'Мастер', exact: true }).count()===0,
      suffix + ': partner registration must be separate from clients');
    await page.getByRole('button', { name: 'Назад', exact: true }).click();
    await returnedHome('register-without-partners');

    await page.goto(BASE + '/#/join');
    await page.getByRole('heading', { name: 'Работать с TrakSOS' }).waitFor();
    await page.getByRole('button', { name: 'Назад', exact: true }).click();
    await returnedHome('join');
    await page.locator('.guest-header-actions').getByRole('link', { name: 'Войти', exact: true }).click();
    await page.locator('input[type=password]').waitFor();

    // The desktop header shows a real expandable catalogue, not a dead link.
    if (width >= 900) {
      await page.goto(BASE + '/#/');
      const catalogue = page.locator('.guest-site-nav .guest-nav-group').first();
      await catalogue.locator('summary').click();
      await catalogue.locator('a[href="#/explore/van"]').click();
      await page.getByRole('heading', { name: 'Выездной мастер' }).waitFor();
      await verifyPage(page, suffix + ':catalogue');
    } else {
      await page.goto(BASE + '/#/');
      await page.locator('.guest-mobile-catalog > summary').click();
      await page.getByRole('navigation',{name:'Каталог услуг TrakSOS'}).getByRole('link',{name:'Компания'}).click();
      await page.getByRole('heading',{name:'Компания TrakSOS'}).waitFor();
      await verifyPage(page, suffix + ':company');
    }
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
  // Same React/CSS inside Android WebView bridge: finger targets, navigation
  // and hero copy must remain consistent with mobile Chrome.
  await run(390, 844, true, true);
} finally {
  await browser.close();
}
console.log(JSON.stringify({ pagesChecked: results.length, failures, results }, null, 2));
if (failures.length) process.exitCode = 1;
