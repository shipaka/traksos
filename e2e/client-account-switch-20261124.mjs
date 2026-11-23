// Real customer Home, Orders, Garage and Profile with an isolated private API.
import {build} from 'esbuild';
import {chromium} from 'playwright';

const api=`
 export function onEvent(callback) {
   window.__clientMock.subs.push(callback);
   return ()=>{window.__clientMock.subs=window.__clientMock.subs.filter(x=>x!==callback);};
 }
 export function get(path){
   return new Promise((resolve,reject)=>window.__clientMock.calls.push({
     path,user:window.__clientMock.user?.id,resolve,reject
   }));
 }
 export async function post(){throw Error('No real POST in UI regression');}
 export async function postOrder(){throw Error('No order creation in UI regression');}
 export async function patch(){throw Error('No profile write in UI regression');}
 export async function put(){throw Error('No update in UI regression');}
 export async function del(){throw Error('No delete in UI regression');}
 export function rub(v){return Math.round((v??0)/100)+' ₽';}
 export function fmtTime(v){return String(v??'');}
 export function fmtPhone(v){return String(v??'');}
 export function setToken(){}
 export function disconnectWs(){}
`;
const ui=`
 import React from 'react';
 export function useMe(){return {me:window.__clientMock.user,mode:'client',reload:async()=>{}};}
 export function useAction(){return {busy:false,run:async fn=>fn()};}
 export function useLoad(){return {data:null,error:null,reload:async()=>{}};}
 export function Loading({error}){return <span role="status">{error??'Загружаю…'}</span>;}
 export function Field({label,children}){return <label>{label}{children}</label>;}
 export function Chips(){return null;}
 export function VehicleFields(){return null;}
 export function LiveStrip(){return null;}
 export function Back(){return null;}
 export function RubInput(){return null;}
 export function go(){}
`;
const dict=`
 export const SERVICES={electric:{name:'Электрик',hint:'Проверка проводки'},tow:{name:'Эвакуатор'}};
 export const STATUS={accepted:{name:'Принято',tone:'good'},completed:{name:'Завершено',tone:'good'},
   no_performer:{name:'Никто не взял',tone:'bad'}};
 export const TIERS={};
 export const SYMPTOMS=[];
 export const CONSULT_CONF={};
 export const ON_SITE={};
 export function seriesHint(){return '';}
`;
const stubs={
 '../api.ts':api,'../dict.ts':dict,'../ui.tsx':ui,
 './base.tsx':`export function BookingRows(){return null;}
   export function BookingList(){return null;}
   export function isOpenBooking(){return false;}`,
 './fleet.tsx':'export function DriverRules(){return null;}',
 './vehicleServices.tsx':`export function VehicleServiceApplication(){return null;}
   export function VehicleServiceHistory(){return null;}`,
 '../native.ts':`export const native={isApp:false,appLockEnabled:()=>false};`,
 '../orderDraft.ts':`export const saveNewOrderDraft=async()=>null;
   export const readNewOrderDraft=async()=>null;
   export const clearNewOrderDraft=()=>{};`,
 '../insurancePresentation.ts':`export function insurancePresentation(){return {tone:'ok',label:'готово',next:''};}
   export function isOpenInsuranceRequest(){return false;}`,
 '../vehicleVisual.tsx':'export function VehiclePhotoLink(){return null;}',
 '../approvedVisuals.ts':'export const APPROVED_VISUALS={workspaceTruck:"data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs="};',
 '../approvedEmptyScene.tsx':'export function ApprovedEmptyScene(){return null;}',
 '../approvedServiceIllustration.tsx':'export function ApprovedServiceIllustration(){return null;}',
 '../approvedOrderTruck.tsx':'export function ApprovedOrderTruck(){return null;}',
 './androidWorkspaces.tsx':`export function useMobileWorkspace(){return false;}
   export function AndroidClientWorkspace(){return null;}`,
};
const b=await build({
 stdin:{sourcefile:'client-account-switch-entry.tsx',loader:'tsx',resolveDir:process.cwd(),contents:`
   import React,{useState} from 'react';
   import {createRoot} from 'react-dom/client';
   import {Home,Orders,Garage,Profile} from './web/src/screens/client.tsx';
   window.__clientMock={calls:[],subs:[],user:null};
   function App(){
     const [view,setView]=useState({page:'home',user:'A'});
     window.__clientRoute=setView;
     const id=view.user;
     window.__clientMock.user={
       id,name:'Имя '+id,roles:['client'],phone:id==='A'?'+79991111111':'+79992222222',
       owner_id:null,company_name:'Company '+id,company_inn:''
     };
     return view.page==='home'?<Home/>:
       view.page==='orders'?<Orders as="client"/>:
       view.page==='garage'?<Garage/>:<Profile/>;
   }
   createRoot(document.getElementById('root')).render(<App/>);
 `},
 bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',
 plugins:[{name:'stub-external-and-preserve-private-read',setup(b){
   b.onResolve({filter:/./},a=>{
     if(Object.hasOwn(stubs,a.path))return {path:a.path,namespace:'client-stub'};
   });
   b.onLoad({filter:/./,namespace:'client-stub'},a=>({
     contents:stubs[a.path],loader:a.path.endsWith('.tsx')?'tsx':'js'
   }));
 }}]
});
const js=b.outputFiles.find(x=>x.path.endsWith('.js'));
const browser=await chromium.launch();
try {
 const page=await browser.newPage({viewport:{width:1440,height:920}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.setContent('<!doctype html><html lang="ru"><body><div id="root"></div></body></html>');
 await page.addScriptTag({content:js.text});
 const wait=(path,user,n)=>page.waitForFunction(([p,u,n])=>
   window.__clientMock.calls.filter(x=>x.path===p&&x.user===u).length>=n,[path,user,n]);
 const answer=(path,user,n,result,fail=false)=>page.evaluate(([p,u,n,result,fail])=>{
   const req=window.__clientMock.calls.filter(x=>x.path===p&&x.user===u)[n];
   if(!req)throw Error('No request: '+p+' '+u+' '+n);
   fail?req.reject(Error(result)):req.resolve(result);
 },[path,user,n,result,fail]);
 const nav=(pageName,user)=>page.evaluate(v=>window.__clientRoute(v),{page:pageName,user});
 const order=(n)=>({id:'order-'+n,number:n,service:'electric',status:'accepted',
   created_at:'2026-11-24T00:00:00Z',address:'Учебная стоянка '+n});
 // Home: previous account's active delivery must never be visible after logout/login.
 await wait('/api/orders','A',1);
 await wait('/api/vehicle-service-requests','A',1);
 await answer('/api/orders','A',0,[order(101)]);
 await answer('/api/vehicle-service-requests','A',0,[]);
 await page.getByText('Заявка №101 · Электрик').waitFor();
 await nav('home','B');
 await wait('/api/orders','B',1);
 if(await page.getByText('Заявка №101 · Электрик').count())
   throw Error('Old customer order leaked after account switch');
 await answer('/api/orders','B',0,'offline',true);
 await answer('/api/vehicle-service-requests','B',0,[]);
 await page.getByRole('button',{name:'Повторить загрузку заявок'}).click();
 await wait('/api/orders','B',2);
 await answer('/api/orders','B',1,[order(202)]);
 await page.getByText('Заявка №202 · Электрик').waitFor();

 // Orders and bookings are independent GETs; one failed read is retryable.
 await nav('orders','B');
 await wait('/api/orders?as=client','B',1);await wait('/api/bookings','B',1);
 await answer('/api/orders?as=client','B',0,'offline history',true);
 await answer('/api/bookings','B',0,'offline bookings',true);
 await page.getByRole('button',{name:'Повторить загрузку записей'}).waitFor();
 await page.getByRole('button',{name:'Повторить загрузку заявок'}).click();
 await wait('/api/orders?as=client','B',2);
 await answer('/api/orders?as=client','B',1,[order(202)]);
 await page.getByText('№202 · Электрик').waitFor();

 // Garage A's private truck must not be briefly exposed to account B.
 await nav('garage','A');await wait('/api/vehicles','A',1);
 await answer('/api/vehicles','A',0,[]);
 await page.getByText('Ваш автопарк пока пуст').waitFor();
 await nav('garage','B');await wait('/api/vehicles','B',1);
 await answer('/api/vehicles','B',0,'offline vehicles',true);
 await page.getByRole('button',{name:'Повторить загрузку транспорта'}).waitFor();
 await page.getByRole('button',{name:'Повторить загрузку транспорта'}).click();
 await wait('/api/vehicles','B',2);
 await answer('/api/vehicles','B',1,[]);
 await page.getByText('Ваш автопарк пока пуст').waitFor();

 // Profile password fields are ephemeral, not shared across users.
 await nav('profile','A');
 await page.getByRole('button',{name:'Сменить пароль'}).click();
 const original=page.locator('input[autocomplete="current-password"]');
 await original.fill('PRIVATE-A-CURRENT-PASSWORD');
 await nav('profile','B');
 if(await page.locator('input[autocomplete="current-password"]').count())
   throw Error('Old account retained an open password form');
 if(await page.getByText('Company A').count())
   throw Error('Old company details leaked into profile B');
 if(errors.length)throw Error('React runtime errors: '+errors.join('; '));
 console.log('PASS client Home, Orders, Garage, Profile account scope and offline retries');
} finally {await browser.close();}
