// Signed-in REAL role visual sweep. Uses synthetic local fixtures only.
 // Captures both phone and desktop, then verifies a role-specific inner page.
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { assertDesktopMenu, assertRoleMenu, desktopPersonalPaths } from './role-click-contract.mjs';

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
          right:[...document.querySelectorAll('.account-menu nav a[href^="#/"]')].map(a=>a.getAttribute('href')),
          left:[...document.querySelectorAll('.desktop-sidebar .desktop-nav a[href^="#/"]')].map(a=>a.getAttribute('href')),
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
        if(report.missing||report.failed||report.legacy.length||
           (width>=900 && (report.sidebar.total===0||report.sidebar.total!==report.sidebar.vector))||
           !report.logo.present||report.logo.src!=='/traksos-brand-logo-approved-618.png'||!report.logo.loaded)
          throw Error(entry.name+' '+width+'px '+where+': old interface, missing approved logo or broken navigation '+JSON.stringify(report));
        if(width>=900){
          const role=entry.name==='master_service'?'hybrid-service':entry.name;
          assertDesktopMenu(entry.mode,role,report.left,report.right,entry.home);
        }else{
          if(report.right.length<5)throw Error(entry.name+': incomplete mobile menu');
          assertRoleMenu(entry.mode,report.right);
        }
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
      // Click the actual approved navigation surface, not a hidden duplicate.
      const personal=width<900 || desktopPersonalPaths.includes(entry.inner);
      const surface=page.locator(personal?'.account-menu nav':'.desktop-sidebar .desktop-nav');
      if(personal)await page.locator('.account-menu > summary').click();
      const inner=surface.locator('a[href="'+entry.inner+'"]');
      if(await inner.count()!==1)throw Error(entry.name+' '+width+'px: missing or duplicate working link '+entry.inner);
      if(!personal){
        const disclosure=inner.locator('xpath=ancestor::details[1]');
        if(await disclosure.count() && !(await disclosure.evaluate(el=>el.open)))
          await disclosure.locator('summary').click();
      }
      await inner.waitFor({state:'visible'});
      await inner.click();
      await page.waitForURL(url => url.hash === entry.inner);
      await verify('inner');
      await page.waitForTimeout(450);
      await verify('inner-stable');
      // The approved 617 inner page has ONE accessible TrakBot in its rail.
      // The fixed dock is intentionally absent here so two assistants do not
      // overlap the form; validate the real chat route instead of an old pill.
      if(width===1440&&entry.name==='owner'){
        const bot=page.locator('.desktop-content > .tr-inner-rail .tr-inner-bot-card');
        await bot.waitFor({state:'visible'});
        await bot.locator('.trakbot-mascot-original').waitFor({state:'visible'});
        if(await bot.getAttribute('href')!=='#/trakbot')
          throw Error('Owner inner TrakBot does not open the real private chat');
        if(await page.locator('.app:not(.guest-app)> .trakbot-dock-launcher').count()!==0)
          throw Error('Owner inner page has duplicate assistant launcher');
        await bot.click();
        await page.waitForURL(url=>url.hash==='#/trakbot');
        await verify('trakbot-private-chat');
        await page.goBack({waitUntil:'domcontentloaded'});
        await page.waitForURL(url=>url.hash===entry.inner);
        await bot.waitFor({state:'visible'});
        await verify('inner-return');
      }
      await page.screenshot({path:'e2e/shots/cabinet-ux/'+entry.name+'-inner-'+width+'.png',fullPage:true});
      await context.close();
    }
  }
  console.log('REAL signed-in cabinets: 9 roles × 2 widths × home and inner pages = 36 browser screenshots; zero broken screens or overflow');
}finally{await browser.close();}
