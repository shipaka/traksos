// Exercise the actual PartProposal React component with deferred local transport.
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {chromium} from 'playwright';
const bundle=await build({
 stdin:{resolveDir:process.cwd(),sourcefile:'part-proposal-entry.tsx',loader:'tsx',contents:`
 import {useState} from 'react';
 import {createRoot} from 'react-dom/client';
 import {TestContext} from './web/src/ui.tsx';
 import {PartProposal} from './web/src/screens/partRecommendations.tsx';
 window.__part={token:'A',reads:[],writes:[],sent:0};
 function App(){
  const [scope,setScope]=useState({id:'A',order:'one',revision:0});
  window.__switch=(id,order,token=id)=>{window.__part.token=token;setScope(s=>({id,order,revision:s.revision+1}));};
  return <TestContext.Provider value={{me:{id:scope.id,roles:['performer']}}}>
   <PartProposal orderId={scope.order} onSent={()=>window.__part.sent++}/>
  </TestContext.Provider>;
 }
 createRoot(document.getElementById('root')).render(<App/>);
 `},
 bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',
 plugins:[{name:'synthetic-part-transport',setup(b){
  b.onResolve({filter:/./},a=>{
   if(a.path==='../ui.tsx'||a.path==='./web/src/ui.tsx')return {path:'ui',namespace:'fixture'};
   if(a.path==='../api.ts')return {path:'api',namespace:'fixture'};
  });
  b.onLoad({filter:/./,namespace:'fixture'},a=>({resolveDir:process.cwd(),loader:'tsx',contents:{
   ui:`import {createContext,useContext,useState} from 'react';
   export const TestContext=createContext({me:null});
   export const useMe=()=>useContext(TestContext);
   export const useLoad=()=>({data:{refs:[]},reload:()=>{}});
   export function useAction(){const [busy,setBusy]=useState(false);return {busy,run:async fn=>{setBusy(true);try{return await fn();}finally{setBusy(false);}}};}`,
   api:`export const getToken=()=>window.__part.token;
   export const get=path=>new Promise((resolve,reject)=>window.__part.reads.push({path,resolve,reject}));
   export const post=(path,body)=>new Promise(resolve=>window.__part.writes.push({path,body,resolve}));
   export const rub=p=>String(p);export const fmtTime=t=>t;`
  }[a.path]}));
 }}]
});
const browser=await chromium.launch();
try{
 for(const width of [390,1440]){
  const page=await browser.newPage({viewport:{width,height:900}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.setContent('<html lang="ru"><body><div id="root"></div></body></html>');
  await page.addScriptTag({content:bundle.outputFiles[0].text});
  const brand=page.getByLabel('Производитель',{exact:true}),article=page.getByLabel('Артикул',{exact:true});
  const search=page.getByRole('button',{name:'Найти точный артикул в магазине'});
  const send=page.getByRole('button',{name:'Предложить замену клиенту'});
  const confirm=page.getByRole('checkbox');
  const count=n=>page.waitForFunction(n=>window.__part.reads.length===n,n);
  const result=(i,name,fail=false)=>page.evaluate(({i,name,fail})=>{
   const p=window.__part.reads[i];if(fail)p.reject(Error('offline'));
   else p.resolve({enabled:true,products:[{id:name,brand:'TEST',article:name,name,price:100,stock:1,leadDays:1}]});
  },{i,name,fail});
  const absent=async name=>assert.equal(await page.getByRole('button',{name:new RegExp(name)}).count(),0);
  await brand.fill('TEST');await article.fill('OLD');await search.click();await count(1);
  await article.fill('NEW');await search.click();await count(2);
  await result(1,'NEW-PRODUCT');await page.getByRole('button',{name:/NEW-PRODUCT/}).waitFor();
  await result(0,'OLD-PRODUCT');await page.evaluate(()=>new Promise(requestAnimationFrame));await absent('OLD-PRODUCT');
  await search.click();await count(3);await absent('NEW-PRODUCT');await result(2,'ignored',true);
  await page.getByText('Не удалось проверить артикул. Повторите поиск.').waitFor();
  await search.click();await count(4);await result(3,'NEW-PRODUCT');
  await page.getByRole('button',{name:/NEW-PRODUCT/}).click();
  await page.getByLabel('Причина замены',{exact:true}).fill('Подтверждённый дефект детали');
  await confirm.check();assert.equal(await send.isEnabled(),true);
  await page.getByLabel('Количество',{exact:true}).fill('2');assert.equal(await confirm.isChecked(),false);
  await confirm.check();await send.evaluate(b=>{b.click();b.click();});
  await page.waitForFunction(()=>window.__part.writes.length===1);
  assert.equal(await page.evaluate(()=>window.__part.writes[0].body.productId),'NEW-PRODUCT');
  await page.evaluate(()=>window.__switch('B','two'));
  await page.waitForFunction(()=>document.querySelector('input').value==='');
  await page.evaluate(()=>window.__part.writes[0].resolve({id:'saved'}));
  await page.evaluate(()=>new Promise(requestAnimationFrame));
  assert.equal(await page.evaluate(()=>window.__part.sent),0);
  await brand.fill('TEST');await article.fill('B');await search.click();await count(5);
  await page.evaluate(()=>window.__switch('B','two','B-new-session'));
  await page.waitForFunction(()=>document.querySelector('input').value==='');
  await result(4,'PREVIOUS-SESSION');await page.evaluate(()=>new Promise(requestAnimationFrame));await absent('PREVIOUS-SESSION');
  assert.equal(await send.isEnabled(),false);assert.deepEqual(errors,[]);
  await page.close();
 }
 console.log('PASS part proposal stale lookup, retry, confirmation, duplicate send and session isolation');
}finally{await browser.close();}
