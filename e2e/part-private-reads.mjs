// Actual recommendation components and the shared private read helper.
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {chromium} from 'playwright';
const bundle=await build({
 stdin:{resolveDir:process.cwd(),sourcefile:'part-private-entry.tsx',loader:'tsx',contents:`
 import {useState} from 'react';
 import {createRoot} from 'react-dom/client';
 import {TestContext} from './web/src/ui.tsx';
 import {OrderPartRecommendations,BookingPartRecommendations,PartRecommendationHistory,AdminPartSourcing} from './web/src/screens/partRecommendations.tsx';
 window.__p={token:'A',reads:[],writes:[],listeners:new Set()};
 window.__emit=e=>window.__p.listeners.forEach(fn=>fn(e));
 function App(){
  const [s,set]=useState({id:'A',mode:'order',source:'one'});
  window.__switch=(id,mode,source,token=id)=>{window.__p.token=token;set({id,mode,source});};
  return <TestContext.Provider value={{me:{id:s.id,roles:s.mode==='admin'?['admin']:['client']}}}>
   {s.mode==='order'?<OrderPartRecommendations order={{id:s.source,you:'client'}}/>:
    s.mode==='booking'?<BookingPartRecommendations bookingId={s.source}/>:
    s.mode==='history'?<PartRecommendationHistory vehicleId={s.source}/>:<AdminPartSourcing/>}
  </TestContext.Provider>;
 }
 createRoot(document.getElementById('root')).render(<App/>);
 `},
 bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',
 plugins:[{name:'local-part-transport',setup(b){
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
   api:`export const getToken=()=>window.__p.token;
   export const onEvent=fn=>{window.__p.listeners.add(fn);return ()=>window.__p.listeners.delete(fn);};
   export const get=path=>new Promise((resolve,reject)=>window.__p.reads.push({path,token:getToken(),resolve,reject}));
   export const post=(path,body)=>new Promise(resolve=>window.__p.writes.push({path,body,resolve}));
   export const rub=p=>String(p);export const fmtTime=t=>t;`
  }[a.path]}));
 }}]
});
const row=(id,name)=>({id,name,brand:'TEST',article:'123',qty:1,reason:'Synthetic reason',status:'pending',source_order_id:'one',created_at:'2026-11-25',sourcing_status:'requested'});
const list=(id,name)=>({items:[row(id,name)],canSuggest:false,canDecide:true});
const browser=await chromium.launch();
try{
 for(const width of [390,1440]){
  const page=await browser.newPage({viewport:{width,height:900}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.setContent('<html lang="ru"><body><div id="root"></div></body></html>');
  await page.addScriptTag({content:bundle.outputFiles[0].text});
  const count=n=>page.waitForFunction(n=>window.__p.reads.length>=n,n);
  const answer=(i,data,fail=false)=>page.evaluate(({i,data,fail})=>{const p=window.__p.reads[i];if(fail)p.reject(Error('offline'));else p.resolve(data);},{i,data,fail});
  const change=(...args)=>page.evaluate(args=>window.__switch(...args),args);
  const emit=e=>page.evaluate(e=>window.__emit(e),e);
  const visible=name=>page.getByText(name,{exact:true}).waitFor();
  const hidden=name=>page.getByText(name,{exact:true}).waitFor({state:'hidden'});
  const retry=()=>page.getByRole('button',{name:'Повторить загрузку'}).click();
  const path=async(i,expected)=>assert.equal(await page.evaluate(i=>window.__p.reads[i].path,i),expected);
  await count(1);await answer(0,list('r1','A-ORDER'));await visible('A-ORDER');
  await emit({type:'part_recommendations_changed'});await count(2);await hidden('A-ORDER');
  await change('B','order','one');await count(3);
  await answer(1,list('old','A-LATE'));await answer(2,list('b','B-ORDER'));await visible('B-ORDER');await hidden('A-LATE');
  await emit({type:'connection_restored'});await count(4);await answer(3,null,true);await hidden('B-ORDER');
  await retry();await count(5);await answer(4,list('b','B-RETRY'));await visible('B-RETRY');
  await page.getByRole('button',{name:'Согласовать замену'}).click();
  await page.waitForFunction(()=>window.__p.writes.length===1);
  await change('B','booking','other');await count(6);await hidden('B-RETRY');await path(5,'/api/bookings/other/part-recommendations');
  await page.evaluate(()=>window.__p.writes[0].resolve({ok:true}));
  await answer(5,{items:[],canDecide:false,canSuggest:false});await visible('Рекомендаций пока нет');
  assert.equal(await page.evaluate(()=>window.__p.reads.length),6);
  await change('B','history','truck1');await count(7);await path(6,'/api/shop/part-recommendations?page=0&vehicleId=truck1');
  await answer(6,{items:[row('h','TRUCK-1')],hasMore:true});await visible('TRUCK-1');
  await page.getByRole('button',{name:'Далее'}).click();await count(8);await hidden('TRUCK-1');
  await change('B','history','truck2');await count(9);await path(8,'/api/shop/part-recommendations?page=0&vehicleId=truck2');
  await answer(7,{items:[row('old','OLD-PAGE')],hasMore:false});
  await answer(8,{items:[row('new','TRUCK-2')],hasMore:false});await visible('TRUCK-2');await hidden('OLD-PAGE');
  await change('adminA','admin','');await count(10);await answer(9,{items:[row('s','QUEUE-A')],hasMore:false,shopEnabled:true});await visible('QUEUE-A');
  await page.getByRole('button',{name:'Подобрать точный товар'}).click();await count(11);
  await answer(10,{products:[{id:'p',name:'CANDIDATE',brand:'TEST',article:'123',price:100,stock:1}],hasMore:false});
  await page.getByRole('button',{name:/CANDIDATE/}).click();
  const resolve=page.getByRole('button',{name:'Предложить выбранную деталь'});assert.equal(await resolve.isEnabled(),true);
  await page.getByRole('button',{name:'Обновить совпадения'}).click();await count(12);
  await answer(11,null,true);assert.equal(await resolve.isEnabled(),false);
  await retry();await count(13);
  await change('adminA','admin','','new-session');await count(14);await hidden('QUEUE-A');
  await answer(12,{products:[{id:'old',name:'OLD-CANDIDATE'}],hasMore:false});
  await answer(13,{items:[],hasMore:false,shopEnabled:false});await visible('В этом разделе нет запросов');
  assert.equal(await page.getByRole('button',{name:/OLD-CANDIDATE/}).count(),0);
  await emit({type:'part_recommendations_changed'});await count(15);
  await path(14,'/api/admin/shop/part-sourcing?status=requested&page=0');
  await hidden('В этом разделе нет запросов');
  await answer(14,{items:[row('new','QUEUE-REFRESH')],hasMore:false,shopEnabled:false});await visible('QUEUE-REFRESH');
  await change('B','booking','only-current');await count(16);
  await answer(15,list('booking','BOOKING-CURRENT'));await visible('BOOKING-CURRENT');
  await emit({type:'part_recommendations_changed'});await count(17);
  await path(16,'/api/bookings/only-current/part-recommendations');await hidden('BOOKING-CURRENT');
  await answer(16,null,true);await page.getByRole('alert').waitFor();
  await change('B','history','truck3');await count(18);
  await answer(17,{items:[row('history','HISTORY-CURRENT')],hasMore:false});await visible('HISTORY-CURRENT');
  await emit({type:'part_recommendations_changed'});await count(19);
  await path(18,'/api/shop/part-recommendations?page=0&vehicleId=truck3');await hidden('HISTORY-CURRENT');
  await answer(18,{items:[],hasMore:false});await visible('Рекомендаций пока нет');

  assert.deepEqual(errors,[]);await page.close();
 }
 console.log('PASS recommendation private reads, errors, source and page isolation, admin selection and session rotation');
}finally{await browser.close();}
