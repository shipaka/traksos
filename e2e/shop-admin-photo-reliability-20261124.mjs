/**
 * Real Chromium ProductForm photo upload/validation.
 * Synthetic admin HTTP data only; no live supplier or database access.
 */
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {chromium} from 'playwright';
const BASE=process.env.BASE_URL??'http://127.0.0.1:8080';
if(!['localhost','127.0.0.1'].includes(new URL(BASE).hostname))
  throw Error('CI local origin required');
const rootDir=new URL('../',import.meta.url).pathname;
const entry=[
  "import React from 'react';",
  "import {createRoot} from 'react-dom/client';",
  "import {AdminShop} from '../web/src/screens/shop.tsx';",
  "createRoot(document.getElementById('root')).render(React.createElement(AdminShop));",
].join('\n');
const mockApi=[
  "export const API_URL='';",
  "export const getToken=()=>window.__ciToken;",
  "export const get=path=>window.__ciGet(path);",
  "export const post=()=>{throw Error('Unexpected POST')};",
  "export const put=()=>{throw Error('Unexpected PUT')};",
  "export const del=()=>{throw Error('Unexpected DELETE')};",
  "export const rub=n=>String(n)+' ₽';",
  "export const fmtTime=()=>'';",
  "export const onEvent=()=>()=>{};",
].join('\n');
const mockUI=[
  "import React from 'react';",
  "export const useMe=()=>({me:{id:'admin-CI',roles:['admin'],company_inn:null}});",
  "export function useLoad(fn,deps){",
  " const [data,setData]=React.useState(null),[error,setError]=React.useState(null);",
  " const f=React.useRef(fn);f.current=fn;",
  " const reload=async()=>{try{setData(await f.current());setError(null)}",
  " catch(e){setData(null);setError(String(e.message))}};",
  " React.useEffect(()=>{setData(null);void reload()},deps);",
  " return {data,error,reload};",
  "}",
  "export function useAction(){const [busy,setBusy]=React.useState(false);",
  " const run=async fn=>{setBusy(true);try{return await fn()}",
  " catch(e){window.__ciLastActionError=String(e.message);return undefined}",
  " finally{setBusy(false)}};",
  " return {busy,run};}",
  "export const go=()=>{};",
  "export const Loading=({error})=>React.createElement('div',{},error||'Загрузка…');",
  "export const Back=()=>null;",
  "export const Field=({label,children})=>React.createElement('section',{},label,children);",
  "export const RubInput=()=>null;",
].join('\n');
const compiled=await build({
  stdin:{contents:entry,resolveDir:new URL('../e2e/',import.meta.url).pathname,
    sourcefile:'shop-admin-photo-entry.tsx',loader:'tsx'},
  bundle:true,write:false,platform:'browser',format:'esm',target:'es2022',
  plugins:[{name:'mock-photo-ci-api',setup(b){
    b.onResolve({filter:/\/api\.ts$/},()=>({path:'api',namespace:'mock-photo'}));
    b.onResolve({filter:/\/ui\.tsx$/},()=>({path:'ui',namespace:'mock-photo'}));
    b.onResolve({filter:/\/shopOffline\.ts$/},()=>({path:'offline',namespace:'mock-photo'}));
    b.onResolve({filter:/\/shopReferenceOffline\.ts$/},()=>({path:'ref',namespace:'mock-photo'}));
    b.onResolve({filter:/\/shopCatalogAdmin\.tsx$/},()=>({path:'adminCatalog',namespace:'mock-photo'}));
    b.onLoad({filter:/.*/,namespace:'mock-photo'},arg=>({
      contents:arg.path==='api'?mockApi:arg.path==='ui'?mockUI:
        arg.path==='offline'?
          'export const syncOfflineParts=async()=>({});export const searchOfflineParts=async()=>[];':
        arg.path==='ref'?
          'export const syncOfflineReferences=async()=>({});export const searchOfflineReferences=async()=>[];':
          'export const AdminShopCatalog=()=>null;',
      loader:'js',resolveDir:rootDir,
    }));
  }}],
});
const browser=await chromium.launch();
try{
  const page=await browser.newPage({serviceWorkers:'block'});
  const crashes=[];page.on('pageerror',error=>crashes.push(error.message));
  await page.route('**/__ci_shop_photo_host',r=>r.fulfill({
    contentType:'text/html',body:'<!doctype html><meta charset="utf-8"><div id="root"></div>',
  }));
  await page.route('**/__ci_shop_photo.mjs',r=>r.fulfill({
    contentType:'text/javascript',body:compiled.outputFiles[0].text,
  }));
  await page.goto(BASE+'/__ci_shop_photo_host');
  await page.evaluate(()=>{
    window.__ciToken='admin-token-CI';
    window.__ciRevoked=[];
    const orig=URL.revokeObjectURL.bind(URL);
    URL.revokeObjectURL=url=>{window.__ciRevoked.push(url);orig(url)};
    window.__ciGet=async path=>{
      if(path==='/api/admin/settings')return {shop:{enabled:false,
        closedTitle:'Пока в разработке',closedText:'',note:'',pickup:true,
        pickupAddress:'CI',delivery:false,deliveryPrice:0,withMaster:false}};
      if(path==='/api/admin/shop/products')return [];
      if(path==='/api/shop')return {categories:{engine:'Двигатель',other:'Разное'}};
      throw Error('Unexpected GET '+path);
    };
  });
  await page.evaluate(()=>import('/__ci_shop_photo.mjs'));
  await page.getByRole('tab',{name:'Товары'}).click();
  await page.getByRole('button',{name:/Добавить товар/}).click();
  const file=page.locator('input[type=file]');
  await file.waitFor();
  await file.setInputFiles({
    name:'test.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.3\n'),
  });
  await page.getByText(/Выберите фотографию JPEG, PNG или WEBP/).waitFor();
  assert.equal(await page.evaluate(()=>window.__ciRevoked.length),0,
    'reject unsupported files before allocating object URLs');
  // One-pixel valid PNG; resized to genuine JPEG data URL.
  await file.setInputFiles({
    name:'pixel.png',mimeType:'image/png',
    buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==','base64'),
  });
  await page.locator('img[src^="data:image/jpeg"]').waitFor();
  assert.equal(await page.evaluate(()=>window.__ciRevoked.length),1,
    'blob URL must be revoked even on successful decode');
  assert.equal(await file.inputValue(),'','same file can be selected again after reset');
  assert.deepEqual(crashes,[],'invalid photo must not produce unhandled React errors');
  console.log('PASS: real ProductForm rejects invalid media and releases blob URL after JPEG conversion');
}finally{await browser.close()}
