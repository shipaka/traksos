// Chromium checks the real React history filters on local CI only.
// API responses and identity are synthetic, with no real session or payment.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const BASE=process.env.BASE_URL??'http://127.0.0.1:8080';
if(!['localhost','127.0.0.1'].includes(new URL(BASE).hostname))
 throw Error('Performer visual regression only supports local CI');
const browser=await chromium.launch();
try {
 for (const width of [390,1440]) {
  const context=await browser.newContext({
   viewport:{width,height:width===390?844:900},locale:'ru-RU',
  });
  const page=await context.newPage();
  const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{
   localStorage.setItem('traksos.token','local-performer-history-canon');
   localStorage.setItem('traksos.mode','performer');
   localStorage.setItem('traksos.cookie','1');
  });
  await page.route('**/api/**',async route=>{
   const name=new URL(route.request().url()).pathname;
   const body=name==='/api/me'
    ? {id:'local-performer',phone:'+79000000021',roles:['tow'],status:'active',
       name:'Локальный эвакуатор',owner_id:null,company_name:null,
       company_inn:null,rating:null,rating_count:0,
       performer:{id:'local-tow',kind:'tow',line_status:'offline'}}
    : name==='/api/orders' || name==='/api/performer/blacklist' ? []
    : name==='/api/me/offers' ? []
    : name==='/api/legal' ? {brand:'TrakSOS'}
    : name==='/api/me/notifications' ? {unread:0,items:[]}
    : name==='/api/auth/realtime-ticket' ? {ticket:'local-only'}
    : null;
   await route.fulfill({
    status:body===null?404:200,
    contentType:'application/json',
    body:JSON.stringify(body??{})
   });
  });
  await page.goto(BASE+'/#/work/jobs',{waitUntil:'domcontentloaded'});
  const group=page.locator('main.performer-orders-page [role="tablist"]');
  await group.waitFor({state:'visible',timeout:15000});
  for(const label of ['Все заявки','По машинам','Чёрный список']){
   const button=group.getByRole('button',{name:label,exact:true});
   await button.click();
   assert.equal(await button.getAttribute('aria-pressed'),'true',
    width+': '+label+' no longer switches history filter');
   const active=group.locator('.seg[aria-pressed="true"]');
   assert.equal(await active.count(),1,width+': only one filter is selected');
   const background=await active.evaluate(el=>getComputedStyle(el).backgroundImage);
   assert(background.includes('rgb(239, 130, 37)'),
    width+': legacy magenta remains instead of approved orange: '+background);
  }
  assert.equal(errors.length,0,width+': uncaught React errors: '+errors.join('; '));
  await context.close();
 }
 console.log('Performer jobs 390/1440: three working real tabs; one orange active selection; no magenta');
} finally { await browser.close(); }
