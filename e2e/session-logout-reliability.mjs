// Real API transport and shared logout handler in Chromium with controlled HTTP.
import {build} from 'esbuild';
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const bundle=await build({stdin:{contents:`
  import {logoutSession} from './web/src/sessionLogout.ts';
  import {setToken,getToken} from './web/src/api.ts';
  window.testLogout=logoutSession;window.setSessionToken=setToken;window.getSessionToken=getToken;
`,resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,platform:'browser',format:'iife',define:{__API_URL__:'""'}});
const browser=await chromium.launch();
try{
  for(const width of [390,1440]){
    const page=await browser.newPage({viewport:{width,height:844}});
    let requests=0,scenario='ok',release;
    await page.route('https://logout.test/**',async route=>{
      if(!route.request().url().endsWith('/api/auth/logout'))
        return route.fulfill({status:200,contentType:'text/html',body:'<main>Test shell</main>'});
      requests++;
      if(scenario==='hang')return;
      if(scenario==='late')await new Promise(r=>{release=r;});
      if(scenario==='active')return route.fulfill({status:400,json:{error:'active_job',message:'Завершите текущую заявку'}});
      if(scenario==='offline')return route.abort('failed');
      return route.fulfill({status:200,json:{ok:true}});
    });
    await page.goto('https://logout.test/#/work');
    await page.evaluate(()=>{
      window.nativeCalls=[];window.expired=0;window.confirmAnswer=true;window.confirmCalls=[];window.alertCalls=[];
      window.TrakSOSNative={setSession:(url,token)=>window.nativeCalls.push(token)};
      window.confirm=msg=>{window.confirmCalls.push(msg);return window.confirmAnswer;};
      window.alert=msg=>window.alertCalls.push(msg);
      window.addEventListener('traksos-auth-expired',()=>window.expired++);
    });
    await page.addScriptTag({content:bundle.outputFiles[0].text});
    const seed=token=>page.evaluate(t=>{
      window.setSessionToken(t);
      localStorage.setItem('traksos.offlineIdentity','private');
      localStorage.setItem('traksos.savedOrderDraft.v1','private');
      sessionStorage.setItem('traksos.pendingOrder','private');
      location.hash='#/work';
    },token);
    const state=()=>page.evaluate(()=>({token:window.getSessionToken(),stored:localStorage.getItem('traksos.token'),
      identity:localStorage.getItem('traksos.offlineIdentity'),draft:localStorage.getItem('traksos.savedOrderDraft.v1'),
      pending:sessionStorage.getItem('traksos.pendingOrder'),expired:window.expired,native:window.nativeCalls,hash:location.hash}));
    await seed('admin-A');
    await page.evaluate(()=>Promise.all([window.testLogout(),window.testLogout()]));
    let s=await state();
    assert.equal(requests,1);assert.equal(s.token,null);assert.equal(s.stored,null);
    assert.equal(s.identity,null);assert.equal(s.draft,null);assert.equal(s.pending,null);
    assert.equal(s.hash,'#/login');assert.equal(s.expired,1);assert.deepEqual(s.native,[null]);
    scenario='active';await seed('worker-B');
    await page.evaluate(()=>window.testLogout());
    assert.equal((await state()).token,'worker-B');assert.match(await page.evaluate(()=>window.alertCalls.at(-1)),/Завершите/);
    scenario='offline';await page.evaluate(()=>window.confirmAnswer=false);
    await page.evaluate(()=>window.testLogout());assert.equal((await state()).token,'worker-B');
    await page.evaluate(()=>window.confirmAnswer=true);
    await page.evaluate(()=>window.testLogout());assert.equal((await state()).token,null);
    assert.match(await page.evaluate(()=>window.confirmCalls.at(-1)),/Сессия на сервере/);
    scenario='late';await seed('old');
    await page.evaluate(()=>{window.oldLogout=window.testLogout();});
    await page.waitForFunction(()=>window.getSessionToken()==='old');
    for(let i=0;i<100&&!release;i++)await new Promise(r=>setTimeout(r,20));
    assert.ok(release,'expected pending request');
    await seed('new');release();
    await page.evaluate(()=>window.oldLogout);
    s=await state();assert.equal(s.token,'new');assert.equal(s.hash,'#/work');
    scenario='hang';await seed('timeout');
    await page.evaluate(()=>window.testLogout());
    assert.equal((await state()).token,null,'bounded network failure permits explicit local logout');
    await page.close();
  }
  console.log('PASS shared logout: duplicate click, local cleanup, active job, rejected/confirmed offline exit, late session, timeout');
}finally{await browser.close();}
