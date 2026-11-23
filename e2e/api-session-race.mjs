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
      const pending=[],pendingImages=[];
      window.fetch=(url,options)=>{
        if(String(url).endsWith('/api/me')){
          return new Promise(resolve=>pending.push({
            auth:options?.headers?.authorization,resolve
          }));
        }
        if(String(url).endsWith('/api/private-image')){
          return new Promise(resolve=>pendingImages.push({
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

        module.setToken('CI-IMAGE-OLD');
        const staleImage=module.authedImage('/api/private-image').catch(e=>e);
        result.oldImageAuth=pendingImages[0]?.auth;
        module.setToken('CI-IMAGE-NEW');
        pendingImages[0].resolve(new Response(new Blob(['sensitive-old-image']),{
          status:200,headers:{'content-type':'image/png'}
        }));
        const imageError=await staleImage;
        result.staleImageCode=imageError.code;
        result.afterOldImage=module.getToken();
        const currentImage=module.authedImage('/api/private-image');
        result.newImageAuth=pendingImages[1]?.auth;
        pendingImages[1].resolve(new Response(new Blob(['current-user-image']),{
          status:200,headers:{'content-type':'image/png'}
        }));
        const currentImageUrl=await currentImage;
        result.currentImageLoaded=currentImageUrl.startsWith('blob:');
        URL.revokeObjectURL(currentImageUrl);

        module.setToken('CI-IMAGE-EXPIRED');
        const image401=module.authedImage('/api/private-image').catch(e=>e);
        result.expiredImageAuth=pendingImages[2]?.auth;
        pendingImages[2].resolve(new Response(JSON.stringify({error:'expired_session'}),{
          status:401,headers:{'content-type':'application/json'}
        }));
        const expiredImage=await image401;
        result.expiredImageStatus=expiredImage.status;
        result.afterExpiredImage=module.getToken();
        result.expiredEventsAfterImage=expiredEvents;
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
    assert.equal(actual.oldImageAuth,'Bearer CI-IMAGE-OLD');
    assert.equal(actual.staleImageCode,'session_changed',
      'a private image from the old user must never reach the next account');
    assert.equal(actual.afterOldImage,'CI-IMAGE-NEW');
    assert.equal(actual.newImageAuth,'Bearer CI-IMAGE-NEW');
    assert.equal(actual.currentImageLoaded,true,
      'private images for the current account still load normally');
    assert.equal(actual.expiredImageAuth,'Bearer CI-IMAGE-EXPIRED');
    assert.equal(actual.expiredImageStatus,401);
    assert.equal(actual.afterExpiredImage,null,
      'expired private-image request must clear its own bearer token');
    assert.equal(actual.expiredEventsAfterImage,2,
      'image 401 must unmount expired workspace just like a JSON API 401');
    console.log('PASS: stale 200/401, private images, and image expiry cannot mix accounts');
  } finally { await context.close(); }
} finally { await browser.close(); }
