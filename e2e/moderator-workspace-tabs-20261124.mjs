// PR #274 moderator workspace regression: actual React component in Chromium.
// Isolated queue stubs avoid privileged API calls and preserve production ACL.
import { build } from 'esbuild';
import { chromium } from 'playwright';

const stubs = {
  './moderation.tsx': "export function ModQueue(){return <p data-testid='queue-cases'>Споры: тестовая очередь</p>}",
  './support.tsx': "export function SupportQueue(){return <p data-testid='queue-support'>Обращения: тестовая очередь</p>}",
  './admin.tsx': "export function Verify(){return <p data-testid='queue-verify'>Проверка мастеров: тестовая очередь</p>} export function Flagged(){return <p data-testid='queue-flagged'>Подозрительное: тестовая очередь</p>}",
  '../navGlyph.tsx': "export function NavGlyph(){return <svg aria-hidden='true' viewBox='0 0 20 20'><circle cx='10' cy='10' r='6'/></svg>}"
};
const output = await build({
  stdin: {contents: [
    "import React from 'react';",
    "import {createRoot} from 'react-dom/client';",
    "import {ModeratorDesk} from './web/src/screens/moderatorDesk.tsx';",
    "const root=createRoot(document.getElementById('root'));",
    "window.__renderDesk=(tab)=>root.render(React.createElement(ModeratorDesk,{initialTab:tab}));",
    "window.__renderDesk('cases');"
  ].join('\n'), resolveDir:process.cwd(), sourcefile:'moderator-workspace-test-entry.tsx', loader:'tsx'},
  bundle:true, write:false, outdir:'./e2e/.tmp-moderator-proof', platform:'browser', format:'iife', jsx:'automatic',
  plugins:[{name:'isolate-real-moderator',setup(b){
    b.onResolve({filter:/./},args=>{
      if(Object.hasOwn(stubs,args.path))return {path:args.path,namespace:'moderator-test-stub'};
    });
    b.onLoad({filter:/./,namespace:'moderator-test-stub'},args=>({
      contents:stubs[args.path],loader:'tsx'
    }));
  }}]
});
const js=output.outputFiles.find(file=>file.path.endsWith('.js'))?.text;
const css=output.outputFiles.find(file=>file.path.endsWith('.css'))?.text;
if(!js || !css)throw Error('Moderator bundle must include the actual component and responsive CSS');
const browser=await chromium.launch();
const check=(ok,message)=>{if(!ok)throw Error(message)};
const queueKeys=['cases','support','verify','flagged'];
try{
  for (const width of [390,1440]) {
    const page=await browser.newPage({viewport:{width,height:844}});
    try {
      const errors=[];
      page.on('pageerror',error=>errors.push(error.message));
      await page.setContent('<!doctype html><html lang="ru"><body><div id="root"></div></body></html>');
      await page.addStyleTag({content:css});
      await page.addScriptTag({content:js});
      await page.getByRole('heading',{name:'Модерация'}).waitFor();
      const cards=page.locator('.moderator-action-grid .moderator-action');
      check(await cards.count()===4,width+'px: missing one of four real queue actions');
      for (const key of queueKeys) {
        const index=queueKeys.indexOf(key);
        await cards.nth(index).click();
        await page.getByTestId('queue-'+key).waitFor();
        check(await page.locator('.moderator-action.active').count()===1,
          width+'px: multiple selected queue cards');
        check(await cards.nth(index).getAttribute('aria-pressed')==='true',
          width+'px: wrong selected queue '+key);
      }
      const strip=page.locator('.moderator-desk-tabs');
      if(width<900){
        check(!(await strip.isVisible()),
          'Mobile duplicated the four action cards with an extra tab strip');
      } else {
        check(await strip.isVisible(),'Desktop approved tab strip disappeared');
        const tabs=page.getByRole('tab');
        check(await tabs.count()===4,'Desktop needs all four accessible tabs');
        await tabs.nth(0).focus();
        await tabs.nth(0).press('End');
        await page.getByTestId('queue-flagged').waitFor();
        check(await tabs.nth(3).getAttribute('aria-selected')==='true',
          'End did not select the last desktop tab');
        check(await tabs.nth(3).evaluate(node=>document.activeElement===node),
          'Arrow keyboard focus did not move to new tab');
        await tabs.nth(3).press('ArrowRight');
        await page.getByTestId('queue-cases').waitFor();
        check(await tabs.nth(0).getAttribute('aria-selected')==='true',
          'ArrowRight did not wrap to first tab');
      }

      // Simulate the router reusing the same component for another
      // #/moderation/* URL. A local choice must not override the new route.
      await cards.nth(1).click();
      await page.getByTestId('queue-support').waitFor();
      await page.evaluate(()=>window.__renderDesk('verify'));
      await page.getByTestId('queue-verify').waitFor();
      check(await page.locator('.moderator-action.active').count()===1,
        width+'px: routing left multiple active actions');
      check(await cards.nth(2).getAttribute('aria-pressed')==='true',
        width+'px: deep link did not replace old local selection');
      const panel=page.getByRole('tabpanel');
      check((await panel.getAttribute('aria-labelledby'))==='moderator-desk-tab-verify',
        width+'px: queue panel label is out of sync');
      const iconColor=await cards.first().locator('span').first().evaluate(
        el=>getComputedStyle(el).color);
      check(iconColor==='rgb(255, 171, 89)',
        width+'px: moderator still has off-brand/purple icon color: '+iconColor);
      check(!errors.length,width+'px: browser errors: '+errors.join('; '));
      console.log('PASS: moderator real React desktop/mobile tabs '+width+'px');
    } finally {
      await page.close();
    }
  }
} finally {
  await browser.close();
}
