// ADMIN-PARTNER-FINANCE-20261124
// Real React screens, completely synthetic API. No production ledger writes,
// payment, real VIN, phone, partner, financial amount or login are used.
import {build} from 'esbuild';
import {chromium} from 'playwright';

const apiStub=`
  function request(method,path,body){
    const m=window.__financeMock;
    m.calls.push({method,path,body});
    return new Promise((resolve,reject)=>m.pending.push({method,path,body,resolve,reject}));
  }
  export const get=path=>request('GET',path);
  export const post=(path,body)=>request('POST',path,body);
  export const patch=(path,body)=>request('PATCH',path,body);
  export const put=(path,body)=>request('PUT',path,body);
  export const fmtTime=x=>String(x);
  export const rub=k=>Math.round(Number(k)/100).toLocaleString('ru-RU')+' ₽';
`;
const uiStub=`
  import {createContext,useContext,useState} from 'react';
  export const TestContext=createContext({me:null});
  export const useMe=()=>useContext(TestContext);
  export function useAction(){
    const [busy,setBusy]=useState(false);
    return {busy,run:async(fn)=>{
      setBusy(true);
      try{return await fn();}catch{return undefined;}
      finally{setBusy(false);}
    }};
  }
`;
const bundle=await build({
  stdin:{contents:`
    import React,{useState} from 'react';
    import {createRoot} from 'react-dom/client';
    import {TestContext} from './web/src/ui.tsx';
    import {parseAdminRubles} from './web/src/adminFinanceKopecks20261124.ts';
    import {VehicleServicesQueue} from './web/src/screens/vehicleServicesAdmin.tsx';
    import {AdminServiceFinance} from './web/src/screens/adminServiceFinance.tsx';
    import {InsuranceAccessAdmin} from './web/src/screens/insuranceAccessAdmin.tsx';
    window.__financeMock={calls:[],pending:[]};
    window.__parseAdminRubles=parseAdminRubles;
    window.confirm=()=>true;
    function App(){
      const [me,setMe]=useState({id:'admin-A',roles:['admin']});
      const [view,setView]=useState('service');
      window.__setFinanceUser=setMe;
      window.__setFinanceView=setView;
      return <TestContext.Provider value={{me}}>
        {view==='service'?<VehicleServicesQueue/>:
          view==='bank'?<AdminServiceFinance/>:<InsuranceAccessAdmin/>}
      </TestContext.Provider>;
    }
    createRoot(document.getElementById('root')).render(<App/>);
  `,resolveDir:process.cwd(),sourcefile:'admin-finance-reliability-entry.tsx',loader:'tsx'},
  bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',
  plugins:[{name:'only-synthetic-finance-transport',setup(b){
    b.onResolve({filter:/./},a=>{
      if(a.path==='../api.ts'||a.path==='./api.ts')return {path:'api',namespace:'synthetic'};
      if(a.path==='../ui.tsx'||a.path==='./web/src/ui.tsx')return {path:'ui',namespace:'synthetic'};
    });
    b.onLoad({filter:/./,namespace:'synthetic'},a=>({
      contents:a.path==='ui'?uiStub:apiStub,loader:a.path==='ui'?'tsx':'js'
    }));
  }}],
});
const expect=(pass,msg)=>{if(!pass)throw Error(msg);};
const browser=await chromium.launch();
try{
  const page=await browser.newPage({viewport:{width:390,height:844},locale:'ru-RU'});
  const runtimeErrors=[];
  page.on('pageerror',e=>runtimeErrors.push(e.message));
  await page.setContent('<!doctype html><html lang="ru"><body><div id="root"></div></body></html>');
  await page.addScriptTag({content:bundle.outputFiles[0].text});
  const count=(method,path)=>page.evaluate(({method,path})=>
    window.__financeMock.pending.filter(x=>x.method===method&&x.path===path).length,
    {method,path});
  const wait=(method,path,n)=>page.waitForFunction(({method,path,n})=>
    window.__financeMock.pending.filter(x=>x.method===method&&x.path===path).length>=n,
    {method,path,n});
  const finish=(method,path,index,kind,value)=>page.evaluate(({method,path,index,kind,value})=>{
    const p=window.__financeMock.pending.filter(x=>x.method===method&&x.path===path)[index];
    if(!p)throw Error('Missing synthetic '+method+' '+path+' '+index);
    p[kind](kind==='reject'?Error(value):value);
  },{method,path,index,kind,value});
  const parse=async value=>page.evaluate(v=>window.__parseAdminRubles(v),value);
  for(const [value,result] of [
    ['1e3',null],['10.001',null],['-1',null],['0',null],['',null],
    ['12,50',1250],['3 500,75',350075],['0.01',1],['100',10000],
    ['999999999999999999999',null],
  ]){
    expect(await parse(value)===result,'Money parser changed amount for '+value);
  }

  const cases='/api/admin/vehicle-service-requests';
  const insurers='/api/admin/insurers';
  const inspectors='/api/admin/inspection-partners';
  await wait('GET',cases,1);await wait('GET',insurers,1);await wait('GET',inspectors,1);
  const record=(id,brand)=>({
    id,kind:'insurance',brand,model:'CI',plate:'CI-000',
    created_at:'2026-01-01',status:'completed',
    has_partner_accrual:false,assigned_to:'synthetic-partner',
  });
  await finish('GET',cases,0,'resolve',[record('case-A','PRIVATE-A-TRUCK')]);
  await finish('GET',insurers,0,'resolve',[]);
  await finish('GET',inspectors,0,'resolve',[]);
  await page.getByText(/PRIVATE-A-TRUCK/).waitFor();
  await page.getByText('Подтвердить начисление партнёру').click();
  const amount=page.getByLabel('Сумма начисления, ₽');
  const reason=page.getByLabel('Основание начисления');
  await amount.fill('1e3');
  await reason.fill('Синтетическое подтверждение №CI-1');
  await page.getByRole('button',{name:'Зарегистрировать начисление'}).click();
  await page.getByRole('alert').filter({hasText:'строго до копейки'}).waitFor();
  expect(await count('POST','/api/admin/partner-finance/accruals')===0,
    'Exponential amount entered the financial ledger');
  await amount.fill('23 456,78');
  await page.getByRole('button',{name:'Зарегистрировать начисление'}).click();
  const ledger='/api/admin/partner-finance/accruals';
  await wait('POST',ledger,1);
  const body=await page.evaluate(path=>
    window.__financeMock.calls.find(x=>x.method==='POST'&&x.path===path)?.body,ledger);
  expect(body?.amountKopecks===2345678&&body.requestId==='case-A',
    'Rounded or wrong partner fee: '+JSON.stringify(body));
  await finish('POST',ledger,0,'reject','temporary offline');
  await page.getByRole('alert').filter({hasText:'Финансовая запись не подтверждена'}).waitFor();
  expect(await amount.inputValue()==='23 456,78',
    'Ambiguous failed ledger POST erased user evidence');
  await page.getByRole('button',{name:'Зарегистрировать начисление'}).click();
  await wait('POST',ledger,2);
  await finish('POST',ledger,1,'resolve',{id:'ledger-ci'});
  await wait('GET',cases,2);
  await finish('GET',cases,1,'resolve',[]);
  await page.getByText('Заявок в этом направлении пока нет').waitFor();

  // Same React component, different account: no old cases, selected partner,
  // bank draft, or results may be visible while replacement GET is pending.
  await page.evaluate(()=>window.__setFinanceUser({id:'admin-B',roles:['admin']}));
  await wait('GET',cases,3);
  expect(await page.getByText(/PRIVATE-A-TRUCK/).count()===0,
    'Prior administrator private case visible after account switch');
  await finish('GET',cases,2,'reject','network offline after switch');
  await page.getByRole('button',{name:'Повторить загрузку заявок'}).click();
  await wait('GET',cases,4);
  await finish('GET',cases,3,'resolve',[record('case-B','PRIVATE-B-TRUCK')]);
  await page.getByText(/PRIVATE-B-TRUCK/).waitFor();

  // Manual bank audit on a real React component with a synthetic booking.
  await page.evaluate(()=>window.__setFinanceView('bank'));
  const bank='/api/admin/service-finance';
  await wait('GET',bank,1);
  const row=id=>({
    id,number:'CI-5',center_name:'SYNTHETIC SERVICE B',
    client_name:'CI CLIENT',invoiced_at:'2026-01-01',
    payment_required:true,fee_base_amount:250000,amount:250000,
    parts_amount:0,client_fee:12500,commission:12500,
    toPay:262500,payout:237500,netReceived:0,outstanding:262500,
    status:'closed',paymentStatus:'awaiting_payment',discount:0,
    recoveryNeeded:false,payoutReady:false,
  });
  await finish('GET',bank,0,'resolve',[row('booking-B')]);
  await page.getByText('SYNTHETIC SERVICE B',{exact:false}).waitFor();
  await page.getByRole('button',{name:'Сверить оплату / возврат'}).click();
  const events='/api/admin/bookings/booking-B/payment-events';
  await wait('GET',events,1);
  await finish('GET',events,0,'resolve',{
    invoice:{number:'CI-5',paymentRequired:true,total:262500,
      received:0,refunded:0,outstanding:262500,recoveryNeeded:false},events:[],
  });
  await page.getByText('Ручная банковская сверка',{exact:false}).waitFor();
  const bankAmount=page.getByLabel('Сумма, ₽');
  const bankReference=page.getByLabel('Номер реальной банковской / кассовой операции');
  await bankAmount.fill('0.001');
  await bankReference.fill('CI BANK REFERENCE');
  expect(await page.getByRole('button',{name:'Записать поступление'}).isDisabled(),
    'Rounded fractional kopecks allowed in a manual bank entry');
  await bankAmount.fill('1 250,50');
  await page.getByRole('button',{name:'Записать поступление'}).click();
  await wait('POST',events,1);
  const bankBody=await page.evaluate(path=>
    window.__financeMock.calls.find(x=>x.method==='POST'&&x.path===path)?.body,events);
  expect(bankBody.amount===125050&&bankBody.reference==='CI BANK REFERENCE',
    'Bank entry amount is not exact kopecks');
  await finish('POST',events,0,'resolve',{id:'bank-entry-B'});
  await wait('GET',events,2);await wait('GET',bank,2);
  await finish('GET',events,1,'resolve',{
    invoice:{number:'CI-5',paymentRequired:true,total:262500,
      received:125050,refunded:0,outstanding:137450,recoveryNeeded:false},events:[],
  });
  await finish('GET',bank,1,'resolve',[row('booking-B')]);
  await page.getByText('SYNTHETIC SERVICE B',{exact:false}).waitFor();

  const previousBank=await count('GET',bank);
  await page.evaluate(()=>window.__setFinanceUser({id:'admin-C',roles:['admin']}));
  await wait('GET',bank,previousBank+1);
  expect(await page.getByText('SYNTHETIC SERVICE B',{exact:false}).count()===0,
    'Bank registry leaked after administrator switch');
  await finish('GET',bank,previousBank,'reject','offline bank');
  await page.getByRole('button',{name:'Повторить загрузку финансов'}).click();
  await wait('GET',bank,previousBank+2);
  await finish('GET',bank,previousBank+1,'resolve',[]);

  // Insurance access switch must never be based on cached previous-user
  // registration state or force enabled before actual GET success.
  await page.evaluate(()=>window.__setFinanceView('access'));
  const access='/api/admin/insurance-access';
  await wait('GET',access,1);
  await finish('GET',access,0,'reject','offline access');
  await page.getByRole('button',{name:'Повторить загрузку настроек'}).click();
  await wait('GET',access,2);
  await finish('GET',access,1,'resolve',{
    registrationOpen:false,primaryConfigured:true,registeredCount:3,
  });
  await page.getByRole('button',{name:/Регистрация новых партнёров закрыта/}).click();
  const toggle='/api/admin/settings/insurancePartners';
  await wait('PUT',toggle,1);
  const allowed=await page.evaluate(path=>
    window.__financeMock.calls.find(x=>x.method==='PUT'&&x.path===path)?.body,toggle);
  expect(allowed.registrationOpen===true,'Unexpected partner registration state');
  await finish('PUT',toggle,0,'resolve',{ok:true});
  await wait('GET',access,3);
  await finish('GET',access,2,'resolve',{
    registrationOpen:true,primaryConfigured:true,registeredCount:3,
  });
  await page.getByRole('button',{name:/Регистрация новых партнёров разрешена/}).waitFor();
  await page.evaluate(()=>window.__setFinanceUser({id:'non-admin',roles:['client']}));
  await page.getByText(/доступно только администратору/).waitFor();
  expect(await page.getByRole('button',{name:/Регистрация новых партнёров разрешена/}).count()===0,
    'Non-admin retained private registration toggle');
  expect(runtimeErrors.length===0,'React runtime errors: '+runtimeErrors.join('; '));
  console.log('PASS: exact financial kopecks, no old admin data, bank retry and insurer switch');
}finally{await browser.close();}
