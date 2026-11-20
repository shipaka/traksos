// Real rendered desktop cabinet evidence. Synthetic accounts ONLY on local CI,
// never a production token, never a synthetic design/mock image.
import { chromium } from 'playwright';
import { mkdir,writeFile } from 'node:fs/promises';
const BASE=process.env.BASE_URL||'http://127.0.0.1:8080';
if(!['localhost','127.0.0.1'].includes(new URL(BASE).hostname))throw Error('Local CI only');
const out='e2e/shots/owner20-cabinets';
await mkdir(out,{recursive:true});
const cases=[
 {id:'owner',phone:'+79990000341',accountType:'owner',mode:'client',url:'#/',inside:'#/garage'},
 {id:'driver',phone:'+79990000342',accountType:'driver',mode:'client',url:'#/',inside:'#/orders'},
 {id:'master',phone:'+79990000343',accountType:'master',mode:'performer',url:'#/work',inside:'#/work/me'},
 {id:'tow',phone:'+79990000344',accountType:'tow',mode:'performer',url:'#/work',inside:'#/work/jobs'},
 {id:'service',phone:'+79990000345',accountType:'service',mode:'service',url:'#/base',inside:'#/base/me'},
 {id:'master_service',phone:'+79990000346',accountType:'master_service',mode:'service',url:'#/base',inside:'#/base/money'},
 {id:'insurer',phone:'+79990000347',accountType:'insurer',mode:'insurer',url:'#/insurance',inside:'#/profile'},
 {id:'admin',phone:'+79990000348',accountType:'owner',mode:'admin',url:'#/admin',inside:'#/admin/section/orders',needs:'admin'},
 {id:'moderator',phone:'+79990000349',accountType:'owner',mode:'moderator',url:'#/moderation',inside:'#/profile',needs:'moderator'}
];
async function post(path,body,token){
 const r=await fetch(BASE+path,{method:'POST',headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},body:JSON.stringify(body)});
 const data=await r.json().catch(()=>null);if(!r.ok)throw Error(path+' HTTP '+r.status+' '+JSON.stringify(data));return data;
}
async function get(path,token){
 const r=await fetch(BASE+path,{headers:{authorization:'Bearer '+token}});
 const data=await r.json().catch(()=>null);
 if(!r.ok)throw Error(path+' HTTP '+r.status+' '+JSON.stringify(data));
 return data;
}
async function put(path,body,token){
 const r=await fetch(BASE+path,{method:'PUT',headers:{'content-type':'application/json',authorization:'Bearer '+token},body:JSON.stringify(body)});
 const data=await r.json().catch(()=>null);
 if(!r.ok)throw Error(path+' HTTP '+r.status+' '+JSON.stringify(data));
 return data;
}
/** Prepare genuine role dashboards using LOCAL synthetic accounts.
 * Avoid publishing fixture accounts, implying real partners or altering live data.
 * No job/order/payment is created by this visual test. */
async function ensureConfiguredWorkspace(c,token){
 if(['master','tow','master_service'].includes(c.id)){
  const profile=await get('/api/performer/profile',token);
  const kind=c.id==='tow'?'tow':'master';
  if(!profile){
   await put('/api/performer/profile',{
    kind,name:c.id==='tow'?'Тестовый эвакуаторщик — локальный стенд':'Тестовый мастер — локальный стенд',
    specialties:kind==='tow'?[]:['electric','diag'],brands:{},tier:'eco'
   },token);
  }
 }
 if(['service','master_service'].includes(c.id)){
  const data=await get('/api/base',token);
  if(!data?.center){
   await put('/api/base',{
    name:'Тестовая СТО TrakSOS — локальный стенд',
    address:'Санкт-Петербург, только тестовый стенд',
    brands:['Scania','Volvo'],accepts:['quick','day']
   },token);
  }
 }
}
const browser=await chromium.launch();
const results=[];
try{
 for(const c of cases){
  try{
   const sms=await post('/api/auth/code',{phone:c.phone});
   if(!/^\d{4,6}$/.test(sms?.devCode||''))throw Error('Dev SMS code not provided');
   const account=await post('/api/auth/verify',{phone:c.phone,code:sms.devCode,accountType:c.accountType,password:'Visual-Local-2026!'});
   if(!account?.token)throw Error('No session token');
   if(c.needs && !account.user?.roles?.includes(c.needs))throw Error('Staff role not granted by local test config');
   const token=account.token;
   await ensureConfiguredWorkspace(c,token);
   for(const width of [1440,390]){
    const context=await browser.newContext({viewport:{width,height:width===390?844:900},locale:'ru-RU',deviceScaleFactor:1});
    const page=await context.newPage();
    const errors=[];page.on('pageerror',x=>errors.push(x.message));
    await page.addInitScript(({token,mode})=>{localStorage.setItem('traksos.token',token);localStorage.setItem('traksos.mode',mode)}, {token,mode:c.mode});
    try {
     await page.goto(BASE+'/'+c.url,{waitUntil:'domcontentloaded'});
     await page.locator('.app').waitFor();
     // Accept the current local offer through the real UI if required.
     const offers=await fetch(BASE+'/api/me/offers',{headers:{authorization:'Bearer '+token}}).then(r=>r.ok?r.json():[]);
     for(const o of offers.filter(x=>x.current&&!x.accepted)){
       const dlg=page.getByRole('dialog',{name:o.name});
       await dlg.waitFor({state:'visible',timeout:12000});
       await dlg.locator('input[type=checkbox]').check();
       await dlg.getByRole('button',{name:'Принимаю'}).click();
       await dlg.waitFor({state:'detached',timeout:12000});
     }
     await page.locator('.account-menu > summary').waitFor({timeout:14000});
     await page.evaluate(()=>document.fonts.ready);
     await page.waitForTimeout(650);
     const dims=await page.evaluate(()=>({client:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth}));
     if(dims.scroll>dims.client+3)throw Error('Horizontal overflow '+JSON.stringify(dims));
     if(errors.length)throw Error('Uncaught errors '+errors.join('; '));
     if(c.id==='owner'){
       // Browser mobile and desktop must use the SAME original logo and the
       // SAME four photographs; card proportions may differ with the viewport.
       const visual=await page.evaluate(async()=>{
         const logo=document.querySelector('.top .tr-approved-brand-logo img');
         const scenes=Array.from(document.querySelectorAll('.desktop-quick-card .tr-service-illustration'));
         const atlas=await fetch('/traksos-service-scenes-shared.webp');
         const bmp=atlas.ok?await createImageBitmap(await atlas.blob()).catch(()=>null):null;
         return {
           logo:logo?.getAttribute('src'),loaded:logo?.complete&&logo?.naturalWidth===274&&logo?.naturalHeight===46,
           illustrations:scenes.length,
           matched:scenes.every(el=>getComputedStyle(el).backgroundImage.includes('traksos-service-scenes-shared.webp')),
           crops:scenes.map(el=>{
             const css=getComputedStyle(el);
             return {pos:css.backgroundPosition,size:css.backgroundSize};
           }),
           size:bmp?{w:bmp.width,h:bmp.height}:null,
         };
       });
       const expectedCrops=['0px 0px','-176px 0px','-352px 0px','-528px 0px'];
       if(visual.logo!=='/traksos-brand-logo-approved-618.png'||!visual.loaded||
          visual.illustrations!==4||!visual.matched||visual.size?.w!==704||visual.size?.h!==105||
          visual.crops?.some((c,i)=>c.pos!==expectedCrops[i]||c.size!=='704px 105px'))
         throw Error('Owner shared-brand/art parity failed at '+width+': '+JSON.stringify(visual));
     }
     if(width===1440) {
       // The desktop must show ONE onboarding prompt, not two stacked panels.
       const prompts=await page.locator('.tr-training-invite:visible, section.card[aria-label="Знакомство с TrakSOS"]:visible').count();
       if(prompts>1)throw Error('Duplicate desktop training prompts: '+prompts);
     }
     await page.screenshot({path:out+'/'+c.id+'-home-'+width+'-viewport.png',fullPage:false,animations:'disabled'});
     await page.screenshot({path:out+'/'+c.id+'-home-'+width+'.png',fullPage:true,animations:'disabled'});
     await page.goto(BASE+'/'+c.inside,{waitUntil:'domcontentloaded'});
     await page.locator('.account-menu > summary').waitFor({timeout:12000});
     await page.waitForTimeout(500);
     if(await page.getByText('Не удалось открыть раздел').count())throw Error('Inner route crashed');
     await page.screenshot({path:out+'/'+c.id+'-inside-'+width+'-viewport.png',fullPage:false,animations:'disabled'});
     await page.screenshot({path:out+'/'+c.id+'-inside-'+width+'.png',fullPage:true,animations:'disabled'});
     results.push({role:c.id,width,height:width===390?844:900,result:'screens saved',files:[
       c.id+'-home-'+width+'-viewport.png',
       c.id+'-home-'+width+'.png',
       c.id+'-inside-'+width+'-viewport.png',
       c.id+'-inside-'+width+'.png',
     ]});
    }finally{await context.close()}
   }
  }catch(error){
   results.push({role:c.id,result:'FAILED',error:String(error)});
   console.error(c.id+': '+String(error));
  }
 }
}finally{await browser.close();}
await writeFile(out+'/capture-report.json',JSON.stringify(results,null,2));
console.log('Owner PC cabinet evidence (real Chromium):',JSON.stringify(results));
const failures=results.filter(x=>x.result==='FAILED');
if(failures.length)process.exitCode=1;
