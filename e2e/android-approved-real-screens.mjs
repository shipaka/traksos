// Real authenticated Android layout evidence from synthetic local CI accounts only.
import {chromium} from 'playwright';
import {mkdir} from 'node:fs/promises';
const BASE=process.env.BASE_URL||'http://127.0.0.1:8080';
if(!['localhost','127.0.0.1'].includes(new URL(BASE).hostname))throw Error('Local CI only');
const output='e2e/shots/android-approved-real';
await mkdir(output,{recursive:true});
async function post(path,body,token){
  const r=await fetch(BASE+path,{method:'POST',headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},body:JSON.stringify(body)});
  const data=await r.json().catch(()=>null);
  if(!r.ok)throw Error(path+' HTTP '+r.status+' '+JSON.stringify(data));
  return data;
}
async function get(path,token){
  const r=await fetch(BASE+path,{headers:{authorization:'Bearer '+token}});
  if(!r.ok)throw Error(path+' HTTP '+r.status);
  return await r.json();
}
const browser=await chromium.launch();
try{
  for(const [role,phone,mode,route,selector] of [
    ['owner','+79990000981','client','#/','.and19-client'],
    ['master','+79990000982','performer','#/work','.and19-performer']
  ]){
    const code=await post('/api/auth/code',{phone});
    if(!/^\d{4,6}$/.test(code?.devCode??''))throw Error('Synthetic local SMS only');
    const v=await post('/api/auth/verify',{phone,code:code.devCode,accountType:role,password:'Test-Only-Visual-2026!'});
    if(!v?.token)throw Error(role+': no token');
    if(role==='master'&&!await get('/api/performer/profile',v.token)){
      const p=await fetch(BASE+'/api/performer/profile',{method:'PUT',headers:{authorization:'Bearer '+v.token,'content-type':'application/json'},body:JSON.stringify({kind:'master',specialties:[],brands:{},tier:'eco'})});
      if(!p.ok)throw Error('Synthetic master profile HTTP '+p.status);
    }
    const ctx=await browser.newContext({viewport:{width:390,height:844},locale:'ru-RU'});
    const page=await ctx.newPage();
    const errors=[];page.on('pageerror',err=>errors.push(err.message));
    await page.addInitScript(({token,mode})=>{
      Object.defineProperty(window,'TrakSOSNative',{configurable:true,value:{
        isApp:()=>true,setSession:()=>{},pushToken:()=>'',performerOnline:()=>{},
        appLockEnabled:()=>false,setAppLockEnabled:()=>false
      }});
      localStorage.setItem('traksos.token',token);
      localStorage.setItem('traksos.mode',mode);
    },{token:v.token,mode});
    try{
      await page.goto(BASE+'/'+route,{waitUntil:'domcontentloaded'});
      await page.locator('.app').waitFor({timeout:20000});
      const offers=await get('/api/me/offers',v.token);
      for(const offer of offers.filter(o=>o.current&&!o.accepted)){
        const modal=page.getByRole('dialog',{name:offer.name});
        await modal.waitFor({state:'visible',timeout:15000});
        await modal.locator('input[type=checkbox]').check();
        await modal.getByRole('button',{name:'Принимаю'}).click();
        await modal.waitFor({state:'detached',timeout:15000});
      }
      await page.locator(selector).waitFor({state:'visible',timeout:20000});
      // Approved mobile workspaces must be visible immediately after login.
      // A first-run course or guided tour can be opened from Menu, not pushed
      // above the only actionable card on a small Android screen.
      if(await page.locator('.tr-training-invite,[aria-label="Знакомство с TrakSOS"],.tr-tour').count())
        throw Error(role+': first-run overlay blocks approved workdesk');
      if(role==='master')await page.locator('.and19-line button').waitFor();
      else await page.locator('.and19-services').waitFor();
      await page.waitForTimeout(650);
      const size=await page.evaluate(()=>({client:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth}));
      if(size.scroll>size.client+3)throw Error(role+' horizontal overflow '+JSON.stringify(size));
      if(errors.length)throw Error(role+' JS errors: '+errors.join('; '));
      await page.screenshot({path:output+'/'+role+'-android-390.png',fullPage:true});
      console.log('Captured real Android native-bridge browser workspace: '+role);
    }finally{await ctx.close()}
  }
}finally{await browser.close()}
