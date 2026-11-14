// Real browser screenshots of the authenticated client React app, not static mockups.
// CI-only synthetic account created by e2e/role-matrix.mjs, no live user data.
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const BASE = process.env.BASE_URL ?? 'http://localhost:8080';
const root = new URL(BASE);
if (!['localhost', '127.0.0.1'].includes(root.hostname))
  throw new Error('Client screenshot audit is restricted to local CI');
const OUT = process.env.SHOTS_DIR ?? 'e2e/shots/client-real';
await mkdir(OUT, {recursive:true});
const login = await fetch(BASE + '/api/auth/login', {
  method:'POST', headers:{'content-type':'application/json'},
  body:JSON.stringify({phone:'+79990000141',password:'Test-Role-Only-2026!'})
});
if (!login.ok) throw new Error('Local CI owner fixture is not available: HTTP '+login.status);
const {token} = await login.json();
const browser=await chromium.launch({headless:true});
const failures=[];
for (const [width,height] of [[390,844],[1440,900]]) {
  const context=await browser.newContext({
    viewport:{width,height},deviceScaleFactor:1,
    isMobile:width<600,hasTouch:width<600,locale:'ru-RU'
  });
  const page=await context.newPage();
  const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  try {
    await page.addInitScript(t=>localStorage.setItem('traksos.token',t),token);
    await page.goto(BASE+'/#/', {waitUntil:'domcontentloaded'});
    await page.locator('.client-dashboard').waitFor({timeout:20000});

    // Offer-gate dialogs, if present, are accepted only in synthetic CI.
    const offerResponse=await fetch(BASE+'/api/me/offers',{headers:{authorization:'Bearer '+token}});
    if (!offerResponse.ok) throw Error('Cannot inspect local fixture offers');
    const offers=await offerResponse.json();
    for(const offer of offers.filter(x=>x.current && !x.accepted)){
      const dialog=page.getByRole('dialog',{name:offer.name});
      await dialog.waitFor({state:'visible',timeout:10000});
      await dialog.locator('input[type=checkbox]').check();
      await dialog.getByRole('button',{name:'Принимаю'}).click();
      await dialog.waitFor({state:'detached',timeout:10000});
    }
    // A real interaction accepts the synthetic test user's cookie notice.
    const cookieButton=page.getByRole('button',{name:'Понятно'});
    if (await cookieButton.isVisible()) await cookieButton.click();
    // Wait for the real offer-accepted toast to disappear before taking clean screenshots.
    await page.locator('.toast').waitFor({state:'hidden',timeout:15000});
    if (!await page.locator('.client-hero-scania').isVisible())throw Error('Scania hero invisible');
    const photo=await page.locator('.client-hero-scania').evaluate(el=>({
      loaded:el.complete && el.naturalWidth>100 && el.naturalHeight>100,
      visible:getComputedStyle(el).display!=='none'
    }));
    if (!photo.loaded||!photo.visible)throw Error('Approved Scania image failed: '+JSON.stringify(photo));

    const cardCount=await page.locator('.desktop-quick-links a.desktop-quick-card').count();
    if (cardCount!==4)throw Error('Expected 4 client service choices, found '+cardCount);
    if (await page.locator('.client-dashboard-hubs a').count()!==4)
      throw Error('Client dashboard service hubs missing');
    const state=await page.evaluate(()=>({
      width:document.documentElement.clientWidth,scrollWidth:document.documentElement.scrollWidth
    }));
    if (state.scrollWidth>state.width+3)throw Error('Dashboard horizontal overflow: '+JSON.stringify(state));
    if (errors.length)throw Error('Dashboard JS error: '+errors.join(' | '));
    // Footer cookie consent scrolls the document; reset so viewport screenshots start at the real top.
    await page.evaluate(()=>{window.scrollTo(0,0);document.documentElement.scrollTop=0;document.body.scrollTop=0;});
    await page.waitForTimeout(120);
    await page.screenshot({path:OUT+'/client-dashboard-'+width+'-viewport.png',fullPage:false});
    await page.screenshot({path:OUT+'/client-dashboard-'+width+'.png',fullPage:true});

    await page.goto(BASE+'/#/sos',{waitUntil:'domcontentloaded'});
    await page.locator('.client-sos-directions').waitFor({timeout:12000});
    if (await page.locator('.client-sos-choice').count()!==3)
      throw Error('SOS must show three directions, no old symptom grid');
    await page.screenshot({path:OUT+'/client-sos-'+width+'-viewport.png',fullPage:false});
    await page.screenshot({path:OUT+'/client-sos-'+width+'.png',fullPage:true});
    await page.getByRole('button',{name:/Выездной мастер/}).click();
    if (await page.locator('.client-sos-specialty').count()!==5)
      throw Error('Expected five master specializations');
    if (await page.locator('.client-sos-choice').count()!==0)
      throw Error('Other directions must be hidden after selection');
    await page.screenshot({path:OUT+'/client-master-specialties-'+width+'.png',fullPage:true});
    await page.locator('.client-sos-specialty').first().click();
    await page.getByRole('heading',{name:/Свет, розетка, проводка|Электрик/i}).first().waitFor({timeout:12000});
    if (errors.length)throw Error('UI JS errors: '+errors.join(' | '));
    console.log('PASS real client design '+width+'px: Scania, 4 cards, 4 hubs, 3 SOS directions, 5 specialties and no overflow');
  }catch(e){failures.push({width,error:e.message});}
  await context.close();
}
await browser.close();
if(failures.length){console.error(JSON.stringify({failures},null,2));process.exitCode=1;}
