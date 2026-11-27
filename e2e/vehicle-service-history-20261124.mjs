// VEHICLE-SERVICE-HISTORY-20261124: real React service-history and application
// components with synthetic, delayed GET/POST/PATCH. No real policies/accounts.
import {build} from 'esbuild';
import {chromium} from 'playwright';

const uiStub=`
  import {createContext,useContext,useState} from 'react';
  export const TestContext=createContext({me:null});
  export const useMe=()=>useContext(TestContext);
  export function useAction(){
    const [busy,setBusy]=useState(false);
    return {busy,run:async(fn)=>{setBusy(true);try{return await fn();}
      catch{return undefined;}finally{setBusy(false);}}};
  }
`;
const apiStub=`
  function call(method,path,body){
    const m=window.__vehicleMock;
    m.calls.push({method,path,body});
    return new Promise((resolve,reject)=>m.pending.push({method,path,body,resolve,reject}));
  }
  export const get=(path)=>call('GET',path);
  export const post=(path,body)=>call('POST',path,body);
  export const patch=(path,body)=>call('PATCH',path,body);
  export function fmtTime(value){return String(value);}
  export function onEvent(listener){
    window.__vehicleMock.listeners.push(listener);
    return ()=>{window.__vehicleMock.listeners=window.__vehicleMock.listeners.filter(x=>x!==listener);};
  }
`;
const presentationStub=`
  export function insurancePresentation(stage,status){
    return {label:'Статус '+(stage||status),
      detail:'Детали '+(stage||status),next:'Следующий шаг уточняется',tone:'neutral'};
  }
`;
const bundle=await build({
  stdin:{
    contents:`
      import React,{useState} from 'react';
      import {createRoot} from 'react-dom/client';
      import {TestContext} from './web/src/ui.tsx';
      import {VehicleServiceApplication,VehicleServiceHistory} from './web/src/screens/vehicleServices.tsx';
      window.__vehicleMock={pending:[],calls:[],listeners:[]};
      window.confirm=()=>true;
      function TestApp(){
        const [me,setMe]=useState({id:'owner-A',roles:['client'],performer:null});
        const [truck,setTruck]=useState('truck-A');
        window.__setVehicleMe=setMe;window.__setVehicleId=setTruck;
        window.__emitVehicleEvent=e=>window.__vehicleMock.listeners.forEach(fn=>fn(e));
        return <TestContext.Provider value={{me}}>
          <VehicleServiceApplication vehicleId={truck} onCreated={()=>{}}/>
          <VehicleServiceHistory id={truck} isDriver={false} refreshVersion={0}/>
        </TestContext.Provider>;
      }
      createRoot(document.getElementById('root')).render(<TestApp/>);
    `,
    resolveDir:process.cwd(),sourcefile:'vehicle-service-history-entry.tsx',loader:'tsx',
  },
  bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',
  plugins:[{
    name:'mock-private-history-only',
    setup(b){
      b.onResolve({filter:/./},args=>{
        if(args.path==='../ui.tsx'||args.path==='./web/src/ui.tsx')
          return {path:'ui-shared',namespace:'vehicle-stub'};
        if(args.path==='../api.ts')return {path:'api-shared',namespace:'vehicle-stub'};
        if(args.path==='../insurancePresentation.ts')
          return {path:'presentation',namespace:'vehicle-stub'};
      });
      b.onLoad({filter:/./,namespace:'vehicle-stub'},args=>({
        resolveDir:process.cwd(),
        contents:args.path==='ui-shared'?uiStub:args.path==='api-shared'?apiStub:presentationStub,
        loader:args.path==='ui-shared'?'tsx':'js',
      }));
    },
  }],
});
const assert=(ok,msg)=>{if(!ok)throw Error(msg);};
const history=(id,status,stage,note)=>({
  id,kind:'insurance',status,insurance_stage:stage,
  staff_note:note,created_at:'2026-01-10',updated_at:'2026-01-12',
  requested_by:'owner-A',policy_expires_on:status==='completed'?'2030-12-31':null,events:[],
});
const browser=await chromium.launch();
try{
  const page=await browser.newPage({viewport:{width:390,height:844},locale:'ru-RU'});
  const jsErrors=[];
  page.on('pageerror',e=>jsErrors.push(e.message));
  await page.setContent('<!doctype html><html lang="ru"><body><div id="root"></div></body></html>');
  await page.addScriptTag({content:bundle.outputFiles[0].text});
  const pending=async(method,path,n)=>{
    await page.waitForFunction(({method,path,n})=>
      window.__vehicleMock.pending.filter(x=>x.method===method&&x.path===path).length>=n,
      {method,path,n});
  };
  const settle=async(method,path,index,kind,data)=>{
    await page.evaluate(({method,path,index,kind,data})=>{
      const p=window.__vehicleMock.pending.filter(x=>x.method===method&&x.path===path)[index];
      if(!p)throw Error('Missing '+method+' '+path+' #'+index);
      p[kind](kind==='reject'?new Error(data):data);
    },{method,path,index,kind,data});
  };
  const a='/api/vehicles/truck-A/service-history';
  await pending('GET',a,1);
  await settle('GET',a,0,'resolve',[history('case-A','submitted','received','SECRET-A')]);
  await page.getByText('Активных страховых заявок: 1',{exact:false}).waitFor();
  await page.getByRole('button',{name:/Страхование и техосмотр · 1/}).click();
  await page.getByText('SECRET-A',{exact:false}).waitFor();

  // Two owner sessions on the same SPA must not share private history or
  // privileged cancellation buttons while the replacement request is pending.
  await page.evaluate(()=>window.__setVehicleMe({id:'owner-B',roles:['client'],performer:null}));
  await pending('GET',a,2);
  assert(await page.getByText('SECRET-A',{exact:false}).count()===0,
    'Old owner private insurance history leaked after account switch');
  assert(await page.getByRole('button',{name:'Отменить заявку'}).count()===0,
    'Stale cancellation controls persisted while a new account loads');
  await settle('GET',a,1,'reject','offline while switching');
  await page.getByRole('button',{name:'Повторить загрузку истории'}).waitFor();
  await page.getByRole('button',{name:'Повторить загрузку истории'}).click();
  await pending('GET',a,3);
  await settle('GET',a,2,'resolve',[history('case-B','completed','policy_sent','POLICY-B')]);
  await page.getByRole('button',{name:/Страхование и техосмотр · 1/}).click();
  await page.getByText('POLICY-B',{exact:false}).waitFor();

  // Calendar dates must be valid future dates, never silently accept a
  // historical or malformed expiry from a pre-filled policy record.
  await page.getByRole('button',{name:'Указать новый срок полиса'}).click();
  const expiry=page.getByLabel('Новая дата окончания полиса');
  await expiry.fill('2000-01-01');
  await page.getByText('Новая дата должна быть корректной и позже сегодняшнего дня.').waitFor();
  assert(await page.getByRole('button',{name:'Сохранить срок'}).isDisabled(),
    'Expired renewal date must not reach the PATCH API');
  await expiry.fill('2035-12-31');
  await page.getByRole('button',{name:'Сохранить срок'}).click();
  const endpoint='/api/vehicle-service-requests/case-B/renewal';
  await pending('PATCH',endpoint,1);
  await settle('PATCH',endpoint,0,'reject','offline after patch');
  await page.getByText(/Срок не подтверждён/).waitFor();
  assert(await expiry.inputValue()==='2035-12-31',
    'Network failure erased manually entered policy expiry');
  await page.getByRole('button',{name:'Сохранить срок'}).click();
  await pending('PATCH',endpoint,2);
  await settle('PATCH',endpoint,1,'resolve',{ok:true});
  await pending('GET',a,4);
  await settle('GET',a,3,'resolve',[history('case-B','completed','policy_sent','POLICY-B')]);
  await page.getByRole('button',{name:'Указать новый срок полиса'}).waitFor();

  // An incoming WebSocket refresh for truck A may finish AFTER navigating
  // to another truck. It must never repopulate truck B/C history.
  await page.evaluate(()=>window.__emitVehicleEvent({type:'connection_restored'}));
  await pending('GET',a,5);
  await page.evaluate(()=>window.__setVehicleId('truck-C'));
  const c='/api/vehicles/truck-C/service-history';
  await pending('GET',c,1);
  await settle('GET',a,4,'resolve',[history('case-A','submitted','received','STALE-A')]);
  assert(await page.getByText('STALE-A',{exact:false}).count()===0,
    'Late old-vehicle GET repopulated a new vehicle');
  await settle('GET',c,0,'resolve',[]);
  await page.getByRole('button',{name:/Страхование и техосмотр · 0/}).waitFor();

  // Editing the application on one truck and switching trucks must discard
  // the previous truck's comment and insurance/inspection choice.
  await page.getByRole('button',{name:'Страхование / техосмотр'}).click();
  await page.getByRole('combobox',{name:'Услуга'}).selectOption('inspection');
  await page.getByRole('textbox',{name:'Комментарий к заявке'}).fill('Draft from C');
  await page.evaluate(()=>window.__setVehicleId('truck-D'));
  await pending('GET','/api/vehicles/truck-D/service-history',1);
  await page.getByRole('button',{name:'Страхование / техосмотр'}).click();
  assert(await page.getByRole('combobox',{name:'Услуга'}).inputValue()==='insurance',
    'Old vehicle form choice leaked after switch');
  assert(await page.getByText('Draft from C').count()===0,
    'Old vehicle inspection comment was retained');
  await settle('GET','/api/vehicles/truck-D/service-history',0,'resolve',[]);
  assert(jsErrors.length===0,'Real React runtime errors: '+jsErrors.join('; '));
  console.log('PASS: private vehicle service history isolated; retry, renewal and form reset work');
}finally{await browser.close();}

// Exercise the shared model-photo load state in the existing browser CI entrypoint.
await import('./vehicle-photo-load-state-20261127.mjs');
