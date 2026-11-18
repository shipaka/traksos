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
// The initial ECU inquiry is free, but diagnostics cannot begin until the chosen
// verified specialist quotes a price and scope and the client approves them.
// This intake smoke rejects old pre-priced SOS forms and unverified workshops.
const browser=await chromium.launch();
try{
  for(const width of [390,1440]){
    const ctx=await browser.newContext({viewport:{width,height:900},deviceScaleFactor:1,locale:'ru-RU'});
    const page=await ctx.newPage();
    const errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.addInitScript(token=>{
      localStorage.setItem('traksos.token',token);
      localStorage.setItem('traksos.mode','client');
    },account.token);
    try{
      await page.goto(BASE+'/#/new/ecu',{waitUntil:'domcontentloaded'});
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
      await page.getByRole('heading',{name:'Специалист по ЭБУ',exact:true})
        .waitFor({timeout:25000});
      await page.locator('#f-ecu-station').waitFor();
      await page.locator('#f-what').getByText('Справочник электронных блоков').waitFor();
      const station=page.locator('#f-ecu-station');
      if(!await station.getByText(/нет опубликованных проверенных мастерских/).count())
        throw Error(width+': missing fail-closed notice when no station is published');
      if(await page.locator('#f-agree input[type="checkbox"]').count())
        throw Error(width+': old pre-priced ECU consent is still displayed');
      if(!await page.getByText(/Стоимость диагностики — до начала работы/).count())
        throw Error(width+': pre-work diagnostic quotation terms are missing');
      const create=page.getByRole('button',{name:/Отправить запрос выбранной мастерской/});
      await create.click();
      if(!await station.getByText(/нет опубликованных проверенных мастерских/).count())
        throw Error(width+': unverified workshop path became enabled');
      const overflow=await page.evaluate(()=>({
        content:document.documentElement.scrollWidth,
        viewport:document.documentElement.clientWidth
      }));
      if(overflow.content>overflow.viewport+3)
        throw Error(width+': ECU intake overflow '+JSON.stringify(overflow));
      if(errors.length)throw Error(width+': browser exceptions '+errors.join('; '));
      console.log('PASS ECU intake '+width+'px: free inquiry, diagnostic consent before work, verified station gate');
    }finally{await ctx.close()}
  }
}finally{await browser.close()}
