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
      for (const path of ['help','explore/guide','explore/pricing','explore/unknown-feature']) {
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

      await page.screenshot({path:'e2e/shots/legacy-guest/legacy-'+width+'.png'});
      // Existing approved service bookmarks must still retain the selected
      // destination; this is a regression check, not a fake login.
      for (const key of ['tow','ecu','parts']) {
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
