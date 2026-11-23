/**
 * Actual Chromium / IndexedDB synthetic race test for both public indexes.
 * Does not contact production, load private history, or alter real accounts.
 */
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {chromium} from 'playwright';
const BASE=process.env.BASE_URL??'http://127.0.0.1:8080';
if(!['localhost','127.0.0.1'].includes(new URL(BASE).hostname))
  throw Error('Only local CI is supported');
const compiled=await build({
  stdin:{
    contents:'export {syncOfflineParts,searchOfflineParts} from "../web/src/shopOffline.ts";\n'
      +'export {syncOfflineReferences,searchOfflineReferences} from "../web/src/shopReferenceOffline.ts";',
    resolveDir:new URL('../e2e/',import.meta.url).pathname,
    sourcefile:'shop-offline-test-entry.ts',loader:'ts',
  },
  bundle:true,write:false,platform:'browser',format:'esm',target:'es2022',
  plugins:[{
    name:'synthetic-offline-api',
    setup(b){
      b.onResolve({filter:/^\.\/api\.ts$/},()=>({path:'offline-api',namespace:'mock'}));
      b.onLoad({filter:/.*/,namespace:'mock'},()=>({
        contents:'export const get=(path)=>window.__ciShopGet(path);',loader:'js',
      }));
    },
  }],
});
const browser=await chromium.launch();
try{
  const page=await browser.newPage({serviceWorkers:'block'});
  await page.route('**/__ci_shop_offline_host',r=>r.fulfill({
    contentType:'text/html',body:'<!doctype html><meta charset="utf-8">Private CI fixture',
  }));
  await page.route('**/__ci_shop_offline.mjs',r=>r.fulfill({
    contentType:'text/javascript',body:compiled.outputFiles[0].text,
  }));
  await page.goto(BASE+'/__ci_shop_offline_host');
  const results=await page.evaluate(async()=>{
    const module=await import('/__ci_shop_offline.mjs');
    const partId='00000000-0000-4000-8000-000000000001';
    const refId='00000000-0000-4000-8000-000000000002';
    const row=(id,name)=>[id,'engine','Scania','A-123',name,null];
    const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
    async function exercise(reference,sync,search,id){
      const prefix=reference?'/api/shop/catalog/index/':'/api/shop/index/';
      const dbName=reference?'traksos-reviewed-reference-index':'traksos-parts-index';
      await new Promise((resolve,reject)=>{
        const r=indexedDB.deleteDatabase(dbName);
        r.onsuccess=resolve;r.onerror=()=>reject(r.error);
      });
      let mode='bad-snapshot',revision='1',queue=[];
      window.__ciShopGet=async path=>{
        if(path===prefix+'manifest')return {enabled:true,revision,count:1};
        if(path.startsWith(prefix+'page'))return {
          enabled:true,rows:[row(id,'старый насос')],
          next:mode==='bad-snapshot'?'00000000-0000-4000-8000-000000000099':null,
        };
        if(path.startsWith(prefix+'changes')){
          if(mode==='race')return new Promise(resolve=>queue.push(resolve));
          if(mode==='bad-delta')return {
            enabled:true,rows:[[4,...row(id,'плохой насос')]],next:'5',revision:'4',
          };
          return {enabled:true,rows:[],next:null,revision};
        }
        throw Error('Unexpected offline request: '+path);
      };
      let rejected=false;
      try{await sync()}catch{rejected=true}
      if(!rejected||(await search('старый')).length)throw Error('Invalid snapshot committed');
      mode='seed';
      if(!(await sync()).complete||(await search('старый')).length!==1)
        throw Error('Valid initial snapshot failed');
      mode='race';revision='3';
      const first=sync().then(()=>({ok:true}),e=>({ok:false,error:String(e.message)}));
      const second=sync().then(()=>({ok:true}),e=>({ok:false,error:String(e.message)}));
      for(let n=0;n<160&&queue.length<2;n++)await pause(10);
      if(queue.length!==2)throw Error('Race barrier was never reached');
      queue[1]({enabled:true,rows:[[3,...row(id,'новый насос')]],next:null,revision:'3'});
      if(!(await second).ok)throw Error('Fresh tab did not commit');
      queue[0]({enabled:true,rows:[[2,...row(id,'старый после обновления')]],next:null,revision:'2'});
      const stale=await first;
      if(stale.ok||!stale.error.includes('другой вкладке'))throw Error('Stale tab not rejected');
      if((await search('новый')).length!==1||(await search('старый после')).length)
        throw Error('Stale data overwrote the committed delta');
      mode='bad-delta';revision='4';rejected=false;
      try{await sync()}catch{rejected=true}
      if(!rejected||(await search('новый')).length!==1)
        throw Error('Malformed delta committed');
      mode='idle';revision='3';
      if(!(await sync()).unchanged)throw Error('Committed revision was rolled back');
      return {snapshotGuard:true,initialPage:true,crossTabCas:true,deltaGuard:true,checkpoint:true};
    }
    return {
      parts:await exercise(false,module.syncOfflineParts,module.searchOfflineParts,partId),
      references:await exercise(true,module.syncOfflineReferences,module.searchOfflineReferences,refId),
    };
  });
  for(const type of ['parts','references'])
    for(const [key,value] of Object.entries(results[type]))
      assert.equal(value,true,type+':'+key);
  console.log('PASS: 10 Chromium/IndexedDB integrity assertions for both offline indexes');
}finally{await browser.close()}
