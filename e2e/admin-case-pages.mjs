// Real AdminCaseCenter React screen with isolated synthetic API transport.
// No real customers, messages, payments or external requests.
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {chromium} from 'playwright';

const bundle=await build({
  stdin:{resolveDir:process.cwd(),sourcefile:'admin-case-pages-entry.tsx',loader:'tsx',contents:`
    import {useState} from 'react';
    import {createRoot} from 'react-dom/client';
    import {TestContext} from './web/src/ui.tsx';
    import {AdminCaseCenter} from './web/src/screens/adminCaseCenter.tsx';
    window.__caseMock={pending:[]};
    function App(){
      const [id,setId]=useState('admin-A');
      window.__switchAdmin=setId;
      return <TestContext.Provider value={{me:{id,roles:['admin']}}}><AdminCaseCenter/></TestContext.Provider>;
    }
    createRoot(document.getElementById('root')).render(<App/>);
  `},
  bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',
  plugins:[{name:'isolated-admin-case-transport',setup(b){
    b.onResolve({filter:/./},a=>{
      if(a.path==='../ui.tsx'||a.path==='./web/src/ui.tsx')return {path:'ui',namespace:'case-stub'};
      if(a.path==='../api.ts')return {path:'api',namespace:'case-stub'};
      if(a.path.endsWith('.css'))return {path:'css',namespace:'case-stub'};
    });
    b.onLoad({filter:/./,namespace:'case-stub'},a=>({resolveDir:process.cwd(),loader:'tsx',contents:{
      ui:`import {createContext,useContext} from 'react';export const TestContext=createContext({me:null});export const useMe=()=>useContext(TestContext);`,
      api:`export function get(path){return new Promise((resolve,reject)=>window.__caseMock.pending.push({path,resolve,reject,done:false}));}
      export function post(){throw new Error('No writes in this fixture');}
      export function fmtTime(v){return String(v);}
      export function rub(v){return String(v/100)+' ₽';}`,
      css:''
    }[a.path]}));
  }}],
});
const browser=await chromium.launch();
const listRow=(id,number)=>({id,number,client_name:'Синтетический клиент '+id,
  vehicle_brand:'DAF',vehicle_plate:'ТЕСТ',opened_at:'2026-11-25',order_count:1,
  workshop_count:0,ecu_count:0,is_multi:false,has_active:true,moderated:false});
const listPage=(items,nextBefore=null)=>({items,nextBefore,hasMore:nextBefore!==null});
const history=(rootId,kind,items,nextBefore=null)=>({rootId,kind,items,nextBefore,hasMore:nextBefore!==null});
const detail=(id,number)=>({root_id:id,multi:true,case_number:null,
  stages:[{id,number,service:'electric',status:'working',client_id:'client-'+id,client_name:'Синтетический клиент',
    created_at:'2026-11-25',vehicle_id:'vehicle-'+id}],
  bookings:[{id:'linked-'+id,number:42,stage_no:null,center_name:'Тестовая СТО',status:'closed',need:'electric'}],
  vehicle:{id:'vehicle-'+id,brand:'DAF',model:'XF',plate:'ТЕСТ',owner_id:'client-'+id},
  ecu_referrals:[],moderation:[],events:[],chat:[],notes:[],payments:[],payouts:[],
  vehicle_history:[],vehicle_history_bookings:[]});
const listUrl=(q='',scope='all',before=null)=>'/api/admin/cases?'+new URLSearchParams({q,scope,limit:'100',...(before?{before}:{})});
const historyUrl=(id,kind,before=null)=>'/api/admin/cases/'+id+'/history?'+new URLSearchParams({kind,limit:'100',...(before?{before}:{})});
const event=(id,type,order_id='case-A')=>({id,type,order_id,created_at:'2026-11-25'});
const message=(id,body,order_id='case-A')=>({id,body,order_id,sender_name:'Тест',created_at:'2026-11-25'});
try{
 for(const width of [390,1440]){
  const page=await browser.newPage({viewport:{width,height:900}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.setContent('<!doctype html><html lang="ru"><body><div id="root"></div></body></html>');
  await page.addScriptTag({content:bundle.outputFiles[0].text});
  const wait=path=>page.waitForFunction(path=>window.__caseMock.pending.some(x=>x.path===path&&!x.done),path);
  const settle=async(path,value,failed=false)=>{
    await wait(path);
    await page.evaluate(({path,value,failed})=>{
      const r=window.__caseMock.pending.find(x=>x.path===path&&!x.done);
      r.done=true;failed?r.reject(new Error(value)):r.resolve(value);
    },{path,value,failed});
  };
  const btn=(name,scope=page)=>scope.getByRole('button',{name,exact:true});
  const row=(n)=>btn('Открыть заявку №'+n);
  const first=listUrl();
  const second=listUrl('','all','case-A');
  await settle(first,listPage([listRow('case-A',701)],'case-A'));
  await row(701).waitFor();
  await btn('Следующая страница').click();
  await wait(second);
  assert.equal(await row(701).count(),0,'Previous registry page leaked during loading');
  await settle(second,'Ошибка страницы реестра',true);
  await page.getByText('Ошибка страницы реестра',{exact:true}).waitFor();
  await btn('Повторить загрузку реестра').click();
  await settle(second,listPage([listRow('case-B',702)]));
  await row(702).waitFor();
  assert.equal(await btn('Следующая страница').isDisabled(),true);
  await btn('Предыдущая страница').click();
  await settle(first,listPage([listRow('case-A',701)],'case-A'));
  await row(701).waitFor();

  // Changing filters invalidates cursor and stale responses.
  const search=page.getByRole('searchbox',{name:'Найти заявку, мультизаявку или автомобиль'});
  await search.fill('старый');
  await wait(listUrl('старый'));
  await search.fill('новый');
  await settle(listUrl('новый'),listPage([listRow('case-B',702)]));
  await row(702).waitFor();
  await settle(listUrl('старый'),listPage([listRow('case-A',701)]));
  assert.equal(await row(701).count(),0);
  await search.fill('');
  await settle(first,listPage([listRow('case-A',701)],'case-A'));
  await row(701).click();
  await settle('/api/admin/cases/case-A',detail('case-A',701));
  const dialog=page.getByRole('dialog',{name:'Подробности заявки'});
  await dialog.getByText('Номер этапа не зафиксирован · СТО · запись №42 ↗',{exact:true}).waitFor();
  const vehicleOrders=dialog.getByRole('region',{name:'История выездов автомобиля'});
  const vehicleBookings=dialog.getByRole('region',{name:'История СТО автомобиля'});
  await settle(historyUrl('case-A','vehicle_orders'),history('case-A','vehicle_orders',
    [{id:'vehicle-old-1',number:1001,service:'electric',created_at:'2026-11-25'}],'vehicle-old-1'));
  await settle(historyUrl('case-A','vehicle_bookings'),history('case-A','vehicle_bookings',
    [{id:'booking-old-1',number:2001,center_name:'Тестовая СТО',created_at:'2026-11-25'}]));
  await vehicleOrders.getByText(/Заказ №1001/).waitFor();
  await vehicleBookings.getByText(/СТО №2001/).waitFor();
  await btn('Более ранние',vehicleOrders).click();
  await settle(historyUrl('case-A','vehicle_orders','vehicle-old-1'),history('case-A','vehicle_orders',
    [{id:'vehicle-old-2',number:1002,service:'electric',created_at:'2026-11-24'}]));
  await vehicleOrders.getByText(/Заказ №1002/).waitFor();
  assert.equal(await vehicleOrders.getByText(/Заказ №1001/).count(),0);
  assert.equal(await vehicleBookings.getByText(/СТО №2001/).count(),1);
  await btn('Ход работ',dialog).click();
  await settle(historyUrl('case-A','events'),history('case-A','events',[event('event-1','created')],'event-1'));
  await dialog.getByText('Заявка создана',{exact:true}).waitFor();
  await btn('Более ранние',dialog).click();
  const earlier=historyUrl('case-A','events','event-1');
  await settle(earlier,'Ошибка чтения событий',true);
  await dialog.getByText('Ошибка чтения событий',{exact:true}).waitFor();
  assert.equal(await dialog.getByText('Заявка создана',{exact:true}).count(),0);
  await btn('Повторить загрузку истории',dialog).click();
  await settle(earlier,history('case-A','events',[event('event-2','accepted')]));
  await dialog.getByText('Исполнитель принял',{exact:true}).waitFor();
  assert.equal(await btn('Более ранние',dialog).isDisabled(),true);
  await btn('Более новые',dialog).click();
  await settle(historyUrl('case-A','events'),history('case-A','events',[event('event-1','created')],'event-1'));
  await dialog.getByText('Заявка создана',{exact:true}).waitFor();

  // Closing/swapping account while an old private history GET is pending
  // must never expose its result to the next administrator.
  await btn('Чат',dialog).click();
  await wait(historyUrl('case-A','chat'));
  await page.evaluate(()=>window.__switchAdmin('admin-B'));
  await settle(first,listPage([listRow('case-B',702)]));
  await row(702).waitFor();
  await settle(historyUrl('case-A','chat'),history('case-A','chat',[message('old-private','Старое частное сообщение')]));
  assert.equal(await page.getByText('Старое частное сообщение',{exact:true}).count(),0);
  await row(702).click();
  await settle('/api/admin/cases/case-B',detail('case-B',702));
  await btn('Чат',dialog).click();
  await settle(historyUrl('case-B','chat'),history('case-B','chat',[message('new-private','Новая переписка','case-B')]));
  await dialog.getByText('Новая переписка',{exact:true}).waitFor();
  assert.equal(await page.getByText('Старое частное сообщение',{exact:true}).count(),0);
  assert.deepEqual(errors,[]);
  await page.close();
 }
 console.log('PASS admin case registry and all history page controls, errors, and account isolation');
}finally{await browser.close();}
