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
   for(const width of [1440,390]){
    const context=await browser.newContext({viewport:{width,height:900},locale:'ru-RU'});
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
     await page.screenshot({path:out+'/'+c.id+'-home-'+width+'.png',fullPage:true,animations:'disabled'});
     await page.goto(BASE+'/'+c.inside,{waitUntil:'domcontentloaded'});
     await page.locator('.account-menu > summary').waitFor({timeout:12000});
     await page.waitForTimeout(500);
     if(await page.getByText('Не удалось открыть раздел').count())throw Error('Inner route crashed');
     await page.screenshot({path:out+'/'+c.id+'-inside-'+width+'.png',fullPage:true,animations:'disabled'});
     results.push({role:c.id,width,result:'screens saved'});
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
