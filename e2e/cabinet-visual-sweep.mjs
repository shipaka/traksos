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
  {name:'master',phone:'+79992223344',password:'TrackSOS-Test-2026!',mode:'performer',home:'#/work',inner:'#/work/me'},
  {name:'tow',phone:'+79990000143',password:'Test-Role-Only-2026!',mode:'performer',home:'#/work',inner:'#/work/jobs'},
  {name:'service',phone:'+79990000144',password:'Test-Role-Only-2026!',mode:'service',home:'#/base',inner:'#/base/me'},
  {name:'master_service',phone:'+79990000146',password:'Test-Role-Only-2026!',mode:'service',home:'#/base',inner:'#/base/money'},
  {name:'insurer',phone:'+79990000145',password:'Test-Role-Only-2026!',mode:'insurer',home:'#/insurance',inner:'#/profile'},
  {name:'moderator',phone:'+79990000147',password:'Test-Role-Only-2026!',mode:'moderator',home:'#/moderation',inner:'#/profile'},
  {name:'admin',phone:'+79990000001',password:'TrackSOS-Test-2026!',mode:'admin',home:'#/admin',inner:'#/admin/section/summary'},
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
        await page.locator('main').first().waitFor();
        await page.evaluate(()=>document.fonts.ready);
        const report=await page.evaluate(()=>({
          width:document.documentElement.clientWidth,
          scroll:document.documentElement.scrollWidth,
          body:document.body.scrollWidth,
          missing:document.querySelector('main')?.textContent?.includes('Такой страницы нет'),
          failed:document.body.textContent?.includes('Не удалось открыть раздел'),
          nav:document.querySelectorAll('.account-menu nav a[href^="#/"]').length
        }));
        if(report.scroll>report.width+3 || report.body>report.width+3)
          throw Error(entry.name+' '+width+'px '+where+': horizontal overflow '+JSON.stringify(report));
        if(report.missing||report.failed||report.nav<5)
          throw Error(entry.name+' '+width+'px '+where+': broken screen or missing cabinet navigation '+JSON.stringify(report));
        if(jsErrors.length)throw Error(entry.name+' '+width+'px '+where+': '+jsErrors.join('; '));
      }
      await page.goto(BASE+'/'+entry.home,{waitUntil:'domcontentloaded'});
      await verify('home');
      await page.screenshot({path:'e2e/shots/cabinet-ux/'+entry.name+'-home-'+width+'.png',fullPage:true});
      // Simulate a real user opening the cabinet menu and following a safe inner page.
      await page.locator('.account-menu > summary').click();
      const links=await page.locator('.account-menu nav a[href^="#/"]').count();
      if(links<5)throw Error(entry.name+' '+width+'px: account menu contains too few links');
      await page.goto(BASE+'/'+entry.inner,{waitUntil:'domcontentloaded'});
      await verify('inner');
      await page.screenshot({path:'e2e/shots/cabinet-ux/'+entry.name+'-inner-'+width+'.png',fullPage:true});
      await context.close();
    }
  }
  console.log('REAL signed-in cabinets: 9 roles × 2 widths × home and inner pages = 36 browser screenshots; zero broken screens or overflow');
}finally{await browser.close();}
