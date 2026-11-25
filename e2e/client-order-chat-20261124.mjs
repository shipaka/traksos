// Real Order + Chat React component in Chromium. All API calls are trapped
// in deterministic promises; no actual orders, money or chat messages sent.
import {build} from 'esbuild';
import {chromium} from 'playwright';

const api=`
  export function getToken(){return window.__orderMock.user?.id??null;}
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
  './roadsideMap.tsx':'export function RoadsideMap(){return null;}',
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
  await page.route('http://localhost:41731/**',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html lang="ru"><body><div id="root"></div></body></html>'}));
  await page.goto('http://localhost:41731/');
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
  const latest=id=>'/api/orders/'+id+'/messages?window=latest&limit=100';
  const earlier=(id,cursor)=>'/api/orders/'+id+'/messages?window=before&limit=100&cursor='+cursor;
  const msg=(id,body,sender_id='other')=>({id,kind:'text',sender_id,body});
  const windowPage=(messages,mode='latest',hasMore=false)=>({messages,quickReplies:[],participants:[],
    page:{mode,hasMore,oldestId:messages[0]?.id??null,newestId:messages.at(-1)?.id??null,
      nextCursor:hasMore?messages[0].id:null}});
  const emit=event=>page.evaluate(e=>window.__orderMock.listeners.slice().forEach(fn=>fn(e)),event);
  const chatA=latest('A');
  await wait(chatA,1);
  await settle(chatA,0,'offline conversation',true);
  await page.getByRole('button',{name:/Чат по заявке/}).click();
  await page.getByRole('button',{name:'Повторить загрузку переписки'}).waitFor();
  if(await page.getByText('Сообщений пока нет').count())
    throw Error('Chat showed empty history when GET failed');
  await page.getByRole('button',{name:'Повторить загрузку переписки'}).click();
  await wait(chatA,2);
  await settle(chatA,1,windowPage([msg(101,'PRIVATE A CHAT')],'latest',true));
  await page.getByRole('button',{name:'Загрузить более ранние сообщения'}).click();
  await wait(earlier('A',101),1);
  await settle(earlier('A',101),0,windowPage([msg(7,'OLDER A CHAT')],'before'));
  await page.getByText('OLDER A CHAT').waitFor();
  await page.getByText('PRIVATE A CHAT').waitFor();
  await page.getByPlaceholder('Сообщение').fill('PRIVATE A DRAFT');
  // Reconnect returns a newer window with a gap. Every previously loaded
  // page is re-read under the current authorization, not kept from memory.
  await emit({type:'connection_restored'});
  await wait(chatA,3);
  await settle(chatA,2,windowPage([msg(507,'NEW A CHAT')],'latest',true));
  await wait(earlier('A',507),1);
  await settle(earlier('A',507),0,windowPage([msg(101,'PRIVATE A CHAT'),msg(305,'MISSED A CHAT')],'before',true));
  await wait(earlier('A',101),2);
  await settle(earlier('A',101),1,windowPage([msg(7,'OLDER A CHAT')],'before'));
  await page.getByText('MISSED A CHAT').waitFor();
  if((await page.locator('.msgs .b').allTextContents()).join('|')!=='OLDER A CHAT|PRIVATE A CHAT|MISSED A CHAT|NEW A CHAT')
    throw Error('Reconnect lost or reordered durable history');
  if(await page.getByPlaceholder('Сообщение').inputValue()!=='PRIVATE A DRAFT')
    throw Error('Reconnect lost mounted draft');
  // A socket payload is only invalidation: no unconfirmed body may appear.
  await emit({type:'chat',message:{order_id:'A',id:99,body:'UNCONFIRMED SOCKET BODY'}});
  await wait(chatA,4);
  if(await page.getByText('UNCONFIRMED SOCKET BODY').count())throw Error('Unconfirmed socket body rendered');
  await settle(chatA,3,'access revoked',true);
  await page.getByRole('button',{name:'Повторить загрузку переписки'}).waitFor();
  if(await page.getByText('PRIVATE A CHAT').count()||await page.getByText('OLDER A CHAT').count())
    throw Error('Denied refresh retained chat history');

  // A different order has a blank chat and a separate GET; old A is never shown.
  await navigate('B');
  await wait('/api/orders/B',1);
  if(await page.getByText('PRIVATE A CHAT').count()||await page.getByText('PRIVATE A DRAFT').count())
    throw Error('A chat remained during navigation to B');
  await settle('/api/orders/B',0,order('B',202));
  await wait(latest('B'),1);
  await settle(latest('B'),0,windowPage([]));
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
  await page.waitForFunction(()=>!document.querySelector('form.compose button')?.disabled);
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
  const original=await page.evaluate(()=>window.__orderMock.posts[0].body);
  if(!/^[0-9a-f-]{36}$/.test(original.requestId))throw Error('Missing request UUID');
  // The server may have committed; only the transport confirmation was lost.
  await page.evaluate(()=>window.__orderMock.posts[0].reject(Object.assign(Error('offline'),{status:0,code:'network'})));
  await wait(latest('B'),2);
  await settle(latest('B'),1,windowPage([msg(808,'B first message','U1')]));
  const retry=page.getByRole('button',{name:'Повторить прежнюю отправку'});
  await retry.waitFor();
  if(await message.inputValue()!=='B second draft')throw Error('Retry erased new draft');
  if(!(await page.locator('form.compose button').isDisabled()))throw Error('New send enabled before unresolved prior attempt');
  if(await page.evaluate(()=>window.__orderMock.posts.length)!==1)throw Error('Automatic POST replay');
  await page.evaluate(()=>{
    const button=Array.from(document.querySelectorAll('button')).find(x=>x.textContent==='Повторить прежнюю отправку');
    if(!button)throw Error('Missing explicit retry');
    button.click();button.click();
  });
  await page.waitForFunction(()=>window.__orderMock.posts.length===2);
  const repeated=await page.evaluate(()=>window.__orderMock.posts[1].body);
  if(JSON.stringify(repeated)!==JSON.stringify(original))throw Error('Retry altered payload or key');
  await page.evaluate(()=>window.__orderMock.posts[1].resolve({
    id:808,kind:'text',sender_id:'U1',body:'B first message'}));
  await wait(latest('B'),3);
  await settle(latest('B'),2,windowPage([msg(808,'B first message','U1')]));
  await page.getByText('B first message').waitFor();
  if(await message.inputValue()!=='B second draft')
    throw Error('Pending response erased the subsequent chat draft');

  // The next intentional message gets a distinct key.
  await page.locator('form.compose button').click();
  await page.waitForFunction(()=>window.__orderMock.posts.length===3);
  const third=await page.evaluate(()=>window.__orderMock.posts[2].body);
  if(third.requestId===original.requestId||third.body!=='B second draft')throw Error('New send reused prior identity');
  const saved=await page.evaluate(()=>Object.entries(localStorage).filter(([k])=>k.startsWith('traksos.chatPending.v1:')));
  if(saved.length!==1||!saved[0][1].includes(third.requestId)||saved[0][1].includes('B second draft')||saved[0][0].includes('U1'))
    throw Error('Recovery storage missing or contains private text/session token');
  // Leave while the response is outstanding; reopen the same authorized order.
  await navigate('C');
  await wait('/api/orders/C',1);
  await navigate('B');
  await wait('/api/orders/B',2);
  await settle('/api/orders/B',1,order('B',202));
  await wait(latest('B'),4);
  await settle(latest('B'),3,windowPage([msg(808,'B first message','U1')]));
  await page.getByRole('button',{name:/Чат по заявке/}).click();
  await page.getByRole('button',{name:'Проверить статус отправки'}).click();
  const statusPath='/api/orders/B/messages/request/'+third.requestId;
  await wait(statusPath,1);
  await settle(statusPath,0,{state:'not_observed',messageId:null,kind:null});
  await page.getByPlaceholder('Точный прежний текст').fill('wrong text');
  await page.getByRole('button',{name:'Повторить сохранённую отправку'}).click();
  await page.getByText('Текст отличается от прежней отправки. Повтор не выполнен.').waitFor();
  if(await page.evaluate(()=>window.__orderMock.posts.length)!==3)throw Error('Mismatched recovered text sent');
  await page.getByRole('button',{name:'Проверить статус отправки'}).click();
  await wait(statusPath,2);
  await settle(statusPath,1,{state:'committed',messageId:809,kind:'text'});
  await wait(latest('B'),5);
  await settle(latest('B'),4,windowPage([msg(808,'B first message','U1'),msg(809,'B second draft','U1')]));
  await page.getByText('Предыдущая отправка подтверждена сервером.').waitFor();
  if(await page.evaluate(()=>Object.keys(localStorage).some(k=>k.startsWith('traksos.chatPending.v1:'))))throw Error('Confirmed recovery metadata not cleared');
  if(await page.evaluate(()=>window.__orderMock.posts.length)!==3)throw Error('Status recovery sent another POST');
  // Same order ID but another authenticated account is a fresh private GET.
  await navigate('B','U2');
  await wait('/api/orders/B',3);
  if(await page.getByText('B first message').count()||
     await page.getByText('B second draft').count())
    throw Error('Former account message shown before fresh ACL GET');
  await page.evaluate(()=>window.__orderMock.posts[2].resolve({id:809,kind:'text',sender_id:'U1',body:'B second draft'}));
  await settle('/api/orders/B',2,'forbidden',true);
  await page.getByRole('button',{name:'Повторить загрузку заявки'}).waitFor();
  if(await page.getByText('№202 · Электрик').count())
    throw Error('Unauthorized account saw old order after 403');
  if(errors.length)throw Error('Browser runtime error: '+errors.join('; '));
  console.log('PASS: real order/chat offline retry, A->B privacy, deduplicated sends and account switch');
}finally{await browser.close();}
