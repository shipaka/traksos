// Regression: a user cannot accept an unread or failed-to-load contract.
// Exercises the actual OfferGate React component in Chromium with isolated API
// transport stubs. No PostgreSQL, SMS, production accounts, or UI redesign.
import { build } from 'esbuild';
import { chromium } from 'playwright';

const stubs = {
  // The isolated functional harness has no CSS output target; actual bundled
  // styles are asserted separately in offer-gate-role-ui.mjs.
  './offerGateApproved.css': '',
  '../api.ts': `
    export class ApiError extends Error {}
    export function onEvent() { return () => {}; }
    export function getToken(){return window.__offerMock.token;}
    export function get(path) {
      const mock = window.__offerMock;
      mock.ApiError = ApiError;
      mock.requests.push(path);
      if(path.startsWith('/api/offers/current/'))return new Promise((resolve,reject)=>mock.publicReads.push({path,resolve,reject}));
      if (path === '/api/me/offers') {
        return Promise.resolve([{audience:'client', name:'Оферта для клиентов',
          accepted:false, current:{id:'offer-1', version:'v1',
            effective_at:'2026-01-01T00:00:00Z'}}]);
      }
      if (path === '/api/offers/offer-1') {
        return new Promise((resolve,reject) => { mock.resolve = resolve; mock.reject = reject; });
      }
      throw Error('Unexpected GET: '+path);
    }
    export function post(path) {
      window.__offerMock.posts.push(path);
      return Promise.resolve({ok:true});
    }
  `,
  '../ui.tsx': `
    export function useMe(){return {me:{id:window.__offerMock.user},mode:'client'};}
    export function useAction(){return {
      busy:false,run:async(fn)=>{await fn();return true;}
    };}
  `,
  '../markdown.tsx': `export function Markdown({text}){return <article>{text}</article>;}`,
  './economicsGuide.tsx': `export function EconomicsGuide(){return null;}`,
};
const bundle = await build({
  stdin: { contents: `
    import React from 'react';
    import {createRoot} from 'react-dom/client';
    import {OfferGate, OfferPage, reportApiError} from './web/src/screens/offers.tsx';
    window.__sendOfferOutdated = () => {
      const error = new window.__offerMock.ApiError('outdated');
      error.code = 'offer_outdated';
      reportApiError(error);
    };
    window.__offerMock = {requests:[],posts:[],resolve:null,reject:null,user:'test-user',token:'A',publicReads:[]};
    const root=createRoot(document.getElementById('root'));
    window.__switchOfferUser=(user,token)=>{window.__offerMock.user=user;window.__offerMock.token=token;root.render(React.createElement(OfferGate));};
    root.render(React.createElement(OfferGate));
    window.__showPublicOffer=audience=>root.render(React.createElement(OfferPage,{audience}));
  `, resolveDir:process.cwd(), sourcefile:'offer-consent-entry.tsx', loader:'tsx' },
  bundle:true, write:false, platform:'browser', format:'iife', jsx:'automatic',
  plugins:[{
    name:'stub-only-network-and-layout',
    setup(build) {
      build.onResolve({filter:/./},args=>{
        if(Object.hasOwn(stubs,args.path))return {path:args.path,namespace:'offer-stub'};
      });
      build.onLoad({filter:/./,namespace:'offer-stub'},args=>({
        resolveDir:process.cwd(),
        contents:stubs[args.path],loader:args.path.endsWith('.tsx')?'tsx':'js'
      }));
    }
  }]
});
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.setContent('<!doctype html><html lang="ru"><body><div id="root"></div></body></html>');
  await page.addScriptTag({content:bundle.outputFiles[0].text});
  const modal=page.getByRole('dialog',{name:'Оферта для клиентов'});
  await modal.waitFor();
  const accept=modal.getByRole('button',{name:'Принимаю',exact:true});
  const agree=modal.getByRole('checkbox');

  // Pending GET: no checkbox or confirmation, even if the user tries to click.
  if(!await accept.isDisabled() || !await agree.isDisabled())
    throw Error('Consent enabled before contract text arrived');
  if((await page.evaluate(()=>window.__offerMock.posts.length))!==0)
    throw Error('Unexpected early contract acceptance');

  // Network failure: visible error and working retry, never silent acceptance.
  await page.evaluate(()=>window.__offerMock.reject(Error('offline')));
  await modal.getByRole('alert').waitFor();
  if(!await accept.isDisabled() || !await agree.isDisabled())
    throw Error('Consent enabled after contract GET failed');
  await modal.getByRole('button',{name:'Попробовать снова'}).click();
  await page.waitForFunction(()=>window.__offerMock.requests.filter(x=>x==='/api/offers/offer-1').length===2);

  // Stale/wrong edition must never be treated as accepted terms.
  await page.evaluate(()=>window.__offerMock.resolve({
    id:'offer-1',audience:'client',version:'obsolete',body:'Old text'
  }));
  await modal.getByRole('alert').waitFor();
  if(!await accept.isDisabled()) throw Error('Wrong contract edition can be accepted');
  await modal.getByRole('button',{name:'Попробовать снова'}).click();
  await page.waitForFunction(()=>window.__offerMock.requests.filter(x=>x==='/api/offers/offer-1').length===3);

  await page.evaluate(()=>window.__offerMock.resolve({
    id:'offer-1',audience:'client',version:'v1',body:'Полный действующий текст юридических условий'
  }));
  await modal.getByText('Полный действующий текст юридических условий').waitFor();
  if(await agree.isDisabled())throw Error('Checkbox did not activate after valid text');
  if(!await accept.isDisabled())throw Error('Acceptance activated without checkbox');
  await agree.check();
  if(await accept.isDisabled())throw Error('Valid accepted terms remain blocked');
  // Another account with the same edition cannot inherit checked consent.
  const readsBefore=await page.evaluate(()=>window.__offerMock.requests.filter(x=>x==='/api/offers/offer-1').length);
  await page.evaluate(()=>window.__switchOfferUser('test-user-B','B'));
  await page.waitForFunction(n=>window.__offerMock.requests.filter(x=>x==='/api/offers/offer-1').length>n,readsBefore);
  await modal.waitFor();
  if(!await accept.isDisabled()||await agree.isChecked())throw Error('Consent inherited by next account');
  await page.evaluate(()=>window.__offerMock.resolve({id:'offer-1',audience:'client',version:'v1',body:'Текст действующей редакции для B'}));
  await modal.getByText('Текст действующей редакции для B').waitFor();
  if(await agree.isChecked()||!await accept.isDisabled())throw Error('New account inherited consent after load');
  await agree.check();
  await accept.click();
  const posts=await page.evaluate(()=>window.__offerMock.posts);
  if(posts.length!==1 || posts[0]!=='/api/offers/offer-1/accept')
    throw Error('Expected one acceptance for the verified contract: '+JSON.stringify(posts));
  // An obsolete edition rejected by the server must refresh the list, so
  // the modal can show the new effective contract instead of trapping a user.
  const before=await page.evaluate(()=>
    window.__offerMock.requests.filter(x=>x==='/api/me/offers').length);
  await page.evaluate(()=>window.__sendOfferOutdated());
  await page.waitForFunction(n=>
    window.__offerMock.requests.filter(x=>x==='/api/me/offers').length>n,before);
  // Public route switches must not render another audience's document,
  // even if the old request resolves later or a proxy supplies a wrong payload.
  await page.evaluate(()=>window.__showPublicOffer('client'));
  await page.waitForFunction(()=>window.__offerMock.publicReads.length===1);
  const doc=(audience,body)=>({id:'public-'+audience,audience,version:'v1',body,effective_at:'2026-01-01T00:00:00Z'});
  await page.evaluate(data=>window.__offerMock.publicReads[0].resolve(data),doc('client','CLIENT LEGAL TEXT'));
  await page.getByText('CLIENT LEGAL TEXT',{exact:true}).waitFor();
  await page.evaluate(()=>window.__showPublicOffer('performer'));
  await page.waitForFunction(()=>window.__offerMock.publicReads.length===2);
  if(await page.getByText('CLIENT LEGAL TEXT',{exact:true}).count())throw Error('Old client legal text visible in partner document');
  await page.evaluate(()=>window.__showPublicOffer('privacy'));
  await page.waitForFunction(()=>window.__offerMock.publicReads.length===3);
  await page.evaluate(data=>window.__offerMock.publicReads[1].resolve(data),doc('performer','LATE PARTNER LEGAL TEXT'));
  await page.evaluate(data=>window.__offerMock.publicReads[2].resolve(data),doc('client','WRONG AUDIENCE TEXT'));
  await page.getByRole('alert').waitFor();
  for(const body of ['CLIENT LEGAL TEXT','LATE PARTNER LEGAL TEXT','WRONG AUDIENCE TEXT']){
    if(await page.getByText(body,{exact:true}).count())throw Error('Unexpected legal edition: '+body);
  }
  await page.getByRole('button',{name:'Попробовать снова'}).click();
  await page.waitForFunction(()=>window.__offerMock.publicReads.length===4);
  await page.evaluate(data=>window.__offerMock.publicReads[3].resolve(data),doc('privacy','CURRENT PRIVACY TEXT'));
  await page.getByText('CURRENT PRIVACY TEXT',{exact:true}).waitFor();
  if(errors.length)throw Error('Browser errors: '+errors.join('; '));
  await page.close();
  console.log('PASS: real OfferGate disallows pending/failed/stale consent; retry and valid acceptance work');
} finally {
  await browser.close();
}
