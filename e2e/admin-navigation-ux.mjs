// Full administration UX: every section is reachable, readable and responsive.
// Operates ONLY against the synthetic local CI server. Never touches production.
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:8080';
if (!['localhost','127.0.0.1'].includes(new URL(BASE).hostname))
  throw Error('Admin visual/navigation audit is LOCAL ONLY');

const sections = [
  ['queue','Модерация'],['summary','Сводка'],['orders','Заявки'],
  ['dispatch','Распределение'],['demand','Проблемные заявки'],
  ['support','Обращения'],['search','Поиск'],['people','Все люди'],
  ['verify','Проверка'],['bases','Рембазы'],['vehicleServices','Страхование и ТО'],
  ['shop','Магазин'],['payments','Деньги'],['offers','Оферты'],
  ['announcements','Объявления и комиссии'],['stats','Статистика'],
  ['flagged','Подозрительное'],['settings','Настройки'],
];
const login = await fetch(BASE+'/api/auth/login',{
  method:'POST',headers:{'content-type':'application/json'},
  body:JSON.stringify({phone:'+79990000001',password:'TrackSOS-Test-2026!'})
});
if (!login.ok) throw Error('Synthetic local administrator fixture is missing: '+login.status);
const {token} = await login.json();
await mkdir('e2e/shots/admin-ux',{recursive:true});
const browser = await chromium.launch();
try {
  for(const width of [390,1440]) {
    const context = await browser.newContext({viewport:{width,height:900},locale:'ru-RU'});
    const page = await context.newPage();
    const jsErrors = [];
    page.on('pageerror',error=>jsErrors.push(error.message));
    await page.addInitScript(value=>{
      localStorage.setItem('traksos.token',value);
      localStorage.setItem('traksos.mode','admin');
    },token);
    await page.goto(BASE+'/#/admin',{waitUntil:'domcontentloaded'});
    await page.getByRole('heading',{name:'Администратор'}).waitFor();
    const navigation = page.getByRole('navigation',{name:'Разделы администрации'});
    const mobile = width < 951;
    const openNav = async () => {
      if(mobile) {
        const toggle = page.getByRole('button',{name:/Разделы управления/});
        if(await toggle.getAttribute('aria-expanded')==='false') await toggle.click();
      }
      await navigation.waitFor({state:'visible'});
    };
    const checkLayout = async label => {
      const geometry=await page.evaluate(()=>({
        viewport:document.documentElement.clientWidth,
        width:document.documentElement.scrollWidth,
        mainWidth:document.querySelector('.admin-stage')?.getBoundingClientRect().width ?? 0,
        bodyWidth:document.body.scrollWidth,
      }));
      if(geometry.width > geometry.viewport+3 || geometry.bodyWidth > geometry.viewport+3)
        throw Error(width+'px, '+label+': horizontal overflow '+JSON.stringify(geometry));
      if(geometry.mainWidth < 200)throw Error(width+'px, '+label+': inaccessible workspace '+JSON.stringify(geometry));
      if(jsErrors.length)throw Error(width+'px, '+label+': JavaScript error '+jsErrors.join('; '));
    };
    await checkLayout('dashboard');
    await page.screenshot({path:'e2e/shots/admin-ux/initial-'+width+'.png',fullPage:true});
    await openNav();
    if(await navigation.locator('.admin-nav-item').count()!==18)
      throw Error(width+'px: missing navigation section(s)');
    const search = navigation.getByRole('searchbox',{name:'Поиск раздела администрации'});
    await search.fill('магазин');
    if(await navigation.locator('.admin-nav-item').count()!==1)
      throw Error(width+'px: section filtering does not work');
    await navigation.getByRole('button',{name:'Магазин',exact:true}).click();
    await page.waitForURL(/#\/admin\/section\/shop$/);
    await page.locator('.admin-stage-head h2').getByText('Магазин',{exact:true}).waitFor();
    await checkLayout('shop after search');
    await page.screenshot({path:'e2e/shots/admin-ux/shop-'+width+'.png',fullPage:true});
    // Every control must navigate to its own deep-linkable section, not a single text strip.
    for(const [id,name] of sections) {
      await openNav();
      await navigation.getByRole('button',{name,exact:true}).click();
      await page.waitForURL(new RegExp('#/admin/section/'+id+'$'));
      await page.locator('.admin-stage-head h2').getByText(name,{exact:true}).waitFor();
      await checkLayout(id);
      if(['queue','summary','payments','vehicleServices','stats','settings'].includes(id))
        await page.screenshot({path:'e2e/shots/admin-ux/'+id+'-'+width+'.png',fullPage:true});
    }
    // Refresh must retain the selected section. Going back to a section should work too.
    await page.reload({waitUntil:'domcontentloaded'});
    await page.locator('.admin-stage-head h2').getByText('Настройки',{exact:true}).waitFor();
    await page.goto(BASE+'/#/admin/section/orders');
    await page.locator('.admin-stage-head h2').getByText('Заявки',{exact:true}).waitFor();
    await checkLayout('deep link');
    await context.close();
  }
  console.log('Admin: all 18 sections, search, real deep links, responsive layout and screenshots OK');
}finally{await browser.close();}
