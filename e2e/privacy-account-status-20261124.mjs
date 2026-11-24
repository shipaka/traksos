// Real Privacy React component + Chromium, isolated synthetic identities and API.
// Protect status of deletion from cross-account stale reads and network failure.
// No production auth, personal data, SMS or deletion requests are performed.
import {build} from 'esbuild';
import {chromium} from 'playwright';

const stubs={
  '../api.ts': `
    export function getToken(){return window.__privacyMock.token;}
    export function fmtTime(value){return String(value);}
    export function get(path) {
      const m=window.__privacyMock;
      m.gets.push({path,user:window.__privacyUser?.id});
      if(path==='/api/me/privacy') {
        return new Promise((resolve,reject)=>{
          m.pending={resolve,reject,user:window.__privacyUser?.id};
        });
      }
      if(path==='/api/me/export')return new Promise(resolve=>{m.exportResolve=resolve;});
      throw Error('Unexpected privacy GET '+path);
    }
    export function post(path) {
      if(path!=='/api/me/delete')throw Error('Unexpected POST '+path);
      window.__privacyMock.posts.push({path,user:window.__privacyUser?.id});
      return Promise.resolve({deleteRequestedAt:'2026-11-24T00:00:00Z',deleteAt:'2027-01-08T00:00:00Z',graceDays:45});
    }
    export function del(path) {
      if(path!=='/api/me/delete')throw Error('Unexpected DELETE '+path);
      window.__privacyMock.deletes.push({path,user:window.__privacyUser?.id});
      return Promise.resolve({deleteRequestedAt:null,deleteAt:null,graceDays:45});
    }
  `,
  '../ui.tsx': `
    export function useMe(){return {me:window.__privacyUser};}
    export function useAction(){return {busy:false,run:async(fn)=>await fn()};}
    export function Back(){return <a href="#/profile">Профиль</a>;}
  `,
};
const bundle=await build({
  stdin:{contents:`
    import React from 'react';
    import {createRoot} from 'react-dom/client';
    import {Privacy} from './web/src/screens/privacy.tsx';
    window.__privacyMock={gets:[],posts:[],deletes:[],pending:null,token:'A',exportResolve:null};
    window.__privacyUser={id:'fixture-A'};
    const root=createRoot(document.getElementById('root'));
    window.__setPrivacyUser=(id,token=id)=>{window.__privacyMock.token=token;window.__privacyUser={id};root.render(React.createElement(Privacy));};
    root.render(React.createElement(Privacy));
  `,resolveDir:process.cwd(),sourcefile:'privacy-isolated-entry.tsx',loader:'tsx'},
  bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',
  plugins:[{
    name:'privacy-isolated-network',
    setup(build){
      build.onResolve({filter:/./},args=>{
        if(Object.hasOwn(stubs,args.path))return {path:args.path,namespace:'privacy-mock'};
      });
      build.onLoad({filter:/./,namespace:'privacy-mock'},args=>({
        contents:stubs[args.path],loader:args.path.endsWith('.tsx')?'tsx':'js'
      }));
    }
  }]
});
const browser=await chromium.launch();
const check=(v,m)=>{if(!v)throw Error(m);};
try{
  const page=await browser.newPage();
  const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('dialog',d=>d.accept());
  await page.setContent('<!doctype html><html lang="ru"><body><div id="root"></div></body></html>');
  await page.addScriptTag({content:bundle.outputFiles[0].text});
  await page.getByText('Загружаем статус удаления аккаунта…').waitFor();
  check(await page.getByRole('button',{name:'Удалить аккаунт'}).count()===0,
    'Delete button exposed before account privacy status');
  check(await page.getByText(/обычный вход по паролю/).count()===1,
    'Privacy instructions still advertise SMS passwordless login');

  await page.evaluate(()=>window.__privacyMock.pending.resolve({
    deleteRequestedAt:'2026-11-20T00:00:00Z',
    deleteAt:'2026-12-20T00:00:00Z',graceDays:30
  }));
  await page.getByText(/Запрос принят/).waitFor();
  await page.getByText(/удаление откладывается до их закрытия/).waitFor();
  check(await page.getByRole('button',{name:'Не удалять'}).count()===1,
    'Account A should display its pending deletion request');

  // Without unmounting, switch to a different account while old status exists.
  await page.evaluate(()=>window.__setPrivacyUser('fixture-B'));
  await page.getByText('Загружаем статус удаления аккаунта…').waitFor();
  check(await page.getByText(/Запрос принят/).count()===0,
    'Account B saw previous user deletion request during status load');
  await page.evaluate(()=>window.__privacyMock.pending.reject(Error('offline')));
  await page.getByRole('alert').waitFor();
  check(await page.getByRole('button',{name:'Удалить аккаунт'}).count()===0,
    'Deletion enabled when status endpoint was unreachable');

  await page.getByRole('button',{name:'Попробовать снова'}).click();
  await page.waitForFunction(()=>window.__privacyMock.gets.filter(x=>
    x.path==='/api/me/privacy'&&x.user==='fixture-B').length===2);
  await page.evaluate(()=>window.__privacyMock.pending.resolve({
    deleteRequestedAt:null,deleteAt:null,graceDays:45
  }));
  await page.getByText(/Через 45 дней аккаунт будет закрыт/).waitFor();
  await page.getByText(/если завершены все действующие заявки/).waitFor();
  check(await page.getByRole('button',{name:'Удалить аккаунт'}).count()===1,
    'Delete action missing after verified new-account status');

  await page.getByRole('button',{name:'Удалить аккаунт'}).click();
  await page.getByText(/Запрос принят/).waitFor();
  let log=await page.evaluate(()=>window.__privacyMock.posts);
  check(log.length===1&&log[0].user==='fixture-B',
    'Deletion requested for wrong account: '+JSON.stringify(log));
  await page.getByRole('button',{name:'Не удалять'}).click();
  await page.getByText(/Через 45 дней аккаунт будет закрыт/).waitFor();
  log=await page.evaluate(()=>window.__privacyMock.deletes);
  check(log.length===1&&log[0].user==='fixture-B',
    'Cancellation submitted for wrong account: '+JSON.stringify(log));
  // Export completed after session switch must not trigger a download.
  await page.evaluate(()=>{window.__privacyDownloads=0;const original=HTMLAnchorElement.prototype.click;HTMLAnchorElement.prototype.click=function(){if(this.download)window.__privacyDownloads++;else original.call(this);};});
  await page.getByRole('button',{name:'Скачать мои данные'}).click();
  await page.waitForFunction(()=>typeof window.__privacyMock.exportResolve==='function');
  await page.evaluate(()=>window.__setPrivacyUser('fixture-B','rotated-B-token'));
  await page.getByText('Загружаем статус удаления аккаунта…').waitFor();
  await page.evaluate(()=>window.__privacyMock.exportResolve({account:{id:'old-B'}}));
  await page.evaluate(()=>window.__privacyMock.pending.resolve({deleteRequestedAt:null,deleteAt:null,graceDays:30}));
  await page.getByText(/Через 30 дней аккаунт будет закрыт/).waitFor();
  check(await page.evaluate(()=>window.__privacyDownloads)===0,'Old session export downloaded after bearer rotation');
  check(errors.length===0,'Browser exceptions: '+errors.join(';'));
  console.log('PASS: privacy account switch, loading/error/retry, real grace and delete/cancel');
}finally{await browser.close();}
