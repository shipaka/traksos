// AIR-SESSION-20261124: actual React DriverAir in Chromium, isolated
// deterministic transport. No production users, messages, or server mutations.
import { build } from 'esbuild';
import { chromium } from 'playwright';

const apiStub = `
  export function get(path) {
    if(path!=='/api/air/messages')throw Error('Unexpected GET: '+path);
    const queue=window.__airTest.gets;
    return new Promise((resolve,reject)=>queue.push({resolve,reject}));
  }
  export function post(path,body) {
    const queue=window.__airTest.posts;
    return new Promise((resolve,reject)=>queue.push({path,body,resolve,reject}));
  }
`;
const uiStub = `
  import React from 'react';
  export function useMe() { return {me:window.__airIdentity}; }
  export function Back() { return React.createElement('span',null,'Назад'); }
`;
const bundle=await build({
  stdin:{
    contents:`
      import React,{useState} from 'react';
      import {createRoot} from 'react-dom/client';
      import {DriverAir} from './web/src/screens/driverAir.tsx';
      window.__airTest={gets:[],posts:[]};
      function Demo(){
        const [me,setMe]=useState({id:'owner-A',roles:['client']});
        window.__airIdentity=me;
        window.__switchAirIdentity=setMe;
        return React.createElement(DriverAir);
      }
      createRoot(document.getElementById('root')).render(React.createElement(Demo));
    `,
    resolveDir:process.cwd(),sourcefile:'air-session-entry.tsx',loader:'tsx'
  },
  bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',
  plugins:[{
    name:'air-private-transport-fixture',
    setup(b){
      b.onResolve({filter:/./},args=>{
        if(!args.importer.endsWith('/web/src/screens/driverAir.tsx'))return;
        if(args.path==='../api.ts')return {path:'api',namespace:'air-test'};
        if(args.path==='../ui.tsx')return {path:'ui',namespace:'air-test'};
      });
      b.onLoad({filter:/.*/,namespace:'air-test'},args=>({
        contents:args.path==='api'?apiStub:uiStub,loader:'js'
      }));
    }
  }]
});
const assert=(condition,message)=>{if(!condition)throw Error(message)};
const message=(id,body)=>({id,body,author:'Тестовый участник',isBot:false,createdAt:'2026-11-23T15:00:00.000Z'});
const snapshot=(texts,permissions={})=>({
  messages:texts.map((text,i)=>message('synthetic-'+i,text)),
  botEnabled:true,canModerate:false,canConfigure:false,
  canPost:true,publicForDrivers:true,...permissions
});
const browser=await chromium.launch();
try{
  const page=await browser.newPage({viewport:{width:390,height:844},locale:'ru-RU'});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.setContent('<!doctype html><html lang="ru"><body><div id="root"></div></body></html>');
  await page.addScriptTag({content:bundle.outputFiles[0].text});
  await page.waitForFunction(()=>window.__airTest.gets.length===1);
  await page.evaluate(data=>window.__airTest.gets[0].resolve(data),
    snapshot(['Сообщение аккаунта A']));
  await page.getByText('Сообщение аккаунта A').waitFor();
  const compose=page.getByRole('textbox',{name:'Сообщение в эфир'});
  await compose.fill('Черновик аккаунта A');

  // Polls are allowed to overlap, but only the NEWEST response wins.
  await page.evaluate(()=>{
    window.dispatchEvent(new Event('online'));
    window.dispatchEvent(new Event('online'));
  });
  await page.waitForFunction(()=>window.__airTest.gets.length>=3);
  await page.evaluate(data=>window.__airTest.gets[2].resolve(data),
    snapshot(['Новые данные A']));
  await page.getByText('Новые данные A').waitFor();
  await page.evaluate(data=>window.__airTest.gets[1].resolve(data),
    snapshot(['Устаревший ответ A']));
  await page.waitForTimeout(80);
  assert(await page.getByText('Устаревший ответ A').count()===0,
    'Older delayed poll overwrote newer messages');
  assert(await page.getByText('Новые данные A').count()===1,
    'Newer messages lost to an old in-flight GET');

  // Offline must revoke stale composer and server-driven permissions, while
  // leaving a clear manual retry rather than a deceptive working chat.
  await page.evaluate(()=>window.dispatchEvent(new Event('offline')));
  await page.getByRole('button',{name:'Повторить загрузку эфира'}).waitFor();
  assert(await compose.count()===0 &&
    await page.getByText('Новые данные A').count()===0,
    'Offline leaked previous messages or allowed a stale POST');
  await page.getByRole('button',{name:'Повторить загрузку эфира'}).click();
  await page.waitForFunction(()=>window.__airTest.gets.length>=4);
  await page.evaluate(data=>window.__airTest.gets[3].resolve(data),
    snapshot(['Связь восстановлена']));
  await page.getByText('Связь восстановлена').waitFor();
  assert(await page.getByRole('button',{name:'Повторить загрузку эфира'}).count()===0,
    'Retry button persisted after a successful GET');

  // POST failure could mean the server accepted the message but the reply
  // was lost. NEVER replay it; keep draft and refresh history for review.
  await page.getByRole('textbox',{name:'Сообщение в эфир'}).fill('Не отправлять повторно автоматически');
  await page.getByRole('button',{name:'Отправить',exact:true}).click();
  await page.waitForFunction(()=>window.__airTest.posts.length===1);
  assert(await page.evaluate(()=>window.__airTest.posts[0].path)==='/api/air/messages',
    'Wrong public-air endpoint');
  await page.evaluate(()=>window.__airTest.posts[0].reject(Error('Потеря ответа POST')));
  await page.getByText('Потеря ответа POST').waitFor();
  await page.waitForFunction(()=>window.__airTest.gets.length>=5);
  await page.evaluate(data=>window.__airTest.gets[4].resolve(data),
    snapshot(['Связь восстановлена']));
  assert(await page.getByRole('textbox',{name:'Сообщение в эфир'}).inputValue()==='Не отправлять повторно автоматически',
    'Failed send erased user draft');
  assert(await page.evaluate(()=>window.__airTest.posts.length)===1,
    'Failed POST was silently replayed');

  // A and B both have role=client (same canView boolean): old state and any
  // delayed A network result MUST be unmounted before displaying B.
  await page.evaluate(()=>window.dispatchEvent(new Event('online')));
  await page.waitForFunction(()=>window.__airTest.gets.length>=6);
  await page.evaluate(()=>window.__switchAirIdentity({id:'owner-B',roles:['client']}));
  await page.waitForFunction(()=>window.__airTest.gets.length>=7);
  assert(await page.getByText('Связь восстановлена').count()===0 &&
    await page.getByRole('textbox',{name:'Сообщение в эфир'}).count()===0,
    'Old account messages/draft visible while new account loads');
  await page.evaluate(data=>window.__airTest.gets[6].resolve(data),
    snapshot(['Только для аккаунта B']));
  await page.getByText('Только для аккаунта B').waitFor();
  assert(await page.getByRole('textbox',{name:'Сообщение в эфир'}).inputValue()==='',
    'New user inherited previous account draft');
  await page.evaluate(data=>window.__airTest.gets[5].resolve(data),
    snapshot(['Запоздалое сообщение A']));
  await page.waitForTimeout(80);
  assert(await page.getByText('Запоздалое сообщение A').count()===0,
    'Previous-account response repopulated new chat');

  // Staff gets moderation/configure controls only from its own fresh API.
  await page.evaluate(()=>window.__switchAirIdentity({id:'staff-C',roles:['moderator']}));
  await page.waitForFunction(()=>window.__airTest.gets.length>=8);
  assert(await page.getByText('Только для аккаунта B').count()===0,
    'Client messages leaked into staff workspace on switch');
  await page.evaluate(data=>window.__airTest.gets[7].resolve(data),
    snapshot(['Сообщение модератора'],{
      canPost:false,canModerate:true,canConfigure:true
    }));
  await page.getByText('Сообщение модератора').waitFor();
  assert(await page.getByRole('button',{name:'Скрыть'}).count()===1 &&
    await page.getByRole('checkbox').count()===1 &&
    await page.getByRole('button',{name:'Отправить'}).count()===0,
    'Staff permissions are not from current server snapshot');
  // Permission changes on the SAME account ID must invalidate previously
  // fetched moderation controls even when a fresh profile still canView.
  await page.evaluate(()=>window.__switchAirIdentity({id:'staff-C',roles:['client']}));
  await page.waitForFunction(()=>window.__airTest.gets.length>=9);
  assert(await page.getByRole('button',{name:'Скрыть'}).count()===0 &&
    await page.getByRole('checkbox').count()===0,
    'Moderator powers persisted through a same-account role downgrade');
  await page.evaluate(data=>window.__airTest.gets[8].resolve(data),
    snapshot(['Роль ограничена'],{canPost:true,canModerate:false,canConfigure:false}));
  await page.getByText('Роль ограничена').waitFor();
  assert(await page.getByRole('button',{name:'Скрыть'}).count()===0 &&
    await page.getByRole('button',{name:'Отправить'}).count()===1,
    'Role downgrade did not load fresh server flags');
  if(errors.length)throw Error('Chromium runtime errors: '+errors.join('; '));
  console.log('PASS DriverAir: out-of-order polls, offline+retry, no automatic POST replay, A/B identity isolation and staff permissions');
} finally { await browser.close(); }
