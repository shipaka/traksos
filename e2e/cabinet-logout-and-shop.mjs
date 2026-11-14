// Check explicit sign-out and role-specific storefront restrictions.
// Synthetic local CI fixtures only; never target an external host.
import { chromium } from 'playwright';
const BASE=process.env.BASE_URL??'http://127.0.0.1:8080';
if(!['localhost','127.0.0.1'].includes(new URL(BASE).hostname))
  throw Error('Cabinet security browser test is local-only');
async function login(phone,password){
  const r=await fetch(BASE+'/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({phone,password})});
  if(!r.ok)throw Error('CI fixture sign-in failed: '+r.status);
  return (await r.json()).token;
}
const browser=await chromium.launch();
try{
  for(const width of [390,1440]){
    const token=await login('+79990000141','Test-Role-Only-2026!');
    const ctx=await browser.newContext({viewport:{width,height:900},locale:'ru-RU'});
    const page=await ctx.newPage();
    const jsErrors=[];
    page.on('pageerror',e=>jsErrors.push(e.message));
    await page.addInitScript(t=>{
      localStorage.setItem('traksos.token',t);
      localStorage.setItem('traksos.mode','client');
    },token);
    await page.goto(BASE+'/#/profile');
    await page.locator('.account-menu > summary').click();
    const menu=page.getByRole('navigation',{name:'Все разделы кабинета'});
    await menu.getByRole('button',{name:'Выйти из аккаунта'}).click();
    await page.waitForURL(/#\/login$/,{timeout:15000});
    await page.waitForFunction(()=>localStorage.getItem('traksos.token')===null);
    if(jsErrors.length)throw Error(width+'px JS: '+jsErrors.join('; '));
    await ctx.close();
  }
  for(const role of [
    {name:'admin',phone:'+79990000001',password:'TrackSOS-Test-2026!',home:'#/admin',mode:'admin'},
    {name:'insurer',phone:'+79990000145',password:'Test-Role-Only-2026!',home:'#/insurance',mode:'insurer'}
  ]){
    const token=await login(role.phone,role.password);
    const ctx=await browser.newContext({viewport:{width:390,height:900},locale:'ru-RU'});
    const page=await ctx.newPage();
    await page.addInitScript(({token,mode})=>{
      localStorage.setItem('traksos.token',token);localStorage.setItem('traksos.mode',mode);
    },{token,mode:role.mode});
    await page.goto(BASE+'/'+role.home);
    await page.locator('.account-menu > summary').click();
    const links=await page.locator('.account-menu nav a').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('href')));
    if(links.some(x=>x==='#/shop'||x==='#/admin/section/shop'))
      throw Error(role.name+': forbidden shop appears in menu');
    if(await page.locator('.tabbar a[href="#/shop"]').count())
      throw Error(role.name+': forbidden shop appears in bottom tabs');
    await page.goto(BASE+'/#/shop');
    await page.getByText('Магазин доступен в клиентском кабинете или кабинете исполнителя.').waitFor();
    await ctx.close();
  }
}finally{await browser.close()}
console.log('Cabinet account logout on 390/1440 and shop isolation for admin/insurer OK');
