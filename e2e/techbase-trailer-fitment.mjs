// #272: actual TechBase React UI, deterministic local reads, no external sources.
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {chromium} from 'playwright';
const bundle=await build({
 stdin:{resolveDir:process.cwd(),sourcefile:'techbase-trailer-entry.tsx',loader:'tsx',contents:`
  import {useState} from 'react';
  import {createRoot} from 'react-dom/client';
  import {TestContext} from './web/src/ui.tsx';
  import {TechBase} from './web/src/screens/techbase.tsx';
  window.__tech={calls:[],pending:[]};
  function App(){
   const [id,setId]=useState('owner-A'),[vehicle,setVehicle]=useState('cool');
   window.__techSwitch=(account,vehicleId)=>{setId(account);setVehicle(vehicleId);};
   return <TestContext.Provider value={{me:{id,roles:['client']}}}>
    <TechBase audience="driver" initialVehicleId={vehicle}/>
   </TestContext.Provider>;
  }
  createRoot(document.getElementById('root')).render(<App/>);
 `},
 bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',
 plugins:[{name:'isolated-transport',setup(b){
  b.onResolve({filter:/./},a=>{
   if(a.path==='../ui.tsx'||a.path==='./web/src/ui.tsx')return {path:'ui',namespace:'stub'};
   if(a.path==='../api.ts')return {path:'api',namespace:'stub'};
   // The illustrated professional screen is not a driver fixture.
   if(a.path==='./TechBaseIllustrated.tsx')return {path:'illustrated',namespace:'stub'};
  });
  b.onLoad({filter:/./,namespace:'stub'},a=>({resolveDir:process.cwd(),loader:'tsx',contents:{
   ui:`import {createContext,useContext} from 'react';export const TestContext=createContext({me:null});export const useMe=()=>useContext(TestContext);`,
   api:`export class ApiError extends Error{constructor(status,code,message){super(message);this.status=status;this.code=code;}}
    export function get(path){window.__tech.calls.push(path);
      if(path.startsWith('/api/vehicle-reference/tips'))return Promise.resolve({items:[],version:'fixture'});
      return new Promise((resolve,reject)=>window.__tech.pending.push({path,resolve,reject}));}`,
   illustrated:`export function TechBaseIllustrated(){return <div>PROFESSIONAL ONLY</div>}`
  }[a.path]}));
 }}]
});
const doc=(id,make,kind,models,applicability='model',extra={})=>({
 id,title:id,audience:'driver',kind,vehicleMake:make,models,applicability,componentMake:null,
 system:'Эксплуатация',type:'operation',language:'ru',source:'Synthetic local test',
 url:'https://example.org/reference',access:'open',warning:'Сверьте применимость',reviewedOn:'2026-11-25',...extra
});
const docs=[
 doc('Load Carrier exact','KRONE','trailer',['Load Carrier']),
 doc('Cool Liner exact','KRONE','trailer',['Cool Liner']),
 doc('Cool Liner year restricted','KRONE','trailer',['Cool Liner'],'model',{modelYearFrom:2020}),
 doc('KRONE general','KRONE','trailer',[],'brand'),
 doc('Unrelated truck','KRONE','truck',['Cool Liner']),
 doc('Wrong prefix','KRONE','trailer',['Cool']),
 doc('Unknown component',null,'component',[],'component'),
 doc('Scania manufacturer','Scania','truck',[],'brand')
];
const garage=[
 {id:'cool',brand:'Кроне',model:'Cool Liner',year:2022,catalog_category:'trailer',plate:'TEST-A'},
 {id:'load',brand:'KRONE',model:'Load Carrier',year:2022,catalog_category:'trailer'},
 {id:'unknown',brand:'KRONE',model:null,catalog_category:'trailer'},
 {id:'unknown-year',brand:'KRONE',model:'Cool Liner',catalog_category:'trailer'},
 {id:'truck',brand:'Scania',model:'R450',year:2022}
];
const browser=await chromium.launch();
try{
 for(const width of [390,1440]){
  const page=await browser.newPage({viewport:{width,height:900}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.setContent('<html lang="ru"><body><div id="root"></div></body></html>');
  await page.addScriptTag({content:bundle.outputFiles[0].text});
  const path='/api/techbase?audience=driver',g='/api/vehicles';
  const wait=(path,n)=>page.waitForFunction(({path,n})=>window.__tech.pending.filter(p=>p.path===path).length>=n,{path,n});
  const answer=(path,i,data,fail=false)=>page.evaluate(({path,i,data,fail})=>{
   const r=window.__tech.pending.filter(p=>p.path===path)[i];if(fail)r.reject(Error(data));else r.resolve(data);
  },{path,i,data,fail});
  const expectDoc=async(id,visible=true)=>assert.equal(await page.getByRole('heading',{name:id,exact:true}).count(),visible?1:0,id);
  const kind=page.getByRole('combobox',{name:'Раздел техники'});
  const chooser=page.getByRole('combobox',{name:'Машина из моего гаража'});
  await wait(path,1);await wait(g,1);
  await answer(path,0,{audiences:['driver'],documents:docs});
  await page.getByText('Ожидаем данные выбранного автомобиля.').waitFor();
  await expectDoc('Load Carrier exact',false);
  await answer(g,0,garage);
  await page.getByRole('heading',{name:'Cool Liner exact'}).waitFor();
  assert.equal(await kind.inputValue(),'trailer');
  await expectDoc('KRONE general');await expectDoc('Cool Liner year restricted');
  for(const name of ['Load Carrier exact','Wrong prefix','Unrelated truck','Unknown component'])await expectDoc(name,false);
  await chooser.selectOption('load');
  await page.getByRole('heading',{name:'Load Carrier exact'}).waitFor();
  await expectDoc('Cool Liner exact',false);
  await chooser.selectOption('unknown');
  await expectDoc('Load Carrier exact',false);await expectDoc('KRONE general');
  await chooser.selectOption('unknown-year');
  await expectDoc('Cool Liner exact');await expectDoc('Cool Liner year restricted',false);
  await chooser.selectOption('truck');
  assert.equal(await kind.inputValue(),'truck');await expectDoc('Scania manufacturer');
  await chooser.selectOption('cool');
  await expectDoc('Cool Liner exact');assert.equal(await kind.inputValue(),'trailer');
  // Account changes must retire both the old selected vehicle and its references.
  await page.evaluate(()=>window.__techSwitch('owner-B','cool'));
  await wait(path,2);await wait(g,2);
  await expectDoc('Cool Liner exact',false);
  await answer(path,1,{audiences:['driver'],documents:docs});
  await answer(g,1,'offline garage',true);
  await page.getByRole('button',{name:'Повторить загрузку гаража'}).click();
  await wait(g,3);await answer(g,2,[]);
  await page.getByText('Выбранный автомобиль не найден в вашем гараже.').waitFor();
  await expectDoc('KRONE general',false);
  assert.equal(await page.getByRole('region',{name:'Дополнительные проверенные источники'}).count(),0);
  await page.getByRole('button',{name:'Перейти к ручному поиску'}).click();
  await page.getByRole('heading',{name:'KRONE general'}).waitFor();
  assert.equal(await page.getByText('PROFESSIONAL ONLY').count(),0);
  assert.deepEqual(errors,[]);
  await page.close();
 }
 console.log('PASS TechBase exact trailer model, category, missing year, account/deep link isolation');
}finally{await browser.close();}
