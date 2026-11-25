// Test the shared grouping and actual compact menu in Chromium without any
// external network, accounts or data mutations.
import {build} from 'esbuild';
import {chromium} from 'playwright';
const bundle=await build({
  stdin:{contents:`
    import {createRoot} from 'react-dom/client';
    import {MobileRoleMenu} from './web/src/mobileRoleMenu.tsx';
    import {groupCabinetMenu} from './web/src/cabinetMenuGroups.ts';
    const account=[['/work','Рабочий стол'],['/profile','Аккаунт'],['/support','Поддержка'],['/work/docs','Проверка и документы']];
    const help=[['/support','Поддержка'],['/help','Помощь и подсказки'],['/training','Обучение'],['/rules','Правила площадки'],['/offer/performer','Оферта'],['/offer/privacy','Оферта'],['/offer/privacy','Политика персональных данных'],['/privacy','Мои персональные данные']];
    const groups=groupCabinetMenu(account,help);
    window.groups=groups;
    createRoot(document.getElementById('root')).render(<MobileRoleMenu mode="performer" quick={[['/work','⌂','Главная'],['/menu','menu','Меню']]} account={account} help={help} onLogout={()=>{}}/>);
  `,resolveDir:process.cwd(),loader:'tsx',sourcefile:'cabinet-menu-groups-test.tsx'},
  bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',
});
const browser=await chromium.launch();
const assert=(ok,message)=>{if(!ok)throw Error(message)};
try{
  for(const width of [320,390,1440]){
    const ctx=await browser.newContext({viewport:{width,height:900}});
    const page=await ctx.newPage();
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.setContent('<!doctype html><html lang="ru"><body><div id="root"></div></body></html>');
    await page.addScriptTag({content:bundle.outputFiles[0].text});
    const menu=page.locator('main.tr-mobile-menu-page');
    await menu.waitFor();
    const help=menu.locator('details').filter({has:page.locator('summary[aria-label="Помощь"]')});
    const docs=menu.locator('details').filter({has:page.locator('summary[aria-label="Документы"]')});
    assert(await help.count()===1&&await docs.count()===1,'Missing independent sections');
    assert(await help.getAttribute('open')===null&&await docs.getAttribute('open')===null,'Secondary groups must start collapsed');
    await help.locator('summary').click();
    assert(await help.locator('a[href="#/help"]').isVisible(),'Help inaccessible');
    assert(await help.locator('a[href="#/support"]').isVisible(),'Support inaccessible');
    assert(await docs.getAttribute('open')===null,'Opening Help expanded Documents');
    await docs.locator('summary').click();
    for(const route of ['/work/docs','/rules','/offer/performer','/offer/privacy','/privacy'])
      assert(await docs.locator('a[href="#'+route+'"]').isVisible(),'Missing document '+route);
    const groups=await page.evaluate(()=>window.groups);
    assert(groups.documents.find(x=>x[0]==='/offer/privacy')[1]==='Политика персональных данных','Incorrect policy label');
    assert(groups.guidance.filter(x=>x[0]==='/support').length===1,'Duplicate support');
    assert(!groups.work.some(x=>x[0]==='/work/docs'),'Documents still mixed with work');
    const links=await menu.locator('.tr-mobile-menu-links a[href]').evaluateAll(a=>a.map(el=>el.getAttribute('href')));
    assert(new Set(links).size===links.length,'Duplicate route in menu');
    await docs.locator('a[href="#/rules"]').click();
    assert(new URL(page.url()).hash==='#/rules','Rules link did not navigate');
    assert(errors.length===0,'JS errors: '+errors.join('; '));
    await ctx.close();
  }
  console.log('PASS separate cabinet help and documents, no duplicate routes');
}finally{await browser.close();}
