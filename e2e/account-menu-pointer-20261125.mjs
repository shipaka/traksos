// Real Chromium interaction with the shared account menu and its actual CSS.
// No API credentials, external network, production data or server mutations.
import {build} from 'esbuild';
import {chromium} from 'playwright';
const bundle=await build({
  stdin:{contents:`
    import {createRoot} from 'react-dom/client';
    import {AccountMenuDetails} from './web/src/accountMenuDetails.tsx';
    createRoot(document.getElementById('root')).render(
      <AccountMenuDetails>
        <summary aria-label="Открыть меню кабинета">Меню</summary>
        <nav aria-label="Все разделы кабинета">
          <a href="#destination">Рабочий раздел</a>
          <button type="button">Действие</button>
        </nav>
      </AccountMenuDetails>
    );
  `,resolveDir:process.cwd(),loader:'tsx',sourcefile:'account-menu-test.tsx'},
  bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',
});
const browser=await chromium.launch();
const assert=(ok,message)=>{if(!ok)throw Error(message)};
async function setup(options){
  const ctx=await browser.newContext(options);
  const page=await ctx.newPage();
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.setContent('<!doctype html><html lang="ru"><body><button id="outside" style="position:absolute;left:10px;top:300px">Вне меню</button><div id="root" style="position:absolute;right:28px;top:28px"></div></body></html>');
  await page.addStyleTag({path:'web/src/styles.css'});
  await page.addScriptTag({content:bundle.outputFiles[0].text});
  const menu=page.locator('.account-menu');
  const trigger=menu.locator('summary');
  const link=menu.getByRole('link',{name:'Рабочий раздел'});
  const isOpen=()=>menu.evaluate(el=>el.open);
  await trigger.waitFor();
  return {ctx,page,errors,menu,trigger,link,isOpen};
}
try{
  const d=await setup({viewport:{width:1440,height:900}});
  await d.trigger.click();
  await d.link.waitFor({state:'visible'});
  const a=await d.trigger.boundingBox(), b=await d.link.boundingBox();
  assert(a&&b,'Missing real menu geometry');
  const x=a.x+a.width/2;
  assert(x>=b.x&&x<=b.x+b.width,'Menu trigger does not align with its flyout');
  // Traverse the visual gap slowly enough to catch a missing pointer bridge.
  for(let y=a.y+a.height-2;y<=b.y+4;y+=2){
    await d.page.mouse.move(x,y);
    await d.page.waitForTimeout(60);
    assert(await d.isOpen(),'Menu closed while moving from trigger to its panel');
  }
  // A short accidental excursion must not close a menu after returning.
  await d.page.mouse.move(4,500);
  await d.page.waitForTimeout(100);
  await d.link.hover();
  await d.page.waitForTimeout(400);
  assert(await d.isOpen(),'Stale hover timer closed a reentered menu');
  // A genuine departure still closes it.
  await d.page.mouse.move(4,500);
  await d.page.waitForFunction(()=>!document.querySelector('.account-menu').open);
  await d.trigger.click();
  await d.trigger.focus();
  await d.page.keyboard.press('Tab');
  assert(await d.link.evaluate(el=>document.activeElement===el),'Keyboard could not enter menu');
  await d.page.keyboard.press('Escape');
  assert(!await d.isOpen(),'Escape failed to close menu');
  assert(await d.trigger.evaluate(el=>document.activeElement===el),'Escape did not restore trigger focus');
  await d.trigger.click();
  await d.page.locator('#outside').click();
  assert(!await d.isOpen(),'Outside click failed to close menu');
  await d.trigger.click();
  await d.link.click();
  assert(!await d.isOpen(),'Menu remained open after navigation');
  assert(new URL(d.page.url()).hash==='#destination','Real link navigation failed');
  assert(d.errors.length===0,'Desktop JS errors: '+d.errors.join('; '));
  await d.ctx.close();

  const m=await setup({viewport:{width:390,height:844},hasTouch:true,isMobile:true});
  await m.trigger.tap();
  await m.link.waitFor({state:'visible'});
  await m.page.waitForTimeout(450);
  assert(await m.isOpen(),'Touch interaction triggered mouse-only dismissal');
  await m.menu.getByRole('button',{name:'Действие'}).tap();
  assert(!await m.isOpen(),'Touch action failed to close menu');
  await m.trigger.tap();
  await m.page.locator('#outside').tap();
  assert(!await m.isOpen(),'Outside tap failed to close menu');
  assert(m.errors.length===0,'Touch JS errors: '+m.errors.join('; '));
  await m.ctx.close();
  console.log('PASS account menu: slow pointer bridge, reentry, leave, keyboard, link and touch');
}finally{await browser.close();}
