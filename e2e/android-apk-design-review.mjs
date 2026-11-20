// Visual evidence from actual React Android components with a simulated DEBUG-only bridge.
// Production/release APK cannot expose this route. Does not authenticate or mutate the API.
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:8080';
if (!['localhost','127.0.0.1'].includes(new URL(BASE).hostname)) {
  throw Error('Android design review must not test against production');
}
const output = 'e2e/shots/android-apk-review';
await mkdir(output, {recursive:true});
const browser = await chromium.launch();
try {
  const context = await browser.newContext({viewport:{width:390,height:844},locale:'ru-RU'});
  const page = await context.newPage();
  const errors = [];
  const apiMutations = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('request', r => {
    if (r.url().includes('/api/') && !['GET','HEAD','OPTIONS'].includes(r.method()))
      apiMutations.push(r.method() + ' ' + r.url());
  });
  await page.addInitScript(() => {
    Object.defineProperty(window,'TrakSOSNative',{configurable:true,value:{
      isApp:()=>true, isPreviewBuild:()=>true,
      designReviewReady:(role)=>{window.__reviewRole=role;},
      setSession:()=>{},pushToken:()=>'',performerOnline:()=>{},
      appLockEnabled:()=>false,setAppLockEnabled:()=>false
    }});
  });
  for (const role of ['client','driver','master','tow']) {
    await page.goto(BASE+'/#/android-review/'+role,{waitUntil:'domcontentloaded'});
    await page.locator('.and19-review-page').waitFor();
    await page.locator(role==='client'||role==='driver'?'.and19-client':'.and19-performer').waitFor();
    await page.waitForTimeout(250);
    const details=await page.evaluate(()=>({
      isNative:document.documentElement.classList.contains('traksos-native'),
      previewRole:window.__reviewRole,
      viewport:document.documentElement.clientWidth,
      scroll:document.documentElement.scrollWidth
    }));
    if (!details.isNative || details.previewRole!==role)throw Error('Wrong role/native mode '+JSON.stringify(details));
    // Regression gate: approved hero must be a real, visible bundled image.
    const hero = await page.locator('.and19-cover img').evaluate(img => {
      const bounds = img.getBoundingClientRect();
      const parent = img.closest('.and19-cover');
      const box = parent.getBoundingClientRect();
      return {
        loaded: img.complete && img.naturalWidth>0,
        src:img.getAttribute('src'),
        visible:bounds.width>200 && bounds.height>=100 && box.height>=100,
        background:getComputedStyle(parent).backgroundColor
      };
    });
    if (!hero.loaded || !hero.visible || hero.src!=='/tracksos-approved-hero-owner-20261119.webp')
      throw Error(role+': approved photo missing from Android hero '+JSON.stringify(hero));
    const nav = await page.locator('.and19-review-tabbar a').allTextContents();
    if (nav.length!==((role==='client'||role==='driver')?6:4))
      throw Error(role+': Android bottom navigation does not match live role layout '+JSON.stringify(nav));
    if (details.scroll>details.viewport+3)throw Error(role+': horizontal overflow '+JSON.stringify(details));
    if (role==='client' || role==='driver') {
      if (await page.locator('.and19-services>a').count()!==4)throw Error('Lost approved four services');
      if (!await page.locator('.and19-main-order').count())throw Error('Preview is not displaying a real workspace component');
      const photo=page.locator('.and19-main-order img[src*="/vehicles/models/"]');
      if (await photo.count()) {
        const ok=await photo.first().evaluate(img=>img.complete&&img.naturalWidth>0);
        if (!ok)throw Error('Approved manufacturer/model photo is not visible: '+role);
      }
    } else {
      const toggle=page.locator('.and19-line button');
      if (!await toggle.count())throw Error('Performer availability is missing');
      if (!await page.locator('.and19-main-order .and19-timeline').count())throw Error('Performer timeline missing');
      if (!await page.getByText('Открыть · отметить прибытие',{exact:false}).count())
        throw Error('The approved master must show a real status-specific next step');
      const links = await page.locator('.and19-order-shortcuts>a').evaluateAll(a => a.map(el=>el.getAttribute('href')));
      if (links.length!==3 || !links.every(h=>h.startsWith('#/order/SYNTHETIC-REVIEW/')))
        throw Error('The master has missing safe quick tabs '+JSON.stringify(links));
    }
    await page.screenshot({path:output+'/'+role+'-390.png'});
    // Clicking a live-looking action in review must not call the API or navigate.
    await page.locator('.and19-main-order a').first().click();
    if (!page.url().endsWith('/#/android-review/'+role))throw Error('Demo left safe review route');
    if (!await page.getByText('Это просмотр оформления.',{exact:false}).count())
      throw Error('Missing protected preview feedback');
    if (errors.length || apiMutations.length)throw Error('Unsafe preview '+JSON.stringify({errors,apiMutations}));
    console.log('REAL COMPONENT, SYNTHETIC DATA:',role,'390px');
  }
  await page.setViewportSize({width:320,height:740});
  await page.goto(BASE+'/#/android-review/client',{waitUntil:'domcontentloaded'});
  await page.locator('.and19-client').waitFor();
  const narrow=await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);
  if (narrow>3)throw Error('320px native layout overflows by '+narrow);
  await page.screenshot({path:output+'/client-320.png'});
  await context.close();

  // Even a spoofed hash without the DEBUG bridge cannot see fake review orders.
  const release=await browser.newContext({viewport:{width:390,height:844}});
  const releasePage=await release.newPage();
  await releasePage.goto(BASE+'/#/android-review/client',{waitUntil:'domcontentloaded'});
  await releasePage.locator('.app').waitFor();
  if (await releasePage.locator('.and19-review-page').count())
    throw Error('Fake debug preview visible to a release/public browser');
  await release.close();
} finally { await browser.close(); }
