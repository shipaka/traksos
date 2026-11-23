// ROADSIDE-MAP-GPS-CONSENT-20261124: real React/Chromium privacy contract.
// Never calls a real map vendor: every external URL is intercepted.
import {build} from 'esbuild';
import {chromium} from 'playwright';

const ui=`
 import {createContext,useContext} from 'react';
 export const C=createContext({me:null});
 export const useMe=()=>useContext(C);
`;
const bundle=await build({
 stdin:{contents:`
  import React,{useState} from 'react';
  import {createRoot} from 'react-dom/client';
  import {C} from './web/src/ui.tsx';
  import {RoadsideMap} from './web/src/screens/roadsideMap.tsx';
  function App(){
   const [state,setState]=useState({
     me:{id:'owner-A'},
     point:{lat:59.943123,lng:30.318321},
     kind:'request',synthetic:false,
   });
   window.__roadsideSwitch=patch=>setState(prev=>({...prev,...patch}));
   return <C.Provider value={{me:state.me}}>
     <RoadsideMap {...state} address="Тестовый адрес" />
   </C.Provider>;
  }
  createRoot(document.getElementById('root')).render(<App/>);
 `,resolveDir:process.cwd(),sourcefile:'roadside-map-consent-entry.tsx',loader:'tsx'},
 bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',
 plugins:[{name:'isolate-roadside-context-and-css',setup(b){
   b.onResolve({filter:/./},args=>{
     if(['../ui.tsx','./web/src/ui.tsx'].includes(args.path))
       return {path:'ui',namespace:'roadside-stub'};
     if(args.path.endsWith('.css'))
       return {path:args.path,namespace:'roadside-css'};
   });
   b.onLoad({filter:/./,namespace:'roadside-stub'},()=>({contents:ui,loader:'js'}));
   b.onLoad({filter:/./,namespace:'roadside-css'},()=>({contents:'',loader:'js'}));
 }}],
});
const js=bundle.outputFiles.find(x=>x.path.endsWith('.js'))?.text;
if(!js)throw Error('Roadside component did not compile into a Chromium bundle');
const assert=(ok,msg)=>{if(!ok)throw Error(msg);};
const browser=await chromium.launch();
try{
 const page=await browser.newPage({viewport:{width:390,height:844},locale:'ru-RU'});
 const errors=[],external=[];
 page.on('pageerror',e=>errors.push(e.message));
 page.on('request',r=>{
   if(/openstreetmap|yandex\.ru/i.test(r.url()))external.push(r.url());
 });
 await page.route(/https:\/\/(?:www\.)?openstreetmap\.org\/.*$/,route=>
   route.fulfill({status:200,contentType:'text/html',body:'<html><body>Test map tile</body></html>'}));
 await page.setContent('<!doctype html><html lang="ru"><body><div id="root"></div></body></html>');
 await page.addScriptTag({content:js});
 const iframe=page.locator('.roadside-map iframe');
 const load=page.getByRole('button',{name:'Загрузить карту OpenStreetMap'});
 const change=patch=>page.evaluate(patch=>window.__roadsideSwitch(patch),patch);
 await load.waitFor();
 assert(await iframe.count()===0,'GPS iframe auto-loaded without permission');
 assert(external.length===0,'third-party map request was sent on initial render');
 await load.click();
 await iframe.waitFor();
 await page.waitForFunction(()=>document.querySelector('.roadside-map iframe')?.getAttribute('src')?.includes('59.943123'));
 assert(external.length===1,'a single explicit consent should cause exactly one OSM request');
 assert(external[0].includes('30.318321'),'user approved GPS was not sent');

 // The exact point changed. Consent MUST be scoped to the prior coordinates,
 // and must not silently send the newly tracked courier's position.
 await change({point:{lat:59.960123,lng:30.360321}});
 await load.waitFor();
 assert(await iframe.count()===0,'old consent reused for changed GPS');
 assert(external.length===1,'new GPS leaked to map vendor without a second click');

 // Switching account while preserving identical coordinates also revokes
 // the prior user's external map consent.
 await load.click();
 await iframe.waitFor();
 assert(external.length===2,'second deliberate consent did not load new map');
 await change({me:{id:'owner-B'}});
 await load.waitFor();
 assert(await iframe.count()===0,'old account consent reused after logout/login');
 assert(external.length===2,'account switch triggered external map request');

 await change({point:null});
 await page.getByText('Нужна точка на карте').waitFor();
 assert(await iframe.count()===0,'missing GPS created external map');
 assert(await load.count()===0,'missing coordinates offered a misleading load action');
 assert(external.length===2,'missing GPS caused vendor request');

 await change({point:{lat:59.960123,lng:30.360321},synthetic:true});
 await page.getByText('Демонстрационные координаты — не реальный выезд').waitFor();
 assert(await iframe.count()===0,'synthetic location automatically sent to map vendor');
 assert(external.length===2,'DEMO coordinates sent without click');
 assert(!errors.length,'React runtime: '+errors.join('; '));
 console.log('Roadside map privacy: no third-party GPS request without per-user/per-location consent');
}finally{await browser.close();}
