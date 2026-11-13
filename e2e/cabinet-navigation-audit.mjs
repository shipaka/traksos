// Full non-destructive navigation audit for every staff, customer and performer cabinet.
// Runs after role-matrix.mjs and admin-master-switch.mjs on synthetic local accounts.
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL ?? 'http://localhost:8080';
if (!['localhost','127.0.0.1'].includes(new URL(BASE).hostname))
  throw Error('Cabinet navigation audit is restricted to local CI');

const accounts = [
  ['owner', '+79990000141', 'Test-Role-Only-2026!', '#/'],
  ['driver', '+79990000142', 'Test-Role-Only-2026!', '#/'],
  ['master', '+79990000147', 'Test-Role-Only-2026!', '#/work'],
  ['tow', '+79990000143', 'Test-Role-Only-2026!', '#/work'],
  ['service', '+79990000144', 'Test-Role-Only-2026!', '#/base'],
  ['master_service', '+79990000146', 'Test-Role-Only-2026!', '#/base'],
  ['insurer', '+79990000145', 'Test-Role-Only-2026!', '#/insurance'],
  ['admin', '+79990000001', 'TrackSOS-Test-2026!', '#/admin'],
];
const browser = await chromium.launch();
const report = [];
try {
  for (const [kind, phone, password, initial] of accounts) {
    const response = await fetch(BASE+'/api/auth/login',{method:'POST',
      headers:{'content-type':'application/json'},body:JSON.stringify({phone,password})});
    if(!response.ok) throw Error(kind+': login fixture failed '+response.status);
    const {token}=await response.json();
    const ctx=await browser.newContext({viewport:{width:390,height:844},locale:'ru-RU'});
    const page=await ctx.newPage();
    const errors=[];
    page.on('pageerror', e=>errors.push(e.message));
    await page.addInitScript(t=>localStorage.setItem('traksos.token',t),token);
    await page.goto(BASE+'/'+initial,{waitUntil:'domcontentloaded'});
    await page.locator('.account-menu > summary').waitFor();
    await page.locator('.account-menu > summary').click();
    const links=await page.locator('.account-menu nav a[href^="#/"]').evaluateAll(
      els=>els.map(el=>({href:el.getAttribute('href'),text:(el.textContent??'').trim()}))
    );
    if(links.length < 6)throw Error(kind+': almost empty cabinet menu');
    const paths=[...new Set(links.map(l=>l.href))];
    if(kind!=='admin' && paths.some(path=>path.startsWith('#/admin/section')))
      throw Error(kind+': sees administrator menu routes');
    if(kind==='admin' && !paths.includes('#/admin/section/queue'))
      throw Error('Admin moderation shortcut missing');
    for(const href of paths){
      await page.goto(BASE+'/'+href,{waitUntil:'domcontentloaded'});
      await page.locator('.app').waitFor({timeout:12000});
      const state=await page.evaluate(()=>({
        missing:document.querySelector('main')?.textContent?.includes('Такой страницы нет'),
        overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth+3,
      }));
      if(state.missing)throw Error(kind+': dead link '+href);
      if(state.overflow)throw Error(kind+': horizontal overflow on '+href);
      if(errors.length)throw Error(kind+': script error at '+href+': '+errors.join('; '));
    }
    report.push({role:kind,visited:paths.length});
    await ctx.close();
  }
} finally {await browser.close();}
console.log('Validated all menu routes in local browser:',JSON.stringify(report));
