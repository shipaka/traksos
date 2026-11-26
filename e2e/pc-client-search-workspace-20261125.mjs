// Real Search React component, deterministic synthetic offers and transport.
import {build} from 'esbuild';
import {chromium} from 'playwright';
import {readFile} from 'node:fs/promises';

const stubs={
  '../api.ts': `
    export function getToken(){return window.__searchMock.token;}
    export function get(path){const m=window.__searchMock;return m.holdRead?new Promise((resolve,reject)=>{m.pendingRead={resolve,reject}}):Promise.resolve(m.response);}
    export function post(path){const m=window.__searchMock;m.chosen.push(path);return m.holdChoose?new Promise(resolve=>{m.pendingChoose=resolve}):Promise.resolve({ok:true});}
    export function rub(v){return Math.round(v/100)+' ₽';}
    export function onEvent(fn){window.__searchMock.listener=fn;return ()=>{};}
  `,
  '../ui.tsx': `
    export function useAction(){return {busy:false,run:fn=>fn()};}
    export function useToast(){return message=>window.__searchMock.toasts.push(message);}
  `,
  './roadsideMap.tsx':'export function RoadsideMap(){return null;}'
};
const bundle=await build({
  stdin:{sourcefile:'pc-search-fixture.tsx',resolveDir:process.cwd(),loader:'tsx',contents:`
    import React,{useState} from 'react';
    import {createRoot} from 'react-dom/client';
    import {Search} from './web/src/screens/search.tsx';
    window.__searchMock={response:{offers:[],autoPick:false},chosen:[],complete:0,token:'session-a',toasts:[],parentDeadline:new Date(Date.now()+600000).toISOString()};
    function App(){
      const [collapsed,setCollapsed]=useState(false);
      const [revision,setRevision]=useState(0);
      const [id,setId]=useState('test');
      window.__searchMock.switchOrder=setId;
      const [motionEpoch]=useState(()=>performance.now()-2500);
      window.__searchMock.epoch=motionEpoch;
      window.__searchMock.revalidate=()=>setRevision(x=>x+1);
      return <Search key={revision} d={{id,service:'electric',search:{candidates:4},autoPick:true,auctionUntil:window.__searchMock.parentDeadline}}
        collapsed={collapsed} onCollapsedChange={setCollapsed} motionEpoch={motionEpoch}
        onChosen={()=>window.__searchMock.complete++}/>;
    }
    createRoot(document.getElementById('root')).render(<App/>);
  `},
  bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',outdir:'./e2e/.tmp-pc-search',
  plugins:[{name:'synthetic-search-transport',setup(b){
    b.onResolve({filter:/./},a=>Object.hasOwn(stubs,a.path)?{path:a.path,namespace:'stub'}:undefined);
    b.onLoad({filter:/./,namespace:'stub'},a=>({contents:stubs[a.path],loader:'js'}));
  }}]
});
const browser=await chromium.launch();
try{
  const page=await browser.newPage({viewport:{width:1440,height:900}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.setContent('<html lang="ru"><body><div class="app"><div id="root"></div></div></body></html>');
  await page.addStyleTag({content:await readFile('web/src/styles.css','utf8')});
  await page.addStyleTag({content:bundle.outputFiles.find(f=>f.path.endsWith('.css')).text});
  await page.addScriptTag({content:bundle.outputFiles.find(f=>f.path.endsWith('.js')).text});
  const panel=page.locator('.search-workspace-content');
  await page.locator('.search-title').filter({hasText:'Ищем исполнителя'}).waitFor();
  if(await page.locator('.radar .blip').count())throw Error('Unanswered candidates must not become offer markers');
  const sweep=page.locator('.search-workspace-radar .sweep');
  const animation=await sweep.evaluate(el=>{const s=getComputedStyle(el);return [s.animationDuration,s.animationTimingFunction,s.animationIterationCount];});
  if(animation.join('|')!=='8s|linear|infinite')throw Error('Desktop radar is not continuous: '+animation);
  const checkPhase=async()=>{
    const phase=await sweep.evaluate(el=>{
      const actual=-parseFloat(getComputedStyle(el).animationDelay)*1000;
      const expected=(performance.now()-window.__searchMock.epoch)%8000;
      return {actual,expected,difference:Math.min(Math.abs(actual-expected),8000-Math.abs(actual-expected))};
    });
    if(!Number.isFinite(phase.actual)||phase.difference>700)throw Error('Rotor restarted instead of restoring phase: '+JSON.stringify(phase));
  };
  await checkPhase();
  const originalDelay=await sweep.evaluate(el=>getComputedStyle(el).animationDelay);
  await page.evaluate(()=>window.__searchMock.listener({type:'order',orderId:'test'}));
  if(await sweep.evaluate(el=>getComputedStyle(el).animationDelay)!==originalDelay)throw Error('Normal offer refresh changed running animation delay');
  await page.getByRole('button',{name:'Свернуть поиск'}).click();
  if(await panel.isVisible())throw Error('Collapsed search remained visible');
  await page.evaluate(()=>{
    window.__searchMock.response={autoPick:true,until:new Date(Date.now()+120000).toISOString(),offers:[
      {id:'first',name:'Первый мастер',price:500000,diffPct:0,eta_minutes:20},
      {id:'second',name:'Второй мастер',price:550000,diffPct:0,eta_minutes:25}
    ]};
    window.__searchMock.listener({type:'order',orderId:'test'});
  });
  await page.getByRole('status').filter({hasText:'2 отклика'}).first().waitFor();
  await page.evaluate(()=>window.__searchMock.revalidate());
  await page.getByRole('status').filter({hasText:'2 отклика'}).first().waitFor();
  if(await panel.isVisible())throw Error('Same-order revalidation expanded a collapsed search');
  await page.getByRole('button',{name:'Раскрыть поиск'}).click();
  await checkPhase();
  if(await page.locator('.radar .blip.on').count()!==2)throw Error('Offer markers not synchronized');
  // The current server deadline overrides the stale ten-minute parent value.
  await page.getByText(/Время выбора: (?:01:|02:00)/).waitFor();
  await page.evaluate(()=>{const m=window.__searchMock;m.response.until=new Date(Date.now()-1000).toISOString();m.listener({type:'order',orderId:'test'});});
  await page.getByText(/Время выбора истекло/).waitFor();
  if(await page.evaluate(()=>window.__searchMock.chosen.length||window.__searchMock.complete))throw Error('Timer expiry performed a client-side assignment');
  await page.evaluate(()=>{const m=window.__searchMock;m.response.until=null;m.listener({type:'order',orderId:'test'});});
  await page.getByText('Выберите подходящего исполнителя',{exact:true}).waitFor();
  if(await page.getByText(/Время выбора:/).count())throw Error('Cleared server deadline resurrected stale parent timer');
  await page.evaluate(()=>{const m=window.__searchMock;m.response.until=new Date(Date.now()+120000).toISOString();m.listener({type:'order',orderId:'test'});});
  await page.getByText(/Время выбора:/).waitFor();
  const second=page.locator('.offer').filter({hasText:'Второй мастер'});
  await second.getByRole('button',{name:'Выбрать за 5500 ₽'}).click();
  await page.waitForFunction(()=>window.__searchMock.complete===1);
  const selected=await page.evaluate(()=>window.__searchMock.chosen);
  if(selected.length!==1||selected[0]!=='/api/orders/test/offers/second/choose')throw Error('Wrong offer chosen: '+selected);
  // Reconnect discards cards until the server has revalidated availability.
  await page.evaluate(()=>{const m=window.__searchMock;m.holdRead=true;m.listener({type:'connection_restored'});});
  await page.locator('.offer').first().waitFor({state:'detached'});
  await page.waitForFunction(()=>!!window.__searchMock.pendingRead);
  await page.evaluate(()=>{const m=window.__searchMock;m.holdRead=false;m.pendingRead.resolve(m.response);});
  await second.waitFor();
  // Ordinary refresh retains geometry, but stale offers cannot be chosen.
  await page.evaluate(()=>{const m=window.__searchMock;m.holdRead=true;m.listener({type:'order',orderId:'test'});});
  await page.waitForFunction(()=>document.querySelector('.offer button')?.disabled);
  await page.evaluate(()=>{const m=window.__searchMock;m.holdRead=false;m.pendingRead.reject(Error('offline'));});
  await page.getByText('Не удалось получить свежие отклики.',{exact:false}).waitFor();
  if(await page.locator('.offer').count())throw Error('Failed verification exposed stale offers');
  await page.getByRole('button',{name:'Повторить',exact:true}).click();
  await second.waitFor();
  // One request even when invoked twice in the same event loop, and a late
  // successful response from the previous order must not notify the new one.
  await page.evaluate(()=>{window.__searchMock.holdChoose=true;const button=[...document.querySelectorAll('.offer button')][1];button.click();button.click();});
  await page.waitForFunction(()=>!!window.__searchMock.pendingChoose);
  if(await page.evaluate(()=>window.__searchMock.chosen.length)!==2)throw Error('Duplicate choose');
  await page.evaluate(()=>{const m=window.__searchMock;m.response={offers:[],autoPick:false};m.token='session-b';m.switchOrder('other');});
  await page.locator('.search-title').filter({hasText:'Ищем исполнителя'}).waitFor();
  await page.evaluate(()=>window.__searchMock.pendingChoose({ok:true}));
  await page.waitForTimeout(100);
  if(await page.evaluate(()=>window.__searchMock.complete!==1||window.__searchMock.toasts.length!==1))throw Error('Stale choose completed in another session');
  await page.emulateMedia({reducedMotion:'reduce'});
  if(await sweep.evaluate(el=>getComputedStyle(el).animationName)!=='none')throw Error('Reduced motion ignored');
  if(errors.length)throw Error(errors.join('; '));
  console.log('PASS: desktop radar, live collapsed offers, second offer choice, reduced motion');
}finally{await browser.close();}
