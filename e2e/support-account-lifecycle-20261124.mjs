// SUPPORT-ATOMIC-LIFECYCLE-20261124: real React support UI in Chromium.
// Controlled transport: no live accounts, support tickets or payments.
import { build } from 'esbuild';
import { chromium } from 'playwright';

const uiStub=`
  import React,{createContext,useContext,useState,useEffect,useRef,useCallback} from 'react';
  import {onEvent} from './web/src/api.ts';
  export const TestContext=createContext({me:null,mode:'client'});
  export const useMe=()=>useContext(TestContext);
  export const go=path=>{location.hash='#/'+path;};
  export const Back=({to})=><a href={'#/'+to}>Назад</a>;
  export const Loading=({error})=><div role="status">{error||'Загружаю…'}</div>;
  export function useAction(){
    const [busy,setBusy]=useState(false);
    return {busy,run:async(fn)=>{setBusy(true);try{return await fn();}
      catch{return undefined;}finally{setBusy(false);}}};
  }
  // Deliberately preserve the real hook's stale-GET behavior. Keyed UI
  // boundaries must prevent a previous user's late private response showing.
  export function useLoad(fn,deps,reloadOn){
    const [data,setData]=useState(null);
    const [error,setError]=useState(null);
    const fnRef=useRef(fn);fnRef.current=fn;
    const reload=useCallback(async()=>{
      try{const result=await fnRef.current();setData(result);setError(null);}
      catch(e){setError(e.message);}
    },[]);
    useEffect(()=>{setData(null);reload();},deps);
    useEffect(()=>(reloadOn?onEvent(event=>reloadOn(event)&&reload()):undefined),deps);
    return {data,error,reload,setData};
  }
`;
const apiStub=`
  function call(method,path,body) {
    const m=window.__supportMock;
    const rec={method,path,body};
    m.calls.push(rec);
    return new Promise((resolve,reject)=>m.pending.push({...rec,resolve,reject}));
  }
  export const get=path=>call('GET',path);
  export const post=(path,body)=>call('POST',path,body);
  export const fmtTime=value=>String(value||'');
  export const fmtPhone=value=>String(value||'');
  export const rub=value=>String(value);
  export function onEvent(fn){
    window.__supportMock.listeners.push(fn);
    return ()=>{window.__supportMock.listeners=window.__supportMock.listeners.filter(x=>x!==fn);};
  }
`;
const bundle=await build({
  stdin:{
    contents:`
      import React,{useState} from 'react';
      import {createRoot} from 'react-dom/client';
      import {TestContext} from './web/src/ui.tsx';
      import {SupportThread,SupportQueue,SupportList,SupportNew,Notifications} from './web/src/screens/support.tsx';
      window.__supportMock={calls:[],pending:[],listeners:[]};
      function App(){
        const [me,setMe]=useState({id:'account-A',roles:['client']});
        const [mode,setMode]=useState('client');
        const [view,setView]=useState('thread');
        const [ticket,setTicket]=useState('ticket-1');
        Object.assign(window,{__setSupportMe:setMe,__setSupportMode:setMode,
          __setSupportView:setView,__setSupportTicket:setTicket,
          __emitSupport:event=>window.__supportMock.listeners.forEach(fn=>fn(event))});
        return <TestContext.Provider value={{me,mode}}>
          {view==='thread'?<SupportThread id={ticket}/>:
          view==='queue'?<SupportQueue/>:
          view==='new'?<SupportNew/>:
          view==='list'?<SupportList/>:<Notifications/>}
        </TestContext.Provider>;
      }
      createRoot(document.getElementById('root')).render(<App/>);
    `,
    resolveDir:process.cwd(),sourcefile:'support-account-lifecycle-entry.tsx',loader:'tsx',
  },
  bundle:true,write:false,outdir:'e2e/.temporary-support-build',
  platform:'browser',format:'iife',jsx:'automatic',
  plugins:[{
    name:'synthetic-support-transport',
    setup(b){
      b.onResolve({filter:/./},arg=>{
        if(arg.path==='../ui.tsx'||arg.path==='./web/src/ui.tsx')return {path:'ui',namespace:'support-stub'};
        if(arg.path==='../api.ts'||arg.path==='./web/src/api.ts')return {path:'api',namespace:'support-stub'};
      });
      b.onLoad({filter:/./,namespace:'support-stub'},arg=>({
        contents:arg.path==='ui'?uiStub:apiStub,loader:arg.path==='ui'?'tsx':'js',
      }));
    },
  }],
});
const js=bundle.outputFiles.find(f=>f.path.endsWith('.js'))?.text;
if(!js)throw Error('Support browser bundle is missing');
const assert=(ok,msg)=>{if(!ok)throw Error(msg);};
const ticket=(text,status='open')=>({
  id:'ticket-1',number:45,topic:'Не работает приложение',status,
  createdAt:'2026-11-24T00:00:00Z',order:null,author:null,entry:null,
  messages:[{id:1,sender_id:'account-A',sender_name:'Клиент',from_staff:false,body:text}],
});
const browser=await chromium.launch();
try{
  const page=await browser.newPage({viewport:{width:390,height:844},locale:'ru-RU'});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.setContent('<!doctype html><html lang="ru"><body><div id="root"></div></body></html>');
  await page.addScriptTag({content:js});
  const counts=(method,path)=>page.evaluate(({method,path})=>
    window.__supportMock.pending.filter(x=>x.method===method&&x.path===path).length,{method,path});
  const wait=(method,path,count)=>page.waitForFunction(({method,path,count})=>
    window.__supportMock.pending.filter(x=>x.method===method&&x.path===path).length>=count,
    {method,path,count});
  const finish=(method,path,index,what,data)=>page.evaluate(({method,path,index,what,data})=>{
    const rec=window.__supportMock.pending.filter(x=>x.method===method&&x.path===path)[index];
    if(!rec)throw Error('Missing '+method+' '+path+' index '+index);
    rec[what](what==='reject'?Error(data):data);
  },{method,path,index,what,data});
  const thread='/api/support/ticket-1';
  await wait('GET',thread,1);
  // Unmount A before A's network response arrives.
  await page.evaluate(()=>window.__setSupportMe({id:'account-B',roles:['client']}));
  await wait('GET',thread,2);
  await finish('GET',thread,0,'resolve',ticket('SECRET-ACCOUNT-A'));
  assert(await page.getByText('SECRET-ACCOUNT-A').count()===0,
    'Late account A response was rendered in B support thread');
  await finish('GET',thread,1,'reject','offline');
  await page.getByRole('button',{name:'Повторить загрузку переписки'}).click();
  await wait('GET',thread,3);
  await finish('GET',thread,2,'resolve',ticket('PRIVATE-ACCOUNT-B'));
  await page.getByText('PRIVATE-ACCOUNT-B').waitFor();
  assert((await page.evaluate(()=>window.__supportMock.listeners.length))===1,
    'A support thread must have exactly one real-time subscription');
  await page.evaluate(()=>window.__emitSupport({type:'support',ticketId:'ticket-1'}));
  await wait('GET',thread,4);
  await page.waitForTimeout(50);
  assert(await counts('GET',thread)===4,'One support event launched duplicate GETs');
  await finish('GET',thread,3,'resolve',ticket('PRIVATE-ACCOUNT-B'));

  const compose=page.getByRole('textbox',{name:'Сообщение поддержке'});
  await compose.fill('Message from B');
  await page.evaluate(()=>{
    const form=document.querySelector('.compose');
    form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
    form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
  });
  const postPath='/api/support/ticket-1/messages';
  await wait('POST',postPath,1);
  assert(await counts('POST',postPath)===1,'Rapid repeat submitted two ticket messages');
  await finish('POST',postPath,0,'reject','timeout after processing');
  await page.waitForTimeout(30);
  assert(await compose.inputValue()==='Message from B','Failed POST discarded user draft');
  assert(await counts('POST',postPath)===1,'Failed POST was silently retried');

  await page.evaluate(()=>window.__setSupportMe({id:'account-C',roles:['client']}));
  await wait('GET',thread,5);
  await finish('GET',thread,4,'resolve',ticket('PRIVATE-ACCOUNT-C'));
  await page.getByText('PRIVATE-ACCOUNT-C').waitFor();
  assert(await compose.inputValue()==='', 'Draft from B leaked into account C');
  const closing=page.getByRole('button',{name:'Вопрос решён — закрыть'});
  await closing.evaluate(button=>{
    button.click();button.click();
  });
  const closePath='/api/support/ticket-1/close';
  await wait('POST',closePath,1);
  assert(await counts('POST',closePath)===1,'Double close made duplicate POST calls');
  await finish('POST',closePath,0,'resolve',ticket('PRIVATE-ACCOUNT-C','closed'));
  await wait('GET',thread,6);
  await finish('GET',thread,5,'resolve',ticket('PRIVATE-ACCOUNT-C','closed'));

  // Staff queue status switch: an old open request cannot fill closed tab.
  await page.evaluate(()=>{
    window.__setSupportMe({id:'moderator-A',roles:['moderator']});
    window.__setSupportMode('moderator');window.__setSupportView('queue');
  });
  const openQueue='/api/admin/support?status=open',closedQueue='/api/admin/support?status=closed';
  await wait('GET',openQueue,1);
  await page.getByRole('button',{name:'Закрытые'}).click();
  await wait('GET',closedQueue,1);
  await finish('GET',openQueue,0,'resolve',[{id:'open-secret',number:55,topic:'OPEN-SECRET',status:'open'}]);
  assert(await page.getByText('OPEN-SECRET').count()===0,'Open ticket appeared in closed queue');
  await finish('GET',closedQueue,0,'resolve',[{id:'closed-case',number:56,topic:'CLOSED-CASE',status:'closed'}]);
  await page.getByText(/CLOSED-CASE/).waitFor();

  // New support request text must not cross identities.
  await page.evaluate(()=>window.__setSupportView('new'));
  await wait('GET','/api/support/topics',1);
  await finish('GET','/api/support/topics',0,'resolve',['Другое']);
  await page.getByRole('button',{name:'Другое'}).click();
  await page.getByRole('textbox',{name:'Описание проблемы'}).fill('Private moderator draft');
  await page.evaluate(()=>window.__setSupportMe({id:'moderator-B',roles:['moderator']}));
  await wait('GET','/api/support/topics',2);
  assert(await page.getByRole('textbox',{name:'Описание проблемы'}).inputValue()==='',
    'A previous user's new-ticket draft survived account switch');
  await finish('GET','/api/support/topics',1,'resolve',['Другое']);

  // The notifications screen must forget A's cached private inbox.
  await page.evaluate(()=>{
    window.__setSupportMe({id:'account-A',roles:['client']});
    window.__setSupportMode('client');window.__setSupportView('notifications');
  });
  const notifications='/api/me/notifications';
  await wait('GET',notifications,1);
  await finish('GET',notifications,0,'resolve',{unread:1,items:[{
    id:5,kind:'support',title:'SECRET-NOTIFICATION-A',body:'A private alert',
    created_at:'2026-11-24',read_at:null,data:{ticketId:'ticket-1'}
  }]});
  await page.getByText('SECRET-NOTIFICATION-A').waitFor();
  await page.evaluate(()=>window.__setSupportMe({id:'account-B',roles:['client']}));
  await wait('GET',notifications,2);
  assert(await page.getByText('SECRET-NOTIFICATION-A').count()===0,
    'Old notification was visible after switching accounts');
  await finish('GET',notifications,1,'resolve',{unread:0,items:[]});
  await page.getByText('Пока ничего').waitFor();
  assert(errors.length===0,'React runtime errors: '+errors.join('; '));
  console.log('PASS: support thread, drafts, status filter, notifications and double POST scoped to account');
} finally {await browser.close();}
