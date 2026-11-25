// Synthetic React + Chromium regression of the production account-scoped GET hook.
import {build} from 'esbuild';
import {chromium} from 'playwright';

const b=await build({
  stdin:{sourcefile:'client-private-read-entry.tsx',resolveDir:process.cwd(),loader:'tsx',
    contents:`
      import React,{useState} from 'react';
      import {createRoot} from 'react-dom/client';
      import {usePrivateRead} from './web/src/screens/privateRead20261124.ts';
      window.__pm={calls:[],events:[]};
      function App(){
        const [user,setUser]=useState('A');
        window.__setUser=setUser;
        const r=usePrivateRead(()=>new Promise((resolve,reject)=>{
          window.__pm.calls.push({user,resolve,reject});
        }),user,e=>e.type==='order');
        return <div><span id="private">{r.data?.title??''}</span>
          <span id="error">{r.error??''}</span>
          <button onClick={()=>{void r.reload();}}>Повторить</button></div>;
      }
      createRoot(document.getElementById('root')).render(<App/>);
    `},
  write:false,bundle:true,platform:'browser',format:'iife',jsx:'automatic',
  plugins:[{name:'event-mock',setup(b){
    b.onResolve({filter:/^\.\.\/api\.ts$/},a=>({path:a.path,namespace:'mock'}));
    b.onLoad({filter:/./,namespace:'mock'},()=>({loader:'js',contents:`
      export function onEvent(cb){
        window.__pm.events.push(cb);
        return ()=>{window.__pm.events=window.__pm.events.filter(x=>x!==cb);};
      }
    `}));
  }}]
});
const browser=await chromium.launch();
try{
  const page=await browser.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.setContent('<!doctype html><html lang="ru"><body><div id="root"></div></body></html>');
  await page.addScriptTag({content:b.outputFiles[0].text});
  const wait=(user,n)=>page.waitForFunction(([u,n])=>
    window.__pm.calls.filter(x=>x.user===u).length>=n,[user,n]);
  const answer=(user,n,value,fail=false)=>page.evaluate(([user,n,value,fail])=>{
    const q=window.__pm.calls.filter(x=>x.user===user)[n];
    if(!q)throw Error('Missing GET '+user+' '+n);
    fail?q.reject(Error(value)):q.resolve({title:value});
  },[user,n,value,fail]);
  const isText=(selector,value)=>page.waitForFunction(([s,v])=>
    document.querySelector(s)?.textContent===v,[selector,value]);
  await wait('A',1);await answer('A',0,'A private');await isText('#private','A private');
  await page.getByRole('button',{name:'Повторить'}).click();
  await wait('A',2);await answer('A',1,'offline',true);
  await isText('#error','offline');await isText('#private','');
  await page.getByRole('button',{name:'Повторить'}).click();
  await wait('A',3);await answer('A',2,'A again');await isText('#private','A again');
  await page.getByRole('button',{name:'Повторить'}).click();
  await wait('A',4);
  await page.evaluate(()=>window.__setUser('B'));
  await wait('B',1);await isText('#private','');
  await answer('B',0,'B only');await isText('#private','B only');
  await answer('A',3,'LATE A');await isText('#private','B only');
  await page.evaluate(()=>window.__pm.events.forEach(cb=>cb({type:'order'})));
  await wait('B',2);await isText('#private','');
  await answer('B',1,'offline B',true);
  await isText('#error','offline B');await isText('#private','');
  if(errors.length)throw Error(errors.join('; '));
  console.log('PASS client-private-read: refresh error, retry, late A->B, live event');
}finally{await browser.close();}

/** Exercise the shared production hooks, not copies of their implementations. */
const shared=await build({
  stdin:{sourcefile:'shared-request-hooks-entry.tsx',resolveDir:process.cwd(),loader:'tsx',contents:`
    import React,{useState} from 'react';
    import {createRoot} from 'react-dom/client';
    import {useLoad,useAction,ToastProvider} from './web/src/ui.tsx';
    window.__hooks={reads:[],writes:[]};
    function App(){
      const [scope,setScope]=useState('A'); window.__scope=setScope;
      const read=useLoad(()=>new Promise((resolve,reject)=>window.__hooks.reads.push({scope,resolve,reject})),[scope]);
      const action=useAction();
      const submit=()=>action.run(()=>new Promise((resolve,reject)=>window.__hooks.writes.push({resolve,reject})),null);
      window.__reload=read.reload;window.__submit=submit;
      return <div><span id="data">{read.data??''}</span><span id="err">{read.error??''}</span><span id="busy">{String(action.busy)}</span></div>;
    }
    createRoot(document.getElementById('root')).render(<ToastProvider><App/></ToastProvider>);
  `},write:false,bundle:true,platform:'browser',format:'iife',jsx:'automatic',
  plugins:[{name:'shared-hook-transport-stub',setup(b){
    b.onResolve({filter:/^\.\/api\.ts$/},a=>({path:a.path,namespace:'hook-mock'}));
    b.onResolve({filter:/^\.\/screens\/offers\.tsx$/},a=>({path:a.path,namespace:'hook-mock'}));
    b.onLoad({filter:/./,namespace:'hook-mock'},a=>({loader:'js',contents:a.path.includes('offers')?
      'export function reportApiError(){}':'export class ApiError extends Error{};export function onEvent(){return ()=>{}}'}));
  }}]
});
const sharedBrowser=await chromium.launch();
try{
  const p=await sharedBrowser.newPage(),errors=[];
  p.on('pageerror',e=>errors.push(e.message));
  await p.setContent('<div id="root"></div>');await p.addScriptTag({content:shared.outputFiles[0].text});
  const count=(kind,n)=>p.waitForFunction(([k,n])=>window.__hooks[k].length===n,[kind,n]);
  const value=(selector,expected)=>p.waitForFunction(([s,v])=>document.querySelector(s)?.textContent===v,[selector,expected]);
  await count('reads',1);
  await p.evaluate(()=>{void window.__reload();});await count('reads',2);
  await p.evaluate(()=>window.__hooks.reads[1].resolve('latest'));await value('#data','latest');
  await p.evaluate(()=>window.__hooks.reads[0].reject(Error('obsolete error')));
  await value('#err','');await value('#data','latest');
  await p.evaluate(()=>{void window.__reload();});await count('reads',3);
  await p.evaluate(()=>window.__scope('B'));await count('reads',4);
  await p.evaluate(()=>window.__hooks.reads[3].resolve('B'));await value('#data','B');
  await p.evaluate(()=>window.__hooks.reads[2].resolve('old A'));await value('#data','B');
  await p.evaluate(()=>{void window.__submit();void window.__submit();});await count('writes',1);await value('#busy','true');
  await p.evaluate(()=>window.__hooks.writes[0].reject(Error('network')));await value('#busy','false');
  await p.evaluate(()=>{void window.__submit();void window.__submit();});await count('writes',2);
  await p.evaluate(()=>window.__hooks.writes[1].resolve('ok'));await value('#busy','false');
  if(errors.length)throw Error(errors.join('; '));
  console.log('PASS shared request hooks: stale success/error, scope change, double-submit, explicit retry');
}finally{await sharedBrowser.close();}
