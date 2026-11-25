// Real Search React component, deterministic synthetic offers and transport.
import {build} from 'esbuild';
import {chromium} from 'playwright';
import {readFile} from 'node:fs/promises';

const stubs={
  '../api.ts': `
    export function get(path){return Promise.resolve(window.__searchMock.response);}
    export function post(path){window.__searchMock.chosen.push(path);return Promise.resolve({ok:true});}
    export function rub(v){return Math.round(v/100)+' ₽';}
    export function onEvent(fn){window.__searchMock.listener=fn;return ()=>{};}
  `,
  '../ui.tsx': `
    export function useAction(){return {busy:false,run:fn=>fn()};}
    export function useToast(){return ()=>{};}
  `,
  './roadsideMap.tsx':'export function RoadsideMap(){return null;}'
};
const bundle=await build({
  stdin:{sourcefile:'pc-search-fixture.tsx',resolveDir:process.cwd(),loader:'tsx',contents:`
    import React,{useState} from 'react';
    import {createRoot} from 'react-dom/client';
    import {Search} from './web/src/screens/search.tsx';
    window.__searchMock={response:{offers:[],autoPick:false},chosen:[],complete:0};
    function App(){
      const [collapsed,setCollapsed]=useState(false);
      const [revision,setRevision]=useState(0);
      window.__searchMock.revalidate=()=>setRevision(x=>x+1);
      return <Search key={revision} d={{id:'test',service:'electric',search:{candidates:4}}}
        collapsed={collapsed} onCollapsedChange={setCollapsed}
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
  if(await page.locator('.radar .blip.on').count()!==2)throw Error('Offer markers not synchronized');
  await page.getByText(/Время выбора:/).waitFor();
  const second=page.locator('.offer').filter({hasText:'Второй мастер'});
  await second.getByRole('button',{name:'Выбрать за 5500 ₽'}).click();
  await page.waitForFunction(()=>window.__searchMock.complete===1);
  const selected=await page.evaluate(()=>window.__searchMock.chosen);
  if(selected.length!==1||selected[0]!=='/api/orders/test/offers/second/choose')throw Error('Wrong offer chosen: '+selected);
  await page.emulateMedia({reducedMotion:'reduce'});
  if(await sweep.evaluate(el=>getComputedStyle(el).animationName)!=='none')throw Error('Reduced motion ignored');
  if(errors.length)throw Error(errors.join('; '));
  console.log('PASS: desktop radar, live collapsed offers, second offer choice, reduced motion');
}finally{await browser.close();}
