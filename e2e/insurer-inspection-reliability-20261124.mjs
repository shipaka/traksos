// Partner account isolation regression. Actual React UI with controlled synthetic API.
import {build} from 'esbuild';
import {chromium} from 'playwright';
const ui=`
import {createContext,useContext,useState} from 'react';
export const C=createContext({me:null,mode:'insurer',route:[]});
export const useMe=()=>useContext(C);
export const useRoute=()=>useContext(C).route;
export const useAction=()=>{const [busy,setBusy]=useState(false);
  return {busy,run:async(fn)=>{setBusy(true);try{return await fn();}
  catch{return undefined;}finally{setBusy(false);}}};};
`;
const api=`
function request(method,path,body){
  const mock=window.__partnerMock;
  const record={method,path,body};
  mock.calls.push(record);
  return new Promise((resolve,reject)=>mock.pending.push({...record,resolve,reject}));
}
export const get=path=>request('GET',path);
export const patch=(path,body)=>request('PATCH',path,body);
export const fmtTime=x=>String(x);
export function onEvent(fn){
  window.__partnerMock.subscribers.push(fn);
  return ()=>{window.__partnerMock.subscribers=window.__partnerMock.subscribers.filter(x=>x!==fn);}
}
`;
const bundle=await build({
  stdin:{contents:`
    import React,{useState} from 'react';
    import {createRoot} from 'react-dom/client';
    import {C} from './web/src/ui.tsx';
    import {InsurerCabinet,InsurerChats} from './web/src/screens/insurer.tsx';
    window.__partnerMock={calls:[],pending:[],subscribers:[]};
    function App(){
      const [me,setMe]=useState({id:'insurer-A',roles:['insurer']});
      const [mode,setMode]=useState('insurer');
      const [route,setRoute]=useState(['insurance']);
      const [view,setView]=useState('chat');
      Object.assign(window,{__partnerSetMe:setMe,__partnerSetMode:setMode,
        __partnerSetRoute:setRoute,__partnerSetView:setView});
      return <C.Provider value={{me,mode,route}}>
        {view==='chat'?<InsurerChats/>:<InsurerCabinet inspectionOnly={view==='inspection'}/>}
      </C.Provider>;
    }
    createRoot(document.getElementById('root')).render(<App/>);
  `,resolveDir:process.cwd(),sourcefile:'insurer-reliability-entry.tsx',loader:'tsx'},
  bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',
  plugins:[{name:'synthetic-api',setup(b){
    b.onResolve({filter:/./},a=>{
      if(a.path==='../ui.tsx'||a.path==='./web/src/ui.tsx')
        return {path:'ui',namespace:'stub'};
      if(a.path==='../api.ts')return {path:'api',namespace:'stub'};
    });
    b.onLoad({filter:/./,namespace:'stub'},a=>({
      resolveDir:process.cwd(),
      contents:a.path==='ui'?ui:api,loader:a.path==='ui'?'tsx':'js'
    }));
  }}],
});
const assertion=(ok,label)=>{if(!ok)throw Error(label);};
const caseRow=(id,brand)=>({id,brand,model:'CI',plate:'CI-000',
  status:'sent_to_partner',insurance_stage:'received',created_at:'2026-01-01'});
const visit=(id,plate)=>({id,kind:'inspection',status:'sent_to_partner',
  brand:'DAF',model:'XF',plate,year:2022,created_at:'2026-01-01'});
const inspectionPage=(items=[],active=items.length,history=0,page=1)=>({items,active,history,page,pageSize:30});
const finance=amount=>({entries:[],totals:[
  {kind:'insurance',accrued:amount,paid:'0',balance:amount},
  {kind:'inspection',accrued:'0',paid:'0',balance:'0'}]});
const browser=await chromium.launch();
try{
  const page=await browser.newPage({viewport:{width:390,height:844}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.setContent('<!doctype html><html lang="ru"><body><div id="root"></div></body></html>');
  await page.addScriptTag({content:bundle.outputFiles[0].text});
  const Q='/api/insurer/requests',V='/api/insurer/inspections/page?view=active&page=1',D='/api/insurer/inspections/same-case',F='/api/insurer/finance';
  const n=(path,method='GET')=>page.evaluate(({path,method})=>
    window.__partnerMock.pending.filter(x=>x.path===path&&x.method===method).length,{path,method});
  const wait=(path,count,method='GET')=>page.waitForFunction(({path,count,method})=>
    window.__partnerMock.pending.filter(x=>x.path===path&&x.method===method).length>=count,
    {path,count,method});
  const finish=(path,index,outcome,data,method='GET')=>page.evaluate(
    ({path,index,outcome,data,method})=>{
      const x=window.__partnerMock.pending.filter(x=>x.path===path&&x.method===method)[index];
      if(!x)throw Error('missing '+path+' '+index);
      x[outcome](outcome==='reject'?Error(data):data);
    },{path,index,outcome,data,method});

  await wait(Q,1);await finish(Q,0,'resolve',[caseRow('one','PRIVATE-INSURER-A')]);
  await page.getByText(/PRIVATE-INSURER-A/).waitFor();
  await page.evaluate(()=>window.__partnerSetMe({id:'insurer-B',roles:['insurer']}));
  await wait(Q,2);
  assertion(await page.getByText(/PRIVATE-INSURER-A/).count()===0,
    'Old insurer chat remained after sign in');
  await finish(Q,1,'reject','offline');
  await page.getByRole('button',{name:'Повторить загрузку чатов'}).click();
  await wait(Q,3);await finish(Q,2,'resolve',[caseRow('two','INSURER-B')]);
  await page.getByText(/INSURER-B/).waitFor();

  const q=await n(Q),v=await n(V),f=await n(F);
  await page.evaluate(()=>window.__partnerSetView('cabinet'));
  await wait(Q,q+1);await wait(V,v+1);await wait(F,f+1);
  await finish(Q,q,'resolve',[caseRow('two','INSURER-B')]);
  await finish(V,v,'resolve',inspectionPage([visit('inspect-B','B-PLATE')]));
  await finish(F,f,'resolve',finance('123456'));
  await page.getByRole('button',{name:'Финансы'}).click();
  await page.getByText(/1\s*234,56\s*₽/).first().waitFor();
  const q1=await n(Q),v1=await n(V),f1=await n(F);
  await page.evaluate(()=>window.__partnerSetMe({id:'insurer-C',roles:['insurer']}));
  await wait(Q,q1+1);await wait(V,v1+1);await wait(F,f1+1);
  await page.getByRole('button',{name:'Финансы'}).click();
  assertion(await page.getByText(/1\s*234,56\s*₽/).count()===0,
    'Private financial balance survived account switch');
  await finish(F,f1,'reject','offline finance');
  await page.getByRole('button',{name:'Повторить загрузку финансов'}).click();
  await wait(F,f1+2);
  await finish(F,f1+1,'resolve',finance('2500'));
  await page.getByText(/25,00\s*₽/).first().waitFor();
  await finish(Q,q1,'resolve',[caseRow('three','INSURER-C')]);
  await finish(V,v1,'resolve',inspectionPage());

  const oldV=await n(V),oldF=await n(F);
  await page.evaluate(()=>{
    window.__partnerSetMe({id:'inspector-A',roles:['inspection_operator']});
    window.__partnerSetMode('inspection');
    window.__partnerSetRoute(['inspections','same-case']);
    window.__partnerSetView('inspection');
  });
  await wait(V,oldV+1);await wait(F,oldF+1);await wait(D,1);
  await finish(V,oldV,'resolve',inspectionPage());
  // The direct link must work even when the case is absent from the queue page.
  await finish(D,0,'resolve',visit('same-case','SECRET-INSPECT-A'));
  await finish(F,oldF,'resolve',finance('0'));
  await page.getByRole('heading',{name:'Техосмотр №same-case'}).waitFor();
  const complete=page.getByRole('button',{name:'Внести результат техосмотра'});
  assertion(await complete.isDisabled(),'Unchecked inspection can be completed');
  for(const label of ['Проверка документов','Осмотр транспортного средства','Результат проверки'])
    await page.getByRole('checkbox',{name:label}).check();
  await page.getByRole('textbox',{name:'Комментарий / результат осмотра'})
    .fill('Выполнены синтетические проверки оператора A');
  assertion(!await complete.isDisabled(),'Fully verified inspection cannot be submitted');

  const oldV2=await n(V);
  await page.evaluate(()=>window.__partnerSetMe({id:'inspector-B',roles:['inspection_operator']}));
  await wait(V,oldV2+1);await wait(D,2);
  assertion(await page.getByText('SECRET-INSPECT-A').count()===0,
    'Other inspector details visible after account switch');
  await finish(V,oldV2,'resolve',inspectionPage());
  await finish(D,1,'resolve',visit('same-case','INSPECT-B'));
  await page.getByRole('heading',{name:'Техосмотр №same-case'}).waitFor();
  assertion(await complete.isDisabled(),'Old inspector ticks authorised a new account');
  await page.getByRole('textbox',{name:'Комментарий / результат осмотра'})
    .fill('Выполнены проверки реальным оператором B в синтетическом тесте');
  for(const label of ['Проверка документов','Осмотр транспортного средства','Результат проверки'])
    await page.getByRole('checkbox',{name:label}).check();
  await complete.click();
  const patch='/api/insurer/inspections/same-case';
  await wait(patch,1,'PATCH');
  const body=await page.evaluate(path=>window.__partnerMock.calls.find(x=>
    x.method==='PATCH'&&x.path===path)?.body,patch);
  assertion(body?.status==='completed'&&body.note.includes('оператором B'),
    'Unexpected inspection decision or previous user comment');
  // The server may have accepted the mutation even though its response was lost.
  await finish(patch,0,'reject','lost acknowledgement','PATCH');
  const acknowledge=page.getByRole('button',{name:'Состояние проверено'});
  const refresh=page.getByRole('button',{name:'Обновить очередь для сверки'});
  await acknowledge.waitFor();
  assertion(await acknowledge.isDisabled(),'Stale detail allowed acknowledgement');
  assertion(await complete.isDisabled(),'Lost response allowed duplicate completion');
  await refresh.click();
  await wait(D,3);
  assertion(await acknowledge.isDisabled(),'Pending read allowed acknowledgement');
  await finish(D,2,'reject','offline during review');
  await page.getByText(/Не удалось сверить заявку/).waitFor();
  assertion(await acknowledge.isDisabled(),'Failed read allowed acknowledgement');
  await refresh.click();await wait(D,4);
  await finish(D,3,'resolve',{...visit('same-case','INSPECT-B'),status:'completed'});
  await page.getByText('Текущий статус: Завершена').waitFor();
  assertion(!await acknowledge.isDisabled(),'Fresh exact case status cannot be acknowledged');
  await acknowledge.click();
  await wait(V,oldV2+2);await wait(D,5);
  await finish(V,oldV2+1,'resolve',inspectionPage([],0,1));
  await finish(D,4,'resolve',{...visit('same-case','INSPECT-B'),status:'completed'});
  await page.getByText('Заявка завершена').waitFor();
  assertion(await n(patch,'PATCH')===1,'Review automatically resent the mutation');
  assertion(errors.length===0,'React exceptions: '+errors.join('; '));
  console.log('PASS: insurer finance/queues/chat isolation and actual inspector checklist');
}finally{await browser.close();}
