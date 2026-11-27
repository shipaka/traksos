// Isolated Chromium regression of the actual DriverAir React component.
// Synthetic reads are controlled explicitly; no real account, SMS or network writes.
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {chromium} from 'playwright';

const stubs={
  '../api.ts':`
    export function getToken(){return 'synthetic-driver-token';}
    export function get(path){
      return new Promise((resolve,reject)=>window.__airTest.requests.push({path,resolve,reject}));
    }
    export async function post(){throw Error('Unexpected write in read-only Air regression');}
  `,
  '../ui.tsx':`
    export function useMe(){return {me:{id:'synthetic-driver',roles:['client','driver']}};}
    export function Back(){return null;}
  `
};
const bundle=await build({
  stdin:{sourcefile:'air-regression-entry.tsx',loader:'tsx',resolveDir:process.cwd(),contents:`
    import {createRoot} from 'react-dom/client';
    import {DriverAir} from './web/src/screens/driverAir.tsx';
    window.__airTest={requests:[],visible:true,online:true};
    Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>window.__airTest.visible?'visible':'hidden'});
    Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>window.__airTest.online});
    createRoot(document.getElementById('root')).render(<DriverAir/>);
  `},
  bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',
  plugins:[{name:'air-isolated-api',setup(b){
    b.onResolve({filter:/./},a=>Object.hasOwn(stubs,a.path)?{path:a.path,namespace:'air-stub'}:undefined);
    b.onLoad({filter:/./,namespace:'air-stub'},a=>({contents:stubs[a.path],loader:'tsx'}));
  }}]
});
const browser=await chromium.launch();
try{
  const page=await browser.newPage({viewport:{width:390,height:844}});
  const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.setContent('<!doctype html><html lang="ru"><body><div id="root"></div></body></html>');
  await page.clock.install();
  await page.addScriptTag({content:bundle.outputFiles[0].text});
  const log=page.getByRole('log',{name:'Сообщения эфира'});
  const composer=page.getByRole('textbox',{name:'Сообщение в эфир'});
  const count=()=>page.evaluate(()=>window.__airTest.requests.length);
  const waitCount=n=>page.waitForFunction(n=>window.__airTest.requests.length===n,n);
  const answer=(index,value)=>page.evaluate(({index,value})=>{
    const request=window.__airTest.requests[index];
    if(request.path!=='/api/air/messages')throw Error('Unexpected GET: '+request.path);
    request.resolve(value);
  },{index,value});
  const message=(id,body)=>({id,author:'Синтетический водитель',body,isBot:false,createdAt:'2026-11-25T12:00:00Z'});
  const snapshot=(tail,body,canPost=true)=>({
    messages:[...Array.from({length:20},(_,i)=>message('stable-'+i,'Сообщение '+i)),message(tail,body)],
    botEnabled:false,canModerate:false,canConfigure:false,canPost,publicForDrivers:true
  });
  const gap=()=>log.evaluate(el=>el.scrollHeight-el.clientHeight-el.scrollTop);
  const waitBottom=()=>page.waitForFunction(()=>{
    const el=document.querySelector('[role="log"]');
    return el.scrollHeight-el.clientHeight-el.scrollTop<5;
  });
  const visibility=visible=>page.evaluate(visible=>{
    window.__airTest.visible=visible;
    document.dispatchEvent(new Event('visibilitychange'));
  },visible);
  const connectivity=online=>page.evaluate(online=>{
    window.__airTest.online=online;
    window.dispatchEvent(new Event(online?'online':'offline'));
  },online);
  await waitCount(1);
  await answer(0,snapshot('tail-a','Первый хвост'));
  await log.getByText('Первый хвост',{exact:true}).waitFor();
  await composer.waitFor();
  await waitBottom();

  // The bounded feed stays at 21 rows. A new tail must still follow the end.
  await page.clock.fastForward(12000);
  await waitCount(2);
  await answer(1,snapshot('tail-b','Новый хвост '+('длинная строка '.repeat(70))));
  await log.getByText(/^Новый хвост/).waitFor();
  assert.equal(await log.locator('.card.flat').count(),21);
  await waitBottom();

  // A reader deliberately scrolled up must not be thrown to the newest row.
  await log.evaluate(el=>{el.scrollTop=0;el.dispatchEvent(new Event('scroll'));});
  assert.ok(await gap()>96,'Fixture must have an independently scrollable log');
  await page.clock.fastForward(12000);
  await waitCount(3);
  await answer(2,snapshot('tail-c','Хвост при чтении старых сообщений'));
  await log.getByText('Хвост при чтении старых сообщений',{exact:true}).waitFor();
  assert.ok(await gap()>96,'New tail moved an older-message reader to the bottom');

  // Read from the middle, not the top: clearing the DOM must restore the
  // actual visible message and its position, not merely avoid the bottom.
  await log.evaluate(el=>{
    el.scrollTop=Math.floor((el.scrollHeight-el.clientHeight)/2);
    el.dispatchEvent(new Event('scroll'));
  });
  const readingPosition=()=>log.evaluate(el=>{
    const top=el.getBoundingClientRect().top;
    const row=Array.from(el.querySelectorAll('[data-air-message-id]'))
      .find(node=>node.getBoundingClientRect().bottom>top);
    return {id:row?.dataset.airMessageId,offset:row?.getBoundingClientRect().top-top,scroll:el.scrollTop};
  });
  const beforeSuspend=await readingPosition();
  assert.ok(beforeSuspend.scroll>0 && await gap()>96);
  assert.ok(beforeSuspend.id);
  // Suspend a pending poll, resume immediately without waiting another 12s,
  // resolve the newer response first, then release the obsolete permissions.
  await page.clock.fastForward(12000);
  await waitCount(4);
  await visibility(false);
  await composer.waitFor({state:'hidden'});
  await page.clock.fastForward(12000);
  assert.equal(await count(),4,'Hidden tab started a background poll');
  await visibility(true);
  await waitCount(5);
  await answer(4,snapshot('fresh','Свежий снимок',false));
  await log.getByText('Свежий снимок',{exact:true}).waitFor();
  const afterResume=await readingPosition();
  assert.equal(afterResume.id,beforeSuspend.id,'Foreground refresh lost the visible message');
  assert.ok(Math.abs(afterResume.offset-beforeSuspend.offset)<2,'Foreground refresh lost reading offset');
  await answer(3,snapshot('obsolete','Устаревший снимок',true));
  await page.clock.runFor(50);
  assert.equal(await log.getByText('Устаревший снимок',{exact:true}).count(),0);
  assert.equal(await log.getByText('Свежий снимок',{exact:true}).count(),1);
  assert.equal(await composer.count(),0,'Stale response restored revoked compose permission');

  await connectivity(false);
  await page.getByRole('alert').getByText(/Нет связи с сервером/).waitFor();
  await page.clock.fastForward(12000);
  assert.equal(await count(),5,'Offline tab started a poll');
  await connectivity(true);
  await waitCount(6);
  await answer(5,snapshot('online','После восстановления связи'));
  await log.getByText('После восстановления связи',{exact:true}).waitFor();
  await composer.waitFor();

  // Reopening with the SAME tail still rebuilds the cleared scrollable DOM.
  // A bottom reader must not be left at the top simply because no ID changed.
  await log.evaluate(el=>{el.scrollTop=el.scrollHeight;el.dispatchEvent(new Event('scroll'));});
  await waitBottom();
  await visibility(false);
  await composer.waitFor({state:'hidden'});
  await visibility(true);
  await waitCount(7);
  await answer(6,snapshot('online','После восстановления связи'));
  await composer.waitFor();
  await log.getByText('После восстановления связи',{exact:true}).waitFor();
  await waitBottom();
  assert.deepEqual(errors,[]);
  console.log('PASS Air: bounded tail, middle-reading anchor, foreground generation, offline/reconnect, same-tail rehydration');
}finally{await browser.close();}
