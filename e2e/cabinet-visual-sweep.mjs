// Signed-in REAL role visual sweep. Uses synthetic local fixtures only.
 // Captures both phone and desktop, then verifies a role-specific inner page.
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:8080';
if (!['127.0.0.1','localhost'].includes(new URL(BASE).hostname))
  throw Error('Cabinet visual sweep must ONLY run on the local CI server');

const roles = [
  {name:'owner',phone:'+79990000141',password:'Test-Role-Only-2026!',mode:'client',home:'#/',inner:'#/garage'},
  {name:'driver',phone:'+79990000142',password:'Test-Role-Only-2026!',mode:'client',home:'#/',inner:'#/orders'},
  {name:'master',phone:'+79992223344',password:'TrakSOS-Test-2026!',mode:'performer',home:'#/work',inner:'#/work/me'},
  {name:'tow',phone:'+79990000143',password:'Test-Role-Only-2026!',mode:'performer',home:'#/work',inner:'#/work/jobs'},
  {name:'service',phone:'+79990000144',password:'Test-Role-Only-2026!',mode:'service',home:'#/base',inner:'#/base/me'},
  {name:'master_service',phone:'+79990000146',password:'Test-Role-Only-2026!',mode:'service',home:'#/base',inner:'#/base/money'},
  {name:'insurer',phone:'+79990000145',password:'Test-Role-Only-2026!',mode:'insurer',home:'#/insurance',inner:'#/profile'},
  {name:'moderator',phone:'+79990000147',password:'Test-Role-Only-2026!',mode:'moderator',home:'#/moderation',inner:'#/profile'},
  {name:'admin',phone:'+79990000001',password:'TrakSOS-Test-2026!',mode:'admin',home:'#/admin',inner:'#/admin/section/orders'},
];
await mkdir('e2e/shots/cabinet-ux',{recursive:true});
const browser=await chromium.launch();
try {
  for(const entry of roles) {
    const response=await fetch(BASE+'/api/auth/login',{method:'POST',
      headers:{'content-type':'application/json'},
      body:JSON.stringify({phone:entry.phone,password:entry.password})});
    if(!response.ok)throw Error(entry.name+': local fixture login failed '+response.status);
    const {token}=await response.json();
    for(const width of [390,1440]) {
      const context=await browser.newContext({viewport:{width,height:900},locale:'ru-RU'});
      const page=await context.newPage();
      const jsErrors=[];
      page.on('pageerror',error=>jsErrors.push(error.message));
      await page.addInitScript(({token,mode})=>{
        localStorage.setItem('traksos.token',token);
        localStorage.setItem('traksos.mode',mode);
      },{token,mode:entry.mode});
      async function verify(where) {
        await page.locator('.app').waitFor();
        await page.locator('.account-menu > summary').waitFor();
        // An image can finish loading after the React shell mounts. Wait for
        // actual decoding before measuring the approved logo's natural pixels.
        await page.locator('header.top .tr-approved-brand-logo img').evaluate(async img => {
          if (!img.complete) await img.decode();
        });
        await page.locator('main').first().waitFor();
        await page.evaluate(()=>document.fonts.ready);
        const report=await page.evaluate(()=>({
          width:document.documentElement.clientWidth,
          scroll:document.documentElement.scrollWidth,
          body:document.body.scrollWidth,
          missing:document.querySelector('main')?.textContent?.includes('Такой страницы нет'),
          failed:document.body.textContent?.includes('Не удалось открыть раздел'),
          nav:document.querySelectorAll('.account-menu nav a[href^="#/"]').length,
          sidebar: {total:document.querySelectorAll('.desktop-sidebar .desktop-nav-link').length,
            vector:document.querySelectorAll('.desktop-sidebar .desktop-nav-link>span:first-child>svg').length},
          legacy:[...document.querySelectorAll('.desktop-hero,.desktop-quick-links,.service-preview-admin-bar,.sandbox-role-card,#operator-demo-code')]
            .map(el=>el.className||el.id),
          logo:(()=>{
            const img=document.querySelector('header.top .tr-approved-brand-logo img');
            return {present:!!img,src:img?.getAttribute('src')||'',loaded:!!img?.complete&&img.naturalWidth===274&&img.naturalHeight===46};
          })()
        }));
        if(report.scroll>report.width+3 || report.body>report.width+3)
          throw Error(entry.name+' '+width+'px '+where+': horizontal overflow '+JSON.stringify(report));
        if(report.missing||report.failed||report.nav<5||report.legacy.length||
           (width>=900 && (report.sidebar.total===0||report.sidebar.total!==report.sidebar.vector))||
           !report.logo.present||report.logo.src!=='/traksos-brand-logo-approved-618.png'||!report.logo.loaded)
          throw Error(entry.name+' '+width+'px '+where+': old interface, missing approved logo or broken navigation '+JSON.stringify(report));
        if(jsErrors.length)throw Error(entry.name+' '+width+'px '+where+': '+jsErrors.join('; '));
      }
      await page.goto(BASE+'/'+entry.home,{waitUntil:'domcontentloaded'});
      await verify('home');
      // Screenshots are for owner visual approval, not an in-flight transition:
      // animations on signed-in cards start at 40% opacity (ts-appear, 280ms).
      // Capture the fully rendered state after that finite reveal.
      await page.waitForTimeout(450);
      await verify('home-stable');
      if (width >= 900) {
        const inline=await page.locator('.approved-pc-bot').count();
        const floating=await page.locator('.trakbot-dock-launcher').count();
        if(inline > 0 && floating > 0)
          throw Error(entry.name+': approved PC dashboard shows duplicate TrakBot card and floating dock');
      }
      // Show the approved branded illustration and live CTA only after the
      // performer/tow order API confirms a genuinely empty shift.
      if(width===1440 && ['master','tow'].includes(entry.name) &&
         await page.locator('.approved-pc-shift-empty-body').count()){
        const empty=page.locator('.approved-pc-shift-empty-body');
        const scene=empty.locator('.tr-approved-empty-scene img');
        const valid=await scene.evaluate(async img=>{
          if(!img.complete) await img.decode().catch(()=>{});
          return img.naturalWidth>50;
        });
        if(!valid||await empty.getAttribute('data-orders')!=='0')
          throw Error(entry.name+': missing approved artwork or false empty job state');
        await empty.getByRole('button',{name:'Проверить предложения'}).click();
        if(await page.getByRole('tab',{name:/Новые предложения/}).getAttribute('aria-selected')!=='true')
          throw Error(entry.name+': empty shift CTA did not open the real offers');
        await page.getByRole('tab',{name:/Текущая работа/}).click();
        await empty.waitFor();
      }
      await page.screenshot({path:'e2e/shots/cabinet-ux/'+entry.name+'-home-'+width+'.png',fullPage:true});
      // Simulate a real user opening the cabinet menu and following a safe inner page.
      await page.locator('.account-menu > summary').click();
      const links=await page.locator('.account-menu nav a[href^="#/"]').count();
      if(links<5)throw Error(entry.name+' '+width+'px: account menu contains too few links');
      const inner = page.locator('.account-menu nav a[href="'+entry.inner+'"]');
      if(await inner.count() !== 1)throw Error(entry.name+' '+width+'px: missing or duplicate working link '+entry.inner);
      await inner.click();
      await page.waitForURL(url => url.hash === entry.inner);
      await verify('inner');
      await page.waitForTimeout(450);
      await verify('inner-stable');
      // Confirm the signed-in desktop helper is fixed, bigger than the
      // retired 38px pill, and can open + close without route changes.
      if(width===1440&&entry.name==='owner'){
        const dock=page.locator('.app:not(.guest-app)> .trakbot-dock');
        const launch=dock.locator('.trakbot-dock-launcher');
        await launch.waitFor({state:'visible'});
        const visual=await launch.evaluate(node=>{
          const r=node.getBoundingClientRect(),styles=getComputedStyle(node);
          const image=node.querySelector('.trakbot-mascot-original');
          const label=node.querySelector('.trakbot-dock-label');
          return {w:r.width,h:r.height,border:styles.borderTopWidth,
            fixed:getComputedStyle(node.closest('.trakbot-dock')).position==='fixed',
            mask:image?getComputedStyle(image).maskImage:'none',
            label:label?getComputedStyle(label).display:'none'};
        });
        if(visual.w<82||visual.h<82||visual.border!=='0px'||!visual.fixed||
           visual.mask==='none'||visual.label!=='none')
          throw Error('Signed-in TrakBot regressed into small sticker pill '+JSON.stringify(visual));
        await launch.click();
        await dock.getByRole('dialog',{name:'TrakBot — личный помощник'}).waitFor({state:'visible'});
        await page.keyboard.press('Escape');
        await dock.getByRole('dialog',{name:'TrakBot — личный помощник'}).waitFor({state:'detached'});
      }
      await page.screenshot({path:'e2e/shots/cabinet-ux/'+entry.name+'-inner-'+width+'.png',fullPage:true});
      await context.close();
    }
  }
  console.log('REAL signed-in cabinets: 9 roles × 2 widths × home and inner pages = 36 browser screenshots; zero broken screens or overflow');
}finally{await browser.close();}
