// Isolated real DriverAir mount/unmount around SOS; synthetic transport, no order or chat writes.
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {chromium} from 'playwright';
const api=`
  export function getToken(){return window.identity.token;}
  export async function get(path){if(path!=='/api/air/messages')throw Error(path);
    return {messages:Array.from({length:30},(_,i)=>({id:'msg-'+i,author:'Водитель',body:'Сообщение '+i,createdAt:'2026-11-27T00:00:00Z',isBot:false})),botEnabled:true,canPost:true,canModerate:false,canConfigure:false,publicForDrivers:true};}
  export async function post(){window.writes++;throw Error('Unexpected write');}
`;
const ui=`export function useMe(){return {me:window.identity};} export function Back(){return null;}`;
const bundle=await build({stdin:{contents:`
  import {useEffect,useState} from 'react';
  import {createRoot} from 'react-dom/client';
  import {DriverAir} from './web/src/screens/driverAir.tsx';
  import {clearAirDraft} from './web/src/airSupportDraft.ts';
  window.writes=0;window.identity={id:'A',token:'synthetic-A',roles:['client']};
  window.clearDraft=clearAirDraft;
  function Demo(){
    const [hash,setHash]=useState(location.hash);
    const [identity,setIdentity]=useState(window.identity);
    window.identity=identity;window.setIdentity=setIdentity;
    useEffect(()=>{const change=()=>setHash(location.hash);window.addEventListener('hashchange',change);return()=>window.removeEventListener('hashchange',change)},[]);
    return hash==='#/sos'?<h1>Учебный маршрут SOS</h1>:<DriverAir/>;
  }
  createRoot(document.getElementById('root')).render(<Demo/>);
`,resolveDir:process.cwd(),loader:'tsx',sourcefile:'air-sos-fixture.tsx'},bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',plugins:[{name:'air-sos-test',setup(b){
  b.onResolve({filter:/^\.\.\/(api\.ts|ui\.tsx)$/},a=>a.importer.endsWith('/web/src/screens/driverAir.tsx')?{path:a.path,namespace:'mock'}:undefined);
  b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:a.path.endsWith('api.ts')?api:ui,loader:'js'}));
}}]});
const browser=await chromium.launch();
try{
  const page=await browser.newPage({viewport:{width:390,height:844}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.setContent('<!doctype html><html lang="ru"><body><div id="root"></div></body></html>');
  await page.addScriptTag({content:bundle.outputFiles[0].text});
  const composer=page.getByRole('textbox',{name:'Сообщение в эфир'});
  const sos=page.getByRole('button',{name:'SOS · Помощь в дороге'});
  const log=page.getByRole('log');
  await composer.fill('Черновик водителя A');
  await log.evaluate(el=>{el.scrollTop=220;el.dispatchEvent(new Event('scroll'));});
  const anchor=await log.evaluate(el=>el.scrollTop);
  assert.ok(anchor>0);
  await sos.click();
  await page.getByRole('heading',{name:'Учебный маршрут SOS'}).waitFor();
  assert.equal(await page.evaluate(()=>window.writes),0);
  assert.equal(await composer.count(),0);
  await page.evaluate(()=>location.hash='#/air');
  await composer.waitFor();
  assert.equal(await composer.inputValue(),'Черновик водителя A');
  assert.ok(Math.abs(await log.evaluate(el=>el.scrollTop)-anchor)<5,'reading position lost');
  await sos.click();
  await page.getByRole('heading',{name:'Учебный маршрут SOS'}).waitFor();
  await page.evaluate(()=>window.setIdentity({id:'B',token:'synthetic-B',roles:['driver']}));
  await page.evaluate(()=>location.hash='#/air');
  await composer.waitFor();
  assert.equal(await composer.inputValue(),'','foreign account draft leaked');
  await composer.fill('Черновик B');
  await sos.click();
  await page.getByRole('heading',{name:'Учебный маршрут SOS'}).waitFor();
  await page.evaluate(()=>{window.clearDraft();location.hash='#/air'});
  await composer.waitFor();
  assert.equal(await composer.inputValue(),'','logout clear did not erase draft');
  await page.evaluate(()=>window.setIdentity({id:'staff',token:'synthetic-staff',roles:['admin']}));
  await page.waitForFunction(()=>!document.querySelector('button')?.textContent?.includes('SOS · Помощь в дороге'));
  assert.equal(await sos.count(),0,'staff received customer SOS control');
  assert.equal(await page.evaluate(()=>window.writes),0);
  assert.deepEqual(errors,[]);
  console.log('PASS Air SOS navigation: draft, scroll, account/logout isolation, staff and no writes');
}finally{await browser.close();}
