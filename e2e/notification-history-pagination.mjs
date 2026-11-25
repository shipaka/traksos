// Actual notification history React component; deterministic private API stubs.
import {build} from 'esbuild';
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const endpoint='/api/me/notifications';
const stubs={
 '../api.ts':`
  export function get(path){return new Promise((resolve,reject)=>window.mock.gets.push({path,resolve,reject}));}
  export function post(path){return new Promise((resolve,reject)=>window.mock.posts.push({path,resolve,reject}));}
  export function fmtTime(v){return String(v??'');}
  export function onEvent(fn){window.mock.listeners.push(fn);return ()=>{window.mock.listeners=window.mock.listeners.filter(x=>x!==fn);};}
 `,
 '../ui.tsx':`
  import React from 'react';
  export function Back(){return <a href="#/">Назад</a>;}
  export function Loading({error}){return <span role="status">{error??'Загрузка'}</span>;}
  export function go(path){window.mock.routes.push(path);}
 `
};
const b=await build({
 stdin:{sourcefile:'notification-history-entry.tsx',loader:'tsx',resolveDir:process.cwd(),contents:`
   import React,{useState} from 'react';
   import {createRoot} from 'react-dom/client';
   import {NotificationHistory} from './web/src/screens/notificationHistory.tsx';
   window.mock={gets:[],posts:[],listeners:[],routes:[]};
   function App(){
     const [account,setAccount]=useState('a');
     window.switchAccount=setAccount;
     return <NotificationHistory key={account}/>;
   }
   createRoot(document.getElementById('root')).render(<App/>);
 `},
 bundle:true,write:false,outdir:'e2e/.temporary-notification-build',platform:'browser',format:'iife',jsx:'automatic',
 plugins:[{name:'private-api-stubs',setup(p){
   p.onResolve({filter:/./},a=>{if(Object.hasOwn(stubs,a.path))return {path:a.path,namespace:'stub'};});
   p.onLoad({filter:/./,namespace:'stub'},a=>({contents:stubs[a.path],loader:a.path.endsWith('tsx')?'tsx':'js',resolveDir:process.cwd()}));
 }}]
});
const js=b.outputFiles.find(f=>f.path.endsWith('.js')||f.path==='<stdout>');
if(!js)throw Error('No client bundle');
const browser=await chromium.launch();
const notice=(id,title,read_at=null)=>({id,title,read_at,kind:'general',body:'Текст',created_at:'2026-11-25T00:00:00Z'});
try{
 const page=await browser.newPage({viewport:{width:390,height:844}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.setContent('<div id="root"></div>');
 await page.addScriptTag({content:js.text});
 const wait=(type,path,n)=>page.waitForFunction(([type,path,n])=>window.mock[type].filter(x=>x.path===path).length>=n,[type,path,n]);
 const settle=(type,path,i,value,fail=false)=>page.evaluate(([type,path,i,value,fail])=>{
   const x=window.mock[type].filter(x=>x.path===path)[i];
   if(!x)throw Error('Missing request '+path);
   fail?x.reject(Error(value)):x.resolve(value);
 },[type,path,i,value,fail]);
 const button=name=>page.getByRole('button',{name});
 const oldPath=endpoint+'?before=101';
 await wait('gets',endpoint,1);
 await settle('gets',endpoint,0,{unread:3,items:[notice(103,'Последнее'),notice(101,'Граница')],nextBefore:101});
 await button('Более старые').click();
 await wait('gets',oldPath,1);
 await settle('gets',oldPath,0,'offline',true);
 await button('Повторить загрузку уведомлений').waitFor();
 assert.equal(await page.getByText('Пока ничего').count(),0);
 await button('Повторить загрузку уведомлений').click();
 await wait('gets',oldPath,2);
 await settle('gets',oldPath,1,{unread:3,items:[notice(99,'Старое')],nextBefore:null});
 // Rapid repeated activation may not send a second write. Failed writes
 // remain unread, do not silently retry, and require another explicit click.
 const unreadOld=button(/Уведомление: Старое.*Не прочитано/);
 await unreadOld.evaluate(node=>{node.click();node.click();});
 await wait('posts',endpoint+'/99/read',1);
 assert.equal(await page.evaluate(path=>window.mock.posts.filter(x=>x.path===path).length,endpoint+'/99/read'),1);
 await settle('posts',endpoint+'/99/read',0,'write offline',true);
 await page.getByRole('alert').waitFor();
 await unreadOld.waitFor();
 assert.equal(await page.evaluate(path=>window.mock.posts.filter(x=>x.path===path).length,endpoint+'/99/read'),1);
 await unreadOld.click();
 await wait('posts',endpoint+'/99/read',2);
 await settle('posts',endpoint+'/99/read',1,{ok:true});
 await wait('gets',oldPath,3);
 await settle('gets',oldPath,2,{unread:2,items:[notice(99,'Старое','2026-11-25')],nextBefore:null});
 await button(/Уведомление: Старое.*Прочитано/).waitFor();
 await button('Прочитать все').evaluate(node=>{node.click();node.click();});
 await wait('posts',endpoint+'/read',1);
 assert.equal(await page.evaluate(path=>window.mock.posts.filter(x=>x.path===path).length,endpoint+'/read'),1);
 await settle('posts',endpoint+'/read',0,{ok:true});
 await wait('gets',oldPath,4);
 await settle('gets',oldPath,3,{unread:0,items:[notice(99,'Старое','2026-11-25')],nextBefore:null});
 await button('Более новые').click();
 await wait('gets',endpoint,2);
 await page.evaluate(()=>window.mock.listeners.forEach(fn=>fn({type:'notification'})));
 await wait('gets',endpoint,3);
 await settle('gets',endpoint,2,{unread:1,items:[notice(104,'Свежий ответ')],nextBefore:null});
 await button(/Уведомление: Свежий ответ/).waitFor();
 await settle('gets',endpoint,1,{unread:0,items:[notice(100,'Устаревший ответ')],nextBefore:null});
 await page.evaluate(()=>window.mock.listeners.forEach(fn=>fn({type:'connection_restored'})));
 await wait('gets',endpoint,4);
 await page.evaluate(()=>window.switchAccount('b'));
 await wait('gets',endpoint,5);
 await settle('gets',endpoint,4,{unread:0,items:[notice(201,'Другой аккаунт','2026-11-25')],nextBefore:null});
 await button(/Уведомление: Другой аккаунт/).waitFor();
 await settle('gets',endpoint,3,{unread:1,items:[notice(105,'Чужой ответ')],nextBefore:null});
 assert.equal(await button(/Уведомление: Чужой ответ/).count(),0);
 assert.equal(await button(/Уведомление: Устаревший ответ/).count(),0);
 assert.equal(await page.getByText('Другой аккаунт',{exact:true}).count(),1);
 assert.deepEqual(errors,[]);
 console.log('notification history pagination: PASS');
}finally{await browser.close();}
