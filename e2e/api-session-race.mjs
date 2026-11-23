// Exact compiled browser transport from web/src/api.ts, isolated local CI.
// No user credentials, server mutation or production endpoints are involved.
import { readFile } from 'node:fs/promises';
import { transform } from 'esbuild';
import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const BASE=process.env.BASE_URL??'http://127.0.0.1:8080';
if(!['localhost','127.0.0.1'].includes(new URL(BASE).hostname))
  throw Error('Session race test may only target a local CI origin');
const source=await readFile(new URL('../web/src/api.ts',import.meta.url),'utf8');
const compiled=await transform(source,{
  loader:'ts',format:'esm',define:{__API_URL__:"''"},target:'es2022',
});
const browser=await chromium.launch();
try {
  const context=await browser.newContext({serviceWorkers:'block',locale:'ru-RU'});
  try {
    const page=await context.newPage();
    await page.goto(BASE+'/#/',{waitUntil:'domcontentloaded'});
    await page.route('**/__ci_api_session_race.mjs',route=>
      route.fulfill({status:200,contentType:'text/javascript',body:compiled.code}));
    const actual=await page.evaluate(async()=>{
      const module=await import('/__ci_api_session_race.mjs');
      const originalFetch=window.fetch.bind(window);
      const pending=[];
      window.fetch=(url,options)=>{
        if(String(url).endsWith('/api/me')){
          return new Promise(resolve=>pending.push({
            auth:options?.headers?.authorization,resolve
          }));
        }
        return originalFetch(url,options);
      };
      const response=(status,payload)=>new Response(JSON.stringify(payload),{
        status,headers:{'content-type':'application/json'}
      });
      const result={};
      try {
        let expiredEvents=0;
        window.addEventListener('traksos-auth-expired',()=>expiredEvents++);
        module.setToken('CI-OLD');
        const old200=module.api('GET','/api/me').catch(e=>e);
        result.old200Auth=pending[0]?.auth;
        module.setToken('CI-NEW');
        pending[0].resolve(response(200,{id:'CI-OLD',private:'not-new-user'}));
        const stale200=await old200;
        result.stale200Code=stale200.code;
        result.stale200Status=stale200.status;
        result.afterOld200=module.getToken();

        module.setToken('CI-OLD-2');
        const old401=module.api('GET','/api/me').catch(e=>e);
        result.old401Auth=pending[1]?.auth;
        module.setToken('CI-NEW-2');
        pending[1].resolve(response(401,{error:'session_expired'}));
        const stale401=await old401;
        result.stale401Code=stale401.code;
        result.afterOld401=module.getToken();
        result.expiredBeforeCurrent=expiredEvents;

        const current401=module.api('GET','/api/me').catch(e=>e);
        result.currentAuth=pending[2]?.auth;
        pending[2].resolve(response(401,{error:'session_expired'}));
        const currentError=await current401;
        result.currentErrorStatus=currentError.status;
        result.afterCurrent401=module.getToken();
        result.expiredAfterCurrent=expiredEvents;
        result.loginHash=location.hash;
      } finally {
        window.fetch=originalFetch;
      }
      return result;
    });
    assert.equal(actual.old200Auth,'Bearer CI-OLD');
    assert.equal(actual.stale200Code,'session_changed');
    assert.equal(actual.stale200Status,409);
    assert.equal(actual.afterOld200,'CI-NEW',
      'old HTTP 200 must never overwrite a new session');
    assert.equal(actual.old401Auth,'Bearer CI-OLD-2');
    assert.equal(actual.stale401Code,'session_changed');
    assert.equal(actual.afterOld401,'CI-NEW-2',
      'old HTTP 401 must not log out the new account');
    assert.equal(actual.expiredBeforeCurrent,0,
      'expired event belongs only to the current token');
    assert.equal(actual.currentAuth,'Bearer CI-NEW-2');
    assert.equal(actual.currentErrorStatus,401);
    assert.equal(actual.afterCurrent401,null);
    assert.equal(actual.expiredAfterCurrent,1);
    assert.equal(actual.loginHash,'#/login');
    console.log('PASS: stale 200/401 cannot mix account data; current 401 unmounts account');
  } finally { await context.close(); }
} finally { await browser.close(); }
