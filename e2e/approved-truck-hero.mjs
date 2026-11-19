// Canonical Nov 14 real-browser audit: truck photos, SOS route and public site.
// Never validate the obsolete demo direction grid or require a clipped hero.
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:8080';
if (!['localhost', '127.0.0.1'].includes(new URL(BASE).hostname))
  throw Error('Approved visual audit must run on the local CI server');
const login = await fetch(BASE + '/api/auth/login', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ phone: '+79990000141', password: 'Test-Role-Only-2026!' })
});
if (!login.ok) throw Error('Local synthetic owner fixture unavailable: ' + login.status);
const { token } = await login.json();
await mkdir('e2e/shots/approved-truck', {recursive: true});
const browser = await chromium.launch();
try {
  for (const width of [390, 1440]) {
    const ctx = await browser.newContext({ viewport: { width, height: 900 }, locale: 'ru-RU' });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(t => {
      localStorage.setItem('traksos.token', t);
      localStorage.setItem('traksos.mode', 'client');
    }, token);
    await page.goto(BASE + '/#/', {waitUntil: 'domcontentloaded'});
    if(width<900){
      const mobile = page.locator('.and19-client');
      await mobile.waitFor({state:'visible'});
      const image=mobile.locator('.and19-cover img');
      const state=await image.evaluate(i=>({
        loaded:i.complete&&i.naturalWidth>100,
        visible:getComputedStyle(i).display!=='none',
        viewport:document.documentElement.clientWidth,
        content:document.documentElement.scrollWidth
      }));
      if(!state.loaded||!state.visible||state.content>state.viewport+3)
        throw Error(width+'px approved Android scene invalid: '+JSON.stringify(state));
      if(await mobile.locator('.and19-services>a').count()!==4)
        throw Error(width+'px Android missing four help services');
    }else{
    const hero = page.locator('.client-dashboard .desktop-hero');
    await hero.waitFor();
    const img = hero.locator('img.client-hero-scania');
    const check = await img.evaluate(i => ({
      loaded: i.complete && i.naturalWidth > 100,
      sourceWidth: i.naturalWidth,
      sourceHeight: i.naturalHeight,
      fit: getComputedStyle(i).objectFit,
      displayed: getComputedStyle(i).display !== 'none',
      imageRect: i.getBoundingClientRect().toJSON(),
      heroRect: i.closest('.desktop-hero')?.getBoundingClientRect().toJSON(),
      viewport: document.documentElement.clientWidth,
      contentWidth: document.documentElement.scrollWidth,
    }));
    if (!check.loaded || !check.displayed || check.fit !== 'contain')
      throw Error(width + 'px truck must be fully visible: ' + JSON.stringify(check));
    if (check.contentWidth > check.viewport + 3)
      throw Error(width + 'px horizontal overflow: ' + JSON.stringify(check));
    if (check.imageRect.left < check.heroRect.left - 3 || check.imageRect.right > check.heroRect.right + 3)
      throw Error(width + 'px truck image outside hero: ' + JSON.stringify(check));
    const cards = page.locator('.client-dashboard .desktop-quick-card');
    if (await cards.count() !== 4) throw Error(width + 'px missing four help cards');
    for (const [i, key] of ['master', 'tow', 'sto', 'consult'].entries()) {
      const photo = await cards.nth(i).evaluate(e => getComputedStyle(e).backgroundImage);
      if (!photo.includes('tracksos-photo-' + key))
        throw Error(width + 'px service photo is missing for ' + key);
    }
    if (check.sourceWidth < 1200)
      console.warn('ASSET QUALITY BLOCKER: desktop landscape truck photo is only ' +
        check.sourceWidth + 'x' + check.sourceHeight + '; replace with high-resolution approved artwork before release');
    }
    await page.screenshot({path: 'e2e/shots/approved-truck/client-' + width + '.png', fullPage: true});
    await page.locator(width<900 ? '.and19-sos' : 'a.desktop-primary-action[href="#/sos"]').click();
    await page.locator('.client-sos-choices').waitFor();
    if (await page.locator('.client-sos-choice').count() !== 3)
      throw Error(width + 'px approved SOS must have exactly three main directions');
    await page.getByRole('button', {name: /Выездной мастер/}).click();
    if (await page.locator('.client-sos-specialty').count() !== 5)
      throw Error(width + 'px master must expand five specialties');
    if (errors.length) throw Error(width + 'px client JS exception: ' + errors.join('; '));
    await ctx.close();

    const guest = await browser.newContext({ viewport: {width,height:900}, locale:'ru-RU' });
    const p = await guest.newPage();
    await p.goto(BASE + '/#/', {waitUntil:'domcontentloaded'});
    const art = p.locator('.public-landing .public-hero-visual');
    await art.waitFor();
    const info = await art.evaluate(el => {
      const cs = getComputedStyle(el);
      const bounds = el.getBoundingClientRect();
      const hero = el.closest('.public-brand-hero')?.getBoundingClientRect();
      return {photo:cs.backgroundImage, fit:cs.backgroundSize,
        visible:bounds.width>100&&bounds.height>100,
        fullBleed:!!hero&&Math.abs(hero.width-bounds.width)<3&&Math.abs(hero.height-bounds.height)<3};
    });
    // The locked desktop keeps a full-bleed scene. Regular mobile browsers
    // intentionally reserve a separate, uncropped image above the text.
    if (!info.visible || (width >= 900 && !info.fullBleed) ||
        (width < 900 && (info.fullBleed || info.fit !== 'contain')) ||
        !info.photo.includes('tracksos-approved-scenic-hero') ||
        info.photo.includes('traksos-final-hero'))
      throw Error(width + 'px public Scania photograph is missing or has the wrong layout: ' + JSON.stringify(info));
    await p.getByRole('button',{name:'Следующее фото'}).click();
    const rescuePhoto=await art.evaluate(el=>getComputedStyle(el).backgroundImage);
    if(!rescuePhoto.includes('tracksos-hero-rescue-hq') ||
       !await p.getByRole('heading',{name:/Эвакуация грузовиков/}).count())
      throw Error(width+'px: tow scene must change both photograph and headline');
    await p.getByRole('button',{name:'Следующее фото'}).click();
    const stoPhoto=await art.evaluate(el=>getComputedStyle(el).backgroundImage);
    if(!stoPhoto.includes('tracksos-hero-service-hq') ||
       !await p.getByRole('heading',{name:/Ремонт и запись в СТО/}).count())
      throw Error(width+'px: STO scene must change both photograph and headline');
    await p.getByRole('button',{name:/Показать фото 1:/}).click();
    await p.screenshot({path:'e2e/shots/approved-truck/public-' + width + '.png',fullPage:true});
    await guest.close();
  }
} finally {
  await browser.close();
}
console.log('Verified client Scania photo, real full-bleed three-scene guest hero, SOS and public photo cards at 390 and 1440px');
