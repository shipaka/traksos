// ECU-HANDOFF-WEB-SESSION-20261124: real React component regression.
// Only synthetic deferred HTTP; no production API, customer location or payments.
import {build} from 'esbuild';
import {chromium} from 'playwright';

const ui=`
 import React,{createContext,useContext,useState} from 'react';
 export const C=createContext({me:null});
 export const useMe=()=>useContext(C);
 export function useAction(){
  const [busy,setBusy]=useState(false);
  return {busy,run:async(fn)=>{setBusy(true);try{return await fn();}catch{return undefined;}finally{setBusy(false);}}};
 }
 export const Loading=({error})=><div role={error?'alert':'status'}>{error??'Загрузка…'}</div>;
 export const Back=({to})=><a href={'#/'+to}>Назад</a>;
`;
const api=`
 function defer(method,path,body){
  const m=window.__ecuMock;
  m.calls.push({method,path,body});
  return new Promise((resolve,reject)=>m.pending.push({method,path,body,resolve,reject}));
 }
 export const get=path=>defer('GET',path);
 export const post=(path,body)=>defer('POST',path,body);
 export const put=(path,body)=>defer('PUT',path,body);
 export const fmtTime=v=>String(v);
 export const rub=v=>String(v)+' коп.';
 export function onEvent(handler){
  window.__ecuMock.listeners.add(handler);
  return ()=>window.__ecuMock.listeners.delete(handler);
 }
`;
const dict=`
 export const SERVICES={electric:{name:'Электрик'},tow:{name:'Эвакуатор'}};
 export const STATUS={completed:{name:'Завершён'}};
`;
const bundled=await build({
 stdin:{contents:`
  import React,{useState} from 'react';
  import {createRoot} from 'react-dom/client';
  import {C} from './web/src/ui.tsx';
  import {EcuOrderPanel,EcuHandoffPage,EcuStationWorkspace,EcuAdminStations}
    from './web/src/screens/ecuHandoffs.tsx';
  import {ecuDiagnosisKopecks} from './web/src/ecuQuoteAmount20261124.ts';
  window.__parseEcuPrice=ecuDiagnosisKopecks;
  window.__ecuMock={calls:[],pending:[],listeners:new Set()};
  function App(){
   const [s,setS]=useState({me:{id:'owner-A',roles:['client'],owner_id:null},
     view:'detail',id:'handoff-1',orderId:'order-1'});
   window.__switchEcu=(patch)=>setS(prev=>({...prev,...patch}));
   const order={id:s.orderId,you:'performer',service:'electric',status:'working'};
   return <C.Provider value={{me:s.me,mode:s.view}}>
    {s.view==='detail'?<EcuHandoffPage id={s.id}/>:
     s.view==='panel'?<EcuOrderPanel order={order}/>:
     s.view==='station'?<EcuStationWorkspace/>:<EcuAdminStations/>}
   </C.Provider>;
  }
  createRoot(document.getElementById('root')).render(<App/>);
 `,resolveDir:process.cwd(),sourcefile:'ecu-web-session-entry.tsx',loader:'tsx'},
 bundle:true,write:false,outdir:'./e2e/.tmp-ecu-handoff-web-session-20261124',platform:'browser',format:'iife',jsx:'automatic',
 plugins:[{name:'ecu-isolated-http',setup(b){
   b.onResolve({filter:/./},args=>{
    if(['../ui.tsx','./web/src/ui.tsx'].includes(args.path))
      return {path:'ui',namespace:'ecu-mock'};
    if(args.path==='../api.ts')return {path:'api',namespace:'ecu-mock'};
    if(args.path==='../dict.ts')return {path:'dict',namespace:'ecu-mock'};
   });
   b.onLoad({filter:/./,namespace:'ecu-mock'},args=>({
    resolveDir:process.cwd(),
    contents:args.path==='ui'?ui:args.path==='api'?api:dict,
    loader:args.path==='ui'?'tsx':'js'
   }));
 }}],
});
const js=bundled.outputFiles.find(f=>f.path.endsWith('.js'))?.text;
if(!js)throw Error('ECU React bundle not generated');
const assert=(ok,msg)=>{if(!ok)throw Error(msg);};
const browser=await chromium.launch();
try{
 const page=await browser.newPage({viewport:{width:390,height:844},locale:'ru-RU'});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.setContent('<!doctype html><html lang="ru"><body><div id="root"></div></body></html>');
 await page.addScriptTag({content:js});
 const switchTo=patch=>page.evaluate(v=>window.__switchEcu(v),patch);
 const wait=(method,path,num)=>page.waitForFunction(([method,path,num])=>
  window.__ecuMock.pending.filter(x=>x.method===method&&x.path===path).length>=num,
  [method,path,num]);
 const complete=(method,path,n,ok,value)=>page.evaluate(([method,path,n,ok,value])=>{
  const item=window.__ecuMock.pending.filter(x=>x.method===method&&x.path===path)[n];
  if(!item)throw Error('Missing mocked ECU '+method+' '+path+' #'+n);
  if(ok)item.resolve(value);else item.reject(Error(value));
 },[method,path,n,ok,value]);
 const record=(props={})=>({
  id:'handoff-1',number:11,sourceNumber:12,state:'selected',
  vehicle:{brand:'Renault Trucks',model:'Premium',year:2010,vin:'PRIVATE-VIN-OWNER-A'},
  summary:'PRIVATE-ECU-REPORT-OWNER-A',disclaimer:'Новый ремонт оплачивается отдельно',
  actor:'owner',quotes:[],notes:[],...props,
 });
 const path='/api/ecu/handoffs/handoff-1';
 await wait('GET',path,1);
 await complete('GET',path,0,true,record());
 await page.getByText('PRIVATE-ECU-REPORT-OWNER-A').waitFor();
 await switchTo({me:{id:'owner-B',roles:['client'],owner_id:null}});
 await wait('GET',path,2);
 assert(await page.getByText('PRIVATE-ECU-REPORT-OWNER-A').count()===0,
  'old handoff evidence shown after account switch');
 assert(await page.getByText('PRIVATE-VIN-OWNER-A').count()===0,
  'private VIN leaked into the new account');
 await complete('GET',path,1,false,'offline');
 await page.getByRole('button',{name:'Повторить загрузку передачи ЭБУ'}).waitFor();
 await page.getByRole('button',{name:'Повторить загрузку передачи ЭБУ'}).click();
 await wait('GET',path,3);
 await complete('GET',path,2,true,record({summary:'NEW-ECU-REPORT-B',
  vehicle:{brand:'Scania',model:'R',year:2018,vin:null}}));
 await page.getByText('NEW-ECU-REPORT-B').waitFor();
 assert(await page.getByText('PRIVATE-ECU-REPORT-OWNER-A').count()===0,
  'old report reappeared after successful retry');

 const parsed=await page.evaluate(()=>
  ['','1e3','-1','0','1','1,50','123.45','1.234','1000000'].map(x=>[x,window.__parseEcuPrice(x)]));
 assert(JSON.stringify(parsed)===JSON.stringify([
  ['',null],['1e3',null],['-1',null],['0',null],['1',100],
  ['1,50',150],['123.45',12345],['1.234',null],['1000000',100000000],
 ]),'non-exact or out-of-bound ruble parsing accepted: '+JSON.stringify(parsed));
 await switchTo({me:{id:'master-C',roles:['master'],owner_id:null},
  id:'handoff-2'});
 const qPath='/api/ecu/handoffs/handoff-2';
 await wait('GET',qPath,1);
 await complete('GET',qPath,0,true,record({
  id:'handoff-2',state:'pending',actor:'candidate',summary:'CANDIDATE-C',
  vehicle:{brand:'MAN',model:'TGX'},quotes:[],
 }));
 const input=page.getByPlaceholder('Цена диагностики, ₽');
 await input.fill('1e3');
 const send=page.getByRole('button',{name:'Предложить диагностику'});
 assert(await send.isDisabled(),'exponential notation unexpectedly enabled price POST');
 await input.fill('200.999');
 assert(await send.isDisabled(),'rounding of fractional kopecks unexpectedly allowed');
 await input.fill('200,50');
 await page.getByPlaceholder('Что включено в диагностику и условия передачи блока')
  .fill('Диагностика электронного блока на стенде и письменное заключение');
 await send.click();
 await wait('POST',qPath+'/quote',1);
 const payload=await page.evaluate(()=>window.__ecuMock.calls.filter(x=>x.method==='POST').at(-1).body);
 assert(payload.diagnosisPrice===20050,'ECU quote lost exact kopeck amount');
 assert(await send.isDisabled(),'duplicate quote submission was not blocked');
 await switchTo({me:{id:'owner-D',roles:['client'],owner_id:null},id:'handoff-3'});
 const ownerPath='/api/ecu/handoffs/handoff-3';
 await wait('GET',ownerPath,1);
 await complete('GET',ownerPath,0,true,record({
   id:'handoff-3',state:'pending',actor:'owner',quotes:[{
     id:'quote-D',diagnosis_price:25000,version:1,
     public_name:'Демо мастерская',address:'Тестовый адрес',explanation:'Проверка ЭБУ'
   }],summary:'OWNER-D',
 }));
 const check=page.getByRole('checkbox');
 await page.getByRole('radio').check();
 await check.check();
 const choose=page.getByRole('button',{name:'Выбрать этого специалиста'});
 assert(await choose.isEnabled(),'quote consent did not enable choice');
 await page.evaluate(()=>window.__ecuMock.listeners.forEach(fn=>fn({
   type:'ecu_handoff',handoffId:'handoff-3'
 })));
 await wait('GET',ownerPath,2);
 await complete('GET',ownerPath,1,true,record({
   id:'handoff-3',state:'pending',actor:'owner',quotes:[{
     id:'quote-D',diagnosis_price:49000,version:2,
     public_name:'Демо мастерская',address:'Тестовый адрес',explanation:'Новая версия'
   }],summary:'OWNER-D',
 }));
 await page.locator('label.opt b').filter({hasText:'49000 коп.'}).waitFor();
 assert(await choose.isDisabled(),
   'old checkbox consent was reused after quote version or amount changed');
 await check.check();
 assert(await choose.isEnabled(),'new quote must be explicitly consented again');
 await choose.click();
 await wait('POST',ownerPath+'/choose',1);
 const picked=await page.evaluate(()=>window.__ecuMock.calls.findLast(x=>x.path.endsWith('/choose')).body);
 assert(picked.version===2&&picked.price===49000,
   'chosen quote version/price were not the current explicit consent');
 await complete('POST',qPath+'/quote',0,true,{ok:true});
 await complete('POST',ownerPath+'/choose',0,true,{ok:true});
 assert(!errors.length,'React runtime: '+errors.join('; '));
 console.log('ECU frontend: session isolation, exact price, changed consent and retries OK');
}finally{await browser.close();}
