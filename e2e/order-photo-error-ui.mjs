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
    export const post=async()=>{throw Error('No real upload allowed in this fixture')};
    export async function get(path){
      window.__calls.gallery++;
      if(!path.includes('/api/orders/synthetic-order/photos'))throw Error('Unexpected request '+path);
      if(window.__galleryFailures-->0)throw Error('Temporary offline failure');
      return [{id:'synthetic-photo',mime:'image/png',size_bytes:68,
        created_at:'2026-11-22T12:00:00.000Z',uploader_name:'Тестовый мастер'}];
    }
    export async function authedImage(path,options={}){
      window.__calls.photo++;
      if(!path.includes('/synthetic-order/photos/synthetic-photo/file'))
        throw Error('Unexpected private photo '+path);
      if(!window.__authToken)throw Error('No bearer token');
      if(window.__photoFailures-->0)throw Error('Temporary private photo error');
      if(options.signal?.aborted)throw Error('Request aborted');
      const bytes=Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9YVBi4IAAAAASUVORK5CYII='),x=>x.charCodeAt(0));
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
  await page.getByRole('dialog',{name:'Фото ремонта'}).waitFor();
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
  assert(!jsErrors.length,'Runtime error: '+jsErrors.join('; '));
  console.log('PASS: order photo error/retry UI; review-only accessibility; private blob cleanup on logout');
} catch(error) {
  if(jsErrors.length)console.error('Browser runtime errors:',jsErrors.join('; '));
  throw error;
} finally {
  await browser.close();
}
