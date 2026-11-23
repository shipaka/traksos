// PR #274: real React/Chromium regression of approved role-scoped onboarding and
// simulated courier training. Only UI is bundled; network/API and live orders are
// never used. No production accounts, payments, or notifications.
import { build } from 'esbuild';
import { chromium } from 'playwright';

const uiStub = `
  import React from 'react';
  export function useMe(){return React.useContext(window.__trainingContext);}
  export function Back({to='',label='Назад'}){return <a href={'#/'+to}>← {label}</a>;}
`;
const bundle=await build({
  stdin:{contents:`
    import React,{createRoot} from 'react';
    import {IntroInvitation,PlatformIntro} from './web/src/screens/platformIntro.tsx';
    import {ScenarioEncyclopedia,ScenarioLesson} from './web/src/screens/scenarioEncyclopedia.tsx';
    import {allowedScenario} from './web/src/screens/scenarioLibrary.ts';
    window.__trainingContext=React.createContext(null);
    window.__recommended=(role,id,index)=>allowedScenario(role,id)?.steps[index].choices.find(x=>x.recommended)?.label;
    function App(){
      const [current,setCurrent]=React.useState({
        userId:'CI-A',mode:'admin',roles:['admin'],page:'intro',caseId:'app-not-working'
      });
      window.__setTraining=(patch)=>setCurrent(old=>({...old,...patch}));
      const me={id:current.userId,roles:current.roles,owner_id:null};
      return React.createElement(window.__trainingContext.Provider,{
        value:{me,mode:current.mode}
      },current.page==='intro'
        ? <><IntroInvitation userId={me.id} mode={current.mode} roles={me.roles}/><PlatformIntro/></>
        : <><ScenarioEncyclopedia/><ScenarioLesson id={current.caseId}/></>);
    }
    createRoot(document.getElementById('root')).render(<App/>);
  `,resolveDir:process.cwd(),sourcefile:'training-role-entry.tsx',loader:'tsx'},
  bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',
  plugins:[{name:'isolate-ui-only',setup(b){
    b.onResolve({filter:/^\.\.\/ui\.tsx$/},args=>({path:args.path,namespace:'training-ui-stub'}));
    b.onLoad({filter:/./,namespace:'training-ui-stub'},()=>({contents:uiStub,loader:'tsx'}));
  }}],
});
const browser=await chromium.launch();
try{
  const page=await browser.newPage({viewport:{width:390,height:844},locale:'ru-RU'});
  const errors=[];const requests=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('request',r=>requests.push(r.url()));
  // about:blank is an opaque origin and forbids localStorage. Fulfil one
  // synthetic secure top-level page in Chromium so actual localStorage and
  // storage/focus events run without an HTTP server or a production request.
  const origin='https://training-ui.test';
  await page.route(origin+'/**',route=>route.fulfill({
    status:200,contentType:'text/html',
    body:'<!doctype html><html lang="ru"><body><div id="root"></div></body></html>',
  }));
  await page.goto(origin+'/',{waitUntil:'domcontentloaded'});
  await page.addScriptTag({content:bundle.outputFiles[0].text});
  const change=async(patch)=>page.evaluate(patch=>window.__setTraining(patch),patch);

  // A dismissed administrator invitation must not hide a different user's
  // first-use prompt. A long admin course must not leak its index to a short
  // service/inspection course after switching workspaces.
  await page.getByRole('region',{name:'Знакомство с TrakSOS'}).waitFor();
  await page.getByRole('button',{name:'Не сейчас'}).click();
  for(let i=0;i<5;i++)await page.getByRole('button',{name:'Дальше',exact:true}).click();
  await page.getByRole('heading',{name:'Настройки'}).waitFor();
  await change({userId:'CI-B',mode:'service',roles:['service']});
  await page.getByRole('heading',{name:'Кабинет СТО'}).waitFor();
  await page.getByRole('region',{name:'Знакомство с TrakSOS'}).waitFor();
  if(!await page.getByText('Шаг 1 из 4').count())
    throw Error('Service course kept previous administrator index');
  await change({mode:'inspection',roles:['inspection']});
  await page.getByRole('heading',{name:'Рабочий кабинет'}).waitFor();
  if(!await page.getByText('Шаг 1 из 3').count())
    throw Error('Inspection course failed to reset step after switch');
  await change({mode:'courier',roles:['courier']});
  await page.getByRole('heading',{name:'Только ваши доставки'}).waitFor();
  await page.getByRole('button',{name:'2. Учебная заявка'}).click();
  await page.getByRole('heading',{name:'1. Назначена доставка'}).waitFor();
  await page.getByRole('button',{name:'Показать получение груза'}).click();
  await page.getByRole('heading',{name:'2. Груз получен'}).waitFor();
  if(await page.getByText('Вопрос о сроке ответа').count())
    throw Error('Courier still sees generic moderator/staff training');

  // Scenarios are scoped to the exact account/role; a cross-tab/local
  // completion is reflected while the encyclopedia is mounted.
  await page.evaluate(()=>localStorage.setItem('traksos.scenario.progress.v1.CI-A.owner','["app-not-working"]'));
  await change({page:'cases',userId:'CI-A',mode:'client',roles:['owner']});
  await page.getByRole('region',{name:'Энциклопедия ситуаций TrakSOS'}).waitFor();
  await page.locator('[aria-label^="Курсы пройдены: 1 из"]').waitFor();
  await change({userId:'CI-B',mode:'client',roles:['owner']});
  await page.locator('[aria-label^="Курсы пройдены: 0 из"]').waitFor();
  await change({mode:'courier',roles:['courier'],caseId:'app-not-working'});
  await page.getByRole('link',{name:/Курьер: код проверен/}).waitFor();
  await page.getByRole('link',{name:/Курьер: код вручения/}).waitFor();
  const courierCourses=await page.locator('.scenario-course-card').count();
  if(courierCourses<3)throw Error('Courier has no curated encyclopedia cases');

  // Switching case IDs while an answer/step is selected must remount all
  // per-case lesson state and prevent a previous answer becoming actionable.
  const first=await page.evaluate(()=>window.__recommended('courier','app-not-working',0));
  await page.getByRole('button',{name:first,exact:true}).click();
  await page.getByRole('button',{name:'Следующая ситуация'}).click();
  await page.getByText('Решение 2 из 3').waitFor();
  await change({caseId:'courier-code-handover'});
  await page.getByText('Решение 1 из 3').waitFor();
  if(await page.locator('.scenario-decision-panel .scenario-feedback').count())
    throw Error('Previous case response leaked into the next lesson');

  // Completing one safe scenario updates the encyclopedia immediately in
  // this tab, without making a single service request.
  for(let step=0;step<3;step++){
    const label=await page.evaluate(step=>window.__recommended('courier','courier-code-handover',step),step);
    if(!label)throw Error('Missing recommended answer for courier step '+step);
    await page.getByRole('button',{name:label,exact:true}).click();
    await page.getByRole('button',{name:step===2?'Показать итог':'Следующая ситуация'}).click();
  }
  await page.getByText('Вы разобрали ситуацию').waitFor();
  await page.locator('[aria-label^="Курсы пройдены: 1 из"]').waitFor();
  const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('traksos.scenario.progress.v1.CI-B.courier')));
  if(!saved.includes('courier-code-handover'))throw Error('Courier completion was not stored in its own scope');

  await page.evaluate(()=>{
    localStorage.setItem('traksos.scenario.progress.v1.CI-B.courier',
      JSON.stringify(['courier-code-handover','courier-code-locked']));
    window.dispatchEvent(new Event('storage'));
  });
  await page.locator('[aria-label^="Курсы пройдены: 2 из"]').waitFor();

  await change({mode:'client',roles:['owner']});
  await page.getByText('Курс недоступен').waitFor();
  await page.locator('[aria-label^="Курсы пройдены: 0 из"]').waitFor();

  if(errors.length)throw Error('Runtime error: '+errors.join('; '));
  if(requests.length)throw Error('Training triggered network: '+requests.join('; '));
  console.log('PASS: role/account training reset, courier practice, scoped case completion, and no real network');
}finally{await browser.close();}
