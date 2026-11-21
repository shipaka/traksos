/**
 * REAL Playwright/Chromium rendering with SYNTHETIC local API data.
 * Never a screenshot of production requests, not proof of real dispatch.
 * Covers active job UI, offers mode, server-controlled step and client/owner
 * selected-order card without a real payment or external SMS.
 */
import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
const BASE=process.env.BASE_URL||'http://127.0.0.1:8080';
if(!['localhost','127.0.0.1'].includes(new URL(BASE).hostname))throw Error('Local CI ONLY');
const output='e2e/shots/pc-active-synthetic';
await mkdir(output,{recursive:true});
const assert=(ok,msg)=>{if(!ok)throw Error(msg)};
const post=async(path,data,token)=>{const r=await fetch(BASE+path,{
 method:'POST',headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},body:JSON.stringify(data)
});const d=await r.json().catch(()=>null);if(!r.ok)throw Error(path+' '+r.status+' '+JSON.stringify(d));return d};
const get=async(path,token)=>{const r=await fetch(BASE+path,{headers:{authorization:'Bearer '+token}});if(!r.ok)throw Error(path+' '+r.status);return r.json()};
const put=async(path,data,token)=>{const r=await fetch(BASE+path,{
 method:'PUT',headers:{'content-type':'application/json',authorization:'Bearer '+token},body:JSON.stringify(data)
});const d=await r.json().catch(()=>null);if(!r.ok)throw Error(path+' '+r.status+' '+JSON.stringify(d));return d};
async function account({phone,type,mode,kind}){
 const authCode=await post('/api/auth/code',{phone});
 assert(/^\d{4,6}$/.test(authCode?.devCode||''),'Local dev code missing');
 const auth=await post('/api/auth/verify',{phone,code:authCode.devCode,
   accountType:type,password:'Synthetic-Visual-2026!'});
 assert(!!auth.token,'Missing LOCAL test token');
 if(kind){
   const profile=await get('/api/performer/profile',auth.token);
   if(!profile)await put('/api/performer/profile',{
     kind,name:'Синтетический мастер TrakSOS',specialties:['electric','diag'],brands:{},tier:'eco'
   },auth.token);
 }
 return {token:auth.token,mode};
}
const browser=await chromium.launch();
const report=[];
const id='synthetic-approved-pc-case-20261120';
const truck={id:'synthetic-vehicle',brand:'Scania',model:'R520',year:2016,plate:'ТЕСТ 000'};
const order={id,number:'LOCAL-0001',service:'electric',status:'accepted',you:'performer',
 address:'Тестовая стоянка — только CI',description:'Синтетический пример неисправности',
 vehicle:truck,client:{name:'Тестовый клиент CI'},lat:null,lng:null};
const json=(data)=>({status:200,contentType:'application/json',body:JSON.stringify(data)});
async function open(page,token,mode,hash){
 await page.addInitScript(({token,mode})=>{
   localStorage.setItem('traksos.token',token);
   localStorage.setItem('traksos.mode',mode);
 },{token,mode});
 await page.goto(BASE+'/'+hash,{waitUntil:'domcontentloaded'});
 await page.locator('.approved-pc').waitFor({timeout:18000});
 await page.evaluate(()=>document.fonts.ready);
 await page.waitForTimeout(350);
 const dims=await page.evaluate(()=>({width:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth}));
 assert(dims.scroll<=dims.width+3,'Horizontal overflow '+JSON.stringify(dims));
}
try{
 const master=await account({phone:'+79990000471',type:'master',mode:'performer',kind:'master'});
 const ctx=await browser.newContext({viewport:{width:1647,height:927},locale:'ru-RU',serviceWorkers:'block'});
 const page=await ctx.newPage();
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 let stepStatus='accepted';
 await page.route(url=>url.pathname==='/api/orders'&&url.searchParams.get('as')==='performer',
   route=>route.fulfill(json([order])));
 await page.route(url=>url.pathname==='/api/orders/'+id,
   route=>route.fulfill(json({...order,status:stepStatus})));
 await page.route(url=>url.pathname==='/api/orders/'+id+'/photos',
   route=>route.fulfill(json([])));
 await page.route(url=>url.pathname==='/api/orders/'+id+'/step',
   async route=>{
     if(route.request().method()!=='POST')return route.continue();
     const {action}=route.request().postDataJSON();
     const changes={depart:'en_route',arrive:'arrived',start_work:'working'};
     assert((action==='depart'&&stepStatus==='accepted')||
       (action==='arrive'&&stepStatus==='en_route')||
       (action==='start_work'&&stepStatus==='arrived'),'Out-of-order server action: '+action);
     stepStatus=changes[action];
     await route.fulfill(json({...order,status:stepStatus}));
   });
 await page.route(url=>url.pathname==='/api/performer/auctions',
   route=>route.fulfill(json([{order_id:'synthetic-auction',number:'LOCAL-0002',service:'electric',
     description:'Тестовое предложение (не назначено)',address:'Только CI',
     limits:{usual:100000,floor:75000,ceil:125000},my_price:null}])));
 await open(page,master.token,master.mode,'#/work');
 assert(await page.locator('.approved-pc-performer-case').count()===1,'Active job not opened');
 assert(await page.getByRole('button',{name:'Выехал'}).count()===1,'Correct first status action missing');
 assert(await page.locator('.approved-pc-techbook').count()===1,'TechBase book not on vehicle photo');
 await page.screenshot({path:output+'/master-active-1647.png',fullPage:false,animations:'disabled'});
 await page.getByRole('button',{name:'Выехал'}).click();
 await page.getByRole('button',{name:'Подтвердить прибытие'}).waitFor();
 assert(stepStatus==='en_route','Server-controlled status was not changed');
 await page.screenshot({path:output+'/master-en-route-1647.png',fullPage:false,animations:'disabled'});
 // Internal case tabs must not create duplicate order selectors.
 await page.getByRole('tab',{name:'Клиент и ТС'}).click();
 assert(await page.getByText('Тестовый клиент CI').count()>0,'Client details tab broken');
 await page.getByRole('tab',{name:'История'}).click();
 await page.getByRole('tab',{name:'Работа',exact:true}).click();
 await page.getByRole('tab',{name:/Новые предложения/}).click();
 assert(await page.getByText('Тестовое предложение (не назначено)').count()>0,'New proposals mode not rendered');
 await page.screenshot({path:output+'/master-new-proposals-1647.png',fullPage:false,animations:'disabled'});
 await page.getByRole('tab',{name:/Текущая работа/}).click();
 assert(await page.locator('.approved-pc-performer-case').count()===1,'Work mode not restored');
 assert(!errors.length,'Browser errors: '+errors.join(';'));
 report.push({role:'master',status:'PASS',scenarios:['selected work','status sequence','TechBase','case tabs','offers mode'],
   screenshots:['master-active-1647.png','master-en-route-1647.png','master-new-proposals-1647.png']});
 await ctx.close();

 const owner=await account({phone:'+79990000472',type:'owner',mode:'client'});
 const oc=await browser.newContext({viewport:{width:1647,height:927},locale:'ru-RU',serviceWorkers:'block'});
 const op=await oc.newPage();
 const oe=[];op.on('pageerror',e=>oe.push(e.message));
 await op.route(url=>url.pathname==='/api/orders',
   route=>route.fulfill(json([{...order,you:'client',performer_name:'Синтетический мастер',status:'en_route'}])));
 await op.route(url=>url.pathname==='/api/orders/'+id,
   route=>route.fulfill(json({...order,you:'client',status:'en_route',
     performer:{id:'synthetic-master',name:'Синтетический мастер',rating:4.9,rating_count:12,
       car:{brand:'Renault',model:'Master'}}})));
 await op.route(url=>url.pathname==='/api/fleet',route=>route.fulfill(json({cars:[
   {...truck,id:'synthetic-vehicle',driver:{name:'Тестовый водитель CI'}}
 ],pending:[]})));
 await open(op,owner.token,owner.mode,'#/');
 assert(await op.locator('.approved-pc-client').count()===1,'Owner PC home missing');
 // Approved PC 617/role desktop should start with the actual work area,
 // not automatically render a training ribbon or a second first-visit card.
 assert(await op.locator('.tr-training-invite').count()===0,
   'Unapproved automatic training banner pushes the actual PC workplace down');
 assert(await op.locator('.desktop-content section[aria-label="Знакомство с TrakSOS"]').count()===0,
   'Duplicate desktop introduction card must be available from Help, not shown by default');
 // Both courses and the manual guided tour remain reachable inside the top-right menu.
 await op.locator('.account-menu > summary').click();
 assert(await op.locator('.account-menu nav a[href="#/learn"]').count()===1,
   'Platform introduction is missing from the help menu');
 assert(await op.locator('.account-menu nav a[href="#/training"]').count()===1,
   'Step-by-step training is missing from the help menu');
 assert(await op.locator('.account-menu nav .account-menu-tour').count()===1,
   'Manual button tour is missing from the help menu');
 await op.locator('.account-menu > summary').click();
 assert(await op.getByText('Синтетический мастер').count()>0,'Selected performer missing');
 assert(await op.getByText('Текущее местоположение исполнителя не подтверждено.').count()===1,
  'Stale or missing GPS incorrectly displayed as live');
 await op.screenshot({path:output+'/owner-active-1647.png',fullPage:false,animations:'disabled'});
 assert(!oe.length,'Owner browser errors: '+oe.join(';'));
 report.push({role:'owner',status:'PASS',scenarios:['selected order','performer details','safe GPS absence'],
   screenshots:['owner-active-1647.png']});
 await oc.close();

 // API failures must not masquerade as a genuinely empty approved desktop.
 // Retry must recover to the truthful server-confirmed empty state.
 const ec=await browser.newContext({viewport:{width:1440,height:900},locale:'ru-RU',serviceWorkers:'block'});
 const ep=await ec.newPage();
 let ordersUnavailable=true;
 const unavailable={status:503,contentType:'application/json',body:JSON.stringify({error:'ci_outage',message:'Проверка недоступности API'})};
 await ep.route(url=>url.pathname==='/api/orders',
   route=>route.fulfill(ordersUnavailable?unavailable:json([])));
 await ep.route(url=>url.pathname==='/api/fleet',route=>route.fulfill(unavailable));
 await open(ep,owner.token,owner.mode,'#/');
 await ep.locator('.approved-pc-center').getByText(/Ошибка загрузки данных/).waitFor();
 const failedOwnerText=await ep.locator('main.approved-pc-client').innerText();
 assert(!failedOwnerText.includes('Активных заявок сейчас нет.'),
   'Client desktop falsely claims no orders while API is unavailable');
 assert(!failedOwnerText.includes('Машины ещё не добавлены в автопарк.'),
   'Fleet desktop falsely claims there are no vehicles while API failed');
 ordersUnavailable=false;
 await ep.locator('.approved-pc-center').getByRole('button',{name:'Обновить'}).click();
 await ep.locator('.approved-pc-center').getByText(/Активных заявок сейчас нет/).waitFor();
 report.push({role:'owner API error/retry',status:'PASS',
   scenarios:['no false empty orders','no false empty fleet','retry on genuine empty response']});
 await ec.close();

 const mc=await browser.newContext({viewport:{width:1440,height:900},locale:'ru-RU',serviceWorkers:'block'});
 const mp=await mc.newPage();
 await mp.route(url=>url.pathname==='/api/orders'&&url.searchParams.get('as')==='performer',
   route=>route.fulfill(unavailable));
 await open(mp,master.token,master.mode,'#/work');
 await mp.locator('.approved-pc-shift-empty').getByText(/Ошибка загрузки данных/).waitFor();
 assert(await mp.locator('.approved-pc-shift-empty [data-orders="0"]').count()===0,
   'Master dashboard must not display an empty shift until the server confirms zero orders');
 report.push({role:'master API error',status:'PASS',scenarios:['no synthetic empty shift on server failure']});
 await mc.close();
}finally{await browser.close()}
await writeFile(output+'/report.json',JSON.stringify({
 source:'Actual Chromium rendering of real React components; LOCAL SYNTHETIC API FIXTURES',
 synthetic:true,production:false,generated_at:new Date().toISOString(),results:report
},null,2));
console.log('Approved PC active work: '+JSON.stringify(report));
