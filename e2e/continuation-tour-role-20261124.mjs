// PR #274: actual continuation and role-tour React components in Chromium.
// All requests are deferred synthetic fixtures; no real accounts or money.
import {build} from 'esbuild';
import {chromium} from 'playwright';

const uiStub=`
 import React,{createContext,useContext,useState} from 'react';
 export const C=createContext({me:null,mode:'client'});
 export const useMe=()=>useContext(C);
 export function useAction(){
   const [busy,setBusy]=useState(false);
   return {busy,run:async fn=>{
     setBusy(true);
     try{return await fn();}catch{return undefined;}finally{setBusy(false);}
   }};
 }
`;
const apiStub=`
 function request(method,path,body){
   const m=window.__ctMock;
   m.calls.push({method,path,body});
   return new Promise((resolve,reject)=>m.pending.push({method,path,body,resolve,reject}));
 }
 export const get=(path)=>request('GET',path);
 export const getToken=()=>window.__ctMock.token;
 export const post=(path,body)=>request('POST',path,body);
 export const fmtTime=()=> '24.11.2026';
 export function onEvent(cb){
   window.__ctMock.listeners.add(cb);
   return ()=>window.__ctMock.listeners.delete(cb);
 }
`;
const trainingStub=`
 export function trainingRole(mode,roles,ownerId){
   if(mode==='client')return ownerId?'driver':'owner';
   return mode||roles?.[0]||'owner';
 }
`;
const bundle=await build({
 stdin:{contents:`
  import React,{useState} from 'react';
  import {createRoot} from 'react-dom/client';
  import {C} from './web/src/ui.tsx';
  import {OrderContinuations} from './web/src/screens/continuations.tsx';
  import {RoleTour} from './web/src/screens/roleTour.tsx';
  import {ContextHelp} from './web/src/screens/contextHelp.tsx';
  window.__ctMock={calls:[],pending:[],listeners:new Set(),token:'fixture-token-A'};
  function App(){
    const [state,setState]=useState({
      me:{id:'user-A',owner_id:null,roles:['client']},mode:'client',
      page:'',order:{id:'order-1',you:'client',service:'electric',status:'accepted'}
    });
    window.__ctSet=(patch)=>{if(patch.token)window.__ctMock.token=patch.token;setState(prev=>({...prev,...patch}));};
    return <C.Provider value={{me:state.me,mode:state.mode}}>
      <header className="top">TrakSOS test header</header>
      <nav className="account-menu"><summary>Меню</summary></nav>
      <ContextHelp page={state.page}/>
      <OrderContinuations order={state.order}/>
      <RoleTour page={state.page}/>
    </C.Provider>;
  }
  createRoot(document.getElementById('root')).render(<App/>);
 `,resolveDir:process.cwd(),sourcefile:'continuation-tour-entry.tsx',loader:'tsx'},
 bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',
 plugins:[{name:'deferred-api-and-context',setup(b){
   b.onResolve({filter:/./},args=>{
     if(['../ui.tsx','./web/src/ui.tsx'].includes(args.path))
       return {path:'ui',namespace:'ct-stub'};
     if(args.path==='../api.ts')return {path:'api',namespace:'ct-stub'};
     if(args.path==='./training.tsx')return {path:'training',namespace:'ct-stub'};
   });
   b.onLoad({filter:/./,namespace:'ct-stub'},args=>({
     contents:args.path==='ui'?uiStub:args.path==='api'?apiStub:trainingStub,
     loader:args.path==='ui'?'tsx':'js'
   }));
 }}],
});
const script=bundle.outputFiles.find(x=>x.path.endsWith('.js'))?.text;
if(!script)throw Error('React continuation tour bundle unavailable');
const assert=(ok,msg)=>{if(!ok)throw Error(msg);};
const browser=await chromium.launch();
try{
 const page=await browser.newPage({viewport:{width:390,height:844},locale:'ru-RU'});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.setContent('<!doctype html><html lang="ru"><body><div id="root"></div></body></html>');
 await page.addScriptTag({content:script});
 const change=patch=>page.evaluate(v=>window.__ctSet(v),patch);
 const wait=(method,path,n)=>page.waitForFunction(([method,path,n])=>
   window.__ctMock.pending.filter(r=>r.method===method&&r.path===path).length>=n,
   [method,path,n]);
 const finish=(method,path,n,resolve,data)=>page.evaluate(([method,path,n,resolve,data])=>{
   const match=window.__ctMock.pending.filter(r=>r.method===method&&r.path===path)[n];
   if(!match)throw Error('Missing deferred '+method+' '+path+' #'+n);
   if(resolve)match.resolve(data);else match.reject(Error(data));
 },[method,path,n,resolve,data]);
 const old={id:'rec-old',target_kind:'tow',status:'approved',
   summary:'PRIVATE RECOMMENDATION OF USER A',created_at:'2026-11-24T00:00:00Z'};
 const H='/api/orders/order-1/continuations';
 await wait('GET',H,1);
 await finish('GET',H,0,true,[old]);
 await page.getByText('PRIVATE RECOMMENDATION OF USER A').waitFor();

 // Same order UUID under a different account must not reuse the old private
 // response; even on HTTP error it cannot reappear as the "current" list.
 await change({me:{id:'user-B',owner_id:null,roles:['client']}});
 await wait('GET',H,2);
 assert(await page.getByText('PRIVATE RECOMMENDATION OF USER A').count()===0,
   'private recommendation A visible after account B switch');
 await finish('GET',H,1,false,'Сеть недоступна');
 await page.getByRole('button',{name:'Повторить загрузку'}).waitFor();
 assert(await page.getByText('PRIVATE RECOMMENDATION OF USER A').count()===0,
   'offline state reused a prior account recommendation');
 await page.getByRole('button',{name:'Повторить загрузку'}).click();
 await wait('GET',H,3);
 await finish('GET',H,2,true,[]);
 await page.getByRole('button',{name:'Повторить загрузку'}).waitFor({state:'detached'});

 // A pending recommendation POST is not repeated by a fast double click.
 const performerOrder={id:'order-2',you:'performer',service:'tow',status:'working'};
 await change({me:{id:'master-A',roles:['master'],owner_id:null},mode:'performer',order:performerOrder});
 const H2='/api/orders/order-2/continuations', P2=H2;
 await wait('GET',H2,1);
 await finish('GET',H2,0,true,[]);
 const select=page.locator('select[id^="continuation-target-"]');
 await select.waitFor();
 assert(await select.inputValue()==='sto','target did not reset to the valid tow continuation');
 const draft=page.getByPlaceholder('Заключение: что обнаружили, почему нужен следующий специалист или эвакуация');
 await draft.fill('После эвакуации нужен дополнительный ремонт в стационарной мастерской');
 const action=page.getByRole('button',{name:'Предложить продолжение клиенту'});
 await action.click();
 await wait('POST',P2,1);
 assert(await action.isDisabled(),'pending recommendation allowed duplicate click');
 assert(await page.evaluate(path=>window.__ctMock.calls.filter(r=>r.method==='POST'&&r.path===path).length,P2)===1,
   'duplicate POST emitted before first HTTP completion');

 // The old write completes after a different account/order is shown. Its
 // success must not request B's old order data or clear B's current draft.
 await change({me:{id:'master-B',roles:['master'],owner_id:null},
   order:{id:'order-3',you:'performer',service:'electric',status:'working'}});
 const H3='/api/orders/order-3/continuations';
 await wait('GET',H3,1);
 await finish('GET',H3,0,true,[]);
 await page.getByPlaceholder('Заключение: что обнаружили, почему нужен следующий специалист или эвакуация')
   .fill('Новый исполнитель описывает другой автомобиль и другую неисправность');
 await finish('POST',P2,0,true,{id:'recommendation-old'});
 assert((await draft.inputValue()).includes('Новый исполнитель'),
   'late POST for old order cleared new account draft');
 assert(await page.evaluate(path=>window.__ctMock.calls.filter(r=>r.method==='GET'&&r.path===path).length,H3)===1,
   'late POST caused an extra private reload in the new account');

 // Rotate bearer without changing user or order: previous draft must not return.
 await change({token:'fixture-token-B'});
 await wait('GET',H3,2);
 await finish('GET',H3,1,true,[]);
 assert((await draft.inputValue())==='', 'draft leaked across bearer rotation');
 await draft.fill('Черновик для новой сессии не должен вернуться после смены аккаунта');
 await change({me:{id:'master-C',roles:['master'],owner_id:null}});
 await wait('GET',H3,3);
 await finish('GET',H3,2,true,[]);
 await change({me:{id:'master-B',roles:['master'],owner_id:null}});
 await wait('GET',H3,4);
 await finish('GET',H3,3,true,[]);
 assert((await draft.inputValue())==='', 'A-B-A restored a previous private draft');

 // Tour focus/geometry on mobile: no background Tab, Escape always closes.
 await change({me:{id:'owner-C',roles:['client'],owner_id:null},mode:'client',
   order:{id:'order-4',you:'client',service:'electric',status:'accepted'}});
 await wait('GET','/api/orders/order-4/continuations',1);
 await finish('GET','/api/orders/order-4/continuations',0,true,[]);
 await page.evaluate(()=>window.dispatchEvent(new Event('traksos-tour-start')));
 const modal=page.getByRole('dialog',{name:'Короткая экскурсия по кабинету'});
 await modal.waitFor();
 const box=modal.locator('.tr-tour-spot');
 if(await box.count()){
   const r=await box.boundingBox();
   if(r)assert(r.x>=0&&r.x+r.width<=392,'tour spotlight spills outside mobile viewport');
 }
 await page.keyboard.press('Escape');
 await modal.waitFor({state:'detached'});
 await page.evaluate(()=>window.dispatchEvent(new Event('traksos-tour-start')));
 await modal.waitFor();
 await change({me:{id:'admin-D',roles:['admin'],owner_id:null},mode:'admin'});
 await modal.waitFor({state:'detached'});
 assert(!errors.length,'Chromium runtime errors: '+errors.join('; '));
 console.log('continuations/tour/context-help: scope, old GET error, old POST, mobile focus and roles OK');
}finally{await browser.close();}
