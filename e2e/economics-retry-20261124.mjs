// ECONOMICS-RETRY-20261124: exercise the actual EconomicsGuide component and
// production useLoad hook in isolated Chromium; no real accounts or finance APIs.
import { build } from 'esbuild';
import { chromium } from 'playwright';

const apiStub = `
  export class ApiError extends Error {}
  export function onEvent() { return () => {}; }
  export function rub(cents) { return Math.round(cents/100).toLocaleString('ru-RU')+' ₽'; }
  export function get(path) {
    const mock=window.__economicsMock;
    if (!path.startsWith('/api/me/economics?role=')) throw Error('Unexpected API read: '+path);
    mock.paths.push(path);
    return new Promise((resolve,reject)=>mock.pending.push({resolve,reject}));
  }
`;
const stubs={
  './api.ts':apiStub, '../api.ts':apiStub,
  './dict.ts':'export const BRANDS=[]; export const MODELS={}; export const YEARS=[];',
  './screens/offers.tsx':'export function reportApiError() {}',
  './platformIntro.tsx':"export function learningRole(mode) { return mode==='performer'?'master':'owner'; }",
};
const bundle=await build({
  stdin:{
    contents:`
      import React,{useState} from 'react';
      import {createRoot} from 'react-dom/client';
      import {MeCtx} from './web/src/ui.tsx';
      import {EconomicsGuide} from './web/src/screens/economicsGuide.tsx';
      window.__economicsMock={paths:[],pending:[]};
      function TestApp(){
        const [mode,setMode]=useState('client');
        window.__changeEconomicsRole=setMode;
        const me={id:'ci-demo-user',roles:mode==='client'?['client']:['master'],
          owner_id:null};
        return React.createElement(MeCtx.Provider,{
          value:{me,mode,reload:async()=>{},setMode}
        },React.createElement(EconomicsGuide));
      }
      createRoot(document.getElementById('root')).render(React.createElement(TestApp));
    `,
    resolveDir:process.cwd(),
    sourcefile:'economics-retry-entry.tsx',
    loader:'tsx',
  },
  bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',
  plugins:[{
    name:'isolate-network-and-copy-only',
    setup(b){
      b.onResolve({filter:/./},args=>{
        if(Object.hasOwn(stubs,args.path))return {path:args.path,namespace:'econ-stub'};
      });
      b.onLoad({filter:/./,namespace:'econ-stub'},args=>({
        contents:stubs[args.path],
        loader:args.path.endsWith('.tsx')?'tsx':'js',
      }));
    },
  }],
});

const browser=await chromium.launch();
try{
  const page=await browser.newPage();
  const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.setContent('<!doctype html><html lang="ru"><body><div id="root"></div></body></html>');
  await page.addScriptTag({content:bundle.outputFiles[0].text});
  const guide=page.getByRole('region',{name:'Финансовые условия'});
  await guide.getByText('Загружаем действующие условия из системы…').waitFor();
  await page.waitForFunction(()=>window.__economicsMock.pending.length===1);
  const initialPath=await page.evaluate(()=>window.__economicsMock.paths[0]);
  if(initialPath!=='/api/me/economics?role=owner')
    throw Error('Wrong role-specific initial finance API: '+initialPath);

  // First read fails: clear error and a usable retry, no invented fee/cap.
  await page.evaluate(()=>window.__economicsMock.pending[0].reject(Error('offline')));
  await guide.getByRole('alert').waitFor();
  const retry=guide.getByRole('button',{name:'Повторить загрузку'});
  await retry.waitFor();
  if(await page.getByText('Тестовые подтверждённые финансы').count())
    throw Error('Showing stale or invented finance text while offline');

  await retry.click();
  await page.waitForFunction(()=>window.__economicsMock.pending.length===2);
  if(!await guide.getByRole('button',{name:'Обновляем…'}).isDisabled())
    throw Error('Retry is not disabled during an in-flight request');
  const clientGuide={
    title:'Тестовые подтверждённые финансы',
    paragraphs:[{title:'Только серверное правило',text:'Действующая комиссия подтверждена API'}],
    examples:[{amount:100000,fee:7000,total:107000,title:'Тестовый пример',formula:'Серверный расчёт'}],
    rules:{},cap:500000
  };
  await page.evaluate(data=>window.__economicsMock.pending[1].resolve(data),clientGuide);
  await page.getByRole('region',{name:'Финансовые условия: Тестовые подтверждённые финансы'}).waitFor();
  if(await page.getByRole('button',{name:'Повторить загрузку'}).count())
    throw Error('Retry remained visible after current data arrived');

  // Changing workspaces must not silently keep the previous role's conditions.
  await page.evaluate(()=>window.__changeEconomicsRole('performer'));
  await page.waitForFunction(()=>window.__economicsMock.pending.length===3);
  await page.evaluate(()=>window.__economicsMock.pending[2].reject(Error('offline-again')));
  await guide.getByRole('alert').waitFor();
  if(await page.getByText('Тестовые подтверждённые финансы').count())
    throw Error('Previous role fees visible after failed role switch');
  const finalPath=await page.evaluate(()=>window.__economicsMock.paths.at(-1));
  if(finalPath!=='/api/me/economics?role=master')
    throw Error('Wrong role-specific refresh URL: '+finalPath);
  if(errors.length)throw Error('Browser runtime errors: '+errors.join('; '));
  console.log('PASS: live EconomicsGuide/useLoad retry and no previous-role fees after offline failure');
}finally{await browser.close();}
