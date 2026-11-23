// PR #274: actual operations React components with isolated mocked private GET.
// No PostgreSQL, production users, money changes or notification deliveries.
import {build} from 'esbuild';
import {chromium} from 'playwright';

const stubs={
  '../api.ts':`
    export function get(path) {
      const mock=window.__opsMock;
      return new Promise((resolve,reject)=>{
        mock.requests.push({path,resolve,reject});
      });
    }
    export async function post(path,body) {
      window.__opsMock.mutations.push({path,body});
      return {ok:true};
    }
    export async function put(path,body) {
      window.__opsMock.mutations.push({path,body});
      return {ok:true};
    }
  `,
  '../dict.ts':`
    export const SERVICES={electric:{name:'Электрик'},diag:{name:'Диагност'},
      tow:{name:'Эвакуатор'},consult:{name:'Консультация'}};
    export const STATUS={searching:{name:'Ищем исполнителя'},no_performer:{name:'Никто не взял'}};
  `,
  '../ui.tsx':`
    import React,{useState} from 'react';
    export function useMe(){return {me:window.__opsMock.user};}
    export function useAction(){
      const [busy,setBusy]=useState(false);
      return {busy,run:async fn=>{
        setBusy(true);
        try{return await fn();}catch{return undefined;}finally{setBusy(false);}
      }};
    }
    export function Loading({error}){return <div data-testid="ops-loading">{error??'Загружаем…'}</div>;}
  `,
};
const bundle=await build({
  stdin:{
    contents:`
      import React,{useState} from 'react';
      import {createRoot} from 'react-dom/client';
      import {OpsDashboard,WorkerCommunications,WorkerNotices} from './web/src/screens/ops.tsx';
      window.__opsMock={requests:[],mutations:[],user:null};
      function App(){
        const [state,setState]=useState({view:'dashboard',id:'admin-A',roles:['admin']});
        window.__changeOpsState=setState;
        window.__opsMock.user={id:state.id,roles:state.roles,
          performer:{specialties:['electric']}};
        return state.view==='dashboard'?<OpsDashboard/>:
          state.view==='communications'?<WorkerCommunications/>:
          <WorkerNotices/>;
      }
      createRoot(document.getElementById('root')).render(<App/>);
    `,
    resolveDir:process.cwd(),sourcefile:'ops-reliability-entry.tsx',loader:'tsx',
  },
  bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',
  plugins:[{
    name:'mock-private-api-and-ui-context',
    setup(b){
      b.onResolve({filter:/./},args=>{
        if(Object.hasOwn(stubs,args.path))return {path:args.path,namespace:'ops-stub'};
      });
      b.onLoad({filter:/./,namespace:'ops-stub'},args=>({
        contents:stubs[args.path],loader:args.path.endsWith('.tsx')?'tsx':'js',
      }));
    }
  }]
});

const browser=await chromium.launch();
const assert=(ok,msg)=>{if(!ok)throw Error(msg);};
const incident=(note,reviewedAt)=>({
  id:'order-A',number:17,service:'electric',status:'no_performer',is_sos:true,
  created_at:'2026-11-24T07:00:00Z',zone_id:'test-zone',
  address:'Только синтетический адрес',elapsed_minutes:15,
  review_state:'investigating',review_note:note,reviewed_at:reviewedAt,
});
const demand=(total,note='')=>({
  summary:{total,unfilled:1,cancelled_before_acceptance:0,waiting_now:0,
    accepted_late:0,completed:0,recovered_after_retry:0},
  hourly:[],byService:[],byServiceZone:[],
  incidents:note?[incident(note, '2026-11-24T12:00:'+String(total).padStart(2,'0')+'Z')]:[],
});
try{
  const page=await browser.newPage({viewport:{width:390,height:844},locale:'ru-RU'});
  const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.setContent('<!doctype html><html lang="ru"><body><div id="root"></div></body></html>');
  await page.addScriptTag({content:bundle.outputFiles[0].text});
  const waitFor=async(path,count)=>page.waitForFunction(([path,count])=>
    window.__opsMock.requests.filter(r=>r.path===path).length>=count,[path,count]);
  const finish=async(path,n,result,isError=false)=>page.evaluate(([path,n,result,isError])=>{
    const x=window.__opsMock.requests.filter(r=>r.path===path)[n];
    if(!x)throw Error('Missing request: '+path+' '+n);
    if(isError)x.reject(Error(result));else x.resolve(result);
  },[path,n,result,isError]);
  const switchTo=(view,id,roles)=>page.evaluate(v=>window.__changeOpsState(v),
    {view,id,roles});

  // A later filter's actual report must win even if the first GET arrives last.
  const seven='/api/admin/demand?days=7&wait=15';
  const thirty='/api/admin/demand?days=30&wait=15';
  await waitFor(seven,1);
  await page.getByLabel('Период').selectOption('30');
  await waitFor(thirty,1);
  await finish(thirty,0,demand(8,'Старая запись'));
  await page.waitForFunction(()=>document.querySelector('.tile-value')?.textContent?.trim()==='8');
  await finish(seven,0,demand(999,'Чужой устаревший период'));
  assert((await page.locator('.tile-value').first().innerText())==='8',
    'A late 7-day GET overwrote the 30-day report');

  // Refresh the same incident with an external admin decision: never retain
  // the previous local note/state when the source review version changed.
  const note=page.getByPlaceholder('Причина, решение и что улучшить');
  await note.waitFor();
  assert((await note.inputValue())==='Старая запись','First review failed to load');
  await page.getByRole('button',{name:'Обновить данные'}).click();
  await waitFor(thirty,2);
  await finish(thirty,1,demand(9,'Новое решение коллеги'));
  await page.waitForFunction(()=>document.querySelector('input[placeholder="Причина, решение и что улучшить"]')?.value==='Новое решение коллеги');
  assert((await note.inputValue())==='Новое решение коллеги',
    'Old locally held review note survived an updated review version');

  // Failed refresh must hide previous report rather than advertising stale KPIs.
  await page.getByRole('button',{name:'Обновить данные'}).click();
  await waitFor(thirty,3);
  await finish(thirty,2,'offline admin demand',true);
  await page.getByText('offline admin demand').waitFor();
  assert(await page.locator('.tile-value').count()===0,
    'Stale totals visible after administrative GET failed');

  // Changing admin identity must not inherit A's report or unsent form.
  await switchTo('dashboard','admin-B',['admin']);
  await waitFor(seven,2);
  assert(await page.getByText('Старая запись').count()===0,
    'Former admin's private report visible to replacement session');
  await finish(seven,1,demand(5));
  await page.waitForFunction(()=>document.querySelector('.tile-value')?.textContent?.trim()==='5');

  // Admin notices and campaigns: transient 500 and reliable manual retry.
  await switchTo('communications','admin-B',['admin']);
  const adminNotices='/api/admin/announcements';
  const adminCampaigns='/api/admin/commission-campaigns';
  await waitFor(adminNotices,1);
  await waitFor(adminCampaigns,1);
  await finish(adminNotices,0,'offline announcements',true);
  await finish(adminCampaigns,0,'offline campaigns',true);
  await page.getByRole('button',{name:'Повторить загрузку объявлений'}).click();
  await page.getByRole('button',{name:'Повторить загрузку акций'}).click();
  await waitFor(adminNotices,2);await waitFor(adminCampaigns,2);
  await finish(adminNotices,1,[]);
  await finish(adminCampaigns,1,[]);
  await page.getByText('Пока пусто').waitFor();

  // Empty financial rate is NOT 0%, even though Number('') === 0.
  await page.getByRole('textbox',{name:'Причина изменения'}).fill('Учебная причина');
  const rate=page.getByRole('spinbutton',{name:/Комиссия платформы/});
  await rate.fill('');
  assert(await page.getByRole('button',{name:'Назначить комиссию'}).isDisabled(),
    'Empty commission input would create a real 0% campaign');
  await rate.fill('0');
  assert(await page.getByRole('button',{name:'Назначить комиссию'}).isEnabled(),
    'Explicit 0% campaign unexpectedly unavailable');

  // Worker's screen: a failed private GET cannot be displayed as "no news";
  // no old rate/announcement may leak across accounts with the same role.
  await switchTo('worker','master-A',['master']);
  const workerNotices='/api/worker/announcements?audience=master';
  const workerCampaigns='/api/worker/commission-campaigns';
  await waitFor(workerNotices,1);await waitFor(workerCampaigns,1);
  await finish(workerNotices,0,'offline worker news',true);
  await finish(workerCampaigns,0,[{
    id:'test-discount',service:'electric',commission_pct:0,reason:'Учебный ноль',
    ends_at:'2099-11-24T20:00:00Z'
  }]);
  await page.getByText('Не удалось проверить объявления и действующие акции').waitFor();
  assert(await page.getByText('Учебный ноль').count()===0,
    'Partial stale rate was displayed while notification GET failed');
  await page.getByRole('button',{name:'Повторить загрузку'}).click();
  await waitFor(workerNotices,2);
  await finish(workerNotices,1,[]);
  await page.getByText('Учебный ноль').waitFor();

  await switchTo('worker','master-B',['master']);
  await waitFor(workerNotices,3);await waitFor(workerCampaigns,2);
  assert(await page.getByText('Учебный ноль').count()===0,
    'Old worker discount leaked into another account');
  await finish(workerNotices,2,[]);
  await finish(workerCampaigns,1,[]);
  assert(await page.getByText('Учебный ноль').count()===0,
    'Another worker saw a previous worker rate');

  // Station partners must not be shown temporary dispatch worker discounts.
  // Their commission/contract is separate from roadside master/tow actions.
  await switchTo('worker','station-A',['service']);
  const stationNotices='/api/worker/announcements?audience=service';
  await waitFor(stationNotices,1);
  await finish(stationNotices,0,[]);
  const campaignReads=await page.evaluate(()=>
    window.__opsMock.requests.filter(x=>x.path==='/api/worker/commission-campaigns').length);
  assert(campaignReads===2,
    'Station fetched and could display commission campaigns meant for dispatch workers');
  assert(await page.getByText('Учебный ноль').count()===0,
    'Station saw a roadside master campaign');

  assert((await page.evaluate(()=>window.__opsMock.mutations.length))===0,
    'Read-only operations regression created a campaign or sent notifications');
  assert(errors.length===0,'Runtime errors: '+errors.join('; '));
  console.log('PASS ops: filter race, external review refresh, offline, admin/worker session isolation, empty-rate guard');
}finally{await browser.close();}
