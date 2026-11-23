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
    // Do not mount the real React app here: it imports another instance of
    // api.ts, causing TWO storage listeners and duplicate external-change
    // events. This test must own exactly one instance of the transport.
    await page.route('**/__ci_api_session_race_host',route=>
      route.fulfill({status:200,contentType:'text/html',
        body:'<!doctype html><html lang="ru"><head><meta charset="utf-8"></head><body>Isolated CI transport</body></html>'}));
    await page.route('**/__ci_api_session_race.mjs',route=>
      route.fulfill({status:200,contentType:'text/javascript',body:compiled.code}));
    await page.goto(BASE+'/__ci_api_session_race_host',{waitUntil:'domcontentloaded'});
    const actual=await page.evaluate(async()=>{
      const module=await import('/__ci_api_session_race.mjs');
      const originalFetch=window.fetch.bind(window);
      const pending=[],pendingImages=[],orderCalls=[];
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
        if(String(url).endsWith('/api/orders') && options?.method==='POST'){
          orderCalls.push({
            auth:options.headers?.authorization,
            key:options.headers?.['idempotency-key']
          });
          return Promise.resolve(response(
            orderCalls.length===1 || orderCalls.length===3 ? 503 : 200,
            orderCalls.length===1 || orderCalls.length===3
              ? {error:'temporary'}
              : {order:{id:'CI-NEW-ORDER'}}
          ));
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

        module.setToken('CI-TAB-OLD');
        const oldTabRequest=module.api('GET','/api/me').catch(e=>e);
        result.oldTabAuth=pending[3]?.auth;
        let externalChanges=0;
        window.addEventListener('traksos-auth-external-change',()=>externalChanges++);
        window.dispatchEvent(new StorageEvent('storage',{
          key:'traksos.token',oldValue:'CI-TAB-OLD',
          newValue:'CI-TAB-NEW',storageArea:localStorage
        }));
        result.crossTabToken=module.getToken();
        pending[3].resolve(response(200,{id:'old-tab-private-profile'}));
        result.oldTabCode=(await oldTabRequest).code;
        window.dispatchEvent(new StorageEvent('storage',{
          key:'traksos.token',oldValue:'CI-TAB-NEW',
          newValue:null,storageArea:localStorage
        }));
        result.crossTabLogoutToken=module.getToken();
        result.externalChanges=externalChanges;

        // The first order failed ambiguously; its request key must remain
        // reusable for THIS account only, not after a different login.
        const orderBody={service:'hydraulics',zoneId:'spb',
          description:'CI idempotency isolation, no live booking'};
        // Hold the asynchronous fingerprint half-way through an account
        // switch: no POST may escape under the replacement account.
        const digestOriginal=SubtleCrypto.prototype.digest;
        let releaseDigest;
        SubtleCrypto.prototype.digest=function(...args){
          return new Promise(resolve=>{releaseDigest=()=>resolve(digestOriginal.apply(this,args));});
        };
        try {
          module.setToken('CI-HASH-OLD');
          const lateOrder=module.postOrder(orderBody).catch(e=>e);
          module.setToken('CI-HASH-NEW');
          releaseDigest();
          const lateError=await lateOrder;
          result.lateOrderCode=lateError.code;
          result.ordersAfterLateFingerprint=orderCalls.length;
        } finally {
          SubtleCrypto.prototype.digest=digestOriginal;
        }
        module.setToken('CI-ORDER-OLD');
        const ambiguous=await module.postOrder(orderBody).catch(e=>e);
        result.ambiguousOrderStatus=ambiguous.status;
        module.setToken('CI-ORDER-NEW');
        const orderCreated=await module.postOrder(orderBody);
        result.orderKeys=orderCalls.map(x=>x.key);
        result.orderAuth=orderCalls.map(x=>x.auth);
        result.newOrderId=orderCreated.order.id;

        // Two attempts by the SAME user with an identical form after a
        // temporary network/API error must retain one idempotency key.
        module.setToken('CI-RETRY-SAME-USER');
        const firstRetry=await module.postOrder(orderBody).catch(e=>e);
        // Structurally identical JSON, deliberately reinserted with a
        // different key order (including a future nested vehicle object).
        const reordered={
          description:orderBody.description,
          zoneId:orderBody.zoneId,
          service:orderBody.service
        };
        const successfulRetry=await module.postOrder(reordered);
        result.sameUserFirstStatus=firstRetry.status;
        result.sameUserSecondId=successfulRetry.order.id;
        result.sameUserKeys=orderCalls.slice(2).map(x=>x.key);
        result.sameUserAuth=orderCalls.slice(2).map(x=>x.auth);
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
    assert.equal(actual.oldTabAuth,'Bearer CI-TAB-OLD');
    assert.equal(actual.crossTabToken,'CI-TAB-NEW');
    assert.equal(actual.oldTabCode,'session_changed',
      'cross-tab login must reject the previous tab token payload');
    assert.equal(actual.crossTabLogoutToken,null);
    assert.equal(actual.externalChanges,2,
      'external login and logout must both notify the app');
    assert.equal(actual.lateOrderCode,'session_changed');
    assert.equal(actual.ordersAfterLateFingerprint,0,
      'unfinished old-account form was POSTed as a new user while digesting');
    assert.equal(actual.ambiguousOrderStatus,503);
    assert.equal(actual.orderAuth[0],'Bearer CI-ORDER-OLD');
    assert.equal(actual.orderAuth[1],'Bearer CI-ORDER-NEW');
    assert.equal(actual.orderKeys.length,2);
    assert.ok(actual.orderKeys[0] && actual.orderKeys[1]);
    assert.notEqual(actual.orderKeys[0],actual.orderKeys[1],
      'account switch reused previous user pending order idempotency key');
    assert.equal(actual.newOrderId,'CI-NEW-ORDER');
    assert.equal(actual.sameUserFirstStatus,503);
    assert.equal(actual.sameUserSecondId,'CI-NEW-ORDER');
    assert.equal(actual.sameUserKeys.length,2);
    assert.ok(actual.sameUserKeys[0]);
    assert.equal(actual.sameUserKeys[0],actual.sameUserKeys[1],
      'same-account retry with reordered JSON keys could create a duplicate order');
    assert.deepEqual(actual.sameUserAuth,[
      'Bearer CI-RETRY-SAME-USER','Bearer CI-RETRY-SAME-USER'
    ]);
    // Even a misconfigured sandbox build cannot send protected images to a
    // foreign API. This isolated module uses a synthetic token, never live.
    await page.route('**/__ci_api_remote_transport.mjs',route=>
      route.fulfill({status:200,contentType:'text/javascript',body:compiled.code}));
    const sandboxGuard=await page.evaluate(async()=>{
      const original=window.fetch;let sends=0;
      window.fetch=(...args)=>{
        if(String(args[0]).includes('ci-foreign.example'))sends++;
        return original.apply(window,args);
      };
      try {
        sessionStorage.setItem('traksos.sandboxMode','1');
        window.TRAKSOS_API='https://ci-foreign.example';
        const remote=await import('/__ci_api_remote_transport.mjs');
        remote.setToken('CI-FAKE-SANDBOX-TOKEN');
        const json=await remote.api('GET','/api/me').catch(e=>e.code);
        const image=await remote.authedImage('/api/private-image').catch(e=>e.code);
        return {json,image,sends};
      }finally{
        delete window.TRAKSOS_API;
        sessionStorage.removeItem('traksos.sandboxMode');
        window.fetch=original;
      }
    });
    assert.equal(sandboxGuard.json,'sandbox_wrong_origin');
    assert.equal(sandboxGuard.image,'sandbox_wrong_origin');
    assert.equal(sandboxGuard.sends,0,
      'test sandbox sent a private bearer to a foreign API origin');
    // Now exercise ACTUAL browser localStorage propagation across two
    // independent documents of the same origin, not just synthetic events.
    // Use the SAME isolated HTML fixture for two tabs. Browsers may render
    // JSON /api/health as a special viewer document without JS module support;
    // that is not evidence of an auth regression in the application.
    await context.route('**/__ci_api_session_race_host',route=>
      route.fulfill({status:200,contentType:'text/html',
        body:'<!doctype html><html lang="ru"><head><meta charset="utf-8"></head><body>Isolated cross-tab CI</body></html>'}));
    await context.route('**/__ci_api_session_race.mjs',route=>
      route.fulfill({status:200,contentType:'text/javascript',body:compiled.code}));
    const tabA=await context.newPage();
    const tabB=await context.newPage();
    try {
      await Promise.all([
        tabA.goto(BASE+'/__ci_api_session_race_host'),
        tabB.goto(BASE+'/__ci_api_session_race_host')
      ]);
      const loadModule=async page=>page.evaluate(async()=>{
        window.ciApi=await import('/__ci_api_session_race.mjs');
        window.ciExternalChanges=0;
        window.addEventListener('traksos-auth-external-change',()=>
          window.ciExternalChanges++);
      });
      await Promise.all([loadModule(tabA),loadModule(tabB)]);
      await tabA.evaluate(()=>window.ciApi.setToken('CI-REAL-TAB-A'));
      await tabB.waitForFunction(()=>window.ciApi.getToken()==='CI-REAL-TAB-A');
      await tabB.evaluate(()=>window.ciApi.setToken('CI-REAL-TAB-B'));
      await tabA.waitForFunction(()=>window.ciApi.getToken()==='CI-REAL-TAB-B');
      await tabB.evaluate(()=>window.ciApi.setToken(null));
      await tabA.waitForFunction(()=>window.ciApi.getToken()===null);
      const [changesA,changesB]=await Promise.all([
        tabA.evaluate(()=>window.ciExternalChanges),
        tabB.evaluate(()=>window.ciExternalChanges),
      ]);
      assert.equal(changesA,2,'tab A must see tab B login AND logout');
      assert.equal(changesB,1,'tab B must receive tab A login once');
    } finally {
      await Promise.all([tabA.close(),tabB.close()]);
    }
    console.log('PASS: real cross-tab login/logout, stale API responses and private images cannot mix accounts');
  } finally { await context.close(); }
} finally { await browser.close(); }
