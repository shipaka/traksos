// ECONOMICS-RETRY-20261124: exercise the actual EconomicsGuide component and
// production private read hook in isolated Chromium; no real accounts or finance APIs.
import { build } from 'esbuild';
import { chromium } from 'playwright';

const apiStub = `
  export class ApiError extends Error {}
  export function onEvent() { return () => {}; }
  export function getToken(){return window.__economicsMock.token;}
  export const fmtTime=()=> '24.11.2026';
  export function rub(cents) { return Math.round(cents/100).toLocaleString('ru-RU')+' ₽'; }
  export function get(path) {
    const mock=window.__economicsMock;
    if (!path.startsWith('/api/me/economics?role=') && path!=='/api/me/referral' && path!=='/api/me/referral?invitedPage=1') throw Error('Unexpected API read: '+path);
    mock.paths.push(path);
    return new Promise((resolve,reject)=>mock.pending.push({path,resolve,reject}));
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
      import {Invite} from './web/src/screens/invite.tsx';
      window.__economicsMock={paths:[],pending:[],token:'bearer-A'};
      function TestApp(){
        const [mode,setMode]=useState('client');
        const [identity,setIdentity]=useState('ci-demo-user');
        const [invite,setInvite]=useState(false);
        const [guest,setGuest]=useState(false);
        window.__showGuestFinance=()=>{window.__economicsMock.token=null;setGuest(true);};
        window.__changeFinanceSession=(id,token)=>{window.__economicsMock.token=token;setIdentity(id);};
        window.__showInvite=()=>setInvite(true);
        window.__changeEconomicsRole=setMode;
        const me={id:identity,roles:mode==='client'?['client']:['master'],
          owner_id:null};
        if(guest)return React.createElement(EconomicsGuide,{inOffer:true});
        return React.createElement(MeCtx.Provider,{
          value:{me,mode,reload:async()=>{},setMode}
        },React.createElement(invite?Invite:EconomicsGuide));
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
  await guide.getByText('Загружаем действующие условия из системы…').waitFor();
  if(await guide.getByRole('button',{name:'Повторить загрузку'}).count())
    throw Error('A second retry is possible during an in-flight request');
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
  // A late response under a previous session must not overwrite the new session.
  await page.evaluate(()=>window.__changeEconomicsRole('client'));
  await page.waitForFunction(()=>window.__economicsMock.pending.length===4);
  await page.evaluate(()=>window.__changeFinanceSession('ci-user-B','bearer-B'));
  await page.waitForFunction(()=>window.__economicsMock.pending.length===5);
  await page.evaluate(data=>window.__economicsMock.pending[3].resolve(data),clientGuide);
  await page.evaluate(()=>window.__economicsMock.pending[4].reject(Error('offline-B')));
  await guide.getByRole('alert').waitFor();
  if(await page.getByText('Тестовые подтверждённые финансы').count())
    throw Error('Old account finance response visible in B');

  await page.evaluate(()=>window.__showInvite());
  await page.waitForFunction(()=>window.__economicsMock.pending.length===6);
  const referral=(code,name,total=1,page=0)=>({code,balance:10000,expiringSoon:0,
    rules:{welcome:10000,clientSpendCapPct:10,spendCapPct:10,ttlDays:180,clientSharePct:10,days:180,performerReward:1000,performerJobs:2,serviceReward:1000},
    invitedTotal:total,invitedPage:page,invitedPageSize:100,
    invited:[{name,who:'client',at:'2026-11-24',earned:1000}],entries:[]});
  await page.evaluate(data=>window.__economicsMock.pending[5].resolve(data),referral('PRIVATE-B','PRIVATE INVITED B'));
  const link=page.getByRole('textbox',{name:'Ваша реферальная ссылка'});
  await link.waitFor();
  if(!(await link.inputValue()).endsWith('PRIVATE-B'))throw Error('Wrong B referral URL');
  await page.getByText('Кого пригласили · 1').click();
  await page.locator('details .sum > span').filter({hasText:'PRIVATE INVITED B'}).waitFor();
  await page.evaluate(()=>window.__changeFinanceSession('ci-user-C','bearer-C'));
  await page.waitForFunction(()=>window.__economicsMock.pending.length===7);
  if(await link.count()||await page.locator('details .sum > span').filter({hasText:'PRIVATE INVITED B'}).count())
    throw Error('Old private invitation data after account switch');
  await page.evaluate(()=>window.__economicsMock.pending[6].reject(Error('offline-C')));
  await page.getByRole('alert').waitFor();
  await page.getByRole('button',{name:'Повторить загрузку'}).click();
  await page.waitForFunction(()=>window.__economicsMock.pending.length===8);
  await page.evaluate(data=>window.__economicsMock.pending[7].resolve(data),referral('PRIVATE-C','PRIVATE INVITED C',101));
  await link.waitFor();
  if(!(await link.inputValue()).endsWith('PRIVATE-C'))throw Error('Wrong C referral URL after retry');
  await page.getByText('Кого пригласили · 101').click();
  await page.getByRole('button',{name:'Следующая'}).click();
  await page.waitForFunction(()=>window.__economicsMock.pending.length===9);
  if(await page.evaluate(()=>window.__economicsMock.paths.at(-1))!=='/api/me/referral?invitedPage=1')throw Error('Wrong referral page URL');
  await page.evaluate(data=>window.__economicsMock.pending[8].resolve(data),referral('PRIVATE-C','PRIVATE INVITED C PAGE TWO',101,1));
  await page.getByText('Страница 2 · показано 1 из 101. Список обновляется при загрузке.').waitFor();
  await page.locator('details .sum > span').filter({hasText:'PRIVATE INVITED C PAGE TWO'}).waitFor();
  if(await page.getByRole('button',{name:'Следующая'}).isEnabled())throw Error('Unexpected next page beyond total');
  await page.evaluate(()=>window.__showGuestFinance());
  await link.waitFor({state:'detached'});
  if(await page.getByRole('region',{name:/Финансовые условия/}).count())throw Error('Guest rendered private finances');
  if(await page.evaluate(()=>window.__economicsMock.pending.length)!==9)throw Error('Guest triggered private finance request');
  if(errors.length)throw Error('Browser runtime errors: '+errors.join('; '));
  console.log('PASS: live EconomicsGuide/Invite private-read retry, late response and account isolation');
}finally{await browser.close();}
