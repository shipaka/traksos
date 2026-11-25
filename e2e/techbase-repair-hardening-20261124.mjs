// TECHBASE-REPAIR-20261124: real React components, isolated synthetic network.
// No production API, user data, orders, source documents or bank calls.
import {build} from 'esbuild';
import {chromium} from 'playwright';

const stubs={
  '../api.ts':`
    export class ApiError extends Error {constructor(status,code,message){super(message);this.status=status;this.code=code;}}
    export function get(path){
      const m=window.__techMock;
      m.calls.push({method:'GET',path});
      return new Promise((resolve,reject)=>m.pending.push({method:'GET',path,resolve,reject}));
    }
    export function post(path,body){
      const m=window.__techMock;
      m.calls.push({method:'POST',path,body});
      return new Promise((resolve,reject)=>m.pending.push({method:'POST',path,body,resolve,reject}));
    }
  `,
  '../ui.tsx':`
    import {createContext,useContext} from 'react';
    export const TestContext=createContext({me:null});
    export const useMe=()=>useContext(TestContext);
    export function Back({to}){return <a href={'#/'+to}>Назад</a>}
  `,
  './web/src/ui.tsx':`
    import {createContext,useContext} from 'react';
    export const TestContext=createContext({me:null});
    export const useMe=()=>useContext(TestContext);
    export function Back({to}){return <a href={'#/'+to}>Назад</a>}
  `,
};
const bundle=await build({
  stdin:{
    contents:`
      import React,{useState} from 'react';
      import {createRoot} from 'react-dom/client';
      import {TestContext} from './web/src/ui.tsx';
      import {TechBase} from './web/src/screens/techbase.tsx';
      import {RepairCases,TechnicalCasesReview} from './web/src/screens/technicalCases.tsx';
      window.__techMock={calls:[],pending:[]};
      function App(){
        const [view,setView]=useState('techbase');
        const [initial,setInitial]=useState('');window.__setTechInitial=setInitial;
        const [me,setMe]=useState({id:'owner-A',roles:['client'],performer:null});
        window.__setTechView=setView;window.__setTechMe=setMe;
        return <TestContext.Provider value={{me}}>
          {view==='techbase'?<TechBase audience="driver" initialVehicleId={initial}/>:
            view==='repair'?<RepairCases/>:<TechnicalCasesReview/>}
        </TestContext.Provider>;
      }
      createRoot(document.getElementById('root')).render(<App/>);
    `,
    resolveDir:process.cwd(),sourcefile:'techbase-repair-entry.tsx',loader:'tsx',
  },
  bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',
  plugins:[{
    name:'isolate-techbase-requests',
    setup(b){
      b.onResolve({filter:/./},args=>{
        // Reuse ONE React Context instance across entry + both real screens.
        if(args.path==='../ui.tsx'||args.path==='./web/src/ui.tsx')
          return {path:'shared-ui',namespace:'tech-stub'};
        if(Object.hasOwn(stubs,args.path))return {path:args.path,namespace:'tech-stub'};
      });
      b.onLoad({filter:/./,namespace:'tech-stub'},args=>({
        resolveDir:process.cwd(),
        contents:args.path==='shared-ui'?stubs['../ui.tsx']:stubs[args.path],
        loader:args.path==='shared-ui'||args.path.endsWith('.tsx')?'tsx':'js',
      }));
    },
  }],
});

const browser=await chromium.launch();
const ensure=(ok,msg)=>{if(!ok)throw Error(msg)};
const doc=(title,make)=>({
  id:title,title,audience:'driver',kind:'truck',vehicleMake:make,
  models:[],componentMake:null,system:'Электрика',type:'maintenance',
  language:'ru',source:'Synthetic local CI',url:'https://example.org/manual',
  access:'open',applicability:'brand',warning:'Сверьте применимость',reviewedOn:'2026-01-01',
});
const caseFile=(id,make)=>({
  id,make,model:'R450',production_year:2021,ecu:'EBS',code:'123',
  symptoms:'Неисправен тестовый агрегат в синтетическом кейсе',
  checks_performed:'Проверена синтетическая цепь без реального грузовика',
  verified_fix:'В тестовом примере выполнена замена компонента',
  provenance_note:'Только синтетический CI',created_at:'2026-01-01',
});
try{
  const page=await browser.newPage({viewport:{width:390,height:844},locale:'ru-RU'});
  const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.setContent('<!doctype html><html lang="ru"><body><div id="root"></div></body></html>');
  await page.addScriptTag({content:bundle.outputFiles[0].text});
  const pending=async(method,path,count)=>{
    await page.waitForFunction(({method,path,count})=>
      window.__techMock.pending.filter(p=>p.method===method&&p.path===path).length>=count,
      {method,path,count});
  };
  const settle=async(method,path,index,kind,value)=>{
    await page.evaluate(({method,path,index,kind,value})=>{
      const x=window.__techMock.pending.filter(p=>p.method===method&&p.path===path)[index];
      if(!x)throw Error('Missing synthetic request '+method+' '+path+' #'+index);
      x[kind](kind==='reject'?new Error(value):value);
    },{method,path,index,kind,value});
  };
  const catalog='/api/techbase?audience=driver';
  const garage='/api/vehicles';
  await pending('GET',catalog,1);await pending('GET',garage,1);
  await settle('GET',catalog,0,'reject','offline catalog');
  await settle('GET',garage,0,'reject','offline garage');
  await page.getByRole('button',{name:'Повторить загрузку каталога'}).waitFor();
  await page.getByRole('button',{name:'Повторить загрузку гаража'}).waitFor();
  await page.getByRole('button',{name:'Повторить загрузку каталога'}).click();
  await page.getByRole('button',{name:'Повторить загрузку гаража'}).click();
  await pending('GET',catalog,2);await pending('GET',garage,2);
  await settle('GET',catalog,1,'resolve',{audiences:['driver'],documents:[doc('Документ владельца A','Scania')]});
  await settle('GET',garage,1,'resolve',[{id:'vehicle-A',brand:'Scania',model:'R450',year:2021,plate:'А111АА'}]);
  await page.getByRole('heading',{name:'Документ владельца A'}).waitFor();
  await page.getByRole('option',{name:/А111АА/}).waitFor({state:'attached'});
  await page.getByRole('combobox',{name:'Машина из моего гаража'}).selectOption('vehicle-A');
  ensure(await page.getByRole('combobox',{name:'Машина из моего гаража'}).inputValue()==='vehicle-A','Garage vehicle A cannot be selected');

  // A signed-in account change must clear old owner plates and old catalog
  // while the new authenticated reads are pending or have failed.
  await page.evaluate(()=>window.__setTechMe({id:'owner-B',roles:['client'],performer:null}));
  await pending('GET',catalog,3);await pending('GET',garage,3);
  ensure(await page.getByRole('option',{name:/А111АА/}).count()===0,
    'Previous owner garage plate leaked into next account');
  ensure(await page.getByRole('heading',{name:'Документ владельца A'}).count()===0,
    'Previous account catalog remained visible during refresh');
  await settle('GET',catalog,2,'reject','offline after switch');
  await settle('GET',garage,2,'reject','offline after switch');
  await page.getByRole('button',{name:'Повторить загрузку гаража'}).click();
  await page.getByRole('button',{name:'Повторить загрузку каталога'}).click();
  await pending('GET',catalog,4);await pending('GET',garage,4);
  await settle('GET',catalog,3,'resolve',{audiences:['driver'],documents:[doc('Документ владельца B','DAF')]});
  await settle('GET',garage,3,'resolve',[{id:'vehicle-B',brand:'DAF',model:'XF',year:2020,plate:'В222ВВ'}]);
  await page.getByRole('heading',{name:'Документ владельца B'}).waitFor();
  await page.getByRole('option',{name:/В222ВВ/}).waitFor({state:'attached'});
  await page.getByRole('combobox',{name:'Машина из моего гаража'}).selectOption('vehicle-B');
  ensure(await page.getByRole('combobox',{name:'Машина из моего гаража'}).inputValue()==='vehicle-B','Garage vehicle B cannot be selected');

  // A malformed or wrong-audience payload must not render a single document.
  await page.evaluate(()=>window.__setTechMe({id:'owner-C',roles:['client'],performer:null}));
  await pending('GET',catalog,5);await pending('GET',garage,5);
  await settle('GET',catalog,4,'resolve',{audiences:['driver'],documents:[{...doc('Wrong audience','Renault'),audience:'master'}]});
  await settle('GET',garage,4,'resolve',[{id:'vehicle-C',brand:'Рено',model:'Premium',year:2010}]);
  await page.getByRole('button',{name:'Повторить загрузку каталога'}).waitFor();
  ensure(await page.locator('.techbase-document').count()===0,'Wrong-audience catalog rendered');
  await page.getByRole('button',{name:'Повторить загрузку каталога'}).click();
  await pending('GET',catalog,6);
  await settle('GET',catalog,5,'resolve',{audiences:['driver'],documents:[
    {...doc('Premium manual','Renault'),models:['Premium']},
    {...doc('Renault C manual','Renault'),models:['C']},
    {...doc('Renault D manual','Renault'),models:['D']},
  ]});
  await page.getByRole('heading',{name:'Premium manual'}).waitFor();
  await page.getByRole('combobox',{name:'Машина из моего гаража'}).selectOption('vehicle-C');
  await page.waitForFunction(()=>document.querySelectorAll('.techbase-document').length===1);
  ensure(await page.getByRole('heading',{name:'Premium manual'}).count()===1,'Canonical Renault alias failed');
  ensure(await page.getByRole('heading',{name:'Renault C manual'}).count()===0,'Unrelated one-letter series rendered');

  // Real trailer deep link and manual selection must have identical filtering.
  await page.evaluate(()=>{window.__setTechMe({id:'owner-trailer',roles:['client'],performer:null});window.__setTechInitial('cool');});
  await pending('GET',catalog,7);await pending('GET',garage,6);
  const kroneDocs=[
    {...doc('KRONE general','KRONE'),kind:'trailer'},
    {...doc('Load Carrier manual','KRONE'),kind:'trailer',models:['Load Carrier'],applicability:'model'},
    {...doc('Load Carrier year limited','KRONE'),kind:'trailer',models:['Load Carrier'],applicability:'model',modelYearFrom:2020},
    {...doc('Same brand truck','KRONE'),kind:'truck'},
  ];
  await settle('GET',catalog,6,'resolve',{audiences:['driver'],documents:kroneDocs});
  await settle('GET',garage,5,'resolve',[
    {id:'cool',brand:'Кроне',model:'Cool Liner',year:2021,catalog_category:'trailer'},
    {id:'load',brand:'KRONE',model:'Load Carrier',year:null,catalog_category:'trailer'},
    {id:'prefix',brand:'KRONE',model:'Load Carrier X',year:2021,catalog_category:'trailer'}
  ]);
  await page.getByRole('heading',{name:'KRONE general'}).waitFor();
  ensure(await page.getByRole('combobox',{name:'Раздел техники'}).inputValue()==='trailer','Trailer deep link must select trailer category');
  ensure(await page.getByRole('heading',{name:'Load Carrier manual'}).count()===0,'Different trailer received model-specific document');
  ensure(await page.getByRole('heading',{name:'Same brand truck'}).count()===0,'Truck document leaked into trailer selection');
  await page.getByRole('combobox',{name:'Машина из моего гаража'}).selectOption('load');
  await page.getByRole('heading',{name:'Load Carrier manual'}).waitFor();
  ensure(await page.getByRole('heading',{name:'Load Carrier year limited'}).count()===0,'Unknown year passed restricted document');
  await page.getByRole('combobox',{name:'Машина из моего гаража'}).selectOption('prefix');
  await page.getByRole('heading',{name:'Load Carrier manual'}).waitFor({state:'detached'});
  await page.getByRole('combobox',{name:'Машина из моего гаража'}).selectOption('cool');
  ensure(await page.locator('.techbase-document').count()===1,'Manual trailer selection differs from deep link');
  await page.evaluate(()=>window.__setTechInitial('foreign'));
  await pending('GET',catalog,8);await pending('GET',garage,7);
  await settle('GET',catalog,7,'resolve',{audiences:['driver'],documents:kroneDocs});
  await settle('GET',garage,6,'resolve',[]);
  await page.getByText('Выбранный автомобиль не найден в вашем гараже.',{exact:false}).waitFor();
  ensure(await page.locator('.techbase-document').count()===0,'Foreign vehicle ID exposed unfiltered documents');

  // Real repair-cases component: two overlapping searches must not let an
  // older response replace the later explicitly requested search results.
  await page.evaluate(()=>{
    window.__setTechMe({id:'master-A',roles:['master'],
      performer:{verification:'approved'}});
    window.__setTechView('repair');
  });
  await pending('GET','/api/tech/repair-cases?q=',1);
  await page.getByRole('textbox',{name:'Поиск кейса'}).fill('Scania');
  // Simulate a re-entrant native form submit while an earlier GET is still
  // pending (a click is intentionally disabled by the pending state).
  await page.locator('form.compose').dispatchEvent('submit');
  await pending('GET','/api/tech/repair-cases?q=Scania',1);
  await settle('GET','/api/tech/repair-cases?q=Scania',0,'resolve',
    {items:[caseFile('case-new','Scania')]});
  await page.getByText('Scania R450',{exact:false}).first().waitFor();
  await settle('GET','/api/tech/repair-cases?q=',0,'resolve',
    {items:[caseFile('case-old','OldMake')]});
  ensure(await page.getByText('OldMake R450',{exact:false}).count()===0,
    'Late, stale repair search replaced the latest result');

  await page.evaluate(()=>window.__setTechMe({id:'master-B',roles:['master'],
    performer:{verification:'approved'}}));
  await pending('GET','/api/tech/repair-cases?q=',2);
  ensure(await page.getByText('Scania R450',{exact:false}).count()===0,
    'Private repair result leaked into another master account');
  await settle('GET','/api/tech/repair-cases?q=',1,'reject','offline');
  await page.getByRole('button',{name:'Повторить загрузку кейсов'}).click();
  await pending('GET','/api/tech/repair-cases?q=',3);
  await settle('GET','/api/tech/repair-cases?q=',2,'resolve',{items:[]});
  await page.getByText('Проверенных случаев по запросу пока нет.').waitFor();

  // Submit errors keep typed specialist knowledge; successful retry hides
  // the pending draft without publishing it to the approved catalog.
  await page.getByRole('button',{name:'Добавить случай ремонта'}).click();
  await page.getByRole('textbox',{name:'Марка',exact:true}).fill('DAF');
  await page.getByRole('textbox',{name:'Симптомы'}).fill('Синтетические симптомы, записанные специалистом');
  await page.getByRole('textbox',{name:'Проверки'}).fill('Проведена проверка синтетического электроблока');
  await page.getByRole('textbox',{name:'Результат'}).fill('Тестовая замена детали устранила синтетическую ошибку');
  await page.getByRole('button',{name:'Отправить на проверку'}).click();
  await pending('POST','/api/tech/repair-cases',1);
  await settle('POST','/api/tech/repair-cases',0,'reject','offline POST');
  await page.getByRole('button',{name:'Повторить загрузку кейсов'}).waitFor();
  ensure((await page.getByRole('textbox',{name:'Симптомы'}).inputValue()).includes('Синтетические'),
    'Failed submission erased technical draft');
  await page.getByRole('button',{name:'Отправить на проверку'}).click();
  await pending('POST','/api/tech/repair-cases',2);
  await settle('POST','/api/tech/repair-cases',1,'resolve',{id:'new-case',reviewState:'pending',published:false});
  await page.getByText(/Кейс отправлен на техническую проверку/).waitFor();

  // The moderation queue belongs to ADMIN, not the current specialist.
  await page.evaluate(()=>{
    window.__setTechMe({id:'admin-A',roles:['admin'],performer:null});
    window.__setTechView('review');
  });
  const reviewPath='/api/admin/tech/repair-cases';
  await pending('GET',reviewPath,1);
  await settle('GET',reviewPath,0,'reject','offline admin');
  await page.getByRole('button',{name:'Повторить загрузку очереди'}).click();
  await pending('GET',reviewPath,2);
  await settle('GET',reviewPath,1,'resolve',{items:[caseFile('123','Iveco')]});
  await page.getByText('Iveco R450',{exact:false}).first().waitFor();
  const approve=page.getByRole('button',{name:'Одобрить'});
  ensure(await approve.isDisabled(),'Admin approved a case without review notes');
  await page.getByRole('textbox',{name:'Основание проверки 123'})
    .fill('Документы проверены, пример подтверждён.');
  await approve.click();
  const action='/api/admin/tech/repair-cases/123/review';
  await pending('POST',action,1);
  await settle('POST',action,0,'resolve',{id:'123',review_state:'approved'});
  await pending('GET',reviewPath,3);
  await settle('GET',reviewPath,2,'resolve',{items:[]});
  await page.getByText('Кейс одобрен после проверки.').waitFor();
  ensure(await page.getByText('Iveco R450',{exact:false}).count()===0,
    'Reviewed case remained in pending queue');

  await page.evaluate(()=>window.__setTechMe({id:'master-C',roles:['master'],
    performer:{verification:'approved'}}));
  await page.getByText('Проверка и публикация кейсов доступны только администратору.').waitFor();
  ensure(await page.getByRole('button',{name:'Одобрить'}).count()===0,
    'Non-admin retained review controls after account switch');

  ensure(errors.length===0,'React/browser errors: '+errors.join('; '));
  console.log('PASS: TechBase recovery, garage isolation, repair search races, draft retry and admin review ACL');
}finally{await browser.close();}
