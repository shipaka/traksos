// TrakSOS: smoke-test the public interface in an actual Chromium browser.
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
      const heroCss = hero && [getComputedStyle(hero).backgroundImage, getComputedStyle(hero,'::after').backgroundImage].join(' | ');
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
    assert(data.serviceTiles === 6, width + 'px: unexpected public services count');
    assert(data.heroCss?.includes('tracksos-approved-scenic-hero') && !data.heroCss.includes('traksos-final-hero'),
      width + 'px: full approved Scania photo without baked carousel controls is not displayed');
    assert(data.mapCss?.includes('tracksos-approved-map'),
      width + 'px: approved regional map is not displayed');

    for (const name of ['tracksos-approved-scenic-hero.webp','tracksos-photo-tow.webp','tracksos-photo-sto.webp','tracksos-approved-map.webp']) {
      const check = await page.evaluate(async (asset) => {
        const res = await fetch('/' + asset);
        const blob = await res.blob();
        return res.ok && blob.type.startsWith('image/') && blob.size > (asset.includes('map') ? 10_000 : 50_000);
      }, name);
      assert(check, width + 'px: approved image cannot be loaded: ' + name);
    }

    // Two approved hero CTAs: login and client registration, no forced SOS flow.
    await page.locator('.public-actions').getByRole('button', { name: 'Войти', exact: true }).click();
    await page.getByRole('heading', { name: 'Вход по номеру телефона' }).waitFor();
    assert(await page.getByText('Помогите — нужна помощь').count() === 0,
      width + 'px: legacy help button is still displayed');
    await page.goto(BASE + '/#/');
    await page.locator('.public-actions').getByRole('button', { name: 'Регистрация', exact: true }).click();
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
    for (const name of ['Электрик','Автономщик']) {
      assert(await page.getByRole('button', {name,exact:true}).isVisible(),
        width+'px: master specialization missing '+name);
    }
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
