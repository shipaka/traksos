// Isolated real React/Chromium regression of courier workspace network recovery
// and private per-order state. It never calls the production server or courier API.
import {build} from 'esbuild';
import {chromium} from 'playwright';

const apiStub=`
  export class ApiError extends Error {}
  export function onEvent() { return () => {}; }
  export function get(path){
    const mock=window.__courierMock;
    return new Promise((resolve,reject)=>{
      mock.pending.push({path,resolve,reject});
      mock.requests.push(path);
    });
  }
  export function put(path,body){ window.__courierMock.posts.push({path,body});return Promise.resolve({ok:true});}
  export function post(path,body){ window.__courierMock.posts.push({path,body});return Promise.resolve({ok:true});}
`;
const stubs={
  '../api.ts':apiStub, './api.ts':apiStub,
  './dict.ts':"export const BRANDS=[]; export const MODELS={}; export const YEARS=[];",
  './screens/offers.tsx':"export function reportApiError(){}",
  './courierApproved20261120.css':'',
};
const bundle=await build({
  stdin:{
    contents:`
      import React,{useState} from 'react';
      import {createRoot} from 'react-dom/client';
      import {MeCtx} from './web/src/ui.tsx';
      import {CourierDesk,CourierDelivery} from './web/src/screens/courier.tsx';
      window.__courierMock={pending:[],requests:[],posts:[]};
      function Test(){
        const [view,setView]=useState({section:'desk',id:'A',user:'courier-one'});
        window.__switchCourierView=setView;
        const me={id:view.user,roles:['courier'],owner_id:null};
        return React.createElement(MeCtx.Provider,{
          value:{me,mode:'courier',reload:async()=>{},setMode:()=>{}}
        },view.section==='desk'
            ?React.createElement(CourierDesk,{section:'home'})
            :React.createElement(CourierDelivery,{id:view.id}));
      }
      createRoot(document.getElementById('root')).render(React.createElement(Test));
    `,
    resolveDir:process.cwd(),sourcefile:'courier-offline-entry.tsx',loader:'tsx'
  },
  bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',
  plugins:[{
    name:'courier-api-and-style-isolation',
    setup(b){
      b.onResolve({filter:/./},args=>{
        if(Object.hasOwn(stubs,args.path))return {path:args.path,namespace:'courier-stub'};
      });
      b.onLoad({filter:/./,namespace:'courier-stub'},args=>({
        contents:stubs[args.path],loader:args.path.endsWith('.tsx')?'tsx':'js',
      }));
    }
  }]
});

const makeJob=(id,orderNumber,status='arrived')=>({
  id,shopOrderId:'test-shop-'+id,orderNumber,status,
  items:[{productId:'part-'+id,name:'Учебная деталь '+id,qty:1}],
  deliveryAddress:'Тестовый адрес '+id,codeVerified:status==='code_verified',
  receivedAt:null,updatedAt:'2026-11-24T00:00:00Z',codeAttemptsRemaining:5,
});
const browser=await chromium.launch();
try{
  const page=await browser.newPage({viewport:{width:390,height:844}});
  const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.setContent('<!doctype html><html lang="ru"><body><div id="root"></div></body></html>');
  await page.addScriptTag({content:bundle.outputFiles[0].text});
  const pending=async(path,count)=>page.waitForFunction(([path,count])=>
    window.__courierMock.pending.filter(x=>x.path===path).length>=count,[path,count]);
  const respond=async(path,index,body,error=false)=>page.evaluate(([path,index,body,error])=>{
    const request=window.__courierMock.pending.filter(x=>x.path===path)[index];
    if(!request)throw Error('No recorded request '+path+' #'+index);
    if(error)request.reject(Error(String(body)));else request.resolve(body);
  },[path,index,body,error]);
  const change=async(section,id,user='courier-one')=>
    page.evaluate(v=>window.__switchCourierView(v),{section,id,user});

  await pending('/api/courier/presence',1);
  await pending('/api/courier/jobs',1);
  await respond('/api/courier/presence',0,'offline',true);
  await respond('/api/courier/jobs',0,'offline',true);
  await page.getByText('Не удалось проверить статус линии').waitFor();
  await page.getByText('Не удалось загрузить доставки').waitFor();

  const presenceRetry=page.locator('.courier-presence-error button');
  await presenceRetry.click();
  await pending('/api/courier/presence',2);
  await respond('/api/courier/presence',1,{online:true});
  await page.getByText('На линии',{exact:true}).waitFor();
  const jobsRetry=page.getByRole('button',{name:'Повторить',exact:true});
  await jobsRetry.click();
  await pending('/api/courier/jobs',2);
  await respond('/api/courier/jobs',1,[]);
  await page.getByText('Назначенных доставок нет').waitFor();

  // Same React component is reused when the URL changes to another delivery.
  await change('delivery','A');
  await pending('/api/courier/jobs/A',1);
  await respond('/api/courier/jobs/A',0,makeJob('A',111));
  await page.getByText('Тестовый адрес A').waitFor();
  const code=page.getByRole('textbox',{name:'Шестизначный код вручения'});
  await code.fill('123456');
  await change('delivery','B');
  await pending('/api/courier/jobs/B',1);
  await respond('/api/courier/jobs/B',0,makeJob('B',222));
  await page.getByText('Тестовый адрес B').waitFor();
  if((await code.inputValue())!=='')throw Error('Code from job A leaked to B');
  if(await page.getByText('Тестовый адрес A').count())
    throw Error('Private address from A remained visible in B');

  // A stale refresh failure must hide cached delivery details until retry.
  await change('delivery','C');
  await pending('/api/courier/jobs/C',1);
  await respond('/api/courier/jobs/C',0,makeJob('C',333,'code_verified'));
  await page.getByText('Тестовый адрес C').waitFor();
  await page.getByRole('button',{name:'Обновить статус'}).click();
  await pending('/api/courier/jobs/C',2);
  await respond('/api/courier/jobs/C',1,'offline-after-success',true);
  await page.getByText('Не удалось обновить назначенную доставку').waitFor();
  if(await page.getByText('Тестовый адрес C').count())
    throw Error('Cached private address visible after failed refresh');
  await page.getByRole('button',{name:'Повторить загрузку'}).click();
  await pending('/api/courier/jobs/C',3);
  await respond('/api/courier/jobs/C',2,makeJob('C',333,'received'));
  await page.getByText('Вручение подтверждено покупателем').waitFor();

  // Late A response must not overwrite D after a route switch.
  await change('delivery','D');
  await pending('/api/courier/jobs/D',1);
  await change('delivery','E');
  await pending('/api/courier/jobs/E',1);
  await respond('/api/courier/jobs/E',0,makeJob('E',555));
  await respond('/api/courier/jobs/D',0,makeJob('D',444));
  await page.getByText('Тестовый адрес E').waitFor();
  if(await page.getByText('Тестовый адрес D').count())
    throw Error('Late response for a previous job overwrote current job');

  // Switching the signed-in courier with the same URL re-fetches it and
  // never exposes old account's cached delivery address.
  await change('delivery','E','courier-two');
  await pending('/api/courier/jobs/E',2);
  if(await page.getByText('Тестовый адрес E').count())
    throw Error('Former courier address exposed during account switch');
  await respond('/api/courier/jobs/E',1,'forbidden',true);
  await page.getByText('Не удалось обновить назначенную доставку').waitFor();
  if(errors.length)throw Error('React runtime errors: '+errors.join('; '));
  if((await page.evaluate(()=>window.__courierMock.posts.length))!==0)
    throw Error('Read-only test unexpectedly wrote delivery status or code');
  console.log('PASS courier offline recovery, stale GET isolation, input reset and privacy');
}finally{await browser.close();}
