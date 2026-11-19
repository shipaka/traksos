// TrakSOS: smoke-test the public interface in an actual Chromium browser.
// This complements the code/design gate with working clicks and responsive layout.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE_URL ?? 'http://localhost:8080';
const browser = await chromium.launch();
const assert = (condition, message) => { if (!condition) throw new Error(message); };

try {
  for (const width of [360, 390, 768, 1440, 1672]) {
    const context = await browser.newContext({ viewport: { width, height: width === 1672 ? 941 : 844 }, locale: 'ru-RU' });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(BASE + '/#/', { waitUntil: 'domcontentloaded' });
    await page.locator('.public-landing').waitFor({ timeout: 15000 });
    // TrakBot is opt-in and does not interrupt the public landing.
    const botLauncher = page.getByRole('button', { name: 'Открыть TrakBot' });
    assert(await botLauncher.isVisible(), width + 'px: TrakBot entry not visible');
    assert(await botLauncher.locator('.trakbot-mascot-truck').count() === 1,
      width + 'px: approved truck technician missing from launcher');
    assert(await page.locator('.trakbot-dock-panel').count() === 0,
      width + 'px: TrakBot opened automatically');
    await botLauncher.click();
    const botDialog = page.getByRole('dialog', { name: 'TrakBot — личный помощник' });
    await botDialog.waitFor();
    assert(await botDialog.locator('.trakbot-dock-guest-mascot .trakbot-mascot-truck').count() === 1,
      width + 'px: guest must see the same technician character');
    assert(await botDialog.getByRole('link', { name: 'Зарегистрироваться', exact: true }).count() === 1,
      width + 'px: mascot registration action is missing');
    assert(await botDialog.getByRole('link', { name: 'Войти', exact: true }).count() === 1,
      width + 'px: mascot login action is missing');
    assert(await botDialog.locator('nav a').count() === 2,
      width + 'px: guest bot must only offer login or registration');
    assert(await botDialog.getByRole('textbox').count() === 0 &&
      await botDialog.locator('.trakbot-dialog, .trakbot-typing, .trakbot-reactions-gallery').count() === 0,
      width + 'px: invitation must never become a private guest chat');
    const invite = await botDialog.boundingBox();
    assert(!!invite && invite.height < 350,
      width + 'px: guest invitation too tall for a small popup');
    // Real Chromium render, not an illustration: archive the exact open guest panel.
    if (width === 390 || width === 1672) {
      mkdirSync('e2e/shots/trakbot-proof', { recursive: true });
      await page.screenshot({
        path: `e2e/shots/trakbot-proof/guest-open-${width}.png`,
        fullPage: false, animations: 'disabled'
      });
    }
    await page.locator('.trakbot-dock-close').click();
    assert(await page.locator('.trakbot-dock-panel').count() === 0,
      width + 'px: TrakBot failed to close');
    assert(await page.locator('.trakbot-dock-panel').count() === 0,
      width + 'px: guest invitation reopened without a user action');


    const data = await page.evaluate(() => {
      const hero = document.querySelector('.public-hero-visual');
      const map = document.querySelector('.public-map-static');
      const header = document.querySelector('.guest-header-actions');
      const heroCss = hero && [getComputedStyle(hero).backgroundImage, getComputedStyle(hero,'::after').backgroundImage].join(' | ');
      const mapCss = map && getComputedStyle(map).backgroundImage;
      return {
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
        overflowSources: Array.from(document.querySelectorAll('body *')).flatMap((el) => {
          const box = el.getBoundingClientRect();
          const css = getComputedStyle(el);
          if (css.display === 'none' || css.visibility === 'hidden' ||
              box.width === 0 || box.height === 0 ||
              (box.right <= document.documentElement.clientWidth + 2 && box.left >= -2)) return [];
          return [{
            tag: el.tagName.toLowerCase(),
            selector: (el.id ? '#' + el.id : '') +
              (typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).join('.') : ''),
            left: Math.round(box.left), right: Math.round(box.right),
            width: Math.round(box.width), scrollWidth: el.scrollWidth,
            position: css.position, whiteSpace: css.whiteSpace
          }];
        }).sort((a, b) => (b.right - document.documentElement.clientWidth) -
                           (a.right - document.documentElement.clientWidth)).slice(0, 15),
        heroCss, mapCss,
        loginCount: header?.querySelectorAll('a[href="#/login"]').length ?? 0,
        registerCount: header?.querySelectorAll('a[href="#/register"]').length ?? 0,
        serviceTiles: document.querySelectorAll('.public-service-tile').length,
        tileIcons: document.querySelectorAll('.public-service-tile .public-service-icon svg').length,
      };
    });
    if (data.scrollWidth > data.clientWidth + 2) {
      mkdirSync('e2e/shots/overflow-proof', { recursive: true });
      await page.screenshot({
        path: `e2e/shots/overflow-proof/guest-${width}.png`,
        fullPage: true, animations: 'disabled'
      });
      console.error('Layout overflow offenders:', JSON.stringify(data.overflowSources, null, 2));
    }
    assert(data.scrollWidth <= data.clientWidth + 2,
      width + 'px: horizontal overflow ' + data.scrollWidth + '/' + data.clientWidth +
      ' offenders=' + JSON.stringify(data.overflowSources.slice(0, 5)));
    assert(data.loginCount === 1 && data.registerCount === 1,
      width + 'px: duplicated/missing login or registration buttons');
    assert(data.serviceTiles === 6, width + 'px: unexpected public services count');
    if (width >= 1200) {
      const benefits = await page.locator('.public-why-strip .public-benefit').allTextContents();
      assert(benefits.length === 3, 'approved desktop footer requires exactly 3 benefit columns');
      assert(benefits[0].includes('Надёжное сообщество'), 'first approved benefit missing');
      assert(benefits[1].includes('Быстрая помощь'), 'second approved benefit missing');
      assert(benefits[2].includes('Всё в одном месте'), 'third approved benefit missing');
    }
    assert(data.tileIcons === 6, width + 'px: technical icon missing from a public tile');
    assert(data.heroCss?.includes('tracksos-approved-scenic-hero') && !data.heroCss.includes('traksos-final-hero'),
      width + 'px: full approved Scania photo without baked carousel controls is not displayed');
    assert(data.mapCss?.includes('tracksos-approved-map'),
      width + 'px: approved regional map is not displayed');

    for (const name of [
      'tracksos-approved-scenic-hero.webp','tracksos-hero-rescue-hq.webp','tracksos-hero-service-hq.webp',
      'tracksos-partner-master-approved.webp','tracksos-partner-tow-approved.webp',
      'tracksos-partner-sto-approved.webp','tracksos-partner-insurer-approved.webp','tracksos-approved-map.webp'
    ]) {
      const check = await page.evaluate(async (asset) => {
        const res = await fetch('/' + asset);
        const blob = await res.blob();
        const img=await createImageBitmap(blob);
        const widthFloor=asset.includes('-hq')?1700:asset.includes('partner-')?1400:0;
        const bytesFloor=asset.includes('map')?10_000:asset.includes('-hq')?280_000:asset.includes('partner-')?180_000:50_000;
        return res.ok && blob.type.startsWith('image/') && blob.size>bytesFloor && img.width>=widthFloor;
      }, name);
      assert(check, width + 'px: approved image cannot be loaded: ' + name);
    }

    // Last approved 19 Nov layout has login in the desktop/mobile header;
    // the public hero is intentionally registration-first, without a duplicate login.
    await page.locator('.guest-header-actions').getByRole('link', { name: 'Войти', exact: true }).click();
    await page.getByRole('heading', { name: 'Вход по номеру телефона' }).waitFor();
    assert(await page.getByText('Помогите — нужна помощь').count() === 0,
      width + 'px: legacy help button is still displayed');
    await page.goto(BASE + '/#/');
    await page.locator('.public-actions').getByRole('button', { name: 'Зарегистрироваться', exact: true }).click();
    await page.getByRole('heading', { name: 'Регистрация в TrakSOS' }).waitFor();
    for (const name of ['Владелец / автопарк','Водитель автопарка']) {
      assert(await page.getByRole('button', { name }).isVisible(),
        width + 'px: client registration missing '+name);
    }
    assert(await page.getByRole('button', {name:'Мастер',exact:true}).count()===0,
      width+'px: partners must not be presented in client registration');

    await page.goto(BASE + '/#/join');
    await page.getByRole('heading', { name: 'Работать с TrakSOS' }).waitFor();
    const partner = ['Мастер','Эвакуаторщик','СТО','Страховой агент'];
    assert(await page.locator('.auth-desktop-form .opt').count()===4,
      width+'px: partner registration must have exactly 4 categories');
    for (const name of partner) {
      assert(await page.getByRole('button', {name:new RegExp('^'+name)}).isVisible(),
        width+'px: partner category missing '+name);
    }
    assert(await page.locator('.guest-partner-role[aria-pressed="true"]').count()===0,
      width+'px: a new partner must choose a role');
    await page.getByRole('button',{name:'Мастер',exact:true}).click();
    for (const name of ['Электрик','Автономщик','Гидравлика']) {
      assert(await page.getByRole('button', {name,exact:true}).isVisible(),
        width+'px: master specialization missing '+name);
    }
    const hydraulics = page.getByRole('button', { name: 'Гидравлика', exact: true });
    await hydraulics.click();
    assert(await hydraulics.getAttribute('aria-pressed') === 'true',
      width+'px: hydraulic mobile specialization did not select');
    const hybridRole = page.locator('.guest-partner-hybrid input[type="checkbox"]');
    assert(await hybridRole.isVisible(), width+'px: hybrid mobile master + station toggle missing');
    await hybridRole.check();
    assert(await hybridRole.isChecked(), width+'px: dual master + station toggle failed');
    await page.getByRole('button', { name: 'СТО', exact: true }).click();
    assert(await hybridRole.isChecked() && await hydraulics.isVisible(),
      width+'px: station cannot retain a separate mobile master hydraulic specialty');
    assert(await page.locator('.guest-partner-role').count() === 4,
      width+'px: hybrid partner unexpectedly creates a fifth public role card');
    await page.goto(BASE + '/#/company');
    await page.getByRole('heading', {name:'Компания TrakSOS'}).waitFor();
    await page.goto(BASE + '/#/offers');
    await page.getByRole('heading', {name:'Оферты и документы'}).waitFor();
    assert(errors.length === 0, width + 'px: browser errors: ' + errors.join('; '));
    console.log('OK: viewport ' + width + 'px, 6 cards, Company/Offers, 4 partner roles, no overflow');
    await context.close();
  }
} finally {
  await browser.close();
}
