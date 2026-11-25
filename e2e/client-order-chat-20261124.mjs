// Real Order + Chat React component in Chromium. All API calls are trapped
// in deterministic promises; no actual orders, money or chat messages sent.
import {build} from 'esbuild';
import {chromium} from 'playwright';

const api=`
  export function get(path) {
    return new Promise((resolve,reject)=>window.__orderMock.gets.push({path,resolve,reject}));
  }
  export function post(path,body){
    return new Promise((resolve,reject)=>window.__orderMock.posts.push({path,body,resolve,reject}));
  }
  export function onEvent(listener){
    window.__orderMock.listeners.push(listener);
    return ()=>{window.__orderMock.listeners=window.__orderMock.listeners.filter(x=>x!==listener);};
  }
  export function rub(v){return Math.round((v??0)/100)+' ₽';}
  export function fmtTime(v){return String(v??'');}
`;
const ui=`
  import React from 'react';
  export function useMe(){return {me:window.__orderMock.user,mode:'client'};}
  export function useAction(){return {busy:false,run:fn=>fn()};}
  export function useLoad(){return {data:null,error:null,reload:()=>{}};}
  export function useToast(){return ()=>{};}
  export function go(){}
  export function Loading({error}){return <span role="status">{error??'Загружаю…'}</span>;}
  export function Back(){return <a href="#/orders">Назад</a>;}
  export function Field({children}){return <div>{children}</div>;}
  export function RubInput(){return null;}
  export function VehicleFields(){return null;}
`;
const dict=`
  export const SERVICES={electric:{name:'Электрик'}};
  export const STATUS={accepted:{name:'Принято'},completed:{name:'Завершено'},
    searching:{name:'Ищем'},no_performer:{name:'Не найден'}};
  export const STEPS=['searching','accepted','en_route','arrived','working','awaiting_confirmation','completed'];
  export const STEP_NAMES={searching:'Поиск',accepted:'Принял',en_route:'В пути',
    arrived:'На месте',working:'Работа',awaiting_confirmation:'Сумма',completed:'Готово'};
  export const RESULTS={solved:'Решено'};
  export const CONSULT_HINTS={};
  export const CONSULT_CONF={};
`;
const stubs={
  '../api.ts':api,'../dict.ts':dict,'../ui.tsx':ui,
  '../approvedVisuals.ts':'export const APPROVED_VISUALS={};',
  './base.tsx':'export function RecommendService(){return null;}',
  './DestinationCard.tsx':'export function DestinationCard(){return null;}',
  './search.tsx':'export function Search(){return null;} export function OfferForm(){return null;}',
  './AdminRouteMap.tsx':'export function AdminRouteMap(){return null;}',
  './ecuHandoffs.tsx':'export function EcuOrderPanel(){return null;}',
  './continuations.tsx':'export function OrderContinuations(){return null;}',
  './OrderTimeline.tsx':'export function OrderTimeline(){return null;}',
  './performer.tsx':'export function LocationSharing(){return null;}',
  './adminUser.tsx':'export function RefundForm(){return null;} export function payStatus(){return "ожидание";}',
  '../vehicleVisual.tsx':'export function VehiclePhotoLink(){return null;}',
  './orderPhotos.tsx':'export function OrderPhotoGallery(){return null;}'
};
const b=await build({
  stdin:{
    sourcefile:'order-chat-isolation-entry.tsx',loader:'tsx',resolveDir:process.cwd(),
    contents:`
      import React,{useState} from 'react';
      import {createRoot} from 'react-dom/client';
      import {Order} from './web/src/screens/order.tsx';
      window.__orderMock={gets:[],posts:[],listeners:[],user:null};
      function App(){
        const [route,setRoute]=useState({id:'A',user:'U1'});
        window.__orderRoute=setRoute;
        window.__orderMock.user={id:route.user,roles:['client']};
        return <Order id={route.id}/>;
      }
      createRoot(document.getElementById('root')).render(<App/>);
    `,
  },
  bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',
  outdir:'./e2e/.tmp-client-order-chat',
  plugins:[{
    name:'all-private-imports-isolated',
    setup(b){
      b.onResolve({filter:/\.css$/},a=>({path:a.path,namespace:'empty-css'}));
      b.onLoad({filter:/./,namespace:'empty-css'},()=>({contents:'',loader:'css'}));
      b.onResolve({filter:/./},a=>{
        if(Object.hasOwn(stubs,a.path))return {path:a.path,namespace:'fake-module'};
      });
      b.onLoad({filter:/./,namespace:'fake-module'},a=>({resolveDir:process.cwd(),
        contents:stubs[a.path],loader:a.path.endsWith('.tsx')?'tsx':'js'
      }));
    }
  }]
});
const js=b.outputFiles.find(f=>f.path.endsWith('.js'));
if(!js)throw Error('Bundler did not return client JavaScript');
const browser=await chromium.launch();
try{
  const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.setContent('<!doctype html><html lang="ru"><body><div id="root"></div></body></html>');
  await page.addScriptTag({content:js.text});
  const wait=(path,n)=>page.waitForFunction(([path,n])=>
    window.__orderMock.gets.filter(x=>x.path===path).length>=n,[path,n]);
  const settle=(path,n,result,fail=false)=>page.evaluate(([path,n,result,fail])=>{
    const x=window.__orderMock.gets.filter(x=>x.path===path)[n];
    if(!x)throw Error('Missing GET '+path);
    fail?x.reject(Error(String(result))):x.resolve(result);
  },[path,n,result,fail]);
  const order=(id,number)=>({
    id,number,service:'electric',status:'accepted',you:'client',isSos:false,
    createdAt:'2026-11-24T00:00:00Z',actions:[],events:[],
    paymentMethod:number===202?'online':'cash',estimate:{zoneName:'Учебная зона',hour:null},
    money:{callOut:10000,work:0,discount:0,clientFee:0,total:10000}
  });
  const navigate=(id,user='U1')=>page.evaluate(route=>window.__orderRoute(route),{id,user});

  await wait('/api/orders/A',1);
  await settle('/api/orders/A',0,order('A',101));
  await page.getByText('№101 · Электрик').waitFor();
  const chatA='/api/orders/A/messages';
  await wait(chatA,1);
  await settle(chatA,0,'offline conversation',true);
  await page.getByRole('button',{name:/Чат по заявке/}).click();
  await page.getByRole('button',{name:'Повторить загрузку переписки'}).waitFor();
  if(await page.getByText('Сообщений пока нет').count())
    throw Error('Chat showed empty history when GET failed');
  await page.getByRole('button',{name:'Повторить загрузку переписки'}).click();
  await wait(chatA,2);
  await settle(chatA,1,{
    messages:[{id:'A1',kind:'text',sender_id:'other',body:'PRIVATE A CHAT'}],
    quickReplies:[],participants:[]});
  await page.getByText('PRIVATE A CHAT').waitFor();
  await page.getByPlaceholder('Сообщение').fill('PRIVATE A DRAFT');

  // A different order has a blank chat and a separate GET; old A is never shown.
  await navigate('B');
  await wait('/api/orders/B',1);
  if(await page.getByText('PRIVATE A CHAT').count()||await page.getByText('PRIVATE A DRAFT').count())
    throw Error('A chat remained during navigation to B');
  await settle('/api/orders/B',0,order('B',202));
  await wait('/api/orders/B/messages',1);
  await settle('/api/orders/B/messages',0,{messages:[],quickReplies:[],participants:[]});
  // An unauthenticated/stale payment GET is not an empty ledger: show retry
  // and never fall back to another order's captured amount.
  const paymentPath='/api/orders/B/payments';
  await wait(paymentPath,1);
  await settle(paymentPath,0,'bank history offline',true);
  await page.getByRole('button',{name:'Повторить загрузку платежей'}).click();
  await wait(paymentPath,2);
  await settle(paymentPath,1,[]);
  await page.getByRole('button',{name:/Чат по заявке/}).click();
  const message=page.getByPlaceholder('Сообщение');
  await message.waitFor();
  if((await message.inputValue())!=='')throw Error('A chat draft leaked into B');

  await message.fill('B first message');
  // DOM-double click in a single task probes the ref lock before setState.
  await page.evaluate(()=>{
    const button=Array.from(document.querySelectorAll('form.compose button'))
      .find(x=>x.textContent?.includes('➤'));
    if(!button)throw Error('No send control');
    button.click();button.click();
  });
  await page.waitForFunction(()=>window.__orderMock.posts.length===1);
  if((await page.evaluate(()=>window.__orderMock.posts.length))!==1)
    throw Error('Double submit produced two POST requests');
  await message.fill('B second draft');
  await page.evaluate(()=>window.__orderMock.posts[0].resolve({
    id:'B1',kind:'text',sender_id:'U1',body:'B first message'}));
  await page.getByText('B first message').waitFor();
  if(await message.inputValue()!=='B second draft')
    throw Error('Pending response erased the subsequent chat draft');

  // After reconnect, load the missing server messages and preserve a draft.
  await page.evaluate(()=>window.__orderMock.listeners.forEach(fn=>fn({type:'connection_restored'})));
  await wait('/api/orders/B/messages',2);
  await settle('/api/orders/B/messages',1,{messages:[
    {id:'B1',kind:'text',sender_id:'U1',body:'B first message'},
    {id:'B2',kind:'text',sender_id:'other',body:'B recovered message'}
  ],quickReplies:[],participants:[]});
  await page.getByText('B recovered message').waitFor();
  if(await page.getByText('B first message').count()!==1)throw Error('Reconnect duplicated a message');
  if(await message.inputValue()!=='B second draft')throw Error('Reconnect lost the current draft');

  // Same order ID but another authenticated account is a fresh private GET.
  await navigate('B','U2');
  await wait('/api/orders/B',2);
  if(await page.getByText('B first message').count()||
     await page.getByText('B second draft').count())
    throw Error('Former account message shown before fresh ACL GET');
  await settle('/api/orders/B',1,'forbidden',true);
  await page.getByRole('button',{name:'Повторить загрузку заявки'}).waitFor();
  if(await page.getByText('№202 · Электрик').count())
    throw Error('Unauthorized account saw old order after 403');
  // A real order detail must age its GPS and ETA even when the socket is silent.
  await navigate('GPS','U2');
  await wait('/api/orders/GPS',1);
  const now=await page.evaluate(()=>Date.now());
  await settle('/api/orders/GPS',0,{
    ...order('GPS',303),lat:59.91,lng:30.31,
    performer:{id:'master-gps',name:'Учебный мастер',lat:59.95,lng:30.35,location_at:new Date(now).toISOString()}
  });
  await page.getByText('GPS исполнителя обновлялся недавно',{exact:true}).waitFor();
  await page.locator('.roadside-eta').waitFor();
  const map=page.locator('.roadside-map[aria-label="Карта исполнителя"]');
  await map.getByText('Координаты получены от устройства',{exact:true}).waitFor();
  await page.evaluate(()=>{const clock=Date.now.bind(Date);window.__restoreClock=()=>{Date.now=clock;};Date.now=()=>clock()+121000;});
  await page.getByText('Последняя GPS-точка устарела',{exact:true}).waitFor({timeout:5000});
  await map.getByText('Последняя точка может быть устаревшей',{exact:true}).waitFor();
  if(await page.locator('.roadside-eta').count())throw Error('Expired GPS still has an ETA');
  if(await page.locator('.roadside-map iframe').count())throw Error('Map opened without consent');
  await page.evaluate(()=>window.__restoreClock());
  await navigate('BAD-GPS','U2');
  await wait('/api/orders/BAD-GPS',1);
  await settle('/api/orders/BAD-GPS',0,{
    ...order('BAD-GPS',304),lat:59.91,lng:30.31,
    performer:{id:'master-gps',name:'Учебный мастер',lat:999,lng:30.35,location_at:new Date(now).toISOString()}
  });
  await page.getByText('Ждём геолокацию исполнителя',{exact:true}).waitFor();
  if(await page.locator('.roadside-eta').count())throw Error('Invalid GPS produced ETA');
  if(errors.length)throw Error('Browser runtime error: '+errors.join('; '));
  console.log('PASS: real order/chat offline retry, A->B privacy, deduplicated sends and account switch');
}finally{await browser.close();}
