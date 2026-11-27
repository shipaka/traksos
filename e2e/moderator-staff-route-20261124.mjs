// PR #274: real staff case and support React pages, with isolated data stubs.
// Tests moderator navigation and admin-only shortcuts without backend mutation.
import { build } from 'esbuild';
import { chromium } from 'playwright';

const stubs={
  '../api.ts': [
    'export function fmtTime(value){return String(value||"—");}',
    'export function fmtPhone(value){return String(value||"—");}',
    'export function rub(value){return String(value||0)+" ₽";}',
    // SupportThread now keys its session by the authenticated token. Keep the fixture role-scoped.
    'export function getToken(){return "staff-route-test:"+window.__mode;}',
    'export function get(){return Promise.resolve({});}',
    'export function post(){return Promise.resolve({});}',
    'export function onEvent(){return ()=>{};}'
  ].join('\n'),
  '../dict.ts': 'export const SERVICES={};',
  '../ui.tsx': [
    'export function useMe(){return {mode:window.__mode,me:{id:"staff-1"}};}',
    'export function useLoad(){return {data:window.__view==="case"?window.__caseData:window.__supportData,',
    ' error:null,reload:async()=>{},setData:()=>{}};}',
    'export function useAction(){return {busy:false,run:async(fn)=>fn()};}',
    'export function Back({to,label}){return <a data-testid="staff-back" href={"#/"+to}>{label||"Назад"}</a>;}',
    'export function Loading(){return <p>Загрузка</p>;}',
    'export function go(path){window.__lastGo=path;}'
  ].join('\n')
};
const output=await build({
  stdin:{contents:[
    "import React from 'react';",
    "import {createRoot} from 'react-dom/client';",
    "import {ModCase} from './web/src/screens/moderation.tsx';",
    "import {SupportThread} from './web/src/screens/support.tsx';",
    "const root=createRoot(document.getElementById('root'));",
    "window.__caseData={kindName:'Спор',number:17,title:'Заявка',createdAt:'now',",
    "status:'resolved',decisionName:'Решено',decidedAt:'now',decisions:{},log:[],",
    "target:{id:'target-1',name:'Водитель',status:'active'}};",
    "window.__supportData={number:99,topic:'Тест обращения',createdAt:'now',status:'open',",
    "messages:[],author:{id:'target-1',name:'Водитель'},",
    "entry:{id:123,amount:50000,kind:'earning',created_at:'now'}};",
    "window.__renderStaff=(mode,view)=>{window.__mode=mode;window.__view=view;",
    "root.render(view==='case' ? React.createElement(ModCase,{id:'case-1',key:mode+view})",
    ":React.createElement(SupportThread,{id:'ticket-1',key:mode+view}));};",
    "window.__renderStaff('moderator','case');"
  ].join('\n'),resolveDir:process.cwd(),sourcefile:'moderator-staff-test.tsx',loader:'tsx'},
  bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',
  plugins:[{name:'staff-route-api-stub',setup(b){
    b.onResolve({filter:/./},args=>{
      if(Object.hasOwn(stubs,args.path))return {path:args.path,namespace:'staff-api-stub'};
    });
    b.onLoad({filter:/./,namespace:'staff-api-stub'},args=>({
      resolveDir:process.cwd(),
      contents:stubs[args.path],loader:args.path==='../ui.tsx'?'tsx':'js'
    }));
  }}]
});
const js=output.outputFiles[0]?.text;
if(!js)throw Error('No React bundle generated');
const browser=await chromium.launch();
const assert=(condition,message)=>{if(!condition)throw Error(message)};
try {
  const page=await browser.newPage({viewport:{width:390,height:844}});
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.setContent('<!doctype html><html lang="ru"><body><div id="root"></div></body></html>');
  await page.addScriptTag({content:js});
  const change=async(mode,view)=>{
    await page.evaluate(([m,v])=>window.__renderStaff(m,v),[mode,view]);
    await page.getByTestId('staff-back').waitFor();
  };
  await change('moderator','case');
  assert(await page.getByTestId('staff-back').getAttribute('href')==='#/moderation/cases',
    'Moderator case should return to own queue');
  assert(await page.locator('a[href="#/admin/user/target-1"]').count()===0,
    'Moderator offered inaccessible admin user card');
  await change('admin','case');
  assert(await page.getByTestId('staff-back').getAttribute('href')==='#/admin',
    'Admin case return route regressed');
  assert(await page.locator('a[href="#/admin/user/target-1"]').count()===1,
    'Admin user card lost legitimate shortcut');

  await change('moderator','support');
  assert(await page.getByTestId('staff-back').getAttribute('href')==='#/moderation/support',
    'Moderator support return points to personal tickets');
  assert(await page.locator('a[href="#/admin/user/target-1"]').count()===0,
    'Moderator support offers inaccessible admin user card');
  assert(await page.getByRole('button',{name:'Закрыть обращение'}).count()===1,
    'Moderator must be treated as support staff');
  assert(await page.getByText('Операция №123').count()===0,
    'Moderator must not see restricted ledger amount');
  await change('admin','support');
  assert(await page.getByTestId('staff-back').getAttribute('href')==='#/admin',
    'Admin support return route regressed');
  assert(await page.locator('a[href="#/admin/user/target-1"]').count()===1,
    'Admin support user-card action missing');
  assert(await page.getByText('Операция №123').count()===1,
    "Admin's existing ledger detail must remain visible");
  await change('client','support');
  assert(await page.getByTestId('staff-back').getAttribute('href')==='#/support',
    'Client support back link changed');
  assert(await page.getByRole('button',{name:'Вопрос решён — закрыть'}).count()===1,
    'Client action incorrectly relabelled as staff');
  assert(!errors.length,'Browser errors: '+errors.join('; '));
  console.log('PASS: real staff React pages respect moderator/admin/client navigation');
} finally {
  await browser.close();
}
