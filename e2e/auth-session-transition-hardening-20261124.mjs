// PR #274: actual React Login with delayed, isolated auth responses in Chromium.
import { build } from 'esbuild';
import { chromium } from 'playwright';
const stubs={
  '../trakServiceIcon.tsx':'export function TrakServiceIcon(){return <svg aria-hidden="true"/>}',
  '../trakAppPhone.tsx':'export function TrakAppPhone(){return null}',
  '../native.ts':'export const native={isApp:false}',
  '../api.ts':[
    'export class ApiError extends Error {}',
    'export function setToken(t){window.mock.tokens.push(t)}',
    'export function getToken(){return window.mock.tokens.at(-1)??null}',
    'export function connectWs(){}',
    'export function post(path,body){return new Promise((resolve,reject)=>window.mock.requests.push({path,body,resolve,reject}))}'
  ].join('\n'),
  '../ui.tsx':[
    'export function useMe(){return {reload:async()=>{}}}',
    'export function useAction(){return {busy:false,run:async(fn)=>{try{return await fn()}catch{return null}}}}',
    'export function useToast(){return ()=>{}}',
    'export function Field({label,hint,children}){return <label>{label}{children}{hint&&<small>{hint}</small>}</label>}',
    "export function go(route){location.hash='#/'+route}"
  ].join('\n'),
  '../guestCatalog.ts':[
    'export const PUBLIC_HOME_TILES=[]',
    'export const MASTER_SPECIALTIES=[]',
    'export function rememberGuestAction(){}',
    'export function rememberGuestService(){}',
    'export function guestCustomerDestination(){return null}'
  ].join('\n'),
  './ownerDesktopHome20261120.tsx':'export function OwnerDesktopHome20261120(){return <div>Desktop background</div>}'
};
const result=await build({
  stdin:{contents:[
    "import React from 'react';import {createRoot} from 'react-dom/client';",
    "import {Login} from './web/src/screens/login.tsx';",
    "window.mock={requests:[],tokens:[]};",
    "const root=createRoot(document.getElementById('root'));",
    "window.renderLogin=(entry,key)=>root.render(React.createElement(Login,{entry,key}));",
    "window.renderLogin('register','register-1');"
  ].join('\n'),resolveDir:process.cwd(),sourcefile:'auth-flow-proof.tsx',loader:'tsx'},
  bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',
  // Explicit output name: esbuild otherwise reports the in-memory bundle as <stdout>.
  outfile:'auth-flow-proof.js',
  plugins:[{name:'auth-isolation',setup(b){
    b.onResolve({filter:/./},a=>Object.hasOwn(stubs,a.path)?{path:a.path,namespace:'auth-stub'}:undefined);
    b.onLoad({filter:/./,namespace:'auth-stub'},a=>({resolveDir:process.cwd(),
      contents:stubs[a.path],loader:a.path.endsWith('.tsx')?'tsx':'js'
    }));
  }}]
});
const js=result.outputFiles.find(f=>f.path.endsWith('.js'))?.text;
if(!js)throw Error('Real Login must compile');
const browser=await chromium.launch();
try{
  for(const width of [390,1440]){
    const page=await browser.newPage({viewport:{width,height:900},locale:'ru-RU'});
    const errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    try{
      await page.setContent('<!doctype html><div id="root"></div>');
      await page.addScriptTag({content:js});
      const resolve=(i,data)=>page.evaluate(([i,data])=>window.mock.requests[i].resolve(data),[i,data]);
      const settle=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      await page.getByRole('heading',{name:'Регистрация в TrakSOS'}).waitFor();
      let form=page.locator('form').last();
      await form.locator('input[type=tel]').fill('+79996660021');
      await form.locator('input[type=checkbox]').check();
      await form.getByRole('button',{name:'Получить код'}).click();
      await page.waitForFunction(()=>window.mock.requests.length===1);
      await form.evaluate(el=>el.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
      await settle();
      if(await page.evaluate(()=>window.mock.requests.length)!==1)throw Error('Duplicate SMS request while pending');
      await form.locator('input[type=tel]').fill('+79996660022');
      await resolve(0,{sent:true,devCode:'1234'});
      await settle();
      if(await page.locator('input[autocomplete="one-time-code"]').count())
        throw Error(width+'px: stale SMS showed OTP field for wrong phone');
      await form.getByRole('button',{name:'Получить код'}).click();
      await page.waitForFunction(()=>window.mock.requests.length===2);
      await resolve(1,{sent:true,devCode:'5678'});
      await page.locator('input[autocomplete="one-time-code"]').waitFor();
      await page.locator('input[autocomplete="one-time-code"]').fill('5678');
      await page.locator('input[autocomplete="new-password"]').fill('Password12345');
      await form.getByRole('button',{name:'Зарегистрироваться'}).click();
      await page.waitForFunction(()=>window.mock.requests.length===3);
      await form.evaluate(el=>el.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
      await settle();
      if(await page.evaluate(()=>window.mock.requests.length)!==3)throw Error('Duplicate verification request while pending');
      await form.getByRole('button',{name:'Другой номер'}).click();
      await resolve(2,{token:'STALE_REGISTER',user:{roles:['client']}});
      await settle();
      if(await page.evaluate(()=>window.mock.tokens.length))
        throw Error(width+'px: cancelled registration saved token');
      await page.evaluate(()=>window.renderLogin('login','login-2'));
      await page.getByRole('heading',{name:'Вход по номеру телефона'}).waitFor();
      form=page.locator('form').last();
      await form.locator('input[type=tel]').fill('+79996660031');
      await form.locator('input[type=password]').fill('PasswordAAAA');
      await form.getByRole('button',{name:'Войти',exact:true}).click();
      await page.waitForFunction(()=>window.mock.requests.length===4);
      await form.locator('input[type=tel]').fill('+79996660032');
      await resolve(3,{token:'STALE_LOGIN',user:{roles:['client']}});
      await settle();
      if(await page.evaluate(()=>window.mock.tokens.length))
        throw Error(width+'px: stale login changed account');
      await form.locator('input[type=password]').fill('PasswordBBBB');
      await form.getByRole('button',{name:'Войти',exact:true}).click();
      await page.waitForFunction(()=>window.mock.requests.length===5);
      // Editing only the password (same phone, same form) must release the
      // cancelled attempt immediately. Its delayed reply must neither set a
      // token nor unlock the newer in-flight request.
      await form.locator('input[type=password]').fill('PasswordCCCC');
      await form.getByRole('button',{name:'Войти',exact:true}).click();
      await page.waitForFunction(()=>window.mock.requests.length===6);
      await resolve(4,{token:'STALE_PASSWORD',user:{roles:['client']}});
      await settle();
      if(await page.evaluate(()=>window.mock.tokens.length))
        throw Error(width+'px: stale password attempt saved token');
      if(!await form.getByRole('button',{name:'Входим…',exact:true}).isDisabled())
        throw Error(width+'px: stale response unlocked a newer login');
      // Even a queued form submit event must not issue a second request.
      await form.evaluate(el=>el.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
      await settle();
      if(await page.evaluate(()=>window.mock.requests.length)!==6)
        throw Error(width+'px: duplicate login request while pending');
      // Moving from login to password recovery also cancels the active
      // login. Returning to login must not retain its busy state.
      await form.getByRole('button',{name:'Забыли пароль?'}).click();
      await page.getByRole('heading',{name:'Восстановить пароль'}).waitFor();
      await resolve(5,{token:'STALE_BEFORE_RESET',user:{roles:['client']}});
      await settle();
      if(await page.evaluate(()=>window.mock.tokens.length))
        throw Error(width+'px: cancelled login authenticated during password recovery');
      await page.locator('form').last().getByRole('button',{name:'Уже есть аккаунт? Войти по паролю'}).click();
      await page.getByRole('heading',{name:'Вход по номеру телефона'}).waitFor();
      form=page.locator('form').last();
      await form.locator('input[type=password]').fill('PasswordDDDD');
      await form.getByRole('button',{name:'Войти',exact:true}).click();
      await page.waitForFunction(()=>window.mock.requests.length===7);
      await resolve(6,{token:'CURRENT_LOGIN',user:{roles:['client']}});
      await page.waitForFunction(()=>window.mock.tokens.length===1);
      if(await page.evaluate(()=>window.mock.tokens[0])!=='CURRENT_LOGIN')
        throw Error('Wrong login token accepted');
      if(errors.length)throw Error(errors.join('; '));
      console.log('PASS actual Login auth request isolation '+width+'px');
    }finally{await page.close();}
  }
}finally{await browser.close();}
