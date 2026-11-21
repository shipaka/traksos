// Regression: retired public PIN-based mock cabinets must NEVER render.
// Only the separate authenticated admin sandbox can display real role screens.
// No auth calls, synthetic grants, data mutation, SMS, or production traffic.
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const BASE=process.env.BASE_URL ?? 'http://127.0.0.1:8080';
if (!['127.0.0.1','localhost'].includes(new URL(BASE).hostname))
  throw Error('Retired preview audit must run against the local test site only');

const output='e2e/shots/temporary-demo';
await mkdir(output,{recursive:true});
const browser=await chromium.launch();
try {
  for(const width of [320,390,960,1440]){
    const context=await browser.newContext({viewport:{width,height:width<=390?844:900},locale:'ru-RU'});
    const page=await context.newPage();
    const errors=[];
    const unsafe=[];
    page.on('pageerror',e=>errors.push(e.message));
    page.on('request',r=>{
      if(r.url().includes('/api/public/demo/') || (r.method()!=='GET' && r.url().includes('/api/')))
        unsafe.push(r.method()+' '+r.url());
    });
    try{
      for(const route of ['#/preview','#/admin/test-center','#/admin/test-center/owner']){
        await page.goto(BASE+'/'+route,{waitUntil:'domcontentloaded'});
        const panel=page.locator('main.tr-approved-route-unavailable');
        await panel.waitFor({state:'visible',timeout:15_000});
        const message=await panel.innerText();
        if(!message.includes('Старый демонстрационный просмотр закрыт'))
          throw Error('Former training preview is not visibly retired '+route);
        if(await page.locator('.sandbox-role-card,.sandbox-cabinet,.operator-demo-screen,#operator-demo-code').count())
          throw Error('Obsolete/mock role dashboard mounted on public route '+route);
        const login=panel.locator('a[href="#/login"]');
        if(!(await login.isVisible()))throw Error('Retired role entry cannot reach real login '+route);
        const size=await page.evaluate(()=>({
          viewport:document.documentElement.clientWidth,
          scroll:document.documentElement.scrollWidth,
        }));
        if(size.scroll>size.viewport+3)
          throw Error('Retired preview overflow '+width+' '+route+' '+JSON.stringify(size));
      }
      if(errors.length||unsafe.length)
        throw Error('Guest preview triggered JS error or fake grant exchange '+JSON.stringify({errors,unsafe}));
      await page.screenshot({path:output+'/retired-public-demo-'+width+'.png',animations:'disabled'});
      await page.locator('main.tr-approved-route-unavailable a[href="#/login"]').click();
      await page.waitForURL('**/#/login');
      await page.locator('main.tr-approved-route-unavailable').waitFor({state:'detached'});
      console.log('RETIRED DEMO ROUTE PASS',width,'no mock cabinet, no PIN, real login');
    } finally {await context.close();}
  }
} finally {await browser.close();}
