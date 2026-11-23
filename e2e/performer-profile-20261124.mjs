
import { build } from 'esbuild';
import { chromium } from 'playwright';
// The exact production React screens are bundled, only external IO/notifications
// are stubbed. No SMS, real payments or privileged production accounts.
const stubs={"../api.ts":"export function get(path){return Promise.resolve({path});}\nexport function put(path,body){window.__saves.push({path,body});return Promise.resolve({ok:true});}\nexport function post(path,body){window.__saves.push({path,body});return Promise.resolve({id:'ticket-1'});}\nexport const rub=v=>String(v??0)+' ₽';\nexport const fmtTime=v=>String(v??'');\nexport const fmtPhone=v=>String(v??'');","../dict.ts":"export const BRANDS=['Scania','MAN','Прочие'];\nexport const BRAND_LEVELS=[{id:'good',name:'Хорошо'}];\nexport const SERVICES={};\nexport const FEE_PURPOSE='Агентский договор';","../ui.tsx":"export function useMe(){return {me:window.__mockMe,reload:async()=>{window.__reloads++;}};}\nexport function useAction(){return {busy:false,run:async(fn)=>fn()};}\nexport function useLoad(){return window.__loadError ? {data:null,error:'Сеть недоступна',reload:async()=>{}} : {data:{tiers:{eco:{callOut:100000,hour:100000}}},error:null,reload:async()=>{}};}\nexport function Field({label,children,hint}){return <label>{label}{children}{hint&&<small>{hint}</small>}</label>;}\nexport function RubInput({value,onChange,placeholder}){return <input type='number' value={value??''} placeholder={placeholder||''} onChange={e=>onChange(e.target.value===''?null:Number(e.target.value))}/>;}\nexport function Back(){return <a href='#/work/me'>Назад</a>;}\nexport function Loading({error}){return <p role='status'>{error||'Загрузка'}</p>;}\nexport function go(path){window.__goto=path;}"};
const bundle=await build({
 stdin:{contents:"import React from 'react';\nimport {createRoot} from 'react-dom/client';\nimport {ScheduleSection,PhoneSection,MoneySection,FilterSection,CarsSection} from './web/src/screens/performerCabinet.tsx';\nconst root=createRoot(document.getElementById('root'));\nwindow.__saves=[];window.__reloads=0;\nconst schedule=(from,to,phoneTo)=>({on:true,days:{mon:true,tue:true,wed:true,thu:true,fri:true,sat:false,sun:false},from,to,phoneTo});\nwindow.__users={\n first:{id:'master-1',phone:'+79991234567',roles:['master'],name:'Мастер первый',performer:{kind:'master',specialties:['electric'],brands:{Scania:'good'},schedule:schedule('09:00','10:00','11:00'),cars:[{brand:'Scania',plate:'А111АА'}],car:{brand:'Scania',plate:'А111АА'},extras:{weekendPct:20}}},\n second:{id:'master-2',phone:'+79997654321',roles:['master'],name:'Мастер второй',performer:{kind:'master',specialties:['diag'],brands:{MAN:'good'},schedule:schedule('08:00','09:30','10:00'),cars:[{brand:'MAN',plate:'В222ВВ'}],car:{brand:'MAN',plate:'В222ВВ'},extras:{weekendPct:0}}}\n};\nwindow.__renderScreen=(name,user='first')=>{\n window.__mockMe=window.__users[user];\n const component={ScheduleSection,PhoneSection,MoneySection,FilterSection,CarsSection}[name];\n root.render(React.createElement(component));\n};\nwindow.__renderScreen('ScheduleSection');",resolveDir:process.cwd(),sourcefile:'performer-profile-test-entry.tsx',loader:'tsx'},
 bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',
 plugins:[{name:'isolate-network',setup(b){
   b.onResolve({filter:/./},args=>{
     if(Object.hasOwn(stubs,args.path))return {path:args.path,namespace:'performer-stub'};
   });
   b.onLoad({filter:/./,namespace:'performer-stub'},args=>({
     contents:stubs[args.path],loader:args.path.endsWith('.tsx')?'tsx':'js'
   }));
 }}]
});
const source=bundle.outputFiles.find(f=>f.path.endsWith('.js'))?.text;
if(!source)throw Error('Bundled performer screen missing');
const browser=await chromium.launch();
const check=(value,message)=>{if(!value)throw Error(message)};
try{
 const page=await browser.newPage({viewport:{width:1440,height:900},locale:'ru-RU'});
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.setContent('<!doctype html><html lang="ru"><body><div id="root"></div></body></html>');
 await page.addScriptTag({content:source});
 const render=async(name,user='first')=>{
   await page.evaluate(([n,u])=>window.__renderScreen(n,u),[name,user]);
   const heading={
     ScheduleSection:'Распорядок',PhoneSection:'Телефон и вход',
     MoneySection:'Финансы',FilterSection:'Настройки заявок',CarsSection:'Машины'
   }[name];
   await page.getByRole('heading',{name:heading,exact:true}).waitFor();
 };
 await page.getByRole('heading',{name:'Распорядок'}).waitFor();
 const start=page.getByLabel('Начало выездов');
 const end=page.getByLabel('Конец выездов');
 const phone=page.getByLabel('На телефоне до');
 check(await start.inputValue()==='09:00','Wrong initial schedule');
 await start.selectOption('11:00');
 check(await end.inputValue()==='11:30','Start change did not move end after start');
 check(await phone.inputValue()==='11:30','Start change left invalid phone time');
 check(!(await end.locator('option').allTextContents()).includes('11:00'),
   'End selector wrongly permits same time as start');
 await end.selectOption('12:30');
 check(await phone.inputValue()==='12:30','End change did not adjust phone time');
 check(!(await start.locator('option').allTextContents()).includes('23:30'),
   'Start selector permits an impossible final slot');
 await page.getByRole('button',{name:'Сохранить',exact:true}).click();
 const saved=await page.evaluate(()=>window.__saves.at(-1));
 check(saved.path==='/api/performer/schedule','Wrong schedule API');
 check(saved.body.from==='11:00'&&saved.body.to==='12:30'&&saved.body.phoneTo==='12:30',
   'Invalid saved schedule');
 await render('ScheduleSection','second');
 await page.waitForFunction(()=>document.querySelector('select.field')?.value==='08:00');
 check(await start.inputValue()==='08:00','Schedule draft leaked between users');

 await render('PhoneSection','second');
 check((await page.locator('main').innerText()).includes('по этому номеру и паролю, без SMS'),
   'Password login instructions still incorrectly promise SMS sign-in');

 await page.evaluate(()=>{window.__loadError=true;});
 await render('MoneySection','second');
 check(await page.getByText('Сеть недоступна').count()>0,
   'Finance error hidden as a successful zero balance');
 await page.evaluate(()=>{window.__loadError=false;});
 await render('FilterSection','first');
 await page.getByRole('button',{name:'Цены',exact:true}).click();
 check(await page.getByText(/Коридор площадки: 1 500–7 000/).count()===0,
   'Unverified fixed pricing advertised');
 const weekend=page.getByLabel('Выходные, %');
 await weekend.fill('101');
 check(await page.getByRole('alert').count()===1,'Over-100% rate not flagged');
 check(await page.getByRole('button',{name:'Сохранить всё'}).isDisabled(),
   'Invalid rate allowed to reach server');
 await weekend.fill('50');
 check(await page.getByRole('alert').count()===0,'Valid 50% incorrectly rejected');
 check(await page.getByRole('button',{name:'Сохранить всё'}).isEnabled(),
   'Valid edited rate cannot be saved');

 await render('FilterSection','second');
 await page.locator('details.profile-accordion summary').first().click();
 await page.waitForFunction(()=>Array.from(document.querySelectorAll('label.profile-brand-check'))
   .some(el=>el.textContent?.includes('Диагностика')&&el.querySelector('input')?.checked));
 check(await page.getByLabel('Диагностика').isChecked(),'Specialties leaked between accounts');
 await render('CarsSection','first');
 await page.getByText('А111АА').waitFor();
 check(await page.getByText('А111АА').count()===1,'First car missing');
 await render('CarsSection','second');
 await page.getByText('В222ВВ').waitFor();
 check(await page.getByText('В222ВВ').count()===1,'Second car missing');
 check(await page.getByText('А111АА').count()===0,'Old car shown to new account');
 check(errors.length===0,'Browser error: '+errors.join('; '));
 console.log('PASS: real performer React schedule, session isolation, money errors, pricing form guards');
} finally { await browser.close(); }
