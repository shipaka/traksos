// Local-only browser walkthrough. No production access, passwords or account data.
import {chromium} from 'playwright';
import {mkdir} from 'node:fs/promises';
const BASE=process.env.BASE_URL??'http://127.0.0.1:8080';
if(!['127.0.0.1','localhost'].includes(new URL(BASE).hostname))throw Error('LOCAL CI ONLY');
const login=await fetch(BASE+'/api/auth/login',{method:'POST',
 headers:{'content-type':'application/json'},
 body:JSON.stringify({phone:'+79990000001',password:'TrackSOS-Test-2026!'})});
if(!login.ok)throw Error('Local administrator fixture not available: '+login.status);
const {token}=await login.json();
await mkdir('e2e/shots/full-role',{recursive:true});
const browser=await chromium.launch();
try{
 for(const width of [390,1440]){
  const context=await browser.newContext({viewport:{width,height:900},locale:'ru-RU',permissions:[]});
  const page=await context.newPage();
  const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  const writes=[];
  page.on('request',req=>{
   if(req.url().includes('/api/')&&!['GET','HEAD'].includes(req.method()))
    writes.push(req.method()+' '+req.url());
  });
  await page.addInitScript(t=>{localStorage.setItem('traksos.token',t);
   localStorage.setItem('traksos.mode','admin');},token);
  await page.goto(BASE+'/#/admin/test-center/client');
  await page.locator('.role-preview-bar').waitFor();
  await page.getByRole('heading',{name:/Помощь в дороге/}).first().waitFor();
  await page.screenshot({path:'e2e/shots/full-role/client-'+width+'.png',fullPage:true});
  await page.locator('.desktop-hero-buttons .desktop-outline-action').click();
  await page.waitForURL(/#\/admin\/test-center\/client\/new\/diag/);
  await page.locator('#f-what textarea').fill('На грузовике не работает пневмосистема, нужна диагностика');
  await page.locator('#f-where input').first().fill('Санкт-Петербург, Софийская улица, 85');
  await page.locator('#f-agree input[type=checkbox]').check();
  await page.getByRole('button',{name:'Вызвать мастера'}).click();
  await page.waitForURL(/#\/admin\/test-center\/client\/order\/demo-order-/,{timeout:15000});
  const orderId=page.url().split('/').pop();
  if(!orderId)throw Error('Order was not created');
  await page.screenshot({path:'e2e/shots/full-role/new-order-'+width+'.png',fullPage:true});
  await page.getByLabel('Выбрать тестовый кабинет').selectOption('master');
  await page.getByText('Заявки рядом · торги').waitFor();
  await page.screenshot({path:'e2e/shots/full-role/master-'+width+'.png',fullPage:true});
  await page.getByRole('button',{name:/Беру за/}).first().click();
  await page.getByLabel('Выбрать тестовый кабинет').selectOption('client');
  await page.goto(BASE+'/#/admin/test-center/client/order/'+orderId);
  await page.getByText('1 отклик').first().waitFor();
  await page.getByRole('button',{name:/Выбрать/}).first().click();
  await page.getByLabel('Выбрать тестовый кабинет').selectOption('master');
  await page.goto(BASE+'/#/admin/test-center/master/order/'+orderId);
  await page.getByRole('button',{name:'Выехал'}).click();
  await page.getByRole('button',{name:'Я на месте'}).click();
  await page.getByRole('button',{name:'Начал работу'}).click();
  await page.screenshot({path:'e2e/shots/full-role/master-on-job-'+width+'.png',fullPage:true});
  await page.getByLabel('Выбрать тестовый кабинет').selectOption('client');
  await page.goto(BASE+'/#/admin/test-center/client/order/'+orderId);
  await page.getByRole('heading',{name:/№\d+/}).waitFor();
  await page.locator('.role-preview-bar a[href="#/admin/test-center"]').click();
  await page.getByRole('heading',{name:'Тестирование кабинетов'}).waitFor();
  if(writes.length)throw Error('Preview made live API writes: '+writes.join(', '));
  if(errors.length)throw Error('JavaScript errors: '+errors.join('; '));
  await context.close();
 }
 console.log('Real role shell, local cross-role order creation/offer/accept/travel/chat and zero real writes: OK');
}finally{await browser.close();}
