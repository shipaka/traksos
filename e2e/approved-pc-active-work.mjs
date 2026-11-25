import { watchPageErrors } from './visual-page-errors.mjs';
/**
 * REAL Playwright/Chromium rendering with SYNTHETIC local API data.
 * Never a screenshot of production requests, not proof of real dispatch.
 * Covers active job UI, offers mode, server-controlled step and client/owner
 * selected-order card without a real payment or external SMS.
 */
import {chromium} from 'playwright';
import {build} from 'esbuild';
import {mkdir,writeFile} from 'node:fs/promises';
const BASE=process.env.BASE_URL||'http://127.0.0.1:8080';
if(!['localhost','127.0.0.1'].includes(new URL(BASE).hostname))throw Error('Local CI ONLY');
const output='e2e/shots/pc-active-synthetic';
await mkdir(output,{recursive:true});
const assert=(ok,msg)=>{if(!ok)throw Error(msg)};
const routeBundle=await build({entryPoints:['web/src/clientOrderDestination.ts'],bundle:true,write:false,format:'esm',platform:'node'});
const {clientOrderDestination}=await import('data:text/javascript;base64,'+Buffer.from(routeBundle.outputFiles[0].text).toString('base64'));
const created={order:{id:'new-case',status:'searching',you:'client'}};
assert(clientOrderDestination(created,true)==='?order=new-case','PC client route');
assert(clientOrderDestination(created,false)==='order/new-case','Mobile/native route');
for(const status of ['awaiting_owner','awaiting_payment','accepted','no_performer','cancelled'])
  assert(clientOrderDestination({order:{...created.order,status}},true)==='order/new-case','Full order route for '+status);
assert(clientOrderDestination({...created,confirmationUrl:'https://payment.invalid'},true)==='order/new-case','Payment route must not open search');
assert(clientOrderDestination({order:{...created.order,you:'admin'}},true)==='order/new-case','Nonclient actor must not open search');

/** Real CSS contract on actual authenticated PC role screens.
 * Photograph fills the WHOLE banner; the same truck is on the right,
 * with legible DOM text at left and no second boxed-in image. */
async function assertFullBleedCabinetBanner(page,role) {
 const banner=page.locator('.approved-pc-heading');
 await banner.waitFor({state:'visible'});
 const state=await banner.evaluate(el=>{
  const art=getComputedStyle(el,'::after');
  const box=el.getBoundingClientRect();
  const copy=el.querySelector(':scope > div')?.getBoundingClientRect();
  const image=el.querySelector(':scope > img');
  const feature=el.querySelector(':scope > .traksos-feature-art');
  return {
   role:el.getAttribute('data-role-art'),
   image:art.backgroundImage,mask:art.maskImage,position:art.backgroundPosition,
   background:getComputedStyle(el).backgroundImage,
   imageDisplay:image?getComputedStyle(image).display:'none',
   featureDisplay:feature?getComputedStyle(feature).display:'none',
   copyWidth:copy?.width??0,copyLeft:copy?.left??0,
   cardWidth:box.width,cardLeft:box.left,
   text:el.querySelector('h1')?.textContent||''
  };
 });
 assert(state.role===role && state.image.includes('traksos-role-banners-approved-atlas-20261122.webp'),
  role+': role-specific atlas not applied to the banner '+JSON.stringify(state));
 assert(state.mask.includes('linear-gradient')&&state.imageDisplay==='none'&&state.featureDisplay==='none',
  role+': duplicated rectangular truck or image cutout returned '+JSON.stringify(state));
 assert(state.copyWidth>90&&state.copyWidth<state.cardWidth*.7&&state.copyLeft>=state.cardLeft,
  role+': readable left-hand headline missing '+JSON.stringify(state));
 assert(state.text.length>3,role+': missing real role heading');
}

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
 const assertMasterClean=watchPageErrors(page);
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
 await assertFullBleedCabinetBanner(page,'master');
 assert(await page.locator('.approved-pc-performer-case').count()===1,'Active job not opened');
 assert(await page.getByRole('button',{name:'Выехал'}).count()===1,'Correct first status action missing');
 assert(await page.locator('.approved-pc-techbook').count()===1,'TechBase book not on vehicle photo');
 await page.screenshot({path:output+'/master-active-1647.png',fullPage:false,animations:'disabled'});
 await assertMasterClean('master active order');
 await page.getByRole('button',{name:'Выехал'}).click();
 await page.getByRole('button',{name:'Подтвердить прибытие'}).waitFor();
 assert(stepStatus==='en_route','Server-controlled status was not changed');
 await page.screenshot({path:output+'/master-en-route-1647.png',fullPage:false,animations:'disabled'});
 await assertMasterClean('master en route');
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
 await assertMasterClean('master order tabs and proposals');
 report.push({role:'master',status:'PASS',scenarios:['selected work','status sequence','TechBase','case tabs','offers mode'],
   screenshots:['master-active-1647.png','master-en-route-1647.png','master-new-proposals-1647.png']});
 await ctx.close();

 const owner=await account({phone:'+79990000472',type:'owner',mode:'client'});
 const oc=await browser.newContext({viewport:{width:1647,height:927},locale:'ru-RU',serviceWorkers:'block'});
 const op=await oc.newPage();
 const assertOwnerClean=watchPageErrors(op);
 const searchId='synthetic-approved-pc-search';
 let searchStatus='searching',chosenOffer='',searchAvailable=false,searchDenied=false;
 const consultId='synthetic-created-consult';
 let consultCreated=false;
 const consultOrder={...order,id:consultId,number:'LOCAL-0004',you:'client',service:'consult',status:'searching',vehicleId:truck.id};
 const secondOrder=()=>({...order,id:searchId,number:'LOCAL-0003',you:'client',status:searchStatus,vehicleId:truck.id,
   performer:searchStatus==='accepted'?{id:'synthetic-bid-master',name:'Второй мастер CI',rating:4.8}:null});
 await op.route(url=>url.pathname==='/api/orders',async route=>{
   if(route.request().method()==='POST'){
     assert(route.request().postDataJSON().service==='consult','Unexpected synthetic creation');
     consultCreated=true;
     return route.fulfill(json({order:consultOrder,confirmationUrl:null}));
   }
   return route.fulfill(json([{...order,you:'client',performer_name:'Синтетический мастер',status:'en_route'},
     ...(searchAvailable?[secondOrder()]:[]),...(consultCreated?[consultOrder]:[])]));
 });
 await op.route(url=>url.pathname==='/api/orders/'+consultId,route=>route.fulfill(json(consultOrder)));
 await op.route(url=>url.pathname==='/api/orders/'+consultId+'/offers',route=>route.fulfill(json({autoPick:false,offers:[]})));
 await op.route(url=>url.pathname==='/api/orders/'+searchId,route=>searchDenied
   ?route.fulfill({status:403,contentType:'application/json',body:JSON.stringify({message:'Нет доступа'})})
   :route.fulfill(json(secondOrder())));
 await op.route(url=>url.pathname==='/api/orders/'+searchId+'/offers',
   route=>route.fulfill(json({autoPick:false,offers:[
     {id:'bid-1',name:'Первый мастер CI',price:100000,diffPct:0,eta_minutes:10},
     {id:'bid-2',name:'Второй мастер CI',price:120000,diffPct:0,eta_minutes:15}
   ]})));
 await op.route(url=>url.pathname==='/api/orders/'+searchId+'/offers/bid-2/choose',async route=>{
   assert(route.request().method()==='POST','Expected real choice action');
   chosenOffer='bid-2';searchStatus='accepted';await route.fulfill(json({ok:true}));
 });
 await op.route(url=>url.pathname==='/api/orders/'+id,
   route=>route.fulfill(json({...order,you:'client',status:'en_route',
     performer:{id:'synthetic-master',name:'Синтетический мастер',rating:4.9,rating_count:12,
       car:{brand:'Renault',model:'Master'}}})));
 await op.route(url=>url.pathname==='/api/fleet',route=>route.fulfill(json({cars:[
   {...truck,id:'synthetic-vehicle',driver:{name:'Тестовый водитель CI'}}
 ],pending:[]})));
 await open(op,owner.token,owner.mode,'#/');
 assert(await op.locator('.approved-pc-client').count()===1,'Owner PC home missing');
 await assertFullBleedCabinetBanner(op,'owner');
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
 await assertOwnerClean('owner active order');
 // Open the second order explicitly while another active order exists.
 searchAvailable=true;
 await op.goto(BASE+'/#/?order='+searchId,{waitUntil:'domcontentloaded'});
 const searchCase=op.locator('.approved-pc-search-case');
 await searchCase.waitFor();
 await searchCase.getByText('Второй мастер CI',{exact:true}).waitFor();
 await searchCase.getByRole('button',{name:'Свернуть поиск'}).click();
 assert(!await searchCase.locator('.search-workspace-content').isVisible(),'Search did not collapse on dashboard');
 await searchCase.getByRole('button',{name:'Раскрыть поиск'}).click();
 await op.screenshot({path:output+'/owner-search-1647.png',fullPage:false,animations:'disabled'});
 // Use the actual center pane width, not monitor width, for the search layout.
 async function checkSearchGeometry(p,label){
   const root=p.locator('.approved-pc-search-case .search-workspace');
   await root.locator('.offer').first().waitFor();
   const g=await root.evaluate(el=>{
     const panel=el.querySelector('.search-workspace-content');
     const radar=el.querySelector('.search-workspace-radar');
     const box=el.getBoundingClientRect(),r=radar.getBoundingClientRect();
     const columns=getComputedStyle(panel).gridTemplateColumns.trim().split(/\s+/).length;
     const outside=[...el.querySelectorAll('.offer,.offer button,.search-workspace-toggle,.search-workspace-radar')].some(n=>{
       const b=n.getBoundingClientRect();
       return b.left<box.left-2||b.right>box.right+2;
     });
     return {width:box.width,columns,outside,radarWidth:r.width,radarHeight:r.height,
       dpr:devicePixelRatio,documentWidth:document.documentElement.clientWidth,scrollWidth:document.documentElement.scrollWidth};
   });
   assert(g.columns===(g.width>=680?2:1),label+' wrong pane-based columns '+JSON.stringify(g));
   assert(!g.outside&&g.scrollWidth<=g.documentWidth+3,label+' search overflow '+JSON.stringify(g));
   assert(g.radarWidth>0&&Math.abs(g.radarWidth-g.radarHeight)<2,label+' radar distorted '+JSON.stringify(g));
   return g;
 }
 for(const width of [1280,1440,1920,2560]){
   await op.setViewportSize({width,height:width>=1920?1080:900});
   await checkSearchGeometry(op,String(width));
   await op.screenshot({path:output+'/owner-search-'+width+'.png',fullPage:false,animations:'disabled'});
 }
 await op.setViewportSize({width:1647,height:927});
 const hidpi=await browser.newContext({viewport:{width:1920,height:1080},deviceScaleFactor:2,locale:'ru-RU',serviceWorkers:'block'});
 try{
   const hp=await hidpi.newPage();
   await hp.route(url=>url.pathname==='/api/orders',route=>route.fulfill(json([secondOrder()])));
   await hp.route(url=>url.pathname==='/api/orders/'+searchId,route=>route.fulfill(json(secondOrder())));
   await hp.route(url=>url.pathname==='/api/orders/'+searchId+'/offers',route=>route.fulfill(json({autoPick:false,offers:[
     {id:'bid-1',name:'Первый мастер CI',price:100000,diffPct:0,eta_minutes:10},
     {id:'bid-2',name:'Второй мастер CI',price:120000,diffPct:0,eta_minutes:15}
   ]})));
   await hp.route(url=>url.pathname==='/api/fleet',route=>route.fulfill(json({cars:[truck],pending:[]})));
   await open(hp,owner.token,owner.mode,'#/?order='+searchId);
   const g=await checkSearchGeometry(hp,'1920 HiDPI');
   assert(g.dpr===2,'HiDPI fixture not configured');
   await hp.screenshot({path:output+'/owner-search-1920-hidpi.png',scale:'device',fullPage:false,animations:'disabled'});
 }finally{await hidpi.close();}

 await op.evaluate(()=>{
   const original=Element.prototype.animate;
   window.__caseReveals=[];
   Element.prototype.animate=function(frames,options){
     if(this.matches('.approved-pc-case:not(.approved-pc-search-case)'))window.__caseReveals.push(options?.duration);
     return original.call(this,frames,options);
   };
 });
 await searchCase.locator('.offer').filter({hasText:'Второй мастер CI'}).getByRole('button',{name:'Выбрать за 1200 ₽'}).click();
 await op.locator('.approved-pc-case').getByText('Второй мастер CI',{exact:false}).first().waitFor();
 await searchCase.waitFor({state:'detached'});
 assert(chosenOffer==='bid-2','Dashboard chose wrong offer');
 assert(await op.evaluate(()=>window.__caseReveals.filter(x=>x===320).length===1),'Confirmed assignment must reveal the existing card exactly once');
 assert(await op.locator('.approved-pc-case').getByRole('link',{name:'История автомобиля'}).count()===1,'Existing vehicle history lost after choice');
 assert(await op.locator('.approved-pc-case').getByRole('link',{name:'Открыть заявку и следующий шаг'}).getAttribute('href')==='#/order/'+searchId,'Wrong case after assignment');
 await op.screenshot({path:output+'/owner-search-assigned-1647.png',fullPage:false,animations:'disabled'});
 // A denied selected order must never silently fall back to the first order.
 searchDenied=true;
 await op.reload({waitUntil:'domcontentloaded'});
 await op.locator('.approved-pc-center').getByText(/Ошибка загрузки данных/).waitFor();
 assert(await op.locator('.approved-pc-center').getByText('Синтетический мастер',{exact:false}).count()===0,'Selected-order denial exposed another case');
 searchDenied=false;
 await assertOwnerClean('owner selected search lifecycle');
 // Real form submit, synthetic server response. Existing older cases must not win.
 const consultPricingRoute=url=>url.pathname==='/api/pricing';
 const consultVehiclesRoute=url=>url.pathname==='/api/vehicles';
 await op.route(consultPricingRoute,route=>route.fulfill(json({payments:{invoice:true},consult:{price:70000,backDiscount:20000,backHours:48}})));
 await op.route(consultVehiclesRoute,route=>route.fulfill(json([truck])));
 await op.goto(BASE+'/#/new/consult',{waitUntil:'domcontentloaded'});
 await op.locator('#f-car select.field').waitFor();
 await op.locator('#f-car select.field').selectOption(truck.id);
 await op.locator('#f-agree input').check();
 await op.getByRole('button',{name:/Заказать консультацию/}).click();
 await op.waitForURL(url=>url.hash==='#/?order='+consultId);
 await op.locator('.approved-pc-search-case').getByText(/LOCAL-0004/).waitFor();
 assert(consultCreated,'Consultation form did not create order');
 assert(await op.locator('.approved-pc-search-case .offer').count()===0,'Empty search invented offers');
 await assertOwnerClean('owner new consultation search routing');
 await op.unroute(consultPricingRoute);
 await op.unroute(consultVehiclesRoute);
 // Shared inner-screen banners must NOT overlay the old separate photo tile
 // on top of the approved full-card photograph, as caught in real screenshots.
 await op.goto(BASE+'/#/garage',{waitUntil:'domcontentloaded'});
 const innerHero=op.locator('.desktop-content > .tr-inner-hero');
 await innerHero.waitFor({state:'visible'});
 const visual=await innerHero.evaluate(el=>({
   background:getComputedStyle(el).backgroundImage,
   separateArt:el.querySelector('.tr-inner-hero-art')
     ?getComputedStyle(el.querySelector('.tr-inner-hero-art')).display:'none',
   copyWidth:el.querySelector('.tr-inner-hero-copy')?.getBoundingClientRect().width||0,
   cardWidth:el.getBoundingClientRect().width
 }));
 assert(visual.background.includes('owner20-photo-background-approved-retouched.webp') &&
   visual.separateArt==='none' &&
   visual.copyWidth>90 && visual.copyWidth<visual.cardWidth*.72,
   'Inner cabinet hero still has a rectangular pasted image, missing photo or clipped left copy: '+JSON.stringify(visual));
 await op.screenshot({path:output+'/owner-garage-full-bleed-1647.png',fullPage:false,animations:'disabled'});
 await assertOwnerClean('owner garage');
 report.push({role:'owner',status:'PASS',scenarios:['selected order','performer details','safe GPS absence'],
   screenshots:['owner-active-1647.png']});
 await oc.close();

 // The real mobile browser uses the approved 618-style workspace. Its first
 // viewport must not be consumed by an unsolicited multi-line tutorial.
 const mobileContext=await browser.newContext({viewport:{width:390,height:844},locale:'ru-RU',serviceWorkers:'block'});
 const mobilePage=await mobileContext.newPage();
 const assertMobileClean=watchPageErrors(mobilePage);
 await mobilePage.addInitScript(({token,mode})=>{
   localStorage.setItem('traksos.token',token);
   localStorage.setItem('traksos.mode',mode);
 },owner);
 await mobilePage.goto(BASE+'/#/',{waitUntil:'domcontentloaded'});
 await mobilePage.locator('.and19-workspace.and19-client').waitFor({timeout:18000});
 assert(await mobilePage.locator('.tr-training-invite').count()===0,
   'Mobile browser 390px is obstructed by the old first-visit training ribbon');
 assert(await mobilePage.locator('section[aria-label="Знакомство с TrakSOS"]').count()===0,
   'Mobile browser shows a second unsolicited introduction');
 await mobilePage.screenshot({path:output+'/owner-mobile-no-training-banner-390.png',
   fullPage:false,animations:'disabled'});
 await assertMobileClean('owner mobile workdesk');
 report.push({role:'owner mobile browser',status:'PASS',
   scenarios:['approved 618 workspace starts without training banners'],
   screenshots:['owner-mobile-no-training-banner-390.png']});
 await mobileContext.close();

 // API failures must not masquerade as a genuinely empty approved desktop.
 // Retry must recover to the truthful server-confirmed empty state.
 const ec=await browser.newContext({viewport:{width:1440,height:900},locale:'ru-RU',serviceWorkers:'block'});
 const ep=await ec.newPage();
 const assertRetryClean=watchPageErrors(ep);
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
 await assertRetryClean('owner API unavailable');
 ordersUnavailable=false;
 await ep.locator('.approved-pc-center').getByRole('button',{name:'Обновить'}).click();
 await ep.locator('.approved-pc-center').getByText(/Активных заявок сейчас нет/).waitFor();
 await assertRetryClean('owner API retry');
 report.push({role:'owner API error/retry',status:'PASS',
   scenarios:['no false empty orders','no false empty fleet','retry on genuine empty response']});
 await ec.close();

 const mc=await browser.newContext({viewport:{width:1440,height:900},locale:'ru-RU',serviceWorkers:'block'});
 const mp=await mc.newPage();
 const assertFailureClean=watchPageErrors(mp);
 await mp.route(url=>url.pathname==='/api/orders'&&url.searchParams.get('as')==='performer',
   route=>route.fulfill(unavailable));
 await open(mp,master.token,master.mode,'#/work');
 await mp.locator('.approved-pc-shift-empty').getByText(/Ошибка загрузки данных/).waitFor();
 assert(await mp.locator('.approved-pc-shift-empty [data-orders="0"]').count()===0,
   'Master dashboard must not display an empty shift until the server confirms zero orders');
 await assertFailureClean('master API unavailable');
 report.push({role:'master API error',status:'PASS',scenarios:['no synthetic empty shift on server failure']});
 await mc.close();
}finally{await browser.close()}
await writeFile(output+'/report.json',JSON.stringify({
 source:'Actual Chromium rendering of real React components; LOCAL SYNTHETIC API FIXTURES',
 synthetic:true,production:false,generated_at:new Date().toISOString(),results:report
},null,2));
console.log('Approved PC active work: '+JSON.stringify(report));
