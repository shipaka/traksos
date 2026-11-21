// Full administration UX: every section is reachable, readable and responsive.
// Operates ONLY against the synthetic local CI server. Never touches production.
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:8080';
if (!['localhost','127.0.0.1'].includes(new URL(BASE).hostname))
  throw Error('Admin visual/navigation audit is LOCAL ONLY');

const sections = [
  ['queue','Модерация'],['summary','Сводка'],['cases','Заявки и мультизаявки'],['orders','Все заказы'],
  ['dispatch','Распределение'],['demand','Проблемные заявки'],
  ['support','Обращения'],['registry','Единая база'],['search','Поиск'],['people','Все люди'],
  ['access','Регистрация и доступы'],
  ['verify','Проверка'],['bases','Рембазы'],['ecu','Стационарные ЭБУ'],['vehicleServices','Страхование и ТО'],
  ['serviceFinance','Счета и выплаты СТО'],['payments','Деньги'],['offers','Оферты'],
  ['announcements','Объявления и комиссии'],['stats','Статистика'],
  ['flagged','Подозрительное'],['diagnostics','Журнал ошибок'],['settings','Настройки'],
];
const login = await fetch(BASE+'/api/auth/login',{
  method:'POST',headers:{'content-type':'application/json'},
  body:JSON.stringify({phone:'+79990000001',password:'TrakSOS-Test-2026!'})
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
    await page.goto(BASE+'/#/admin/section/summary',{waitUntil:'domcontentloaded'});
    await page.locator('.admin-stage-head h2').getByText('Сводка',{exact:true}).waitFor();
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
    if(await navigation.locator('.admin-nav-item').count()!==sections.length)
      throw Error(width+'px: missing navigation section(s)');
    const search = navigation.getByRole('searchbox',{name:'Поиск раздела администрации'});
    await search.fill('страхование');
    if(await navigation.locator('.admin-nav-item').count()!==1)
      throw Error(width+'px: section filtering does not work');
    await navigation.getByRole('button',{name:'Страхование и ТО',exact:true}).click();
    await page.waitForURL(/#\/admin\/section\/vehicleServices$/);
    await page.locator('.admin-stage-head h2').getByText('Страхование и ТО',{exact:true}).waitFor();
    await checkLayout('insurance after search');
    await page.screenshot({path:'e2e/shots/admin-ux/insurance-'+width+'.png',fullPage:true});
    // Every control must navigate to its own deep-linkable section, not a single text strip.
    for(const [id,name] of sections) {
      await openNav();
      await navigation.getByRole('button',{name,exact:true}).click();
      await page.waitForURL(new RegExp('#/admin/section/'+id+'$'));
      await page.locator('.admin-stage-head h2').getByText(name,{exact:true}).waitFor();
      if (await page.locator('.admin-command-hero').count() !== 0)
        throw Error(id + ': obsolete admin landing hero repeated above the actual section');
      if(id==='dispatch') {
        await page.locator('.desktop-content > main').getByRole('heading',{name:'Диспетчерская'}).first().waitFor();
        await page.getByRole('button',{name:'Обновить данные'}).waitFor();
        await page.getByText('Настройки распределения и торгов').waitFor();
        const search = page.getByRole('searchbox',{name:'Найти заявку по номеру, имени или месту'});
        await search.fill('Тестовый поиск');
        if(await search.inputValue() !== 'Тестовый поиск') throw Error('Dispatcher search cannot be edited');
      }
      if(id==='ecu') {
        await page.getByText('Проверка стационарных точек ЭБУ',{exact:true}).waitFor();
        await page.getByText('Это не выездная услуга и не тариф по километрам.',{exact:false}).waitFor();
      }
      if(id==='cases') {
        await page.getByRole('heading',{name:'Заявки и мультизаявки'}).first().waitFor();
        await page.getByRole('searchbox',{name:'Найти заявку, мультизаявку или автомобиль'}).waitFor();
        await page.getByRole('button',{name:'Модерировались'}).waitFor();
        // Isolated synthetic data: exercise clickable relation links without any production writes.
        const root='00000000-0000-4000-8000-000000000001';
        const vehicleId='00000000-0000-4000-8000-000000000002';
        const clientId='00000000-0000-4000-8000-000000000003';
        const performerId='00000000-0000-4000-8000-000000000004';
        const caseRow={id:root,number:301,case_number:'М-000011',client_name:'Учебный клиент',
          vehicle_brand:'R',vehicle_plate:'Т101ТТ',order_count:1,workshop_count:1,
          has_active:true,moderated:true,opened_at:'2026-11-18T11:00:00Z'};
        const stage={id:root,number:301,stage_no:1,vehicle_id:vehicleId,client_id:clientId,
          client_name:'Учебный клиент',performer_id:performerId,performer_name:'Учебный мастер',
          service:'diag',status:'accepted',created_at:'2026-11-18T11:00:00Z',problem:'Диагностика двигателя'};
        const booking={id:'00000000-0000-4000-8000-000000000005',number:304,stage_no:2,
          status:'expected',center_name:'Учебная СТО',need:'Диагностика',when_day:'2026-11-18'};
        const caseDetail={root_id:root,case_number:'М-000011',multi:true,stages:[stage],
          bookings:[booking],vehicle:{id:vehicleId,owner_id:clientId,brand:'R',model:'Грузовик',
          plate:'Т101ТТ',year:2010},vehicle_history:[],vehicle_history_bookings:[],
          events:[{order_id:root,type:'created',created_at:'2026-11-18T11:00:00Z'}],
          chat:[{id:'msg-one',order_id:root,kind:'text',body:'Проверка связи',
          sender_name:'Учебный клиент',created_at:'2026-11-18T11:03:00Z'}],
          payments:[],payouts:[],moderation:[],notes:[],document_status:'Демо без реального чека'};
        await page.route('**/api/admin/cases?**',route=>route.fulfill({status:200,json:[caseRow]}));
        await page.route('**/api/admin/cases/'+root,route=>route.fulfill({status:200,json:caseDetail}));
        await page.reload({waitUntil:'domcontentloaded'});
        await page.getByRole('button',{name:'Открыть М-000011'}).click();
        const modal=page.getByRole('dialog',{name:'Подробности заявки'});
        await modal.getByRole('button',{name:/Этап 1 · заказ №301/}).click();
        await modal.getByRole('heading',{name:'Рабочая заявка №301'}).waitFor();
        await modal.getByRole('button',{name:/Автомобиль и история ТС/}).click();
        await modal.getByRole('heading',{name:'Карточка автомобиля'}).waitFor();
        await modal.getByRole('button',{name:/Владелец · открыть профиль/}).click();
        await modal.getByRole('heading',{name:/карточка пользователя/}).waitFor();
        const fullProfile=modal.locator('a[href="#/admin/user/'+clientId+'"]');
        if(await fullProfile.count()!==1)throw Error('Admin person link is not navigable');
        await modal.getByRole('button',{name:/Вернуться к обращению/}).click();
        await modal.getByRole('button',{name:/СТО · запись №304/}).click();
        await modal.getByRole('heading',{name:'Запись СТО №304'}).waitFor();
        if(await modal.locator('a[href="#/booking/'+booking.id+'"]').count()!==1)
          throw Error('Booking link is not navigable');
        await modal.getByRole('button',{name:/Вернуться к обращению/}).click();
        await modal.getByRole('button',{name:'Ход работ'}).click();
        await modal.getByRole('button',{name:'Заказ №301 ↗'}).click();
        await modal.getByRole('heading',{name:'Рабочая заявка №301'}).waitFor();
        await modal.getByRole('button',{name:/Вернуться к обращению/}).click();
        await modal.getByRole('button',{name:'Чат'}).click();
        await modal.getByText('Проверка связи').waitFor();
        await modal.getByRole('button',{name:'Заказ №301 ↗'}).click();
        await modal.getByRole('heading',{name:'Рабочая заявка №301'}).waitFor();
        await modal.getByRole('button',{name:'Закрыть окно'}).click();
        await checkLayout('case links and drilldowns');
      }
      if(id==='access') {
        await page.getByRole('heading',{name:'Зарегистрировать человека вручную'}).waitFor();
        await page.getByRole('button',{name:'Создать учётную запись'}).waitFor();
        await page.getByRole('button',{name:'Создать обращение разработчику'}).waitFor();
      }
      await checkLayout(id);
      if(['queue','summary','payments','vehicleServices','stats','settings'].includes(id))
        await page.screenshot({path:'e2e/shots/admin-ux/'+id+'-'+width+'.png',fullPage:true});
    }
    // Refresh must retain the selected section. Going back to a section should work too.
    await page.reload({waitUntil:'domcontentloaded'});
    await page.locator('.admin-stage-head h2').getByText('Настройки',{exact:true}).waitFor();
    // The empty API response must render a branded, actionable state, not a blank panel.
    await page.route('**/api/admin/orders',route=>route.fulfill({status:200,json:[]}));
    await page.goto(BASE+'/#/admin/section/orders');
    await page.locator('.admin-stage-head h2').getByText('Все заказы',{exact:true}).waitFor();
    await page.getByRole('status',{name:'Нет заказов'}).waitFor();
    await page.locator('.admin-orders-zero .tr-approved-empty-scene img').waitFor();
    await page.locator('.admin-orders-zero a[href="#/admin/section/cases"]').waitFor();
    await page.screenshot({path:'e2e/shots/admin-ux/orders-empty-'+width+'.png',fullPage:true});
    await checkLayout('deep link');
    await context.close();
  }
  console.log('Admin: all '+sections.length+' sections, search, real deep links, responsive layout and screenshots OK');
}finally{await browser.close();}
