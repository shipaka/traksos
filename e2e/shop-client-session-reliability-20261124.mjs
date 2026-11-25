/**
 * Actual ShopCart and ShopHistory React components run in Chromium with a
 * local synthetic API. Never contact production or create real orders.
 */
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {chromium} from 'playwright';

const BASE=process.env.BASE_URL??'http://127.0.0.1:8080';
if(!['localhost','127.0.0.1'].includes(new URL(BASE).hostname))
  throw Error('Only local CI site allowed');
const rootDir=new URL('../',import.meta.url).pathname;
const entry=[
  "import React,{useEffect,useState} from 'react';",
  "import {createRoot} from 'react-dom/client';",
  "import {Shop,ShopCart,ShopHistory} from '../web/src/screens/shop.tsx';",
  "function App(){const [screen,setScreen]=useState('cart');",
  " useEffect(()=>{const handler=()=>setScreen(window.__ciScreen);",
  " window.addEventListener('ci-screen-change',handler);",
  " return ()=>window.removeEventListener('ci-screen-change',handler)},[]);",
  " return screen==='home'?React.createElement(Shop):screen==='history'?React.createElement(ShopHistory):React.createElement(ShopCart);}",
  "createRoot(document.getElementById('root')).render(React.createElement(App));",
].join('\n');
const mockApi=[
  "export const API_URL='';",
  "export const getToken=()=>window.__ciToken;",
  "export const get=(path)=>window.__ciGet(path);",
  "export const post=(path,data)=>window.__ciPost(path,data);",
  "export const put=()=>{throw Error('Unexpected PUT')};",
  "export const del=()=>{throw Error('Unexpected DELETE')};",
  "export const rub=n=>String(n)+' ₽';",
  "export const fmtTime=()=>'';",
  "export const onEvent=()=>()=>{};",
].join('\n');
const mockUI=[
  "import React from 'react';",
  "export function useMe(){",
  " const [id,setId]=React.useState(window.__ciActor);",
  " React.useEffect(()=>{const update=()=>setId(window.__ciActor);",
  " window.addEventListener('ci-actor-change',update);",
  " return ()=>window.removeEventListener('ci-actor-change',update)},[]);",
  " return {me:id?{id,roles:['client'],company_inn:null}:null};",
  "}",
  "export function useLoad(fn,deps){",
  " const [data,setData]=React.useState(null),[error,setError]=React.useState(null);",
  " const f=React.useRef(fn);f.current=fn;",
  " const reload=async()=>{try{setData(await f.current());setError(null)}",
  " catch(e){setData(null);setError(String(e.message))}};",
  " React.useEffect(()=>{setData(null);void reload()},deps);",
  " return {data,error,reload};",
  "}",
  "export function useAction(){",
  " const [busy,setBusy]=React.useState(false);",
  " const run=async fn=>{setBusy(true);try{return await fn()}",
  " catch(e){window.__ciLastActionError=String(e.message);return undefined}",
  " finally{setBusy(false)}};",
  " return {busy,run};",
  "}",
  "export const go=path=>{location.hash='#/'+path};",
  "export const Loading=({error})=>React.createElement('div',{},error||'Загружаю…');",
  "export const Back=({to})=>React.createElement('a',{href:'#/'+to},'Назад');",
  "export const Field=({label,children})=>React.createElement('section',{},label,children);",
  "export const RubInput=()=>null;",
].join('\n');
const compiled=await build({
  stdin:{contents:entry,resolveDir:new URL('../e2e/',import.meta.url).pathname,
    sourcefile:'shop-private-regression-entry.tsx',loader:'tsx'},
  // Match production JSX runtime; real screens import hooks, not a React global.
  bundle:true,write:false,platform:'browser',format:'esm',target:'es2022',jsx:'automatic',
  plugins:[{
    name:'mock-shop-api-and-other-screens',
    setup(b){
      b.onResolve({filter:/\/api\.ts$/},()=>({path:'api',namespace:'mock-shop'}));
      b.onResolve({filter:/\/ui\.tsx$/},()=>({path:'ui',namespace:'mock-shop'}));
      b.onResolve({filter:/\/shopCatalogAdmin\.tsx$/},()=>({path:'adminCatalog',namespace:'mock-shop'}));
      b.onLoad({filter:/.*/,namespace:'mock-shop'},arg=>({
        contents:arg.path==='api'?mockApi:arg.path==='ui'?mockUI:
            'export const AdminShopCatalog=()=>null;',
        loader:'js',resolveDir:rootDir,
      }));
    },
  }],
});
const browser=await chromium.launch();
const pageErrors=[];
try{
  const page=await browser.newPage({serviceWorkers:'block'});
  page.on('pageerror',error=>{pageErrors.push(error.message);console.error('Shop browser error:',error.stack??error.message)});
  const idA='00000000-0000-4000-8000-000000000011';
  const idB='00000000-0000-4000-8000-000000000012';
  await page.route('**/__ci_shop_private_host',r=>r.fulfill({
    contentType:'text/html',
    body:'<!doctype html><meta charset="utf-8"><div id="root"></div>',
  }));
  await page.route('**/__ci_shop_private.mjs',r=>r.fulfill({
    contentType:'text/javascript',body:compiled.outputFiles[0].text,
  }));
  await page.goto(BASE+'/__ci_shop_private_host');
  await page.evaluate(({idA,idB})=>{
    window.__ciActor='A';window.__ciToken='token-A';window.__ciScreen='cart';
    const aCart=Object.fromEntries([[idA,1],...Array.from({length:50},(_,i)=>['zz-ci-old-'+String(i).padStart(2,'0'),1])]);
    localStorage.setItem('traksos.cart.user.A',JSON.stringify(aCart));
    localStorage.setItem('traksos.cart.user.B',JSON.stringify({[idB]:1}));
    window.__ciOrders=[];window.__ciFailPost=true;
    window.__ciHoldASelection=true;
    window.__ciSelectionRequests=[];
    window.__ciGet=async path=>{
      if(path==='/api/shop?light=1')return {
        enabled:true,delivery:{pickup:true,pickupAddress:'CI',delivery:false,
          withMaster:true,deliveryPrice:0,deliveryNote:''},
      };
      if(path==='/api/orders')throw Error('Сеть недоступна для списка заявок');
      if(path==='/api/vehicles')return [];
      if(path.startsWith('/api/shop/selection?')){
        window.__ciSelectionRequests.push({
          actor:window.__ciActor,
          ids:new URLSearchParams(path.split('?')[1]).get('ids').split(','),
        });
        if(window.__ciActor==='A'&&window.__ciHoldASelection)
          return new Promise(resolve=>{window.__ciResolveA=resolve});
        return {products:[{id:idB,name:'Деталь Б',price:12000,
          inStock:true,leadDays:1,hasPhoto:false}]};
      }
      if(path.startsWith('/api/shop/history?')){
        return {items:[{id:'B-order',number:'B',status:'new',statusName:'Новый',
          total:12000,delivery:'pickup',createdAt:'2026-11-24',
          vehicleId:'ci-vehicle-B',items:[{productId:idB,name:'Деталь Б',qty:1}]},
          {id:'B-order-second',number:'B2',status:'done',statusName:'Завершён',
          total:12000,delivery:'pickup',createdAt:'2026-11-23',vehicleId:'ci-vehicle-other',
          items:[{productId:idB,name:'Деталь Б',qty:1}]}],hasMore:false};
      }
      if(path.endsWith('/analogs'))return {enabled:true,items:[{id:'ci-analog',name:'Проверенный аналог CI',price:15000,inStock:true,leadDays:0}]};
      throw Error('Unexpected GET '+path);
    };
    window.__ciPost=async(path,payload)=>{
      if(path!=='/api/shop/orders')throw Error('Unexpected POST '+path);
      window.__ciOrders.push(payload);
      if(window.__ciFailPost)throw Error('CI: network response lost');
      return {id:'created-order',status:'new'};
    };
  },{idA,idB});
  await page.evaluate(()=>import('/__ci_shop_private.mjs'));
  try{
    await page.getByRole('heading',{name:'Корзина'}).waitFor();
  }catch(error){
    // The host contains only synthetic CI data. Preserve the failing
    // assertion and distinguish empty React mount from loading/API errors.
    const state=await page.evaluate(()=>({
      rootPresent:!!document.getElementById('root'),
      rootText:document.getElementById('root')?.innerText.slice(0,500)??'',
      actor:window.__ciActor,
      selectionRequested:typeof window.__ciResolveA==='function',
    })).catch(()=>null);
    console.error('Cart initial mount diagnostics:',JSON.stringify(state));
    throw error;
  }
  await page.waitForFunction(()=>typeof window.__ciResolveA==='function');
  const aRequests=await page.evaluate(()=>window.__ciSelectionRequests.filter(r=>r.actor==='A'));
  assert.equal(aRequests.length,1,'first account must have exactly one pending batch');
  assert.equal(aRequests[0].ids.length,50,'test must exercise the 50-ID page boundary');
  // Switch account while A's first catalog batch is still in-flight.
  await page.evaluate(({idA})=>{
    window.__ciActor='B';window.__ciToken='token-B';
    window.dispatchEvent(new Event('traksos-auth-external-change'));
    window.dispatchEvent(new Event('ci-actor-change'));
    window.__ciResolveA({products:[{id:idA,name:'Секретная деталь A',price:99999,
      inStock:true,leadDays:0,hasPhoto:false}]});
  },{idA});
  await page.getByText('Деталь Б').waitFor();
  assert.equal(await page.getByText('Секретная деталь A').count(),0);
  // Allow the old continuation and the new account render to settle.
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  const requests=await page.evaluate(()=>window.__ciSelectionRequests);
  assert.equal(requests.filter(r=>r.actor==='A').length,1,'old request must not dispatch another batch');
  const bRequests=requests.filter(r=>r.actor==='B');
  assert.ok(bRequests.length>0,'new account must request its own products');
  assert.ok(bRequests.every(r=>r.ids.length===1&&r.ids[0]===idB),
    'no old account product IDs may be dispatched with the new bearer');
  await page.getByText(/Не удалось проверить активные ремонтные заявки/).waitFor();
  const submit=page.getByRole('button',{name:'Оформить заказ'});
  assert.equal(await submit.isDisabled(),true,'delivery not chosen');
  await page.getByRole('button',{name:/Самовывоз/}).click();
  assert.equal(await submit.isDisabled(),false);
  await submit.click();
  await page.getByText(/Сначала проверьте историю покупок/).waitFor();
  assert.equal(await submit.isDisabled(),true,
    'ambiguous POST must never auto-repeat');
  assert.equal(await page.evaluate(()=>window.__ciOrders.length),1);
  await page.getByRole('button',{
    name:'Я проверил историю — разрешить новую отправку',
  }).click();
  await page.evaluate(()=>{window.__ciFailPost=false;});
  await submit.click();
  await page.waitForFunction(()=>location.hash==='#/shop');
  assert.equal(await page.evaluate(()=>window.__ciOrders.length),2);
  assert.deepEqual(await page.evaluate(()=>window.__ciOrders.map(o=>o.items[0].productId)),
    [idB,idB]);
  await page.evaluate(()=>{
    window.__ciScreen='history';
    window.dispatchEvent(new Event('ci-screen-change'));
  });
  await page.getByRole('heading',{name:'История покупок'}).waitFor();
  await page.getByText(/Заказ №B ·/).waitFor();
  const analogButtons=page.getByRole('button',{name:'Найти аналоги'});
  await analogButtons.first().click();
  await page.getByText('Проверенный аналог CI').waitFor();
  assert.equal(await page.getByText('Проверенный аналог CI').count(),1,'Analog duplicated across purchase lines');
  assert.equal(await analogButtons.nth(1).getAttribute('aria-expanded'),'false');
  await page.getByRole('button',{name:'Повторить',exact:true}).first().click();
  await page.waitForFunction(()=>location.hash==='#/shop/cart?vehicleId=ci-vehicle-B');
  // Real ShopHome and both real IndexedDB indexes. Only the synthetic API
  // is mocked; no catalog enablement, checkout or production mutation.
  await page.evaluate(()=>{
    window.__ciNetwork=true;
    Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>window.__ciNetwork});
    window.__ciShopMode='open';window.__ciReferenceMode='fail';
    window.__ciShopGets=[];
    const product='00000000-0000-4000-8000-000000000021';
    const reference='00000000-0000-4000-8000-000000000022';
    window.__ciGet=async path=>{
      window.__ciShopGets.push({path,online:window.__ciNetwork});
      if(!window.__ciNetwork)throw Error('CI offline network read');
      if(path==='/api/shop?light=1'){
        if(window.__ciShopMode==='fail')throw Error('CI failed reconnect');
        if(window.__ciShopMode==='closed')return {
          enabled:false,closedTitle:'Учебный магазин закрыт',closedText:'Продажи недоступны'
        };
        return {enabled:true,products:[],categories:{engine:'Двигатель'},
          categoryGroups:[],note:'Учебный каталог'};
      }
      if(path.startsWith('/api/shop/search?'))return {items:[],total:0,page:0,limit:24};
      if(path.startsWith('/api/shop/catalog/search?'))return {enabled:true,items:[],total:0};
      if(path==='/api/shop/index/manifest')return {enabled:true,revision:'1',count:1};
      if(path.startsWith('/api/shop/index/page?'))return {enabled:true,
        rows:[[product,'engine','Scania','P-321','Учебный насос',null]],next:null};
      if(path==='/api/shop/catalog/index/manifest'){
        if(window.__ciReferenceMode==='fail')throw Error('CI reference index unavailable');
        const deleted=window.__ciReferenceMode==='deleted';
        return {enabled:true,revision:deleted?'2':'1',count:deleted?0:1};
      }
      if(path.startsWith('/api/shop/catalog/index/page?'))return {enabled:true,
        rows:[[reference,'engine','Scania','R-654','Учебный справочный артикул',null]],next:null};
      if(path.startsWith('/api/shop/catalog/index/changes?'))return {
        enabled:true,rows:[['2',reference]],next:null,revision:'2'
      };
      throw Error('Unexpected GET '+path);
    };
    location.hash='#/shop';
    window.__ciScreen='home';window.dispatchEvent(new Event('ci-screen-change'));
  });
  const heading=page.getByRole('heading',{name:'Магазин',exact:true});
  const save=page.getByRole('button',{name:'Сохранить справочник для слабого интернета'});
  const offlineHeading=page.getByRole('heading',{name:'Сохранённый справочник запчастей'});
  const query=page.getByRole('searchbox',{name:'Поиск запчастей по названию или артикулу'});
  const setOnline=online=>page.evaluate(online=>{
    window.__ciNetwork=online;window.dispatchEvent(new Event(online?'online':'offline'));
  },online);
  const screen=name=>page.evaluate(name=>{
    window.__ciScreen=name;window.dispatchEvent(new Event('ci-screen-change'));
  },name);
  await heading.waitFor();
  await save.click();
  await page.getByText(/Обновление прервано/).waitFor();
  await setOnline(false);
  await offlineHeading.waitFor();
  await query.fill('P321');
  await page.getByText('Учебный насос',{exact:true}).waitFor();
  assert.equal(await page.getByText('Учебный справочный артикул',{exact:true}).count(),0);
  assert.equal(await page.getByRole('button',{name:/В корзину|Добавить:|Оформить заказ|Корзина/}).count(),0);
  assert.equal(await page.getByText(/в наличии|под заказ ·/).count(),0);
  // Cold navigation inside an already-loaded shell: unmount and remount Shop
  // while offline, retaining only the actual public IDB reference index.
  await screen('history');
  await page.getByRole('heading',{name:'История покупок'}).waitFor();
  await screen('home');
  await offlineHeading.waitFor();
  await query.fill('P321');
  await page.getByText('Учебный насос',{exact:true}).waitFor();
  await setOnline(true);
  await heading.waitFor();
  await page.evaluate(()=>{window.__ciReferenceMode='seed'});
  await save.click();
  await page.getByText(/справочные номера: 1/).waitFor();
  await setOnline(false);
  await offlineHeading.waitFor();
  await query.fill('R654');
  await page.getByText('Учебный справочный артикул',{exact:true}).waitFor();
  await setOnline(true);
  await heading.waitFor();
  await page.evaluate(()=>{window.__ciReferenceMode='deleted'});
  await save.click();
  await page.getByText(/удалено устаревших: 1/).waitFor();
  await setOnline(false);
  await offlineHeading.waitFor();
  await page.getByText('В сохранённом справочнике ничего не найдено. При подключении обновите каталог.').waitFor();
  assert.equal(await page.getByText('Учебный справочный артикул',{exact:true}).count(),0,'Revoked reference survived IDB delta');
  assert.equal(await page.getByRole('button',{name:/Добавить:|В корзину|Оформить заказ/}).count(),0);
  // Explicit server closure stays closed even when the following reconnect
  // fails, rather than reopening the saved-index screen by mistake.
  await page.evaluate(()=>{window.__ciShopMode='closed'});
  await setOnline(true);
  await page.getByText('Учебный магазин закрыт',{exact:true}).waitFor();
  await setOnline(false);
  await page.getByText('Учебный магазин закрыт',{exact:true}).waitFor();
  await page.evaluate(()=>{window.__ciShopMode='fail'});
  await setOnline(true);
  await page.getByText('CI failed reconnect',{exact:true}).waitFor();
  await setOnline(false);
  await page.getByText('Учебный магазин закрыт',{exact:true}).waitFor();
  assert.equal(await offlineHeading.count(),0);
  assert.equal(await page.getByRole('searchbox').count(),0);
  const offlineReads=await page.evaluate(()=>window.__ciShopGets.filter(x=>!x.online&&
    (x.path.startsWith('/api/shop/search?')||x.path.startsWith('/api/shop/catalog/search?')||x.path==='/api/shop?light=1')));
  assert.deepEqual(offlineReads,[],'Shop must not issue live catalog queries while offline');
  assert.equal(await page.evaluate(()=>window.__ciOrders.length),2,'Offline screen must not send checkout writes');
  assert.deepEqual(pageErrors,[],'Unhandled React errors in shop/cart/history');
  console.log('PASS: real Shop, ShopCart, ShopHistory, account isolation, offline IDB, partial sync, tombstone, closure and no auto-repeat');
}catch(error){
  if(pageErrors.length)console.error('Browser runtime errors:',pageErrors.join('; '));
  throw error;
}finally{await browser.close()}
