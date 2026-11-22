// Courier browser layout regression. Chromium and a local fully mocked
// courier-only session. Never calls real users, SMS, payments or production.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const BASE=process.env.BASE_URL??'http://127.0.0.1:8080';
if(!['localhost','127.0.0.1'].includes(new URL(BASE).hostname))
  throw Error('Courier mobile chrome check runs on local CI only');
const browser=await chromium.launch();
try{
 for(const width of [320,390]){
  const context=await browser.newContext({
   viewport:{width,height:844},locale:'ru-RU',isMobile:true,hasTouch:true
  });
  const page=await context.newPage();
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>{
   localStorage.setItem('traksos.token','test-courier-browser-only');
   localStorage.setItem('traksos.mode','courier');
   localStorage.removeItem('traksos.cookie');
  });
  await page.route('**/api/**',async route=>{
   const path=new URL(route.request().url()).pathname;
   const body=path==='/api/me'
     ? {id:'local-courier-only',phone:'+79000000054',roles:['courier'],status:'active',
        name:'Курьер — локальный дизайн',owner_id:null,company_name:null,
        company_inn:null,rating:null,rating_count:0,performer:null}
     : path==='/api/courier/jobs' ? []
     : path==='/api/courier/presence' ? {online:false}
     : path==='/api/me/offers' ? []
     : path==='/api/legal' ? {brand:'TrakSOS',tagline:'Тестовый слоган',
        entity:'Тестовый оператор',phone:null,email:null,inn:null,ogrn:null,address:null}
     : path==='/api/me/notifications' ? {unread:0,items:[]}
     : path==='/api/auth/realtime-ticket' ? {ticket:'mock-ci-ticket'}
     : null;
   if(body===null){
    await route.fulfill({status:404,contentType:'application/json',body:'{}'});
    return;
   }
   await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
  });
  await page.goto(BASE+'/#/courier',{waitUntil:'domcontentloaded'});
  await page.locator('main.courier-android').waitFor({timeout:15000});
  const footer=page.locator('.desktop-content > .site-footer');
  await footer.waitFor();
  assert.equal(await page.locator('.trakbot-dock').count(),0,
    width+': floating TrakBot covers courier actions/legal links');
  const logo=footer.locator(':scope > .logo');
  assert.equal(await logo.count(),1);
  assert.equal(await logo.evaluate(node=>getComputedStyle(node).display),'none',
    width+': duplicate footer logo is still visible');
  const links=footer.locator('.row.note a');
  assert.equal(await links.count(),4,
    width+': company, offers, privacy and rules links must be kept');
  for(const a of await links.all())assert(await a.isVisible(),width+': legal link hidden');
  const cookies=footer.getByText(/Используем только необходимые cookie/);
  await cookies.waitFor({state:'visible',timeout:5000});
  assert(await footer.getByRole('button',{name:'Понятно'}).isVisible(),
    width+': cookie notice lost');
  const tabs=await page.locator('.tabbar a').evaluateAll(
    items=>items.map(a=>a.getAttribute('href')));
  assert.deepEqual(tabs,['#/courier','#/courier/jobs','#/courier/chat','#/menu'],
    width+': approved four-button courier bottom navigation changed');
  assert.equal(errors.length,0,width+': page errors '+errors.join('; '));

  // A nested route may match both its parent and own tab. The longest
  // matching tab must be the ONLY highlighted navigation destination.
  for(const [route,selected] of [['#/courier/jobs','#/courier/jobs'],
                                  ['#/courier/chat','#/courier/chat']]){
    await page.goto(BASE+'/'+route,{waitUntil:'domcontentloaded'});
    await page.locator('.tabbar a[href="'+selected+'"]').waitFor();
    await page.waitForTimeout(90);
    const active=await page.locator('.tabbar a.on').evaluateAll(
      links=>links.map(a=>a.getAttribute('href')));
    assert.deepEqual(active,[selected],
      width+': multiple courier bottom tabs selected for '+route);
  }

  await page.goto(BASE+'/#/menu',{waitUntil:'domcontentloaded'});
  await page.locator('.tr-mobile-menu-page').waitFor();
  assert.equal(await page.locator('a[href="#/trakbot"]').count()>0,true,
    width+': opt-in TrakBot must remain available in Menu');
  await context.close();
 }
 // Same parent-prefix bug affected the real desktop admin orders screenshot:
 // /admin and /admin/section/orders were both marked active.
 const desktop=await browser.newContext({viewport:{width:1440,height:900},locale:'ru-RU'});
 const adminPage=await desktop.newPage();
 await adminPage.addInitScript(()=>{
   localStorage.setItem('traksos.token','local-admin-nav-only');
   localStorage.setItem('traksos.mode','admin');
 });
 await adminPage.route('**/api/**',async route=>{
   const path=new URL(route.request().url()).pathname;
   const body=path==='/api/me'
    ? {id:'local-admin-nav',phone:'+79990000001',roles:['admin'],status:'active',
       name:'Тестовая админка',owner_id:null,company_name:null,company_inn:null,
       rating:null,rating_count:0,performer:null}
    : path==='/api/me/offers' ? []
    : path==='/api/me/notifications' ? {unread:0,items:[]}
    : path==='/api/legal' ? {brand:'TrakSOS'}
    : path==='/api/auth/realtime-ticket' ? {ticket:'mock-ci-ticket'}
    : null;
   await route.fulfill({status:body===null?404:200,contentType:'application/json',
     body:JSON.stringify(body??{})});
 });
 for(const [route,expected] of [['#/admin','#/admin'],
                                 ['#/admin/section/orders','#/admin/section/orders'],
                                 ['#/admin/section/support','#/admin/section/support']]){
   await adminPage.goto(BASE+'/'+route,{waitUntil:'domcontentloaded'});
   await adminPage.locator('.desktop-sidebar .desktop-nav').waitFor();
   await adminPage.locator('.desktop-nav-link[href="'+expected+'"]').waitFor();
   const active=await adminPage.locator('.desktop-sidebar .desktop-nav .desktop-nav-link.active')
     .evaluateAll(items=>items.map(a=>a.getAttribute('href')));
   assert.deepEqual(active,[expected],
     'Desktop admin sidebar has multiple selected routes on '+route);
 }
 await desktop.close();
 console.log('Courier mobile 320/390 + admin desktop 1440: exactly one active navigation item; footer and consent visible');
}finally{await browser.close();}
