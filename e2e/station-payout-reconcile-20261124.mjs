// Actual AdminServicePayouts React, synthetic transport only; no real payments.
import {build} from 'esbuild';
import {chromium} from 'playwright';
import assert from 'node:assert/strict';

const apiStub=`
export const requests=()=>window.__sto.pending;
export function get(path) {
  return new Promise((resolve,reject)=>{
    window.__sto.pending.push({method:'GET',path,resolve,reject});
  });
}
export function post(path,body) {
  return new Promise((resolve,reject)=>{
    window.__sto.pending.push({method:'POST',path,body,resolve,reject});
  });
}
export const put=post;
export const rub=n=>((n??0)/100).toLocaleString('ru-RU')+' ₽';
export const fmtTime=s=>String(s);
export function onEvent(callback){
  window.__sto.listeners.add(callback);
  return ()=>window.__sto.listeners.delete(callback);
}
`;
const uiStub=`
import React from 'react';
export const useMe=()=>({me:window.__sto.me,reload:async()=>{},mode:'service'});
export const go=path=>{window.__sto.go.push(path)};
export const useAction=()=>{
  const [busy,setBusy]=React.useState(false);
  return {busy,run:async(fn)=>{
    setBusy(true);
    try{return await fn()}catch(error){window.__sto.errors.push(error.message);return undefined}
    finally{setBusy(false)}
  }};
};
export function Loading(){return React.createElement('span',{role:'status'},'Загрузка…')}
export function Field({label,children}){return React.createElement('label',null,label,children)}
export function Back(){return React.createElement('span',null,'Назад')}
export function RubInput({value,onChange}){return React.createElement('input',{
  'aria-label':'Денежная сумма',value:value??'',onChange:e=>onChange(Number(e.target.value)||null)
})}
`;
const stubs={
  '../api.ts':apiStub,
  '../ui.tsx':uiStub,
  '../dict.ts':`
    export const BRANDS=['Scania','Volvo'];
    export const FEE_PURPOSE='Сервисные условия применяются по подтверждённой редакции';
    export const PLACES=[{id:'moscow',name:'Москва',lat:55.75,lng:37.61}];
  `,
  './ops.tsx':"export function WorkerNotices(){return null}",
  './roadsideMap.tsx':"export function RoadsideMap(){return null}",
  './DestinationCard.tsx':"export function DestinationCard(){return null}",
  '../verifiedBadge.tsx':"export function VerifiedBadge(){return null}",
  '../vehicleVisual.tsx':"export function VehicleModelPhoto(){return null}",
};

const bundled=await build({
  stdin:{contents:`
    import React,{useState} from 'react';
    import {createRoot} from 'react-dom/client';
    import {AdminServicePayouts} from './web/src/screens/base.tsx';
    function App(){
      const [user,setUser]=useState({id:'admin-A',roles:['admin']});
      window.__sto.me=user;
      window.__sto.switchUser=setUser;
      return user.roles.includes('admin')?React.createElement(AdminServicePayouts):React.createElement('h1',null,'Нет прав');
    }
    createRoot(document.getElementById('root')).render(React.createElement(App));
  `,sourcefile:'station-payout-reconcile.tsx',resolveDir:process.cwd(),loader:'tsx'},
  bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',
  plugins:[{name:'isolated-station-payout',setup(b){
    b.onResolve({filter:/./},args=>{
      if(args.importer.endsWith('/web/src/screens/base.tsx')&&Object.hasOwn(stubs,args.path))
        return {path:args.path,namespace:'sto-stub'};
    });
    b.onLoad({filter:/.*/,namespace:'sto-stub'},args=>({resolveDir:process.cwd(),
      contents:stubs[args.path],loader:args.path.endsWith('.tsx')?'tsx':'js'}));
  }}]
});
const invoice=(id,number,name)=>({id,number,center_name:name,payout:120000,amount:125000,commission:5000,inn:'test',closed_at:'2026-11-24'});
const browser=await chromium.launch();
try{
  const page=await browser.newPage({viewport:{width:390,height:844}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',route=>route.abort());
  await page.setContent('<div id="root"></div>');
  await page.evaluate(()=>window.__sto={pending:[],listeners:new Set(),errors:[],go:[],me:null});
  await page.addScriptTag({content:bundled.outputFiles[0].text});
  const wait=(n,method,path)=>page.waitForFunction(({n,method,path})=>{
    const q=window.__sto.pending;return q.length>=n && q[n-1].method===method && q[n-1].path===path;
  },{n,method,path},{timeout:5000});
  const get='/api/admin/service-payouts';
  const paid=id=>'/api/admin/bookings/'+id+'/paid';
  const answer=(i,data)=>page.evaluate(({i,data})=>window.__sto.pending[i].resolve(data),{i,data});
  const reject=i=>page.evaluate(i=>window.__sto.pending[i].reject(Error('Ответ потерян')),i);
  const count=()=>page.evaluate(()=>window.__sto.pending.length);
  const settle=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  const buttons=page.getByRole('button',{name:'Отметить выплату'});
  await wait(1,'GET',get);
  await answer(0,[invoice('a',101,'СТО A'),invoice('b',102,'СТО B')]);
  await page.getByText('СТО A · счёт №101').waitFor();
  // Dispatch two real React click events synchronously before busy can render.
  await buttons.first().evaluate(el=>{el.click();el.click()});
  await wait(2,'POST',paid('a'));
  await settle();
  assert.equal(await count(),2,'Duplicate payout POST');
  assert.ok(await buttons.first().isDisabled(),'Pending payout not disabled');
  await reject(1);
  await wait(3,'GET',get);
  await page.getByRole('status').waitFor();
  assert.equal(await buttons.count(),0,'Stale payout actions after lost response');
  await reject(2);
  await page.getByRole('alert').waitFor();
  assert.equal(await buttons.count(),0,'Unverified payout list after GET failure');
  await page.getByRole('button',{name:'Повторить загрузку'}).click();
  await wait(4,'GET',get);
  await answer(3,[invoice('b',102,'СТО B')]);
  await page.getByText('СТО B · счёт №102').waitFor();
  assert.equal(await page.getByText('СТО A · счёт №101').count(),0);
  assert.equal(await buttons.count(),1);
  // Successful mark also requires a fresh list; then another admin enters.
  await buttons.first().click();
  await wait(5,'POST',paid('b'));
  await answer(4,{ok:true});
  await wait(6,'GET',get);
  await page.getByRole('status').waitFor();
  await answer(5,[invoice('c',103,'СТО C')]);
  await page.getByText('СТО C · счёт №103').waitFor();
  await buttons.first().click();
  await wait(7,'POST',paid('c'));
  await page.evaluate(()=>window.__sto.switchUser({id:'admin-B',roles:['admin']}));
  await wait(8,'GET',get);
  await answer(7,[invoice('d',104,'СТО D')]);
  await page.getByText('СТО D · счёт №104').waitFor();
  await reject(6);
  await settle();
  assert.equal(await count(),8,'Retired account issued a late reconciliation GET');
  assert.equal(await page.getByText('СТО C · счёт №103').count(),0);
  await page.evaluate(()=>window.__sto.switchUser({id:'admin-B',roles:['client']}));
  await page.getByRole('heading',{name:'Нет прав'}).waitFor();
  assert.equal(await buttons.count(),0);
  assert.deepEqual(errors,[]);
  console.log('PASS station payout: duplicate click, lost POST, failed GET, fresh list, success, account switch and role revocation');
}finally{await browser.close()}
