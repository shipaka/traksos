/**
 * Real Chromium interaction test for PRIVATE order-photo error and retry states.
 * Uses the actual React/TSX component with isolated local mock transports:
 * no production orders, no remote images, no real uploads or PII.
 *
 * Run after npm install + npx playwright install chromium:
 *   node e2e/order-photo-error-ui.mjs
 */
import { build } from 'esbuild';
import { chromium } from 'playwright';

const assert=(ok,message)=>{if(!ok)throw new Error(message)};
const snippets={
  api:`
    export const getToken=()=>window.__authToken;
    export const post=(path,body)=>{
      if(!window.__uploadFixture||!/^\\/api\\/orders\\/synthetic-(?:A|B)\\/photos$/.test(path))
        throw Error('No real upload allowed in this fixture: '+path);
      return new Promise((resolve,reject)=>window.__uploadFixture.posts.push({path,body,resolve,reject}));
    };
    export async function get(path){
      window.__calls.gallery++;
      if(!path.includes('/api/orders/synthetic-order/photos'))throw Error('Unexpected request '+path);
      if(window.__galleryFailures-->0)throw Error('Temporary offline failure');
      return [{id:'synthetic-photo',mime:'image/png',size_bytes:70,
        created_at:'2026-11-22T12:00:00.000Z',uploader_name:'Тестовый мастер'}];
    }
    export async function authedImage(path,options={}){
      window.__calls.photo++;
      if(!path.includes('/synthetic-order/photos/synthetic-photo/file'))
        throw Error('Unexpected private photo '+path);
      if(!window.__authToken)throw Error('No bearer token');
      if(window.__photoFailures-->0)throw Error('Temporary private photo error');
      if(options.signal?.aborted)throw Error('Request aborted');
      const bytes=Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='),x=>x.charCodeAt(0));
      const url=URL.createObjectURL(new Blob([bytes],{type:'image/png'}));
      window.__loadedUrls.push(url);
      return url;
    }
  `,
  ui:`
    import {useCallback,useEffect,useRef,useState} from 'react';
    export function useLoad(fn,deps){
      const [data,setData]=useState(null),[error,setError]=useState(null);
      const current=useRef(fn);current.current=fn;
      const reload=useCallback(async()=>{
        try{setData(await current.current());setError(null)}
        catch(e){setError(e.message)}
      },[]);
      useEffect(()=>{setData(null);void reload()},deps);
      return {data,error,reload};
    }
    export const useToast=()=>message=>window.__toasts.push(message);
  `,
  glyph:`
    import React from 'react';
    export const NavGlyph=({glyph})=>React.createElement('span',{'aria-hidden':true},glyph);
  `,
};
const plugin={
  name:'order-photo-mocked-transport',
  setup(p){
    const modules=new Map([
      ['../api.ts','api'],['../ui.tsx','ui'],
      ['../navGlyph.tsx','glyph'],['./orderPhotos.css','css']
    ]);
    p.onResolve({filter:/./},args=>{
      if(!args.importer.endsWith('/web/src/screens/orderPhotos.tsx'))return;
      const key=modules.get(args.path);
      if(key)return {path:key,namespace:'photo-test'};
    });
    p.onLoad({filter:/.*/,namespace:'photo-test'},args=>
      ({contents:snippets[args.path]||'',loader:'js',resolveDir:process.cwd()}));
  }
};
const harness=`
  import React from 'react';
  import {createRoot} from 'react-dom/client';
  import {OrderPhotoCapture,OrderPhotoGallery} from './web/src/screens/orderPhotos.tsx';
  const root=createRoot(document.getElementById('root'));
  root.render(React.createElement(React.Fragment,null,
    React.createElement(OrderPhotoCapture,{orderId:'synthetic-order',reviewOnly:true}),
    React.createElement(OrderPhotoGallery,{orderId:'synthetic-order'})));
  window.renderCapture=(orderId,reviewOnly=false)=>root.render(orderId
    ?React.createElement(OrderPhotoCapture,{orderId,reviewOnly}):null);
`;
const compiled=await build({
  stdin:{contents:harness,resolveDir:process.cwd(),sourcefile:'order-photo-harness.tsx',loader:'tsx'},
  platform:'browser',format:'iife',bundle:true,write:false,jsx:'automatic',
  plugins:[plugin],define:{'process.env.NODE_ENV':'"production"'},
});
const browser=await chromium.launch();
const jsErrors=[];
try{
  const page=await browser.newPage({viewport:{width:390,height:844},locale:'ru-RU'});
  page.on('pageerror',err=>jsErrors.push(err.message));
  await page.goto('about:blank');
  await page.setContent('<!doctype html><html><body><div id="root"></div></body></html>');
  await page.evaluate(()=>{
    window.__authToken='synthetic-bearer';
    window.__galleryFailures=1;
    window.__photoFailures=1;
    window.__calls={gallery:0,photo:0};
    window.__loadedUrls=[];
    window.__revokedUrls=[];
    window.__toasts=[];
    const nativeRevoke=URL.revokeObjectURL.bind(URL);
    URL.revokeObjectURL=url=>{window.__revokedUrls.push(url);nativeRevoke(url)};
  });
  await page.addScriptTag({content:compiled.outputFiles[0].text});
  await page.getByRole('img',{name:/только демонстрация/}).waitFor();
  assert(await page.getByRole('button',{name:/Фото заявки — безопасное демо/}).count()===0,
    'Review-only photo action is still a dead interactive button');

  await page.getByRole('alert',{name:'Ошибка загрузки фотографий заявки'}).waitFor();
  await page.getByRole('button',{name:'Повторить загрузку',exact:true}).click();
  await page.getByRole('button',{name:/Повторить загрузку фото ремонта/}).waitFor();
  const failures=await page.evaluate(()=>({...window.__calls}));
  assert(failures.gallery===2&&failures.photo===1,
    'Gallery/private image failure was not exercised: '+JSON.stringify(failures));

  await page.getByRole('button',{name:/Повторить загрузку фото ремонта/}).click();
  await page.getByRole('button',{name:/Посмотреть фото ремонта/}).waitFor();
  await page.getByRole('button',{name:/Посмотреть фото ремонта/}).click();
  const preview=page.getByRole('dialog',{name:'Фото ремонта'});
  await preview.waitFor();
  const previewImage=preview.getByRole('img',{name:'Фотография ремонта, прикреплённая к заявке'});
  await previewImage.evaluate(async img=>{
    await img.decode();
    if(img.naturalWidth!==1||img.naturalHeight!==1)throw Error('Synthetic photo did not decode to its expected dimensions');
  });
  await page.keyboard.press('Escape');
  assert(await page.getByRole('dialog',{name:'Фото ремонта'}).count()===0,
    'Escape did not close photo preview');

  // Browser storage logout is an explicit token-boundary event. The old blob
  // must be released, never left visible in a second user's gallery.
  await page.evaluate(()=>{
    window.__authToken=null;
    window.dispatchEvent(new Event('traksos-auth-external-change'));
  });
  await page.getByRole('button',{name:/Повторить загрузку фото ремонта/}).waitFor();
  const final=await page.evaluate(()=>({
    counts:window.__calls,
    urls:window.__loadedUrls,
    revoked:window.__revokedUrls,
  }));
  assert(final.revoked.includes(final.urls[0]),
    'Old-account private Blob URL not revoked on external sign-out: '+JSON.stringify(final));
  assert(final.counts.gallery===2&&final.counts.photo===2,
    'Unexpected server request/automatic photo retry: '+JSON.stringify(final.counts));
  // Real file conversion and a deferred transport; no actual server upload.
  // Use the SAME component instance across order changes (no key-based reset).
  await page.evaluate(()=>{
    window.__authToken='upload-token';
    window.__uploadFixture={decodes:[],posts:[],events:[]};
    const realDecode=window.createImageBitmap.bind(window);
    window.createImageBitmap=async(file,...args)=>{
      const bitmap=await realDecode(file,...args);
      return new Promise(resolve=>window.__uploadFixture.decodes.push(()=>resolve(bitmap)));
    };
    window.addEventListener('traksos-photo-added',event=>window.__uploadFixture.events.push(event.detail.orderId));
    window.renderCapture('synthetic-A');
  });
  const fileInput=page.locator('input[type=file]');
  await fileInput.waitFor({state:'attached'});
  // A deterministic noisy synthetic image is large enough for safeJpeg's
  // actual min/max JPEG contract. No user photo or external data.
  const png=await page.evaluate(()=>{
    const c=document.createElement('canvas');c.width=c.height=128;
    const ctx=c.getContext('2d'), data=ctx.createImageData(128,128);
    let seed=11;
    for(let i=0;i<data.data.length;i+=4){
      seed=(Math.imul(seed,1664525)+1013904223)>>>0;
      data.data[i]=seed>>>24;data.data[i+1]=(seed>>>16)&255;data.data[i+2]=(seed>>>8)&255;data.data[i+3]=255;
    }
    ctx.putImageData(data,0,0);
    return c.toDataURL('image/png').split(',')[1];
  });
  const pick=()=>fileInput.setInputFiles({name:'synthetic.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});
  const waitDecode=count=>page.waitForFunction(n=>window.__uploadFixture.decodes.length===n,count);
  const releaseDecode=i=>page.evaluate(i=>window.__uploadFixture.decodes[i](),i);
  const settle=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  const posts=()=>page.evaluate(()=>window.__uploadFixture.posts.length);
  await pick();await waitDecode(1);
  assert(await fileInput.isDisabled(),'Pending file conversion must lock input');
  await page.evaluate(()=>window.renderCapture('synthetic-B'));
  await page.waitForFunction(()=>!document.querySelector('input[type=file]').disabled);
  await pick();await waitDecode(2);
  await releaseDecode(0);await settle();
  assert(await posts()===0,'Old-order JPEG was submitted after route switch');
  assert(await fileInput.isDisabled(),'Old-order conversion unlocked new upload');
  await releaseDecode(1);
  await page.waitForFunction(()=>window.__uploadFixture.posts.length===1);
  const posted=await page.evaluate(()=>window.__uploadFixture.posts.map(x=>({path:x.path,jpeg:x.body.dataUrl.startsWith('data:image/jpeg;base64,')})));
  assert(posted[0].path==='/api/orders/synthetic-B/photos'&&posted[0].jpeg,'Active-order photo did not reach expected JPEG endpoint');
  // Simulate switching account while the write result is pending: no old
  // success toast/event and no automatic replay under replacement token.
  const toastCount=await page.evaluate(()=>window.__toasts.length);
  await page.evaluate(()=>{
    window.__authToken='replacement-token';
    window.dispatchEvent(new Event('traksos-auth-external-change'));
    window.__uploadFixture.posts[0].resolve({ok:true});
  });
  await settle();
  assert(await page.evaluate(()=>window.__uploadFixture.events.length)===0,'Old upload completion notified replacement workspace');
  assert(await page.evaluate(()=>window.__toasts.length)===toastCount,'Old upload completion notified replacement account');
  await pick();await waitDecode(3);
  await page.evaluate(()=>window.renderCapture('synthetic-B',true));
  await page.getByRole('img',{name:/только демонстрация/}).waitFor();
  await releaseDecode(2);await settle();
  assert(await posts()===1,'Review-only transition submitted old file');
  await page.evaluate(()=>window.renderCapture('synthetic-A'));
  await fileInput.waitFor({state:'attached'});
  await pick();await waitDecode(4);
  await page.evaluate(()=>window.renderCapture(null));
  await fileInput.waitFor({state:'detached'});
  await releaseDecode(3);await settle();
  assert(await posts()===1,'Unmounted capture submitted old file');
  // Positive control: a current upload completes, emits only its own event
  // and clears the file. Cancellation tests cannot pass by disabling uploads.
  await page.evaluate(()=>window.renderCapture('synthetic-B'));
  await fileInput.waitFor({state:'attached'});
  await pick();await waitDecode(5);await releaseDecode(4);
  await page.waitForFunction(()=>window.__uploadFixture.posts.length===2);
  await page.evaluate(()=>window.__uploadFixture.posts[1].resolve({ok:true}));
  await page.waitForFunction(()=>window.__uploadFixture.events.length===1 &&
    !document.querySelector('input[type=file]').disabled &&
    document.querySelector('input[type=file]').value==='');
  assert(await page.evaluate(()=>window.__uploadFixture.events[0])==='synthetic-B','Wrong current upload event');
  // Account switch during conversion (including a repeated token value
  // accompanied by an explicit auth boundary) must never send that file.
  await pick();await waitDecode(6);
  await page.evaluate(()=>window.dispatchEvent(new Event('traksos-auth-external-change')));
  await page.waitForFunction(()=>!document.querySelector('input[type=file]').disabled);
  await releaseDecode(5);await settle();
  assert(await posts()===2,'Old JPEG submitted after explicit auth boundary');
  assert(await page.evaluate(()=>window.__uploadFixture.events.length)===1,'Auth-cancelled conversion emitted an event');
  assert(!jsErrors.length,'Runtime error: '+jsErrors.join('; '));
  console.log('PASS: order photo error/retry UI; review-only accessibility; private blob cleanup on logout; delayed upload route/auth/review boundaries');
} catch(error) {
  if(jsErrors.length)console.error('Browser runtime errors:',jsErrors.join('; '));
  throw error;
} finally {
  await browser.close();
}
