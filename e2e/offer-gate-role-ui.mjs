// Local Chromium proof: a mixed-role administrator is not forced to accept
// unrelated client terms while managing the platform. No real agreements,
// signatures, accounts, payments or production endpoints are modified.
import {chromium} from 'playwright';
import assert from 'node:assert/strict';

const BASE=process.env.BASE_URL||'http://127.0.0.1:8080';
if(!['localhost','127.0.0.1'].includes(new URL(BASE).hostname))
  throw Error('Offer role audit is local CI only');
const login=await fetch(BASE+'/api/auth/login',{
  method:'POST',headers:{'content-type':'application/json'},
  body:JSON.stringify({phone:'+79990000001',password:'TrakSOS-Test-2026!'}),
});
if(!login.ok)throw Error('Local mixed-role admin fixture login failed: '+login.status);
const {token,user}=await login.json();
assert(user.roles.includes('admin')&&user.roles.includes('client'),
  'the test must use one account with both admin and client roles');

const iso='2026-11-19T10:00:00.000Z';
const client={id:'00000000-0000-4000-8000-000000000221',audience:'client',
  version:'0.2-черновик',summary:'Только локальная фикстура',effective_at:iso};
const privacy={id:'00000000-0000-4000-8000-000000000222',audience:'privacy',
  version:'0.3-черновик',summary:'Отдельная тестовая редакция',effective_at:iso};
let privacyAccepted=false;
const browser=await chromium.launch();
try{
  const context=await browser.newContext({viewport:{width:390,height:844},locale:'ru-RU'});
  const page=await context.newPage();
  await page.addInitScript(t=>{
    localStorage.setItem('traksos.token',t);
    localStorage.setItem('traksos.mode','admin');
  },token);
  await page.route('**/api/me/offers',route=>route.fulfill({
    status:200,contentType:'application/json',
    body:JSON.stringify([
      {audience:'client',name:'Оферта для клиентов',current:client,accepted:false},
      {audience:'privacy',name:'Согласие на обработку персональных данных',current:privacy,accepted:privacyAccepted},
    ]),
  }));
  await page.route('**/api/offers/00000000-0000-4000-8000-00000000022*',route=>{
    const o=route.request().url().endsWith('221')?client:privacy;
    return route.fulfill({status:200,contentType:'application/json',
      body:JSON.stringify({...o,body:'# Отдельный тестовый черновик'})});
  });
  await page.goto(BASE+'/#/admin',{waitUntil:'domcontentloaded'});
  await page.getByRole('dialog',{name:'Согласие на обработку персональных данных'})
    .waitFor({state:'visible',timeout:15000});
  assert.equal(await page.getByRole('dialog',{name:'Оферта для клиентов'}).count(),0,
    'Client terms must not overlay the admin workspace');
  await page.getByText(/Тестовый черновик для проверки интерфейса/).waitFor();

  // Privacy accepted in the MOCK response only. Do not submit to the real DB.
  privacyAccepted=true;
  const got=page.waitForResponse(r=>r.url().endsWith('/api/me/offers')&&r.ok());
  await page.reload({waitUntil:'domcontentloaded'});
  await got;
  await page.locator('.account-menu > summary').waitFor();
  await page.waitForTimeout(150);
  assert.equal(await page.getByRole('dialog').count(),0,
    'Admin was still blocked by terms of an inactive client role');
  await page.evaluate(()=>{
    localStorage.setItem('traksos.mode','client');
    location.hash='#/';
  });
  await page.reload({waitUntil:'domcontentloaded'});
  await page.getByRole('dialog',{name:'Оферта для клиентов'})
    .waitFor({state:'visible',timeout:15000});
  assert.equal(await page.getByRole('dialog',{name:'Согласие на обработку персональных данных'}).count(),0);
  await context.close();

  const guest=await browser.newContext({viewport:{width:390,height:844},locale:'ru-RU'});
  const publicPage=await guest.newPage();
  await publicPage.route('**/api/offers/current/privacy',route=>route.fulfill({
    status:200,contentType:'application/json',
    body:JSON.stringify({...privacy,body:'# Тестовый текст без юридического статуса'}),
  }));
  await publicPage.goto(BASE+'/#/offer/privacy',{waitUntil:'domcontentloaded'});
  await publicPage.getByText(/Не является окончательной юридической редакцией/).waitFor();
  assert(!(await publicPage.locator('main.public-offer-page').innerText())
    .includes('Действующая правовая редакция'),
    'Privacy draft must not be labelled as an effective approved legal document');
  await guest.close();
  console.log('Role-scoped consent gate and clearly-labelled privacy drafts: OK');
}finally{await browser.close();}
