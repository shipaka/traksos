// STO-WORKSPACE-RELIABILITY-20261124
// Genuine React station, booking and money components in Chromium. All
// accounts, responses, money, dates and trucks below are synthetic. The test
// cannot connect to production or mutate a real invoice.
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const apiStub=`
export const requests=()=>window.__sto.pending;
export function getToken(){
  return window.__sto.me?.id ? 'synthetic-session:'+window.__sto.me.id : null;
}
export function get(path) {
  return new Promise((resolve,reject)=>{
    window.__sto.pending.push({method:'GET',path,resolve,reject});
  });
}
export function post(path,body) {
  return new Promise((resolve,reject)=>{
    window.__sto.pending.push({method:'POST',path,body,resolve,reject});
  });
}
export const put=post;
export const rub=n=>((n??0)/100).toLocaleString('ru-RU')+' ₽';
export const fmtTime=s=>String(s);
export function onEvent(callback){
  window.__sto.listeners.add(callback);
  return ()=>window.__sto.listeners.delete(callback);
}
`;
const uiStub=`
import React from 'react';
export const useMe=()=>({me:window.__sto.me,reload:async()=>{},mode:'service'});
export const go=path=>{window.__sto.go.push(path)};
export const useAction=()=>{
  const [busy,setBusy]=React.useState(false);
  return {busy,run:async(fn)=>{
    setBusy(true);
    try{return await fn()}catch(error){window.__sto.errors.push(error.message);return undefined}
    finally{setBusy(false)}
  }};
};
export function Loading(){return React.createElement('span',{role:'status'},'Загрузка…')}
export function Field({label,children}){return React.createElement('label',null,label,children)}
export function Back(){return React.createElement('span',null,'Назад')}
export function RubInput({value,onChange}){return React.createElement('input',{
  'aria-label':'Денежная сумма',value:value??'',onChange:e=>onChange(Number(e.target.value)||null)
})}
`;
const stubs={
  '../api.ts':apiStub,
  '../ui.tsx':uiStub,
  '../dict.ts':`
    export const BRANDS=['Scania','Volvo'];
    export const FEE_PURPOSE='Сервисные условия применяются по подтверждённой редакции';
    export const PLACES=[{id:'moscow',name:'Москва',lat:55.75,lng:37.61}];
  `,
  './ops.tsx':"export function WorkerNotices(){return null}",
  './roadsideMap.tsx':"export function RoadsideMap(){return null}",
  './DestinationCard.tsx':"export function DestinationCard(){return null}",
  '../verifiedBadge.tsx':"export function VerifiedBadge(){return null}",
  '../vehicleVisual.tsx':"export function VehicleModelPhoto(){return null}",
};
const bundled=await build({
  stdin:{
    contents:`
      import React,{useState} from 'react';
      import {createRoot} from 'react-dom/client';
      import {BaseHome,BaseMoney,ServicesList,BookingPage,RequestCard} from './web/src/screens/base.tsx';
      function TestApp(){
        const [user,setUser]=useState('sto-A');
        const [view,setView]=useState('base');
        const [bookingId,setBookingId]=useState('booking-1');
        window.__sto.me={id:user,roles:['service'],owner_id:null};
        window.__sto.changeUser=setUser;
        window.__sto.changeView=setView;
        window.__sto.changeBooking=setBookingId;
        if(view==='base')return React.createElement(BaseHome);
        if(view==='money')return React.createElement(BaseMoney);
        if(view==='search')return React.createElement(ServicesList);
        if(view==='booking')return React.createElement(BookingPage,{id:bookingId});
        if(view==='request')return React.createElement(RequestCard,{
          b:{id:'request-1',createdAt:'2026-11-24T00:00:00Z',
            whenDay:'2026-12-10',whenTime:'11:00',status:'new',statusName:'Новый запрос',
            needName:'Электрика',arrival:'self',client:{name:'Тестовый клиент'},
            vehicle:{brand:'Scania',model:'R440'}},
          onDone:()=>window.__sto.done++
        });
        return null;
      }
      createRoot(document.getElementById('root')).render(React.createElement(TestApp));
    `,
    sourcefile:'sto-workspace-entry.tsx',resolveDir:process.cwd(),loader:'tsx'
  },
  bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',
  plugins:[{
    name:'sto-isolated-modules',
    setup(b){
      b.onResolve({filter:/./},args=>{
        if(!args.importer.endsWith('/web/src/screens/base.tsx'))return;
        if(Object.hasOwn(stubs,args.path))return {path:args.path,namespace:'sto-stub'};
      });
      b.onLoad({filter:/.*/,namespace:'sto-stub'},args=>({resolveDir:process.cwd(),
        contents:stubs[args.path],loader:args.path.endsWith('.tsx')?'tsx':'js'
      }));
    }
  }]
});
const assert=(truth,message)=>{if(!truth)throw Error(message)};
const center=name=>({
  center:{
    name,address:'Учебный адрес '+name,hours:'08:00–20:00',rating:0,reviews:0,
    verification:'approved',paused:false,closedToday:false,confirmDue:false,
    accepts:['quick']
  },
  groups:{requests:[],expected:[],repair:[],ready:[],done:[]}
});
const money=(amount)=>({
  summary:{toPay:amount,awaiting:0,unpaid:0,disputed:0,paid:0,points:0},
  months:[],items:[],rule:{pct:5,max:500000,referralPct:0}
});
const booking=(name)=>({
  number:5101,needName:'Электрика',status:'clarify',statusName:'Уточнение',
  whenDay:'2026-12-10',arrival:'self',client:{name:'Клиент'},vehicle:{brand:'Scania'},
  center:{name,address:'Синтетический адрес'},
  clarifyQ:'Уточнение для '+name,notes:[],works:[],history:[]
});
const browser=await chromium.launch();
await mkdir('e2e/shots/sto-reliability',{recursive:true});
try{
  const page=await browser.newPage({viewport:{width:390,height:844},locale:'ru-RU'});
  const jsErrors=[];page.on('pageerror',e=>jsErrors.push(e.message));
  // A synthetic loopback origin provides normal localStorage semantics.
  // Playwright intercepts the document; no external request or test server.
  await page.route('http://127.0.0.1:18979/**',route=>route.fulfill({
    status:200,contentType:'text/html',
    body:'<!doctype html><html lang="ru"><body><div id="root"></div></body></html>'
  }));
  await page.goto('http://127.0.0.1:18979/');
  await page.evaluate(()=>{
    window.__sto={pending:[],listeners:new Set(),errors:[],go:[],done:0,me:null};
    localStorage.setItem('traksos.svcsearch',JSON.stringify({need:'engine',radius:0}));
    localStorage.setItem('traksos.svcsearch.v2:sto-B',
      JSON.stringify({sort:'garbled',cond:'invalid',accepts:{},radius:-7,place:'incident',need:'unknown'}));
    Object.defineProperty(navigator,'geolocation',{configurable:true,value:undefined});
  });
  await page.addScriptTag({content:bundled.outputFiles[0].text});
  const waitGet=(path,count=1)=>page.waitForFunction(({path,count})=>
    window.__sto.pending.filter(x=>x.method==='GET' && x.path===path).length>=count,{path,count});
  const answer=async(index,data)=>page.evaluate(({index,data})=>window.__sto.pending[index].resolve(data),{index,data});
  const reject=async(index,err)=>page.evaluate(({index,err})=>window.__sto.pending[index].reject(Error(err)),{index,err});
  const change=async(view,user)=>page.evaluate(({view,user})=>{
    if(user)window.__sto.changeUser(user);
    if(view)window.__sto.changeView(view);
  },{view,user});
  await waitGet('/api/base');
  await answer(0,center('СТО A'));
  await page.getByRole('heading',{name:'Рембаза «СТО A»'}).waitFor();
  // A WebSocket refresh invalidates the old private snapshot immediately.
  await page.evaluate(()=>window.__sto.listeners.forEach(fn=>fn({type:'booking'})));
  await waitGet('/api/base',2);
  await page.getByRole('status').filter({hasText:'Загрузка…'}).waitFor({timeout:2000});
  assert(await page.getByText('Рембаза «СТО A»').count()===0,
    'Old station still visible while refreshed data is unverified');
  await reject(1,'Эфирная сеть отключена');
  await page.getByRole('alert').getByRole('button',{name:'Повторить загрузку'}).waitFor();
  assert(await page.getByText('Рембаза «СТО A»').count()===0,
    'Prior station data visible after a failed GET');
  await page.getByRole('button',{name:'Повторить загрузку'}).click();
  await waitGet('/api/base',3);
  await answer(2,center('СТО A актуальная'));
  await page.getByRole('heading',{name:'Рембаза «СТО A актуальная»'}).waitFor();

  // Old A request returns after A->B login; it cannot render an A company,
  // use stale action permission, or corrupt B's values.
  await page.evaluate(()=>window.__sto.listeners.forEach(fn=>fn({type:'booking'})));
  await waitGet('/api/base',4);
  await change(undefined,'sto-B');
  await waitGet('/api/base',5);
  await page.getByRole('status').filter({hasText:'Загрузка…'}).waitFor({timeout:2000});
  assert(await page.getByText('Рембаза «СТО A актуальная»').count()===0,
    'Account swap retained private old station data');
  await answer(4,center('СТО B'));
  await page.getByRole('heading',{name:'Рембаза «СТО B»'}).waitFor();
  await page.screenshot({path:'e2e/shots/sto-reliability/sto-cabinet-390.png',fullPage:true});
  await page.setViewportSize({width:1440,height:900});
  await page.screenshot({path:'e2e/shots/sto-reliability/sto-cabinet-1440.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});
  await answer(3,center('Старое A НЕ показывать'));
  await page.waitForTimeout(70);
  assert(await page.getByText('Старое A НЕ показывать').count()===0,
    'Late A response displaced the new B cabinet');

  // Real finance component: errors revoke amounts; retry fetches live data,
  // and a failed points call cannot invent a percentage limit.
  await change('money');
  await waitGet('/api/base/money');
  const indexFinance=await page.evaluate(()=>window.__sto.pending.findIndex(x=>x.path==='/api/base/money'));
  await answer(indexFinance,money(1012345));
  await page.getByRole('heading',{name:'Финансы'}).waitFor();
  await page.getByText(/10\s?123[,.]45/).first().waitFor();
  const pointsIndex=await page.evaluate(()=>window.__sto.pending.findIndex(x=>x.path==='/api/me/referral'));
  await reject(pointsIndex,'Баллы недоступны');
  await page.locator('details').first().locator('summary').click();
  await page.getByText('Не удалось проверить действующий лимит списания баллов').waitFor();
  await page.evaluate(()=>window.__sto.listeners.forEach(fn=>fn({type:'booking'})));
  await waitGet('/api/base/money',2);
  // A synchronous request registration precedes React's scheduled DOM commit.
  // Keep the new response unresolved and require the actual loading UI before
  // asserting that private stale amounts were removed. No fixed sleep.
  await page.getByRole('status').filter({hasText:'Загрузка…'}).waitFor({timeout:2000});
  assert(await page.getByText(/10\s?123[,.]45/).count()===0,
    'Stale payout visible during finance refresh');
  const financeSecond=await page.evaluate(()=>window.__sto.pending.findLastIndex(x=>x.path==='/api/base/money'));
  await reject(financeSecond,'Ошибка чтения реестра');
  await page.getByRole('alert').getByRole('button',{name:'Повторить загрузку'}).waitFor();
  await page.getByRole('button',{name:'Повторить загрузку'}).click();
  await waitGet('/api/base/money',3);
  const financeThird=await page.evaluate(()=>window.__sto.pending.findLastIndex(x=>x.path==='/api/base/money'));
  await answer(financeThird,money(200000));
  await page.getByRole('heading',{name:'Финансы'}).waitFor();
  await page.screenshot({path:'e2e/shots/sto-reliability/sto-finance-390.png',fullPage:true});

  // Search preferences are scoped by actual identity and fully validated.
  await change('search');
  await page.getByRole('heading',{name:'Найти рембазу'}).waitFor();
  await page.getByRole('button',{name:'Электрика'}).click();
  const saved=await page.evaluate(()=>({
    own:localStorage.getItem('traksos.svcsearch.v2:sto-B'),
    legacy:localStorage.getItem('traksos.svcsearch')
  }));
  const parsed=JSON.parse(saved.own);
  assert(parsed.need==='electric' && Array.isArray(parsed.cond) &&
    parsed.radius===50 && parsed.sort==='near' && parsed.place==='gps',
    'Corrupted preferences were not normalized: '+saved.own);
  assert(saved.legacy.includes('engine'),
    'Shared legacy preferences were modified or migrated into new user');
  await change(undefined,'sto-C');
  // Heading already exists in the old account; wait for the actual new
  // React identity AND the new account's non-selected service filter.
  await page.waitForFunction(()=>window.__sto.me?.id==='sto-C' &&
    [...document.querySelectorAll('button')].some(button=>
      button.textContent?.trim()==='Электрика' &&
      button.getAttribute('aria-pressed')==='false'));
  assert(await page.getByRole('button',{name:'Электрика'}).getAttribute('aria-pressed')==='false',
    'Old user search choice leaked into the new account');

  // Booking route switch must immediately discard a previous customer's
  // question and typed private answer, even if the old GET resolves late.
  await change('booking');
  await waitGet('/api/bookings/booking-1');
  const oldBooking=await page.evaluate(()=>window.__sto.pending.findIndex(x=>x.path==='/api/bookings/booking-1'));
  await answer(oldBooking,booking('первой записи'));
  await page.getByText('Уточнение для первой записи').waitFor();
  await page.getByPlaceholder('Ответ сервису').fill('Частный ответ первого заказа');
  await page.evaluate(()=>window.__sto.changeBooking('booking-2'));
  await waitGet('/api/bookings/booking-2');
  await page.getByRole('status').filter({hasText:'Загрузка…'}).waitFor({timeout:2000});
  assert(await page.getByText('Уточнение для первой записи').count()===0,
    'Old booking shown after route switch');
  const nextBooking=await page.evaluate(()=>window.__sto.pending.findIndex(x=>x.path==='/api/bookings/booking-2'));
  await answer(nextBooking,booking('второй записи'));
  await page.getByText('Уточнение для второй записи').waitFor();
  assert(await page.getByPlaceholder('Ответ сервису').inputValue()==='',
    'New booking inherited the previous private answer');
  await page.screenshot({path:'e2e/shots/sto-reliability/sto-booking-390.png',fullPage:true});

  // The user can answer the real booking form once; a pending response must
  // never be submitted a second time from rapid presses.
  await page.getByPlaceholder('Ответ сервису').fill('Подтверждаю данные по грузовику');
  await page.getByRole('button',{name:'Ответить'}).click();
  await page.waitForFunction(()=>window.__sto.pending.some(x=>x.path==='/api/bookings/booking-2/answer'));
  assert(await page.evaluate(()=>window.__sto.pending.filter(
    x=>x.path==='/api/bookings/booking-2/answer').length)===1,
    'Duplicate booking answer POST');
  const indexAnswer=await page.evaluate(()=>window.__sto.pending.findIndex(
    x=>x.path==='/api/bookings/booking-2/answer'));
  await answer(indexAnswer,{...booking('второй записи'),status:'expected',statusName:'Ожидаем'});
  await page.getByText('Сервис ждёт вас. Опаздываете').waitFor();

  // A separate request card must use the existing booking response API and
  // keep the form editable after a lost/failed response (never auto-replay).
  await change('request');
  await page.getByRole('button',{name:'Готовы принять'}).click();
  await page.getByRole('button',{name:'Отправить клиенту'}).click();
  await page.waitForFunction(()=>window.__sto.pending.some(x=>x.path==='/api/base/bookings/request-1/respond'));
  const responded=await page.evaluate(()=>window.__sto.pending.filter(
    x=>x.path==='/api/base/bookings/request-1/respond')
    .map(x=>({path:x.path,body:x.body})));
  assert(responded.length===1 && responded[0].body.action==='accept',
    'Accept did not use the single existing station response API');
  const firstResponse=await page.evaluate(()=>window.__sto.pending.findIndex(
    x=>x.path==='/api/base/bookings/request-1/respond'));
  await reject(firstResponse,'Потеря ответа сервиса');
  await page.getByRole('button',{name:'Отправить клиенту'}).waitFor();
  assert(await page.evaluate(()=>window.__sto.pending.filter(
    x=>x.path==='/api/base/bookings/request-1/respond').length)===1,
    'Failed station response auto-replayed');
  await page.getByRole('button',{name:'Отправить клиенту'}).click();
  await page.waitForFunction(()=>window.__sto.pending.filter(
    x=>x.path==='/api/base/bookings/request-1/respond').length===2);
  const secondResponse=await page.evaluate(()=>window.__sto.pending.findLastIndex(
    x=>x.path==='/api/base/bookings/request-1/respond'));
  await answer(secondResponse,{id:'request-1',status:'expected'});
  await page.waitForFunction(()=>window.__sto.done===1);
  assert(jsErrors.length===0,'Browser JavaScript errors: '+jsErrors.join('; '));
  console.log('PASS STO: station + booking + finance + search, session/route isolation, queued responses, retry and no duplicate writes');
}finally{await browser.close()}
