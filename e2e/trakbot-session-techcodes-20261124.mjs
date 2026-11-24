// TRAKBOT-SESSION-TECHCODES-20261124: actual React components in Chromium.
// Synthetic deferred API: never sends real assistant prompts or private documents.
import { build } from 'esbuild';
import { chromium } from 'playwright';

const uiStub = `
  import {createContext,useContext} from 'react';
  export const C = createContext({me:null});
  export const useMe = () => useContext(C);
  export const Back = ({to}) => <a href={'#/'+to}>Назад</a>;
`;
const apiStub = `
  function request(method,path,body) {
    const record = {method,path,body};
    const mock = window.__botMock;
    mock.calls.push(record);
    return new Promise((resolve,reject) => mock.pending.push({...record,resolve,reject}));
  }
  export const get = (path) => request('GET',path);
  export const post = (path,body) => request('POST',path,body);
  export const del = (path) => request('DELETE',path);
`;
const bundle = await build({
  stdin: {
    contents: `
      import React,{useState} from 'react';
      import {createRoot} from 'react-dom/client';
      import {C} from './web/src/ui.tsx';
      import {TrakBotChat,TechCodes} from './web/src/screens/trakbot.tsx';
      window.__botMock={calls:[],pending:[]};
      window.confirm=()=>true;
      function TestApp(){
        const [me,setMe]=useState({id:'owner-A',roles:['client'],performer:null});
        const [screen,setScreen]=useState('chat');
        window.__setBotMe=setMe; window.__setBotScreen=setScreen;
        return <C.Provider value={{me}}>
          {screen==='chat'?<TrakBotChat/>:<TechCodes/>}
        </C.Provider>;
      }
      createRoot(document.getElementById('root')).render(<TestApp/>);
    `,
    resolveDir:process.cwd(), sourcefile:'trakbot-session-entry.tsx', loader:'tsx',
  },
  bundle:true, write:false, outdir:'e2e/.temporary-trakbot-build',
  platform:'browser', format:'iife', jsx:'automatic',
  plugins:[{
    name:'bot-mock-transport-only',
    setup(b) {
      b.onResolve({filter:/./},args=>{
        if(args.path==='../ui.tsx'||args.path==='./web/src/ui.tsx')
          return {path:'ui',namespace:'trakbot-stub'};
        if(args.path==='../api.ts')return {path:'api',namespace:'trakbot-stub'};
        if(args.path.endsWith('.css'))return {path:args.path,namespace:'trakbot-style'};
      });
      b.onLoad({filter:/./,namespace:'trakbot-stub'},args=>({resolveDir:process.cwd(),
        contents:args.path==='ui'?uiStub:apiStub,
        loader:args.path==='ui'?'tsx':'js',
      }));
      b.onLoad({filter:/./,namespace:'trakbot-style'},()=>({contents:'',loader:'js'}));
    },
  }],
});
const js=bundle.outputFiles.find(x=>x.path.endsWith('.js'))?.text;
if(!js)throw Error('Bot React bundle is missing');
const check=(condition,message)=>{if(!condition)throw Error(message);};
const bot=(id,body)=>({id,role:'bot',body,created_at:'2026-11-24T00:00:00Z'});
const human=(id,body)=>({id,role:'user',body,created_at:'2026-11-24T00:00:00Z'});
const response=(messages,aiAvailable=false)=>({messages,freePilot:true,aiAvailable,aiTransport:'api'});
const browser=await chromium.launch();
try {
  const page=await browser.newPage({viewport:{width:390,height:844},locale:'ru-RU'});
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.setContent('<!doctype html><html lang="ru"><body><div id="root"></div></body></html>');
  await page.addScriptTag({content:js});
  const H='/api/trakbot/messages',A='/api/trakbot/answer';
  const count=(method,path)=>page.evaluate(({method,path})=>
    window.__botMock.pending.filter(x=>x.method===method&&x.path===path).length,{method,path});
  const wait=(method,path,n)=>page.waitForFunction(({method,path,n})=>
    window.__botMock.pending.filter(x=>x.method===method&&x.path===path).length>=n,{method,path,n});
  const finish=(method,path,index,what,data)=>page.evaluate(({method,path,index,what,data})=>{
    const q=window.__botMock.pending.filter(x=>x.method===method&&x.path===path)[index];
    if(!q)throw Error('Missing '+method+' '+path+' #'+index);
    q[what](what==='reject'?Error(data):data);
  },{method,path,index,what,data});
  const messages=page.getByRole('textbox',{name:'Сообщение TrakBot'});
  await wait('GET',H,1);
  check(await messages.isDisabled(),'Chat could send before private history is known');
  await finish('GET',H,0,'resolve',response([bot('bot-A','SECRET-TRAKBOT-OWNER-A')],true));
  await page.getByText('SECRET-TRAKBOT-OWNER-A').waitFor();
  await page.getByRole('checkbox').check();
  await page.getByRole('textbox',{name:'Марка'}).fill('SECRET-VEHICLE-A');
  await messages.fill('Диагностика А');
  await page.getByRole('button',{name:'Отправить'}).click();
  await wait('POST',A,1);
  const postA=await page.evaluate(()=>window.__botMock.calls.find(x=>x.method==='POST'&&x.path==='/api/trakbot/answer'));
  check(postA?.body?.allowAiProcessing===true,'Explicit AI consent not included for account A');
  await page.evaluate(()=>window.__setBotMe({id:'owner-B',roles:['client'],performer:null}));
  await wait('GET',H,2);
  check(await page.getByText('SECRET-TRAKBOT-OWNER-A').count()===0,
    'Private messages from old chat survived account switch');
  // New chat must clear old vehicle input even if it is not rendered as text.
  check(await page.getByRole('textbox',{name:'Марка'}).inputValue()==='',
    'Old vehicle metadata was inherited by account B');
  check(await page.getByRole('checkbox').count()===0,
    'Old AI consent was inherited by account B');
  check(await messages.isDisabled(),'Account B can send before loading B history');
  await finish('POST',A,0,'resolve',{
    userMessage:human('user-A','Диагностика А'),
    message:bot('answer-A','SECRET-ASYNC-REPLY-A'),freePilot:true,
  });
  await page.waitForTimeout(80);
  check(await page.getByText('SECRET-ASYNC-REPLY-A').count()===0,
    'Late A POST reply appeared inside B session');
  await finish('GET',H,1,'reject','offline');
  await page.getByRole('button',{name:'Повторить загрузку переписки'}).click();
  await wait('GET',H,3);
  await finish('GET',H,2,'resolve',response([bot('bot-B','PRIVATE-TRAKBOT-OWNER-B')],true));
  await page.getByText('PRIVATE-TRAKBOT-OWNER-B').waitFor();
  check(!await page.getByRole('checkbox').isChecked(),
    'Account B inherited account A external AI processing consent');

  // POST can commit before transport timeout. The UI reconciles while keeping
  // the original draft, and never silently posts the same body twice.
  await messages.fill('Вопрос Б');
  await page.getByRole('button',{name:'Отправить'}).click();
  await wait('POST',A,2);
  const postB=await page.evaluate(()=>window.__botMock.calls.filter(x=>
    x.method==='POST'&&x.path==='/api/trakbot/answer')[1]);
  check(postB?.body?.allowAiProcessing===false,
    'A previous account AI consent leaked into B POST');
  await finish('POST',A,1,'reject','connection lost after write');
  await wait('GET',H,4);
  check(await messages.isDisabled(),'Post reconciliation unlocked a racing composer');
  await finish('GET',H,3,'resolve',response([
    human('human-B','Вопрос Б'),bot('bot-B2','CONFIRMED-ANSWER-B'),
  ]));
  await page.getByText('CONFIRMED-ANSWER-B').waitFor();
  check(await messages.inputValue()==='Вопрос Б','Timeout erased the unsent draft');
  check(await count('POST',A)===2,'POST silently retried after uncertain timeout');

  // Deletion is also isolated: a late DELETE from B cannot clear account C.
  await page.getByRole('button',{name:'Очистить мою переписку'}).click();
  await wait('DELETE',H,1);
  await page.evaluate(()=>window.__setBotMe({id:'owner-C',roles:['client'],performer:null}));
  await wait('GET',H,5);
  await finish('GET',H,4,'resolve',response([bot('bot-C','PRIVATE-TRAKBOT-OWNER-C')]));
  await page.getByText('PRIVATE-TRAKBOT-OWNER-C').waitFor();
  await finish('DELETE',H,0,'resolve',{cleared:true});
  check(await page.getByText('PRIVATE-TRAKBOT-OWNER-C').count()===1,
    'Old deletion cleared a newer account');

  // Tech codes: stale out-of-order lookups and changed specialist rights.
  await page.evaluate(()=>{
    window.__setBotMe({id:'mechanic-A',roles:['master'],performer:{verification:'approved'}});
    window.__setBotScreen('tech');
  });
  const tech=page.getByRole('textbox',{name:'Поиск кода'});
  await tech.fill('P0087');
  await page.getByRole('button',{name:'Искать'}).click();
  const pOld='/api/tech/codes?q=P0087';
  await wait('GET',pOld,1);
  await tech.fill('P0090');
  check(await page.getByText('Совпадений пока нет').count()===0,
    'No-result text shown before a response');
  await page.getByRole('button',{name:'Искать'}).click();
  const pNew='/api/tech/codes?q=P0090';
  await wait('GET',pNew,1);
  await finish('GET',pOld,0,'resolve',{items:[{
    code:'P0087',title_en:'OLD-SECRET-TECH-RESULT',title_ru:null,
    detail_en:null,detail_ru:null,source_url:'https://example.com/old',review_state:'unverified',
  }]});
  check(await page.getByText('OLD-SECRET-TECH-RESULT').count()===0,
    'Older search overwrote current specialist query');
  await finish('GET',pNew,0,'resolve',{items:[{
    code:'P0090',title_en:'CURRENT-TECH-RESULT',title_ru:null,
    detail_en:null,detail_ru:null,source_url:'https://example.com/new',review_state:'external_reviewed',
  }]});
  await page.getByText('CURRENT-TECH-RESULT').waitFor();
  await page.evaluate(()=>window.__setBotMe({id:'mechanic-A',roles:['master'],performer:{verification:'pending'}}));
  await page.getByText('Доступ ограничен').waitFor();
  check(await page.getByText('CURRENT-TECH-RESULT').count()===0,
    'Revoked technician retained private search results');
  await page.evaluate(()=>window.__setBotMe({id:'admin-B',roles:['admin'],performer:null}));
  await tech.waitFor();
  check((await tech.inputValue())==='', 'New staff member inherited technician query');
  check(errors.length===0,'React runtime exceptions: '+errors.join('; '));
  console.log('PASS: TrakBot chat history, AI consent, pending POST/DELETE, retry and technical codes are isolated');
} finally { await browser.close(); }
