import { watchPageErrors } from './visual-page-errors.mjs';
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
  const page=await ctx.newPage();
  const assertClean=watchPageErrors(page);
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
    // An empty courier account must not advertise an imaginary live trip.
    if(await page.locator('.courier-pc-trip--empty').count()){
      if(await page.getByText('Мой рейс',{exact:true}).count() ||
         await page.getByText('Маршрутный лист',{exact:true}).count() ||
         await page.locator('.courier-pc-trip--empty .courier-pc-progress').count() ||
         await page.locator('.courier-pc-schematic--empty .courier-pc-route-line button').count())
        throw Error('Empty courier workspace exposes a fictional active trip or route');
      await page.getByText('Пока нет назначенных доставок',{exact:true}).first().waitFor();
    }
    if(await page.locator('.courier-pc-bot img').count()!==1)
      throw Error('Approved TrakBot is missing');
    if(await page.locator('.app > .trakbot-dock').isVisible().catch(()=>false))
      throw Error('Floating TrakBot duplicates the approved courier assistant card and obscures the trip');
    if(await page.locator('.courier-pc-schematic').count()!==1)
      throw Error('Approved schematic is missing');
    report.checks.push('courier desktop layout, TrakBot');
   }else if(await page.locator('.courier-pc').count())
    throw Error('Desktop courier leaked into Android');
   const availability=page.getByLabel('Доступность курьера для новых доставок',{exact:true});
   const toggle=availability.getByRole('button',{name:/Статус · (На линии|Не на линии)/});
   await toggle.waitFor({state:'visible'});
   const previous=(await toggle.innerText()).includes('Не на линии');
   const desired=previous?'На линии':'Не на линии';
   const old=previous?'Не на линии':'На линии';
   await toggle.click();
   const choices=availability.getByLabel('Выбор доступности курьера');
   if(await choices.getByRole('button',{name:old,exact:true}).getAttribute('aria-pressed')!=='true')
     throw Error('Current courier status not marked');
   await choices.getByRole('button',{name:desired,exact:true}).click();
   await availability.getByRole('button',{name:'Статус · '+desired,exact:true}).waitFor({timeout:15000});
   await toggle.click();
   if(await choices.getByRole('button',{name:desired,exact:true}).getAttribute('aria-pressed')!=='true')
     throw Error('Saved courier status not reflected in menu');
   await choices.getByRole('button',{name:old,exact:true}).click();
   await availability.getByRole('button',{name:'Статус · '+old,exact:true}).waitFor({timeout:15000});
   report.checks.push('real courier availability menu and server reload '+width);
   const sizes=await page.evaluate(()=>({
    client:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth
   }));
   if(sizes.scroll>sizes.client+3)throw Error('Horizontal overflow '+JSON.stringify(sizes));
   await assertClean('courier '+width+' workdesk');
   const home='courier-home-'+width+'.png';
   await page.screenshot({path:output+'/'+home,fullPage:true,animations:'disabled'});
   report.screenshots.push(home);
   // Click the visible role workdesk link, not the hidden duplicate in common navigation.
   await page.locator((width===1440?'main.courier-pc':'main.courier-android')+' a[href="#/courier/jobs"]').first().click();
   await page.locator('main.courier-android').waitFor({state:'visible'});
   await page.getByRole('heading',{name:'Мои доставки'}).waitFor();
   const jobs='courier-jobs-'+width+'.png';
   await page.screenshot({path:output+'/'+jobs,fullPage:true,animations:'disabled'});
   report.screenshots.push(jobs);
   await assertClean('courier '+width+' deliveries');
   report.checks.push('real courier route and clickable jobs navigation '+width);
   // Communication is an honest delivery section, not a promise of direct chat.
   // Both PC and phone must open it, then reach real support from the page.
   const communication=page.locator(width===1440
     ? '.desktop-sidebar .desktop-nav a[href="#/courier/chat"]'
     : '.tabbar a[href="#/courier/chat"]');
   await communication.waitFor({state:'visible'});
   await communication.click();
   await page.getByRole('heading',{name:'Связь по доставкам',exact:true}).waitFor();
   await page.getByText('Сообщения с получателем пока не подключены.',{exact:false}).waitFor();
   const supportNav=page.locator('main.courier-android a[href="#/support"]');
   await supportNav.waitFor({state:'visible'});
   await supportNav.click();
   await page.getByRole('heading',{name:'Поддержка',exact:true}).waitFor();
   await page.getByRole('button',{name:'Написать',exact:true}).waitFor();
   await assertClean('courier '+width+' support');
   report.checks.push('courier support shortcut opens real messages and new ticket '+width);

   // Actual courier detail, controlled server state: no real shipment or code.
   const jobId='synthetic-handoff',jobPath='/api/courier/jobs/'+jobId;
   let remaining=5,status='arrived',failRead=false,loseReply=false,writes=0,reads=0;
   await page.route('**'+jobPath,async route=>{
    reads++;
    if(failRead)return route.fulfill({status:503,json:{message:'Synthetic read failure'}});
    return route.fulfill({json:{id:jobId,shopOrderId:'synthetic-order',
      orderNumber:9001,status,items:[{productId:'synthetic-item',name:'Учебная деталь',qty:1}],
      deliveryAddress:null,codeVerified:status==='code_verified',receivedAt:null,
      updatedAt:'2026-11-25T12:00:00Z',codeAttemptsRemaining:remaining}});
   });
   await page.route('**'+jobPath+'/verify',async route=>{
    writes++;
    if(route.request().method()!=='POST')throw Error('Unexpected verification method');
    if(loseReply){status='code_verified';return route.abort('failed');}
    remaining=Math.max(0,remaining-1);
    return route.fulfill({status:400,json:{error:'bad_receipt_code',message:'Учебный неверный код'}});
   });
   await page.goto(BASE+'/#/courier/jobs/'+jobId);
   const code=page.getByRole('textbox',{name:'Шестизначный код вручения'});
   const verify=page.getByRole('button',{name:'Проверить код вручения'});
   await page.getByText('Осталось попыток: 5.',{exact:false}).waitFor();
   for(let left=4;left>=0;left--){
    await code.fill('111111');
    const before=writes;
    await verify.evaluate(el=>{el.click();el.click();});
    await page.getByText('Осталось попыток: '+left+'.',{exact:false}).waitFor();
    if(writes!==before+1)throw Error('Duplicate verification POST');
   }
   await code.fill('111111');
   if(!await verify.isDisabled())throw Error('Exhausted server attempts still permit verification');
   if(writes!==5)throw Error('Wrong code was silently replayed');
   // Simulate server-side reset, reopen the job; never reset a real code.
   remaining=5;
   await page.reload();
   await page.getByText('Осталось попыток: 5.',{exact:false}).waitFor();
   await code.fill('111111');
   failRead=true;
   await verify.click();
   await page.getByText('Не удалось обновить назначенную доставку',{exact:true}).waitFor();
   if(await verify.count())throw Error('Failed reread exposed stale attempt counter');
   if(await page.getByText('Осталось попыток:',{exact:false}).count())throw Error('Failed reread exposed old count');
   failRead=false;
   await page.getByRole('button',{name:'Повторить загрузку',exact:true}).click();
   await page.getByText('Осталось попыток: 4.',{exact:false}).waitFor();
   if(writes!==6)throw Error('Read retry repeated the verification write');
   loseReply=true;
   await code.fill('111111');
   await verify.click();
   await page.getByText('Ожидаем отдельное подтверждение фактического получения от покупателя.',{exact:false}).waitFor();
   if(await verify.count()||writes!==7||reads<9)throw Error('Lost response did not reconcile exactly once');
   if(await page.getByText('Вручение подтверждено покупателем',{exact:true}).count())throw Error('Courier verification falsely completed purchase');
   await assertClean('courier '+width+' receipt reconciliation');
   report.checks.push('courier attempts, failed reread, reset and ambiguous receipt reconciliation '+width);
  }finally{await ctx.close();}
 }
}finally{await browser.close();}
await writeFile(output+'/report.json',JSON.stringify(report,null,2));
console.log('Courier approved real Chromium proof PASS '+JSON.stringify(report));
