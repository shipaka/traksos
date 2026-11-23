// ADMIN-ACCOUNT-SETTINGS-20261124
// Real React admin screens. Synthetic, fully intercepted GET/POST/PUT responses:
// no user account, fee, bank refund, SMS, or real platform policy is changed.
import {build} from 'esbuild';
import {chromium} from 'playwright';

const uiStub=`
  import React,{createContext,useContext,useState} from 'react';
  export const C=createContext({me:null});
  export const useMe=()=>useContext(C);
  export const useToast=()=>()=>{};
  export function Back(){return <span>К админке</span>;}
  export function go(){}
  export function RubInput({value,onChange,placeholder}){
    return <input aria-label={placeholder||'Сумма в рублях'}
      value={value==null?'':String(value/100)}
      onChange={e=>{
        const raw=e.target.value;
        onChange(raw===''?null:Math.round(Number(raw)*100));
      }}/>;
  }
  export function useAction(){
    const [busy,setBusy]=useState(false);
    return {busy,run:async(fn)=>{
      setBusy(true);
      try{return await fn();}catch{return undefined;}
      finally{setBusy(false);}
    }};
  }
`;
const apiStub=`
  function make(method,path,body){
    const m=window.__adminStub;
    m.calls.push({method,path,body});
    return new Promise((resolve,reject)=>m.pending.push({method,path,body,resolve,reject}));
  }
  export const get=path=>make('GET',path);
  export const post=(path,body)=>make('POST',path,body);
  export const put=(path,body)=>make('PUT',path,body);
  export const fmtPhone=s=>String(s||'');
  export const fmtTime=s=>String(s||'');
  export const rub=n=>String(Number(n)/100)+' ₽';
`;
const bundle=await build({
  stdin:{contents:`
    import React,{useState} from 'react';
    import {createRoot} from 'react-dom/client';
    import {C} from './web/src/ui.tsx';
    import {AdminUser} from './web/src/screens/adminUser.tsx';
    import {AdminSettings} from './web/src/screens/adminSettings.tsx';
    import {AdminAccountAccess} from './web/src/screens/adminAccountAccess.tsx';
    import {parseAdminSetting} from './web/src/adminSettingsValidation20261124.ts';
    window.__adminStub={calls:[],pending:[]};
    window.__settingsParse=parseAdminSetting;
    window.confirm=()=>true;
    function App(){
      const [me,setMe]=useState({id:'admin-A',roles:['admin']});
      const [view,setView]=useState('settings');
      const [target,setTarget]=useState('client-X');
      window.__setAdminUser=setMe;
      window.__setAdminView=setView;
      window.__setAdminTarget=setTarget;
      return <C.Provider value={{me}}>
        {view==='settings'?<AdminSettings/>:
          view==='access'?<AdminAccountAccess/>:<AdminUser id={target}/>}
      </C.Provider>;
    }
    createRoot(document.getElementById('root')).render(<App/>);
  `,resolveDir:process.cwd(),sourcefile:'admin-accounts-regression.tsx',loader:'tsx'},
  bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',
  plugins:[{name:'fully-synthetic-http',setup(b){
    b.onResolve({filter:/./},a=>{
      if(a.path==='../ui.tsx'||a.path==='./web/src/ui.tsx')
        return {path:'ui',namespace:'admin-test'};
      if(a.path==='../api.ts'||a.path==='./api.ts')
        return {path:'api',namespace:'admin-test'};
    });
    b.onLoad({filter:/./,namespace:'admin-test'},a=>({
      contents:a.path==='ui'?uiStub:apiStub,
      loader:a.path==='ui'?'tsx':'js',
    }));
  }}],
});
function assert(ok,message){if(!ok)throw Error(message);}
const browser=await chromium.launch();
try {
  const page=await browser.newPage({viewport:{width:390,height:844},locale:'ru-RU'});
  const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.setContent('<!doctype html><html lang="ru"><body><div id="root"></div></body></html>');
  await page.addScriptTag({content:bundle.outputFiles[0].text});
  const count=(method,path)=>page.evaluate(({method,path})=>
    window.__adminStub.pending.filter(x=>x.method===method&&x.path===path).length,{method,path});
  const wait=(method,path,n)=>page.waitForFunction(({method,path,n})=>
    window.__adminStub.pending.filter(x=>x.method===method&&x.path===path).length>=n,
    {method,path,n});
  const settle=(method,path,index,kind,payload)=>page.evaluate(({method,path,index,kind,payload})=>{
    const item=window.__adminStub.pending.filter(x=>x.method===method&&x.path===path)[index];
    if(!item)throw Error('No synthetic '+method+path+' #'+index);
    item[kind](kind==='reject'?new Error(payload):payload);
  },{method,path,index,kind,payload});
  const parse=(kind,value)=>page.evaluate(({kind,value})=>window.__settingsParse(kind,value),{kind,value});
  for(const [kind,value,expected] of [
    ['pct','',null],['pct','1e3',null],['pct','101',null],
    ['pct','5,25',5.25],['pct','0',0],['share','125',null],
    ['share','25',0.25],['num','0.5',null],['num','30',30],
    ['rub',1234.5,null],['rub',1234,1234],['bool','true',null],
  ]){
    const result=await parse(kind,value);
    assert((expected===null&&!result.ok)||(result.ok&&result.value===expected),
      'Unsafe setting parser '+kind+': '+value+' -> '+JSON.stringify(result));
  }

  const settings='/api/admin/settings';
  const defaults=fee=>({
    fees:{clientFeePct:fee,performerCommissionPct:5,serviceCommissionPct:5,
      serviceCommissionMax:500000,serviceReferralDiscountPct:1,cashDebtLimit:300000},
    referral:{clientSharePct:10,days:180,welcome:30000,performerReward:100000,
      performerJobs:5,serviceReward:200000,spendCapPct:50,ttlDays:180},
    pricing:{billingStepMinutes:60,consult:{price:70000,backDiscount:20000,backHours:48}},
    payments:{cash:false,online:false,invoice:false},
    cancel:{scale:{accepted:0.25,en_route_first_half:0.5,en_route_second_half:1,arrived:1}},
    dispatch:{priorityFirst:true,ringSeconds:30,auctionMinutes:10,missedToOffline:3},
    legal:{entity:'CI-ENTITY',inn:'',ogrn:'',address:'',phone:'',email:'',tagline:''},
  });
  await wait('GET',settings,1);
  await settle('GET',settings,0,'resolve',defaults(5));
  await page.getByRole('button',{name:/Деньги/}).click();
  await page.getByRole('button',{name:/Сервисный сбор с клиента/}).click();
  await page.getByPlaceholder('%').fill('8.999');
  await page.getByRole('button',{name:'Сохранить'}).click();
  await page.getByRole('alert').filter({hasText:/Введите число без экспоненты/}).waitFor();
  assert(await count('PUT','/api/admin/settings/fees')===0,
    'Fractional extra precision changed commission');
  await page.getByPlaceholder('%').fill('6,25');
  await page.getByRole('button',{name:'Сохранить'}).click();
  const fees='/api/admin/settings/fees';
  await wait('PUT',fees,1);
  const written=await page.evaluate(path=>
    window.__adminStub.calls.filter(x=>x.method==='PUT'&&x.path===path)[0]?.body,fees);
  assert(written.clientFeePct===6.25,'Fee value silently modified');
  await settle('PUT',fees,0,'resolve',{ok:true});
  await wait('GET',settings,2);
  await settle('GET',settings,1,'resolve',defaults(6.25));
  await page.getByRole('button',{name:/Сервисный сбор с клиента/}).waitFor();

  await page.evaluate(()=>window.__setAdminUser({id:'admin-B',roles:['admin']}));
  await wait('GET',settings,3);
  assert(await page.getByText('CI-ENTITY').count()===0,
    'Old admin settings displayed while B awaits load');
  await settle('GET',settings,2,'reject','offline');
  await page.getByRole('button',{name:'Повторить загрузку настроек'}).click();
  await wait('GET',settings,4);
  await settle('GET',settings,3,'resolve',defaults(7));

  await page.evaluate(()=>window.__setAdminView('access'));
  const reports='/api/admin/developer-reports';
  await wait('GET',reports,1);
  await settle('GET',reports,0,'resolve',[{
    id:'report-B',user_id:null,phone:null,category:'roles',
    details:'SYNTHETIC PRIVATE REPORT B',status:'open',created_at:'2026-01-01',
    user_name:null,delivery_configured:false,delivery_sent_at:null,
    delivery_attempts:0,delivery_next_at:null,delivery_last_error:null,
  }]);
  await page.getByText('SYNTHETIC PRIVATE REPORT B').waitFor();
  await page.evaluate(()=>window.__setAdminUser({id:'admin-C',roles:['admin']}));
  await wait('GET',reports,2);
  assert(await page.getByText('SYNTHETIC PRIVATE REPORT B').count()===0,
    'Prior admin developer report leaked');
  await settle('GET',reports,1,'reject','offline reports');
  await page.getByRole('button',{name:'Повторить загрузку обращений'}).click();
  await wait('GET',reports,3);
  await settle('GET',reports,2,'resolve',[]);
  await page.getByText('Очередь пуста').waitFor();

  const personal='/api/admin/users/client-X';
  await page.evaluate(()=>window.__setAdminView('user'));
  await wait('GET',personal,1);
  const card=name=>({
    user:{id:'client-X',name,phone:'+79000000000',roles:['client'],
      created_at:'2026-01-01',status:'active',rating:0,rating_count:0},
    pricing:{defaultFeePct:5,feePctOverride:null,bonus:0,bonusEntries:[]},
    sessions:[],asClient:[],asPerformer:[],vehicles:[],drivers:[],
    performer:null,owner:null,reviewsAbout:[],reviewsBy:[],payments:[],audit:[],
    ledger:[],payouts:[],balance:null,
  });
  await settle('GET',personal,0,'resolve',card('PRIVATE-C-ACCOUNT'));
  await page.getByRole('heading',{name:'PRIVATE-C-ACCOUNT'}).waitFor();
  await page.getByRole('button',{name:/Профиль и цена/}).waitFor();
  await page.evaluate(()=>window.__setAdminUser({id:'admin-D',roles:['admin']}));
  await wait('GET',personal,2);
  assert(await page.getByRole('heading',{name:'PRIVATE-C-ACCOUNT'}).count()===0,
    'Old privileged user dossier remains after admin change');
  await settle('GET',personal,1,'reject','offline dossier');
  await page.getByRole('button',{name:'Повторить загрузку карточки'}).click();
  await wait('GET',personal,3);
  await settle('GET',personal,2,'resolve',card('PRIVATE-D-ACCOUNT'));
  await page.getByRole('heading',{name:'PRIVATE-D-ACCOUNT'}).waitFor();
  await page.evaluate(()=>window.__setAdminUser({id:'unprivileged',roles:['client']}));
  await page.getByText('Карточки пользователей доступны только администратору.').waitFor();
  assert(errors.length===0,'Real React runtime errors: '+errors.join('; '));
  console.log('PASS: admin settings, private account dossiers, developer reports and strict validation');
} finally {await browser.close();}
