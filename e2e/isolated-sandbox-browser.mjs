// Real Chromium evidence from the SAME isolated sandbox candidate image/API.
// No mocked components: use the HMAC one-time entry and actual role pages.
// Runs exclusively on a disposable GitHub Actions runner, local loopback only.
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { issueSandboxTicket } from '../server/src/services/sandboxTickets.ts';

const base=process.env.SANDBOX_BROWSER_BASE_URL ?? '';
const secret=process.env.SANDBOX_SHARED_SECRET ?? '';
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(base) || secret.length<32 ||
    process.env.TRAKSOS_RUN_DISPOSABLE_SCENARIO!=='true')
  throw Error('Browser review requires a local disposable sandbox and ticket secret');

const roles=[
  ['client','#/'],['driver','#/'],['master','#/work'],
  ['tow','#/work'],['service','#/base'],['admin','#/admin'],
];
const out='e2e/shots/sandbox-real-browser';
await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true});
try{
  for(const width of [390,1440]){
    for(const [role,landing] of roles){
      const context=await browser.newContext({
        viewport:{width,height:width===390?844:900},locale:'ru-RU',
      });
      const page=await context.newPage();
      const errors=[];
      page.on('pageerror',error=>errors.push(error.message));
      try{
        const ticket=issueSandboxTicket(role,secret);
        await page.goto(base+'/#/sandbox-enter?ticket='+encodeURIComponent(ticket),{
          waitUntil:'domcontentloaded',
        });
        await page.locator('.sandbox-isolated-banner').waitFor({timeout:25_000});
        await page.waitForFunction(expected=>location.hash===expected,landing,{timeout:20_000});
        const banner=await page.locator('.sandbox-isolated-banner').innerText();
        if(!banner.includes('ДАННЫЕ ИЗОЛИРОВАНЫ'))
          throw Error('Sandbox data-isolation indicator missing for '+role);
        const content=await page.locator('main').first().innerText();
        if(!content.trim() || /Вход по номеру телефона|Отсутствует приглашение/.test(content))
          throw Error('Role did not open a real authenticated cabinet: '+role);
        const geometry=await page.evaluate(()=>({
          client:document.documentElement.clientWidth,
          scroll:document.documentElement.scrollWidth,
        }));
        if(geometry.scroll>geometry.client+3)
          throw Error('Horizontal scroll in '+role+' '+width+': '+JSON.stringify(geometry));
        if(errors.length)throw Error('JavaScript error in '+role+': '+errors.join('; '));
        await page.screenshot({path:out+'/'+role+'-'+width+'.png',fullPage:true});
        console.log('SANDBOX BROWSER PASS',role,width,landing,'approved interface and isolated session');
      }finally{await context.close();}
    }
  }
}finally{await browser.close();}
