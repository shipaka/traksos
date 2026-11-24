/**
 * Real React/Chromium admin import test, with synthetic local get/post fakes.
 * Never calls production endpoints, insurers, suppliers, SMS or payments.
 */
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {chromium} from 'playwright';
import {watchPageErrors} from './visual-page-errors.mjs';

const BASE=process.env.BASE_URL??'http://127.0.0.1:8080';
if(!['localhost','127.0.0.1'].includes(new URL(BASE).hostname))
  throw Error('Only local CI is supported');
const entry=[
  "import React from 'react';",
  "import {createRoot} from 'react-dom/client';",
  "import {AdminShopCatalog} from '../web/src/screens/shopCatalogAdmin.tsx';",
  "createRoot(document.getElementById('root')).render(React.createElement(AdminShopCatalog));",
].join('\n');
const mockApi=[
  "export const getToken=()=>window.__ciToken;",
  "export const get=(path)=>window.__ciGet(path);",
  "export const post=(path,body)=>window.__ciPost(path,body);",
].join('\n');
const mockUi=[
  "import React from 'react';",
  "export function useMe(){",
  " const [id,setId]=React.useState(window.__ciActor);",
  " React.useEffect(()=>{const f=()=>setId(window.__ciActor);",
  " window.addEventListener('ci-actor-change',f);",
  " return ()=>window.removeEventListener('ci-actor-change',f)},[]);",
  " return {me:id?{id}:null};",
  "}",
  "export function useLoad(fn,deps){",
  " const [data,setData]=React.useState(null),[error,setError]=React.useState(null);",
  " const fnRef=React.useRef(fn);fnRef.current=fn;",
  " const reload=React.useCallback(async()=>{",
  " try{const r=await fnRef.current();setData(r);setError(null)}",
  " catch(e){setError(String(e.message))}", 
  " },[]);",
  " React.useEffect(()=>{setData(null);void reload()},deps);",
  " return {data,error,reload};",
  "}",
  "export function useAction(){",
  " const [busy,setBusy]=React.useState(false);",
  " const run=async fn=>{setBusy(true);try{return await fn()}",
  " catch(e){window.__ciLastError=String(e.message);return undefined}",
  " finally{setBusy(false)}};",
  " return {busy,run};",
  "}",
  "export const Loading=({error})=>React.createElement('div',{},error||'Загружаю…');",
].join('\n');
const rootDir=new URL('../',import.meta.url).pathname;
const compiled=await build({
  stdin:{contents:entry,resolveDir:new URL('../e2e/',import.meta.url).pathname,
    sourcefile:'catalog-admin-ci-entry.tsx',loader:'tsx'},
  bundle:true,write:false,platform:'browser',format:'esm',target:'es2022',jsx:'automatic',
  plugins:[{name:'mock-admin-api',setup(b){
    b.onResolve({filter:/\/api\.ts$/},()=>({path:'api',namespace:'ci-mock'}));
    b.onResolve({filter:/\/ui\.tsx$/},()=>({path:'ui',namespace:'ci-mock'}));
    b.onLoad({filter:/.*/,namespace:'ci-mock'},arg=>({
      contents:arg.path==='api'?mockApi:mockUi,loader:'js',resolveDir:rootDir,
    }));
  }}],
});
const browser=await chromium.launch();
try{
  const page=await browser.newPage({serviceWorkers:'block',locale:'ru-RU'});
  const assertClean=watchPageErrors(page);
  await page.route('**/__ci_catalog_admin_host',route=>route.fulfill({
    status:200,contentType:'text/html',
    body:'<!doctype html><html lang="ru"><meta charset="utf-8"><div id="root"></div></html>',
  }));
  await page.route('**/__ci_catalog_admin.mjs',route=>route.fulfill({
    status:200,contentType:'text/javascript',body:compiled.outputFiles[0].text,
  }));
  await page.goto(BASE+'/__ci_catalog_admin_host');
  await page.evaluate(()=>{
    window.__ciActor='admin-A';window.__ciToken='token-A';
    window.__ciRequests=[];window.__ciActualChunk=0;
    window.__ciFailSecond=false;window.__ciHoldDryRun=false;
    window.__ciGet=async path=>{
      if(path==='/api/shop?light=1')return {categories:{engine:'Двигатель'}};
      if(path==='/api/admin/shop/catalog/stats')return {total:0,pending:0,approved:0};
      if(path.startsWith('/api/admin/shop/catalog?'))return {items:[],total:0,page:0,limit:40};
      throw Error('Unexpected GET '+path);
    };
    window.__ciPost=async(path,body)=>{
      if(path!=='/api/admin/shop/catalog/import')throw Error('Unexpected POST '+path);
      window.__ciRequests.push({path,body});
      if(body.dryRun&&window.__ciHoldDryRun)
        return new Promise(resolve=>{window.__ciPendingDryRunResolve=resolve});
      if(!body.dryRun){
        window.__ciActualChunk++;
        if(window.__ciFailSecond&&window.__ciActualChunk===2)
          throw Error('synthetic timeout: unknown batch outcome');
      }
      return {processed:body.rows.length,newRows:body.rows.length,
        existingRows:0,published:0};
    };
  });
  await page.evaluate(()=>import('/__ci_catalog_admin.mjs'));
  try { await page.getByText('Массовая загрузка справочника запчастей').waitFor(); }
  catch(error){ await assertClean('catalog mount'); throw error; }
  await assertClean('catalog mount');
  const rows=Array.from({length:301},(_,i)=>
    'Scania;CI-'+String(i+1).padStart(5,'0')+';Тестовый насос '+i+';engine;');
  const csv='бренд;артикул;название;категория;синонимы\n'+rows.join('\n')+'\n';
  const file={name:'synthetic-parts.csv',mimeType:'text/csv',buffer:Buffer.from(csv)};
  const source=page.locator('input[placeholder^="Название каталога"]');
  const importButton=page.getByRole('button',{name:'Загрузить на проверку'});
  const checkButton=page.getByRole('button',{name:'Проверить перед загрузкой'});
  await page.locator('input[type=file]').setInputFiles(file);
  await source.fill('Разрешённые синтетические номера для CI');
  await page.locator('input[type=checkbox]').check();
  assert.equal(await importButton.isDisabled(),true,'unvalidated CSV cannot import');
  await checkButton.click();
  await page.getByText(/Предварительная проверка: 301 позиций/).waitFor();
  assert.equal(await importButton.isDisabled(),false);
  assert.deepEqual(await page.evaluate(()=>
    window.__ciRequests.filter(v=>v.body.dryRun).map(v=>v.body.rows.length)),[150,150,1]);
  await source.fill('Изменился источник — старый предпросмотр недействителен');
  assert.equal(await importButton.isDisabled(),true,'provenance invalidates preview');
  await checkButton.click();
  await page.getByText(/Предварительная проверка: 301 позиций/).waitFor();
  await page.evaluate(()=>{window.__ciFailSecond=true;window.__ciActualChunk=0;});
  await importButton.click();
  await page.getByText(/Подтверждено сервером 150 из 301/).waitFor();
  assert.equal(await importButton.isDisabled(),true,'partial upload invalidates preview');
  await page.evaluate(()=>{window.__ciFailSecond=false;window.__ciActualChunk=0;});
  await checkButton.click();
  await page.getByText(/Предварительная проверка: 301 позиций/).waitFor();
  await importButton.click();
  await page.getByText('Прочитано 301 позиций').waitFor({state:'detached'});
  assert.equal(await page.locator('input[type=file]').inputValue(),'',
    'completed import clears picker and permits re-selection of identical CSV');
  // Old account A's pending dry-run must never enable account B's button.
  await page.locator('input[type=file]').setInputFiles(file);
  await source.fill('Источник для последнего dry-run');
  await page.locator('input[type=checkbox]').check();
  await page.evaluate(()=>{window.__ciHoldDryRun=true;window.__ciPendingDryRunResolve=null;});
  await checkButton.click();
  await page.waitForFunction(()=>typeof window.__ciPendingDryRunResolve==='function');
  await page.evaluate(()=>{
    window.__ciActor='admin-B';window.__ciToken='token-B';
    window.dispatchEvent(new Event('traksos-auth-external-change'));
    window.dispatchEvent(new Event('ci-actor-change'));
    window.__ciPendingDryRunResolve({processed:150,newRows:150,existingRows:0,published:0});
  });
  await page.waitForFunction(()=>{
    const input=document.querySelector('input[type=file]');
    return input?.value===''&&!document.body.textContent.includes('Прочитано 301');
  });
  assert.equal(await importButton.isDisabled(),true,
    'account B must never see account A dry-run approval');
  await assertClean('catalog import and cross-account reset');
  console.log('PASS: real React 301-row CSV, partial retry, immutable preview and cross-account reset');
}finally{await browser.close()}
