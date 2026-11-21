/**
 * Owner-approved courier PC/Android: REAL Chromium + LOCAL backend proof.
 * No real shipments, customer data, payment, or public courier self-registration.
 */
import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
const BASE=process.env.BASE_URL||'http://127.0.0.1:8080';
if(!['localhost','127.0.0.1'].includes(new URL(BASE).hostname))throw Error('Local CI only');
const output='e2e/shots/courier-pc-approved';
await mkdir(output,{recursive:true});
const report={syntheticAccounts:true,production:false,checks:[],screenshots:[]};
async function api(path,method='GET',body,token){
 const r=await fetch(BASE+path,{method,headers:{
   ...(body?{'content-type':'application/json'}:{}),
   ...(token?{authorization:'Bearer '+token}:{})
 },...(body?{body:JSON.stringify(body)}:{})});
 const data=await r.json().catch(()=>null);
 if(!r.ok)throw Error(path+' HTTP '+r.status+' '+JSON.stringify(data));
 return data;
}
async function account(phone,password){
 let auth;
 try{auth=await api('/api/auth/login','POST',{phone,password});}
 catch(e){
   if(!/HTTP (401|404)/.test(String(e)))throw e;
   const code=await api('/api/auth/code','POST',{phone});
   if(!/^\d{4,6}$/.test(code.devCode||''))throw Error('No LOCAL SMS code');
   auth=await api('/api/auth/verify','POST',{phone,code:code.devCode,accountType:'owner',password});
 }
 return auth;
}
const admin=await account('+79990000348','Visual-Local-2026!');
if(!(await api('/api/me','GET',undefined,admin.token)).roles.includes('admin'))
 throw Error('Test admin not in local allowlist');
const original=await account('+79990000350','Courier-Only-Visual-2026!');
const person=await api('/api/me','GET',undefined,original.token);
if(!person.roles.includes('courier'))
 await api('/api/admin/users/'+person.id+'/roles','POST',{roles:['courier']},admin.token);
const courier=await api('/api/auth/login','POST',{
 phone:'+79990000350',password:'Courier-Only-Visual-2026!'
});
const who=await api('/api/me','GET',undefined,courier.token);
if(!who.roles.includes('courier')||who.roles.includes('client'))
 throw Error('Courier must be a separate authorized role');
report.checks.push('admin-authorized courier account and role isolation');
const browser=await chromium.launch();
try{
 for(const width of [1440,390]){
  const ctx=await browser.newContext({viewport:{width,height:width===390?844:900},
    locale:'ru-RU',serviceWorkers:'block'});
  const page=await ctx.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(token=>{
   localStorage.setItem('traksos.token',token);
   localStorage.setItem('traksos.mode','courier');
  },courier.token);
  try{
   await page.goto(BASE+'/#/courier',{waitUntil:'domcontentloaded'});
   const offers=await api('/api/me/offers','GET',undefined,courier.token);
   for(const offer of offers.filter(x=>x.current&&!x.accepted)){
    const dlg=page.getByRole('dialog',{name:offer.name});
    await dlg.waitFor({state:'visible'});
    await dlg.locator('input[type=checkbox]').check();
    await dlg.getByRole('button',{name:'Принимаю'}).click();
    await dlg.waitFor({state:'detached'});
   }
   await page.locator(width===1440?'main.courier-pc':'main.courier-android')
     .waitFor({state:'visible',timeout:15000});
   if(width===1440){
    if(await page.locator('.courier-pc-bot img').count()!==1)
      throw Error('Approved TrakBot is missing');
    if(await page.locator('.app > .trakbot-dock').isVisible().catch(()=>false))
      throw Error('Floating TrakBot duplicates the approved courier assistant card and obscures the trip');
    if(await page.locator('.courier-pc-schematic').count()!==1)
      throw Error('Approved schematic is missing');
    const toggle=page.locator('.courier-pc-presence[role="switch"]');
    await toggle.waitFor({state:'visible'});
    const previous=await toggle.getAttribute('aria-checked');
    await toggle.click();
    await page.waitForFunction(previous=>
     document.querySelector('.courier-pc-presence')?.getAttribute('aria-checked')!==previous,
     previous,{timeout:9000});
    report.checks.push('courier desktop layout, TrakBot, real online toggle');
   }else if(await page.locator('.courier-pc').count())
    throw Error('Desktop courier leaked into Android');
   const sizes=await page.evaluate(()=>({
    client:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth
   }));
   if(sizes.scroll>sizes.client+3)throw Error('Horizontal overflow '+JSON.stringify(sizes));
   if(errors.length)throw Error('JS error: '+errors.join(' | '));
   const home='courier-home-'+width+'.png';
   await page.screenshot({path:output+'/'+home,fullPage:true,animations:'disabled'});
   report.screenshots.push(home);
   // Click the visible role workdesk link, not the hidden duplicate in common navigation.
   await page.locator((width===1440?'main.courier-pc':'main.courier-android')+' a[href="#/courier/jobs"]').first().click();
   await page.locator('main.courier-android').waitFor({state:'visible'});
   await page.getByRole('heading',{name:'Мои рейсы'}).waitFor();
   const jobs='courier-jobs-'+width+'.png';
   await page.screenshot({path:output+'/'+jobs,fullPage:true,animations:'disabled'});
   report.screenshots.push(jobs);
   if(errors.length)throw Error('Courier navigation JS error '+errors.join(' | '));
   report.checks.push('real courier route and clickable jobs navigation '+width);
  }finally{await ctx.close();}
 }
}finally{await browser.close();}
await writeFile(output+'/report.json',JSON.stringify(report,null,2));
console.log('Courier approved real Chromium proof PASS '+JSON.stringify(report));
