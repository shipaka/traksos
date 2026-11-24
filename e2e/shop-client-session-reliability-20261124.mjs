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
  "import {ShopCart,ShopHistory} from '../web/src/screens/shop.tsx';",
  "function App(){const [screen,setScreen]=useState('cart');",
  " useEffect(()=>{const handler=()=>setScreen(window.__ciScreen);",
  " window.addEventListener('ci-screen-change',handler);",
  " return ()=>window.removeEventListener('ci-screen-change',handler)},[]);",
  " return screen==='history'?React.createElement(ShopHistory):React.createElement(ShopCart);}",
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
      b.onResolve({filter:/\/shopOffline\.ts$/},()=>({path:'offline',namespace:'mock-shop'}));
      b.onResolve({filter:/\/shopReferenceOffline\.ts$/},()=>({path:'offlineRef',namespace:'mock-shop'}));
      b.onResolve({filter:/\/shopCatalogAdmin\.tsx$/},()=>({path:'adminCatalog',namespace:'mock-shop'}));
      b.onLoad({filter:/.*/,namespace:'mock-shop'},arg=>({
        contents:arg.path==='api'?mockApi:arg.path==='ui'?mockUI:
          arg.path==='offline'?
            'export const syncOfflineParts=async()=>({});export const searchOfflineParts=async()=>[];':
          arg.path==='offlineRef'?
            'export const syncOfflineReferences=async()=>({});export const searchOfflineReferences=async()=>[];':
            'export const AdminShopCatalog=()=>null;',
        loader:'js',resolveDir:rootDir,
      }));
    },
  }],
});
const browser=await chromium.launch();
try{
  const page=await browser.newPage({serviceWorkers:'block'});
  const crashes=[];
  page.on('pageerror',error=>{crashes.push(error.message);console.error('Shop browser error:',error.stack??error.message)});
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
    localStorage.setItem('traksos.cart.user.A',JSON.stringify({[idA]:1}));
    localStorage.setItem('traksos.cart.user.B',JSON.stringify({[idB]:1}));
    window.__ciOrders=[];window.__ciFailPost=true;
    window.__ciHoldASelection=true;
    window.__ciGet=async path=>{
      if(path==='/api/shop?light=1')return {
        enabled:true,delivery:{pickup:true,pickupAddress:'CI',delivery:false,
          withMaster:true,deliveryPrice:0,deliveryNote:''},
      };
      if(path==='/api/orders')throw Error('Сеть недоступна для списка заявок');
      if(path==='/api/vehicles')return [];
      if(path.startsWith('/api/shop/selection?')){
        if(window.__ciActor==='A'&&window.__ciHoldASelection)
          return new Promise(resolve=>{window.__ciResolveA=resolve});
        return {products:[{id:idB,name:'Деталь Б',price:12000,
          inStock:true,leadDays:1,hasPhoto:false}]};
      }
      if(path.startsWith('/api/shop/history?')){
        return {items:[{id:'B-order',number:'B',status:'new',statusName:'Новый',
          total:12000,delivery:'pickup',createdAt:'2026-11-24',
          items:[{productId:idB,name:'Деталь Б',qty:1}]}],hasMore:false};
      }
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
  await page.getByRole('heading',{name:'Корзина'}).waitFor();
  await page.waitForFunction(()=>typeof window.__ciResolveA==='function');
  // Switch account while A's catalog request is still in-flight.
  await page.evaluate(({idA})=>{
    window.__ciActor='B';window.__ciToken='token-B';
    window.dispatchEvent(new Event('traksos-auth-external-change'));
    window.dispatchEvent(new Event('ci-actor-change'));
    window.__ciResolveA({products:[{id:idA,name:'Секретная деталь A',price:99999,
      inStock:true,leadDays:0,hasPhoto:false}]});
  },{idA});
  await page.getByText('Деталь Б').waitFor();
  assert.equal(await page.getByText('Секретная деталь A').count(),0);
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
  await page.getByText(/Заказ №B/).waitFor();
  assert.deepEqual(crashes,[],'real shop screens must not produce unhandled browser errors');
  console.log('PASS: real ShopCart/ShopHistory React, account A→B, stale selection, failed POST no auto-repeat');
}finally{await browser.close()}
