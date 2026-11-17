// Real customer ECU quotation/consent smoke, run only against isolated local CI.
import {chromium} from 'playwright';

const BASE=process.env.BASE_URL??'http://localhost:8080';
const origin=new URL(BASE);
if(!['localhost','127.0.0.1'].includes(origin.hostname))
  throw Error('ECU consent E2E must only run against the local test server');
const post=async(path,body)=>{
  const response=await fetch(BASE+path,{
    method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)
  });
  const payload=await response.json();
  if(!response.ok)throw Error(path+' HTTP '+response.status);
  return payload;
};
const phone='+79990000978'; // isolated synthetic developer fixture; no real SMS
const code=await post('/api/auth/code',{phone});
if(!/^\d{4,6}$/.test(code.devCode??''))
  throw Error('Synthetic local test code unavailable');
const account=await post('/api/auth/verify',{
  phone,code:code.devCode,accountType:'owner',password:'SyntheticTest2026-Only!'
});
if(!account.user?.roles?.includes('client'))throw Error('Synthetic client role unavailable');
const browser=await chromium.launch();
try{
  for(const width of [390,1440]){
    const ctx=await browser.newContext({
      viewport:{width,height:900},deviceScaleFactor:1,locale:'ru-RU'
    });
    const page=await ctx.newPage();
    const errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.addInitScript(token=>{
      localStorage.setItem('traksos.token',token);
      localStorage.setItem('traksos.mode','client');
    },account.token);
    try{
      await page.goto(BASE+'/#/',{waitUntil:'domcontentloaded'});
      for(let n=0;n<6;n++){
        const modal=page.locator('[role="dialog"]').first();
        if(!await modal.isVisible().catch(()=>false))break;
        const check=modal.locator('input[type="checkbox"]');
        if(await check.count())await check.first().check();
        const accept=modal.getByRole('button',{name:/Принимаю/});
        if(!await accept.count())break;
        await accept.click();
        await modal.waitFor({state:'hidden'});
      }
      const cookie=page.getByRole('button',{name:'Понятно'});
      if(await cookie.isVisible().catch(()=>false))await cookie.click();
      await page.goto(BASE+'/#/new/ecu',{waitUntil:'domcontentloaded'});
      await page.getByRole('heading',{name:'Специалист по ЭБУ',exact:true})
        .waitFor({timeout:20000});
      await page.locator('#f-where').waitFor();
      const consent=page.locator('#f-agree');
      await consent.waitFor();
      if(await consent.locator('input[type="checkbox"]').count())
        throw Error(width+': customer could accept ECU price before selecting a zone');
      if(!await consent.getByText(/Сначала укажите местоположение/).count())
        throw Error(width+': missing unpriced stage explanation');
      const address=page.locator('#f-where input.field');
      await address.fill('Санкт-Петербург, тестовая парковка');
      await page.locator('#f-where .scroll-x button.chip')
        .filter({hasText:'Санкт-Петербург'}).click();
      await consent.locator('input[type="checkbox"]').waitFor({timeout:20000});
      if(await consent.locator('input[type="checkbox"]').isChecked())
        throw Error(width+': ECU quote auto-accepted without consent');
      await consent.locator('input[type="checkbox"]').check();
      if(!await consent.locator('input[type="checkbox"]').isChecked())
        throw Error(width+': user cannot accept the displayed quotation');
      await address.fill('Санкт-Петербург, другая тестовая стоянка');
      // A changed route invalidates the prior price/consent immediately.
      await page.waitForFunction(()=>{
        const old=document.querySelector('#f-agree input[type="checkbox"]');
        return !old || !old.checked;
      },null,{timeout:12000});
      const sizes=await page.evaluate(()=>({
        content:document.documentElement.scrollWidth,
        viewport:document.documentElement.clientWidth
      }));
      if(sizes.content>sizes.viewport+3)
        throw Error(width+': ECU quote screen overflow '+JSON.stringify(sizes));
      if(errors.length)throw Error(width+': browser exceptions '+errors.join('; '));
      console.log('PASS ECU quote '+width+'px: no early consent, explicit zone, revocation on edit');
    }finally{await ctx.close()}
  }
}finally{await browser.close()}
