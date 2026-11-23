
import { build } from 'esbuild';
import { chromium } from 'playwright';
// Actual Work and LocationSharing React code; all network and GPS callbacks
// are isolated from real devices, SMS, accounts and payment services.
const stubs={"../api.ts":"export function get(path){\n if(path.includes('orders?as=performer'))\n  return Promise.resolve([{id:window.__mockMe.id+'-order',number:window.__mockMe.id==='master-1'?101:202,service:'electric',status:'accepted',address:'Склад тест'}]);\n if(path==='/api/performer/auctions')return Promise.resolve([]);\n if(path==='/api/performer/balance')return Promise.resolve({to_pay:window.__mockMe.id==='master-1'?10000:20000,cash_debt:0,paused:false});\n return Promise.resolve([]);\n}\nexport function post(path,body){window.__posts.push({path,body,as:window.__mockMe.id});return Promise.resolve({ok:true});}\nexport function put(){return Promise.resolve({ok:true});}\nexport const rub=v=>String(v??0)+' ₽';\nexport function onEvent(){return ()=>{};}","../dict.ts":"export const BRANDS=[];export const BRAND_LEVELS=[];\nexport const LINE={online:'Свободен',offline:'Не на линии',on_call:'На звонке',on_job:'На выезде',busy:'Перерыв'};\nexport const SERVICES={electric:{name:'Электрика'}};","../ui.tsx":"import {useEffect,useState} from 'react';\nexport function useMe(){return {me:window.__mockMe,reload:async()=>{window.__reloads++;}};}\nexport function useAction(){return {busy:false,run:async(fn)=>fn()};}\nexport function useLoad(fn,deps=[]){\n const [data,setData]=useState(null);\n const reload=async()=>{const v=await fn();setData(v);};\n useEffect(()=>{let active=true;fn().then(v=>{if(active)setData(v)});return()=>{active=false}},deps);\n return {data,error:null,reload};\n}\nexport function go(path){window.__go=path;}\nexport function Loading(){return null;}\nexport function Field({children}){return <div>{children}</div>;}\nexport function RubInput(){return null;}\nexport function Back(){return null;}\nexport function LiveStrip(){return null;}\nexport function useToast(){return ()=>{};}","../native.ts":"export const native={isApp:false,performerOnline(){}};","./search.tsx":"export function OfferForm(){return null;}","./ops.tsx":"export function WorkerNotices(){return null;}","../verifiedBadge.tsx":"export function VerifiedBadge(){return null;}","./ecuHandoffs.tsx":"export function EcuStationWorkspace(){return null;}","../vehicleVisual.tsx":"export function VehiclePhotoLink(){return null;}","./androidWorkspaces.tsx":"export function useMobileWorkspace(){return false;}export function AndroidPerformerWorkspace(){return null;}","./performerCabinet.tsx":"export function PerformerHub(){return null;}"};
const bundle=await build({
 stdin:{contents:"import React from 'react';\nimport {createRoot} from 'react-dom/client';\nimport {Work,LocationSharing} from './web/src/screens/performer.tsx';\nconst root=createRoot(document.getElementById('root'));\nwindow.__posts=[];window.__reloads=0;\nwindow.__watchers=[];window.__cleared=[];\nObject.defineProperty(navigator,'geolocation',{configurable:true,value:{\n watchPosition:(success,error,opts)=>{const id=window.__watchers.length+1;window.__watchers.push({id,success,error});return id;},\n clearWatch:id=>{window.__cleared.push(id);}\n}});\nconst makeUser=(id,verification)=>({id,roles:['master'],name:id,\n performer:{kind:'master',line_status:'offline',verification,submitted_at:null,\n specialties:['electric'],brands:{},schedule:{on:false}}});\nwindow.__users={\n first:makeUser('master-1','pending'),second:makeUser('master-2','approved')\n};\nwindow.__render=(mode,user='first')=>{\n window.__mockMe=window.__users[user];\n root.render(React.createElement(mode==='gps'?LocationSharing:Work));\n};\nwindow.__render('work');",resolveDir:process.cwd(),sourcefile:'performer-line-proof.tsx',loader:'tsx'},
 bundle:true,write:false,outdir:'./e2e/.tmp-performer-line',platform:'browser',format:'iife',jsx:'automatic',
 plugins:[{name:'no-live-external-modules',setup(b){
   b.onResolve({filter:/./},args=>{
     if(Object.hasOwn(stubs,args.path))return {path:args.path,namespace:'performer-line-stub'};
   });
   b.onLoad({filter:/./,namespace:'performer-line-stub'},args=>({
     contents:stubs[args.path],loader:args.path.endsWith('.tsx')?'tsx':'js'
   }));
 }}]
});
const source=bundle.outputFiles.find(f=>f.path.endsWith('.js'))?.text;
if(!source)throw Error('Cannot compile real performer React workspace');
const browser=await chromium.launch();
const check=(condition,message)=>{if(!condition)throw Error(message)};
try{
 const page=await browser.newPage({viewport:{width:1440,height:900},locale:'ru-RU'});
 const errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.setContent('<!doctype html><html lang="ru"><body><div id="root"></div></body></html>');
 await page.addScriptTag({content:source});
 await page.getByRole('heading',{name:'master-1'}).waitFor();
 await page.getByText(/№101/).first().waitFor();

 // Verification is voluntary: the real desktop line controls must be usable
 // before the person has uploaded verification documents.
 await page.getByText('Пройдите проверку',{exact:true}).first().waitFor();
 const status=page.getByRole('button',{name:/Статус · Не на линии/});
 check(await status.isEnabled(),'Unverified master cannot open desktop line controls');
 await status.click();
 await page.getByRole('button',{name:/Свободен/}).click();
 await page.waitForFunction(()=>window.__posts.some(p=>p.path==='/api/performer/line'));
 const linePost=await page.evaluate(()=>window.__posts.find(p=>p.path==='/api/performer/line'));
 check(linePost.body.lineStatus==='online','Desktop line toggle did not use existing API');

 // Same route, different account: no previous user's orders or balance.
 await page.evaluate(()=>window.__render('work','second'));
 await page.getByText(/№202/).first().waitFor();
 check(await page.getByText(/№101/).count()===0,'Previous worker order leaked after switching account');
 await page.getByText('200 ₽',{exact:false}).first().waitFor();
 check(await page.getByText('100 ₽',{exact:false}).count()===0,'Old worker balance remained visible');

 // GPS watcher is bound to the session and old queued callbacks cannot send
 // coordinates under a new bearer token after user switch.
 await page.evaluate(()=>window.__render('gps','first'));
 await page.waitForFunction(()=>window.__watchers.length===1);
 await page.evaluate(()=>window.__watchers[0].success({coords:{latitude:59.9,longitude:30.2}}));
 await page.waitForFunction(()=>window.__posts.some(p=>p.path==='/api/performer/location'));
 const firstGpsCount=await page.evaluate(()=>window.__posts.filter(p=>p.path==='/api/performer/location').length);
 await page.evaluate(()=>window.__render('gps','second'));
 await page.waitForFunction(()=>window.__watchers.length===2&&window.__cleared.includes(1));
 await page.evaluate(()=>window.__watchers[0].success({coords:{latitude:10,longitude:10}}));
 check(await page.evaluate(()=>window.__posts.filter(p=>p.path==='/api/performer/location').length)===firstGpsCount,
   'Stale GPS callback uploaded the previous worker location');
 await page.evaluate(()=>window.__watchers[1].success({coords:{latitude:60,longitude:31}}));
 await page.waitForFunction(n=>window.__posts.filter(p=>p.path==='/api/performer/location').length===n+1,firstGpsCount);
 const latest=await page.evaluate(()=>window.__posts.filter(p=>p.path==='/api/performer/location').at(-1));
 check(latest.as==='master-2'&&latest.body.lat===60,'New GPS watcher submitted wrong account or coordinates');
 check(errors.length===0,'Browser errors: '+errors.join('; '));
 console.log('PASS: real performer desktop allows voluntary verification, isolates user orders and GPS watches');
} finally {await browser.close();}
