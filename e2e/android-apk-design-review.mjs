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
    // The actual approved 618.png has a plain "Рабочий стол" heading above
    // four actions / performer metrics. No oversized invented truck hero here.
    const header = await page.locator('.and19-cover').evaluate(el => {
      const b=el.getBoundingClientRect(),style=getComputedStyle(el);
      return {text:el.textContent.trim(),height:b.height,images:el.querySelectorAll('img').length,bg:style.backgroundImage};
    });
    if(header.text!=='Рабочий стол' || header.height>70 || header.images!==0)
      throw Error(role+': Android heading differs from original 618.png '+JSON.stringify(header));
    const logo=await page.locator('.and19-review-header img').evaluate(el=>
      el.complete && el.naturalWidth>0 && el.src.endsWith('/traksos-brand-logo-approved-618.png'));
    if(!logo) throw Error(role+': original 618.png logo is missing');
    const nav = await page.locator('.and19-review-tabbar a').allTextContents();
    const expectedTabs=(role==='client'||role==='driver')?5:4;
    if (nav.length!==expectedTabs)
      throw Error(role+': Android bottom navigation does not match live role layout '+JSON.stringify(nav));
    const columns=await page.locator('.and19-review-tabbar').evaluate(el=>
      getComputedStyle(el).gridTemplateColumns.split(' ').filter(Boolean).length);
    if (columns!==expectedTabs)
      throw Error(role+': bottom tabbar CSS has '+columns+' columns for '+expectedTabs+' approved items');
    if (details.scroll>details.viewport+3)throw Error(role+': horizontal overflow '+JSON.stringify(details));
    if (role==='client' || role==='driver') {
      if (await page.locator('.and19-services>a').count()!==4)throw Error('Lost approved four services');
      if (!await page.locator('.and19-main-order').count())throw Error('Preview is not displaying a real workspace component');
      if (!await page.locator('.and19-assigned-performer').count())
        throw Error('Approved 618.png assigned-master card absent from synthetic role review');
      const orderOfCost=await page.evaluate(()=>{
        const assigned=document.querySelector('.and19-assigned-performer');
        const cost=document.querySelector('.and19-client-cost');
        return !!assigned && !!cost && !!(assigned.compareDocumentPosition(cost)&Node.DOCUMENT_POSITION_FOLLOWING);
      });
      if(!orderOfCost)throw Error('Approved 618.png requires master row before API-backed cost row');
      // A tap on the exact-model photo opens that vehicle's own history,
      // whereas the status/header opens the order and Chat opens the real chat.
      const photoHref=await page.locator('.and19-order-photo-link').getAttribute('href');
      const chatLinks=await page.locator('.and19-client a[href*="chat=1"]').count();
      const costText=(await page.locator('.and19-client-cost').innerText()).replace(/\s/g,'');
      const ratingText=(await page.locator('.and19-performer-rating').innerText()).replace(/\s/g,'');
      if(photoHref!=='#/garage/SYNTHETIC-VEHICLE'||chatLinks<1||
         !costText.includes('10500₽')||!costText.includes('10000₽')||
         !costText.includes('500₽')||!ratingText.includes('4,9'))
        throw Error('Client Android order routing/kopeck pricing/rating wrong '+JSON.stringify({photoHref,chatLinks,costText,ratingText}));
      // Owner-approved Scania R440 (2010) must NEVER display the unrelated
      // Next Gen R520 photograph from the existing model catalog.
      const vehicleText=await page.locator('.and19-main-order .and19-vehicle').innerText();
      if(!vehicleText.includes('Scania R440 2010'))
        throw Error(role+': debug app is not showing approved 618.png vehicle: '+vehicleText);
      const imageSource=await page.locator('.and19-main-order .tr-approved-order-truck img').getAttribute('src');
      if(imageSource?.includes('scania-r520') ||
        (imageSource?.includes('/vehicles/models/') && !imageSource.includes('scania-r440')))
        throw Error(role+': wrong model photograph displayed for R440 2010: '+imageSource);
      const photo=page.locator('.and19-main-order img[src*="/vehicles/models/"]');
      if (await photo.count()) {
        const ok=await photo.first().evaluate(img=>img.complete&&img.naturalWidth>0);
        if (!ok)throw Error('Approved manufacturer/model photo is not visible: '+role);
      }
    } else {
      const toggle=page.locator('.and19-line button');
      if (!await toggle.count())throw Error('Performer availability is missing');
      if (!await page.locator('.and19-main-order .and19-timeline').count())throw Error('Performer timeline missing');
      if (!await page.locator('.and19-client-contact').count())
        throw Error('Approved 618.png client-contact card absent from synthetic performer review');
      const stage=page.locator('.and19-stage-primary');
      if(await stage.count()!==1||!(await stage.innerText()).includes('Я на месте') ||
         await page.locator('.and19-stage-complete.is-disabled').count()!==1)
        throw Error('Master must show sequential functional arrival and disabled finish');
      const money=(await page.locator('.and19-performer-finance').innerText()).replace(/\s/g,'');
      if(!money.includes('10000₽')||!money.includes('500₽')||!money.includes('9500₽')||
         money.includes('10500₽'))
        throw Error('Performer must never see client surcharge; actual payout is 9500 ₽: '+money);
      const photo=page.locator('.and19-quick .and19-photo-capture');
      const photoCount=await photo.count();
      const fileInputs=await page.locator('.and19-review-page input[type="file"]').count();
      if(photoCount!==1 || fileInputs!==0 || !await photo.getAttribute('aria-label'))
        throw Error('Approved master Фото must be present but completely inert in synthetic DEBUG review');
      const quick = await page.locator('.and19-quick>*').allTextContents();
      if(quick.length!==3||!quick.some(label=>label.includes('Запчасти'))||
         !quick.some(label=>label.includes('Фото')))
        throw Error('The master has missing approved photo/report/parts actions '+JSON.stringify(quick));
    }
    // Regression against the old CSS rule which colored every <p> child
    // span 16px orange; the current approved component uses SVG for icons
    // and the span contains the real issue/address text.
    const factStyles=await page.locator('.and19-main-order .and19-facts').evaluate(node=>{
      const sample=cls=>{
        const p=node.querySelector('p.'+cls);
        const span=p?.querySelector(':scope > span');
        return p&&span?{label:cls,parentColor:getComputedStyle(p).color,
          textColor:getComputedStyle(span).color,fontPx:parseFloat(getComputedStyle(span).fontSize)}:null;
      };
      return [sample('and19-issue'),sample('and19-order-address')];
    });
    if(factStyles.some(s=>!s || s.fontPx>13 || s.textColor!==s.parentColor))
      throw Error(role+': obsolete oversized orange text leaked into approved Android facts '+JSON.stringify(factStyles));
    if(await page.locator('.and19-timeline li:last-child > span svg').count()!==1)
      throw Error(role+': approved last timeline step must show a check icon, not number five');
    const stageTimes=await page.locator('.and19-timeline li time').count();
    const dispatchEta=await page.locator('.and19-route-eta').innerText();
    if(stageTimes!==3 || !dispatchEta.includes('28 мин'))
      throw Error(role+': actual API-style stage times and dispatch ETA missing: '+JSON.stringify({stageTimes,dispatchEta}));
    if(role==='client'||role==='driver') {
      const actions=await page.locator('.and19-services a .and19-service-symbol svg').count();
      if(actions!==4 || await page.locator('.and19-parts-shortcut').count()!==0)
        throw Error('618.png has four scalable services and NO extra home shop card');
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
