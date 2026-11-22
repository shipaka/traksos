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
    if(width>=900 && !nativePreview){
      await page.locator('.owner20-home').waitFor();
      check(await page.locator('.owner20-quick>a').count()===5,suffix+': Nov20 PC primary row missing');
      check(await page.locator('.owner20-features>a').count()===5,suffix+': Nov20 PC feature row missing');
      check(await page.locator('.owner20-bottom>.owner20-bottom-card').count()===4,suffix+': Nov20 PC lower cards missing');
      await verifyPage(page,suffix+':new-desktop-home');
      await page.screenshot({path:OUT+'/home-'+suffix+'.png',fullPage:true});
      await page.goto(BASE+'/#/register');
      await page.getByRole('heading',{name:'Регистрация в TrakSOS'}).waitFor();
      await verifyPage(page,suffix+':register');
      await page.goto(BASE+'/#/join');
      await page.getByRole('heading',{name:'Работать с TrakSOS'}).waitFor();
      await verifyPage(page,suffix+':join');
      check(!errors.length,suffix+': JS errors '+errors.join('; '));
      return;
    }
    await page.getByRole('heading', { name: /TrakSOS.*помощь.*в пути/i }).waitFor();
    check(await page.locator('.public-actions').getByRole('button', { name: 'Зарегистрироваться', exact: true }).isVisible(), 'Hero registration is not visible');
    check(await page.locator('.public-actions').getByRole('link', { name: 'Как это работает', exact: true }).isVisible(), 'Hero guide is not visible');
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
          pictureWidth:visual.width,pictureHeight:visual.height,pictureBottom:visual.bottom,
          paragraphTop:paragraph.top,actionsTop:actions.top,copyBottom:copy.bottom,
          carouselTop:carousel.top,carouselHeight:carousel.height };
      });
      if (nativePreview) {
        check(!await page.evaluate(() => document.documentElement.classList.contains('traksos-browser')),
          suffix + ': Android must not activate browser-only styling');
        // The approved native guest entry shows the complete truck photo above the
        // text and actions. Do not demand an obsolete full-bleed overlay.
        check(heroGeometry && heroGeometry.pictureWidth <= heroGeometry.heroWidth + 2 &&
          heroGeometry.pictureWidth >= heroGeometry.heroWidth * .75 &&
          heroGeometry.pictureHeight >= heroGeometry.pictureWidth / 2 - 3 &&
          heroGeometry.pictureHeight < heroGeometry.heroHeight &&
          heroGeometry.pictureBottom <= heroGeometry.paragraphTop + 2,
          suffix + ': native truck photo must be uncropped and separate from the text: ' + JSON.stringify(heroGeometry));
      } else {
        check(await page.evaluate(() => document.documentElement.classList.contains('traksos-browser')),
          suffix + ': regular Chrome must activate mobile browser styling');
        check(heroGeometry && heroGeometry.pictureWidth <= heroGeometry.heroWidth + 2 &&
          // The artwork stays at its original 2:1 aspect ratio. At 320px
          // the available 238px width gives a correct 119px tall photograph.
          heroGeometry.pictureHeight >= heroGeometry.pictureWidth / 2 - 3 &&
          heroGeometry.pictureHeight < heroGeometry.heroHeight,
          suffix + ': browser truck artwork must have a dedicated uncropped photo area: ' + JSON.stringify(heroGeometry));
        check(await page.locator('.guest-header-actions a[href="#/login"]').isVisible() &&
          await page.locator('.guest-header-actions a[href="#/register"]').isVisible(),
          suffix + ': both entry actions must be visible in the mobile header');
      }
      check(heroGeometry.actionsTop >= heroGeometry.paragraphTop-2,
        suffix + ': banner actions overlap its paragraph: ' + JSON.stringify(heroGeometry));
      check(heroGeometry.copyBottom < heroGeometry.carouselTop-2,
        suffix + ': carousel controls overlap text and actions: ' + JSON.stringify(heroGeometry));
      check(heroGeometry.carouselHeight>=44,
        suffix + ': hero carousel too small for touch: '+JSON.stringify(heroGeometry));
    }
    await verifyPage(page, suffix + ':home');
    // Regression for the 20 Nov owner screenshot: benefits/insurance were
    // inline text and enormous icons even while the overall page did not scroll.
    if (width < 900 && !nativePreview) {
      const publicLegibility = await page.evaluate(() => {
        const errors = [];
        const bounds = el => el?.getBoundingClientRect();
        const benefits = [...document.querySelectorAll('.public-why-strip > article.public-benefit')];
        if (benefits.length !== 3) errors.push('wrong number of benefit cards');
        for (const [i, item] of benefits.entries()) {
          const box = bounds(item);
          const icon = bounds(item.querySelector('.public-benefit-icon svg'));
          const title = bounds(item.querySelector('b'));
          const detail = bounds(item.querySelector('small'));
          if (!box || !icon || !title || !detail) {
            errors.push('benefit ' + i + ' missing layout element'); continue;
          }
          if (icon.width > 50 || icon.height > 50)
            errors.push('benefit ' + i + ' huge icon ' + icon.width + 'x' + icon.height);
          if (detail.top < title.bottom - 2)
            errors.push('benefit ' + i + ' title and description overlap');
          if (detail.left < title.left - 2 || detail.right > box.right + 2 ||
              title.right > box.right + 2 || icon.right > title.left + 2)
            errors.push('benefit ' + i + ' columns overlap or overflow');
          if (box.height < 95 || box.width < 200)
            errors.push('benefit ' + i + ' tiny card');
        }
        const insurance = document.querySelector('.public-track-insurance');
        const insuranceText = bounds(insurance?.querySelector('span'));
        const insuranceLabel = bounds(insurance?.querySelector('span b'));
        const insuranceDetail = bounds(insurance?.querySelector('span small'));
        const insuranceAction = bounds(insurance?.querySelector(':scope > strong'));
        const insuranceBox = bounds(insurance);
        if (!insuranceBox || !insuranceText || !insuranceLabel || !insuranceDetail || !insuranceAction)
          errors.push('insurance CTA incomplete');
        else if (insuranceDetail.top < insuranceLabel.bottom - 2 ||
                 insuranceAction.top < insuranceText.bottom - 2 ||
                 insuranceAction.right > insuranceBox.right + 2)
          errors.push('insurance CTA text concatenated/overlapping');
        const extras = [...document.querySelectorAll('.public-track-extras-grid > a.public-track-extra')];
        if (extras.length !== 3) errors.push('missing service links');
        for (const [i, link] of extras.entries()) {
          const b = bounds(link.querySelector('b'));
          const s = bounds(link.querySelector('small'));
          if (!b || !s || s.top < b.bottom - 2)
            errors.push('service link ' + i + ' inline/overlapping');
        }
        const map = document.querySelector('.public-map-static');
        if (!map || !getComputedStyle(map).backgroundImage.includes('radial-gradient') ||
            !getComputedStyle(map, '::after').content.includes('демонстрационная'))
          errors.push('blank or unlabelled mobile demo map');
        const logo = document.querySelector('.top .guest-approved-mark img');
        if (!logo || getComputedStyle(logo).mixBlendMode !== 'screen')
          errors.push('public brand crop with exposed dark background');
        return { count: benefits.length, issues: errors };
      });
      check(publicLegibility.count === 3 && !publicLegibility.issues.length,
        suffix + ': owner-reported mobile text/icon/branding defect: ' + JSON.stringify(publicLegibility));
    }
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
    // The latest 19 Nov public six tiles are the only approved public row.
    if(width<900 && !nativePreview){
      // A collapsed browser bot must be reachable without covering the
      // truck or signup controls; it lives below the actual page content.
      const layout=await page.evaluate(()=>{
        const hero=document.querySelector('.public-brand-hero')?.getBoundingClientRect();
        const dock=document.querySelector('.guest-app.guest-home > .trakbot-dock')?.getBoundingClientRect();
        const launcher=document.querySelector('.guest-app.guest-home > .trakbot-dock .trakbot-dock-launcher');
        return hero&&dock&&launcher?{
          heroBottom:hero.bottom,dockTop:dock.top,mode:getComputedStyle(launcher.closest('.trakbot-dock')).position
        }:null;
      });
      check(layout && layout.mode!=='fixed' && layout.dockTop>layout.heroBottom+8,
        suffix+': collapsed TrakBot overlays approved public photo and actions: '+JSON.stringify(layout));
      const launcher=page.getByRole('button',{name:'Открыть TrakBot'});
      await launcher.click();
      await page.getByRole('dialog',{name:'TrakBot — личный помощник'}).waitFor();
      await page.getByRole('button',{name:'Закрыть TrakBot'}).last().click();
    }
    const services = page.locator('.public-service-tiles > a');
    check(await services.count() === 6, suffix + ': six approved service cards required');
    const labels = await services.locator('b').allTextContents();
    check(JSON.stringify(labels) === JSON.stringify([
      'SOS', 'Эфир', 'СТО', 'ЭБУ', 'Запчасти', 'Страхование'
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

    // Realistic mocked SMS request: failure must remain visible; success
    // must open the code field. Never send a real message from CI.
    if (width === 390 && !nativePreview) {
      await page.getByRole('button', { name: 'Получить код' }).click();
      await page.getByRole('alert').getByText(/Введите номер полностью/).waitFor();
      let smsRejected = true;
      await page.route('**/api/auth/code', async route => {
        const response = smsRejected
          ? { error: 'sms_rejected', message: 'SMS.ru отклонил отправку.', requestId: 'e2e-sms-502' }
          : { phone: '+79990001234', sent: true };
        await route.fulfill({ status: smsRejected ? 502 : 200, contentType: 'application/json', body: JSON.stringify(response) });
      });
      await page.locator('.auth-desktop-form input[type=tel]').fill('+79990001234');
      await page.locator('.auth-desktop-form input[type=checkbox]').check();
      await page.getByRole('button', { name: 'Получить код' }).click();
      await page.getByRole('alert').getByText(/Код обращения: e2e-sms-502/).waitFor();
      check(await page.locator('input[autocomplete="one-time-code"]').count() === 0,
        suffix + ': SMS rejection must not pretend the code was sent');
      smsRejected = false;
      await page.getByRole('button', { name: 'Получить код' }).click();
      await page.locator('input[autocomplete="one-time-code"]').waitFor();
      await page.unroute('**/api/auth/code');
    }

    await page.goto(BASE + '/#/join');
    await page.getByRole('heading', { name: 'Работать с TrakSOS' }).waitFor();
    for (const name of ['Мастер', 'Эвакуаторщик', 'СТО', 'Страховой агент']) {
      check(await page.getByRole('button', { name: new RegExp('^'+name) }).isVisible(), 'Missing partner category: ' + name);
    }
    check(await page.locator('.auth-desktop-form .opt').count() === 4,
      suffix + ': partner registration must offer exactly 4 roles');
    check(await page.locator('.guest-partner-role').count() === 4,
      suffix + ': all four partner role options remain accessible');
    check(await page.getByRole('navigation',{name:'Тип регистрации'}).count() === 0,
      suffix + ': partner page repeats client registration tab');
    const partnerImage=page.locator(mobile ? '.guest-partner-mobile-preview' : '.auth-desktop-showcase-photo');
    if(await partnerImage.isVisible())
      check((await partnerImage.evaluate(el=>getComputedStyle(el).backgroundImage)).includes('tracksos-approved-hero-owner-20261119'),
        suffix + ': partner signup must start with the owner-approved 19 Nov truck artwork');
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
    if (width === 390 && !nativePreview) {
      await page.getByRole('button', { name: 'Войти', exact: true }).click();
      await page.getByRole('alert').getByText(/Введите номер телефона полностью/).waitFor();
      await page.locator('.auth-desktop-form input[type=tel]').fill('+79990001234');
      await page.locator('.auth-desktop-form input[type=password]').fill('Incorrect-E2E-Password');
      await page.route('**/api/auth/login', route => route.fulfill({
        status: 401, contentType: 'application/json',
        body: JSON.stringify({ error: 'invalid_login', message: 'Неверный пароль', requestId: 'e2e-login-401' })
      }));
      await page.getByRole('button', { name: 'Войти', exact: true }).click();
      await page.getByRole('alert').getByText(/Код обращения: e2e-login-401/).waitFor();
      await page.unroute('**/api/auth/login');
    }
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
      await page.getByRole('navigation',{name:'Возможности TrakSOS'}).getByRole('link',{name:'О платформе'}).click();
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
