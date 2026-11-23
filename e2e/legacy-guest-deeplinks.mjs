// PR #274: legacy guest URLs never resurrect old public tours or a previous
// service selection. Actual Chromium and local test server; no mock accounts.
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:8080';
if (!['127.0.0.1', 'localhost'].includes(new URL(BASE).hostname))
  throw new Error('Legacy guest deep-link test must use a local CI server');

const browser = await chromium.launch();
const assert = (value, reason) => { if (!value) throw new Error(reason); };
await mkdir('e2e/shots/legacy-guest', {recursive:true});

try {
  for (const [width, height] of [[390, 844], [1440, 900]]) {
    const context = await browser.newContext({viewport:{width,height},locale:'ru-RU'});
    try {
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      const landing = width >= 900 ? '.owner20-home' : '.public-landing';
      const open = async path => {
        await page.goto(BASE + '/#/' + path, {waitUntil:'domcontentloaded'});
        await page.getByRole('heading', {name:'Вход по номеру телефона'}).waitFor();
      };
      const preloadAbandonedChoice = async () => {
        await page.goto(BASE + '/#/', {waitUntil:'domcontentloaded'});
        await page.locator(landing).waitFor({state:'visible'});
        await page.evaluate(() => {
          sessionStorage.setItem('traksos.pendingLandingAction','tow');
          sessionStorage.setItem('traksos.pendingCatalogChoice','tow/accident');
        });
      };
      // A saved "tow" choice can come from the same browser tab. Opening an
      // obsolete bookmark must not send a subsequent login to a tow booking.
      for (const path of ['help','explore','explore/guide','explore/pricing',
        'explore/unknown-feature','explore/old-marketing-page','unknown-legacy-screen']) {
        await preloadAbandonedChoice();
        await open(path);
        await page.waitForFunction(() =>
          sessionStorage.getItem('traksos.pendingLandingAction') === null &&
          sessionStorage.getItem('traksos.pendingCatalogChoice') === null);
        assert(await page.locator('main.guest-explore, .guest-explore-hero').count()===0,
          width+'px: old public tour at #/'+path);
        assert(await page.getByText('Вы выбрали:',{exact:false}).count()===0,
          width+'px: legacy URL advertises a service at #/'+path);
        assert(await page.locator('input[type="tel"], input[autocomplete="tel"]').count()>0,
          width+'px: guest #/'+path+' has no real sign-in input');
      }

      // Public about and legal-index routes must remain readable while
      // clearing unrelated abandoned service intent. No login gate or
      // accidental redirect is allowed on these approved public pages.
      for (const [path,heading] of [
        ['company','Компания TrakSOS'],
        ['offers','Оферты и документы'],
      ]) {
        await preloadAbandonedChoice();
        await page.goto(BASE+'/#/'+path,{waitUntil:'domcontentloaded'});
        await page.getByRole('heading',{name:heading,exact:true}).waitFor();
        await page.waitForFunction(() =>
          sessionStorage.getItem('traksos.pendingLandingAction')===null &&
          sessionStorage.getItem('traksos.pendingCatalogChoice')===null);
        assert(await page.locator('main.guest-info-page').count()===1,
          width+'px: public informational page replaced: #/'+path);
        assert(await page.locator('main.guest-explore').count()===0,
          width+'px: obsolete public tour at #/'+path);
      }
      // Partner onboarding must not inherit a previously selected
      // CUSTOMER booking, even when the visitor opens #/join directly.
      await preloadAbandonedChoice();
      await page.goto(BASE+'/#/join',{waitUntil:'domcontentloaded'});
      await page.getByRole('heading',{name:'Работать с TrakSOS'}).waitFor();
      await page.waitForFunction(() =>
        sessionStorage.getItem('traksos.pendingLandingAction')===null &&
        sessionStorage.getItem('traksos.pendingCatalogChoice')===null);
      assert(await page.locator('.guest-partner-role').count()===4,
        width+'px: partner registration lost its four approved choices');

      // The old #/privacy bookmark must still show the currently published
      // PUBLIC policy, not an unrelated registration screen or the
      // authenticated personal-data management form.
      await preloadAbandonedChoice();
      await page.goto(BASE+'/#/privacy',{waitUntil:'domcontentloaded'});
      await page.locator('main.public-offer-page').waitFor({state:'visible'});
      await page.waitForFunction(() =>
        sessionStorage.getItem('traksos.pendingLandingAction')===null &&
        sessionStorage.getItem('traksos.pendingCatalogChoice')===null);
      assert(await page.locator('main.auth-desktop-layout').count()===0,
        width+'px: public privacy bookmark unexpectedly opens sign-in');
      assert(await page.locator('main.guest-explore').count()===0,
        width+'px: old public tour at #/privacy');

      if (width>=900) {
        // Secondary public pages use the shared header, NOT the owner 617
        // home header. Its menus must not remain open over legal documents.
        await page.goto(BASE+'/#/company',{waitUntil:'domcontentloaded'});
        await page.getByRole('heading',{name:'Компания TrakSOS',exact:true}).waitFor();
        const menus=page.locator('.guest-site-nav details.guest-nav-group');
        assert(await menus.count()===4,
          'Desktop secondary public header lost an approved navigation group');
        const platform=menus.nth(0);
        const services=menus.nth(1);
        await platform.locator('summary').click();
        assert(await platform.evaluate(el=>el.open),
          'Desktop secondary header Platform disclosure did not open');
        await services.locator('summary').click();
        assert(!await platform.evaluate(el=>el.open) &&
          await services.evaluate(el=>el.open),
          'Two secondary public header menus are open simultaneously');
        await page.keyboard.press('Escape');
        assert(!await services.evaluate(el=>el.open),
          'Escape left a secondary public header flyout hanging');
        assert(await services.locator('summary').evaluate(el=>document.activeElement===el),
          'Escape lost keyboard focus in secondary public header');
        await services.locator('summary').click();
        await page.mouse.move(width/2,height-5);
        assert(!await services.evaluate(el=>el.open),
          'Desktop secondary header flyout stayed open after pointer left');
        await services.locator('summary').click();
        await page.mouse.click(width/2,height-5);
        assert(!await services.evaluate(el=>el.open),
          'Desktop secondary header flyout stayed open after outside click');
        await services.locator('summary').click();
        await services.locator('a[href="#/explore/van"]').click();
        await page.getByRole('heading',{name:'Вход по номеру телефона'}).waitFor();
        await page.waitForFunction(() =>
          sessionStorage.getItem('traksos.pendingLandingAction')==='van');
        assert(await page.getByText('Вы выбрали:',{exact:false}).count()===1,
          'Desktop secondary header Services did not open real chosen-service auth');
      }
      await open('explore/guide');
      await page.screenshot({path:'e2e/shots/legacy-guest/legacy-'+width+'.png'});
      // Existing approved service bookmarks must still retain the selected
      // destination; this is a regression check, not a fake login.
      for (const key of [
        'van','tow','sto','consult','insurance','parts','inspection',
        'ecu','sos','air','club','tech','trakbot','garage','training'
      ]) {
        await page.goto(BASE + '/#/', {waitUntil:'domcontentloaded'});
        await page.locator(landing).waitFor({state:'visible'});
        await page.evaluate(() => {
          sessionStorage.removeItem('traksos.pendingLandingAction');
          sessionStorage.removeItem('traksos.pendingCatalogChoice');
        });
        await open('explore/'+key);
        await page.waitForFunction(service =>
          sessionStorage.getItem('traksos.pendingLandingAction')===service, key);
        assert(await page.getByText('Вы выбрали:',{exact:false}).count()===1,
          width+'px: valid #/explore/'+key+' lost its auth context');
        assert(await page.evaluate(() =>
          sessionStorage.getItem('traksos.pendingCatalogChoice')===null),
          width+'px: stale booking details carried into #/explore/'+key);
        assert(await page.locator('main.guest-explore, .guest-explore-hero').count()===0,
          width+'px: obsolete guest UI at valid service #/explore/'+key);
        // Abandoning an auth flow using normal navigation cancels its hint.
        await page.goto(BASE+'/#/', {waitUntil:'domcontentloaded'});
        await page.locator(landing).waitFor({state:'visible'});
        await page.waitForFunction(() =>
          sessionStorage.getItem('traksos.pendingLandingAction')===null);
      }
      assert(errors.length===0,width+'px: browser errors: '+errors.join('; '));
      console.log('PASS legacy guest deep links '+width+'px: stale hints cleared, approved services preserved');
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
}
