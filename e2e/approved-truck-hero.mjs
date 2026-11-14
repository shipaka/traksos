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
    await page.screenshot({path: 'e2e/shots/approved-truck/client-' + width + '.png', fullPage: true});
    await page.locator('a.desktop-primary-action[href="#/sos"]').click();
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
    const info = await art.evaluate(async el => {
      const cs = getComputedStyle(el);
      const layer = getComputedStyle(el, '::after');
      const picture = [cs.backgroundImage, layer.backgroundImage]
        .find(x => x.includes('tracksos-approved-scenic-hero'));
      const visible = el.getBoundingClientRect().width > 100 && el.getBoundingClientRect().height > 100;
      return {visible, picture, fit: [cs.backgroundSize, layer.backgroundSize].join(',')};
    });
    if (!info.visible || !info.picture || !info.fit.includes('contain'))
      throw Error(width + 'px public Scania artwork missing or cropped: ' + JSON.stringify(info));
    await p.screenshot({path:'e2e/shots/approved-truck/public-' + width + '.png',fullPage:true});
    await guest.close();
  }
} finally {
  await browser.close();
}
console.log('Verified real Nov 14 photo cards, full-image hero, SOS branching and public art at 390 and 1440px');
