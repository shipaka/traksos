// Verify one account can act as administrator and mobile master.
// Local CI ONLY; never modifies production users.
import { chromium } from 'playwright';
import pg from 'pg';
const BASE = process.env.BASE_URL ?? 'http://localhost:8080';
if (!['localhost', '127.0.0.1'].includes(new URL(BASE).hostname))
  throw new Error('Admin/master role fixture must only run against local test server');
const connectionString = process.env.TEST_DATABASE_URL || 'postgres://postgres@127.0.0.1:5432/traksos';
if (!['localhost', '127.0.0.1'].includes(new URL(connectionString).hostname))
  throw new Error('Admin/master role fixture must only use local test database');
// In CI the actual app uses traksos, whereas TEST_DATABASE_URL may point to a different test database.
const db = new pg.Client({ connectionString: 'postgres://postgres@127.0.0.1:5432/traksos' });
await db.connect();
try {
  const row = await db.query(
    "update users set roles=array(select distinct unnest(roles || array['master']::text[])) where phone=$1 and 'admin'=any(roles) returning id,roles",
    ['+79990000001']
  );
  if (row.rowCount !== 1 || !row.rows[0].roles.includes('master')) throw new Error('Local admin/master fixture was not created');
} finally { await db.end(); }
const login = await fetch(BASE+'/api/auth/login',{
  method:'POST',headers:{'content-type':'application/json'},
  body:JSON.stringify({phone:'+79990000001',password:'TrackSOS-Test-2026!'})
});
if (!login.ok) throw new Error('Admin/master login failed: '+login.status);
const {token,user} = await login.json();
if (!user.roles.includes('master') || !user.roles.includes('admin')) throw new Error('Both roles missing after login');
const browser=await chromium.launch();
try {
  const context=await browser.newContext({viewport:{width:390,height:844},locale:'ru-RU'});
  const page=await context.newPage();
  const exceptions=[];
  page.on('pageerror',e=>exceptions.push(e.message));
  await page.addInitScript(t=>{localStorage.setItem('traksos.token',t);localStorage.setItem('traksos.mode','admin')},token);
  await page.goto(BASE+'/#/admin');
  await page.getByRole('heading',{name:'Администратор'}).waitFor();
  await page.locator('.account-menu > summary').click();
  const nav=page.getByRole('navigation',{name:'Все разделы кабинета'});
  await nav.getByRole('link',{name:'Выездной мастер'}).click();
  await page.waitForURL(/#\/work/);
  await page.locator('.account-menu > summary').click();
  await nav.getByRole('link',{name:'Администратор'}).click();
  await page.waitForURL(/#\/admin/);
  // One admin-only sandbox opens every simulated cabin with ZERO API writes.
  await page.goto(BASE+'/#/admin/test-center');
  await page.getByRole('heading',{name:'Тестирование кабинетов'}).waitFor();
  const writes=[];
  page.on('request',r=>{
    if(r.url().includes('/api/') && !['GET','HEAD'].includes(r.method())) writes.push(r.method());
  });
  for(const [id,label] of [
    ['client','Клиент'],['owner','Владелец / автопарк'],['driver','Водитель автопарка'],
    ['master','Выездной мастер'],['tow','Эвакуаторщик'],['service','Рембаза / СТО'],
    ['master_service','Мастер и своя СТО'],['insurer','Страховой партнёр'],
    ['inspection','Оператор техосмотра'],
    ['moderator','Модератор'],['admin','Администратор'],
  ]){
    await page.locator('a.sandbox-role-card[href="#/admin/test-center/'+id+'"]').click();
    if(id==='service'){
      await page.getByRole('heading',{name:/Рембаза/}).waitFor();
      await page.getByRole('button',{name:'Готовы принять'}).first().click();
      await page.getByRole('button',{name:'Отправить клиенту'}).click();
      await page.locator('.service-preview-admin-bar a[href="#/admin/test-center"]').click();
    }else if(id==='client'||id==='driver'){
      await page.getByRole('main',{name:'Тестовый кабинет: '+label}).waitFor();
      await page.getByRole('button',{name:'Эвакуатор'}).click();
      await page.getByRole('textbox',{name:'Что случилось?'}).fill('Не запускается двигатель');
      await page.getByRole('button',{name:'Создать тестовую заявку'}).click();
      await page.getByRole('button',{name:'Исполнитель выехал'}).last().click();
      await page.getByRole('button',{name:'История',exact:true}).click();
      await page.getByRole('button',{name:'Помощь на дороге'}).click();
      await page.getByRole('link',{name:'← Назад к выбору кабинетов'}).first().click();
    }else if(id==='insurer'){
      await page.getByRole('main',{name:'Тестовый кабинет: Страховой партнёр'}).waitFor();
      await page.getByRole('button',{name:'Принять в работу'}).click();
      await page.getByRole('button',{name:'Отправить предложение'}).click();
      await page.getByRole('button',{name:'Документы и полисы'}).click();
      await page.getByRole('button',{name:'Прикрепить образец полиса'}).click();
      await page.getByRole('button',{name:'Финансы'}).click();
      await page.getByRole('link',{name:'← Назад к выбору кабинетов'}).first().click();
    }else{
      await page.getByRole('main',{name:'Тестовый кабинет: '+label}).waitFor();
      // Other roles remain in existing isolated demo until their full real-cabinet upgrade.
      await page.getByRole('navigation',{name:'Разделы тестового кабинета'})
        .getByRole('button',{name:'▤',exact:false}).click();
      await page.getByRole('button',{name:'Создать тестовую заявку'}).click();
      await page.getByRole('alert').getByText('Укажи описание', {exact:false}).waitFor();
      await page.getByRole('link',{name:'← Назад к выбору кабинетов'}).first().click();
    }
    await page.getByRole('heading',{name:'Тестирование кабинетов'}).waitFor();
  }
  if(writes.length)throw new Error('Sandbox unexpectedly changed live API');
  await page.getByRole('link',{name:'Вернуться в админку'}).click();
  await page.getByRole('heading',{name:'Администратор'}).waitFor();
  if(exceptions.length)throw new Error('JavaScript error: '+exceptions.join(' | '));
  console.log('Admin and master cabinets switch correctly within one account');
  await context.close();
} finally {await browser.close();}

const modDb = new pg.Client({ connectionString: 'postgres://postgres@127.0.0.1:5432/traksos' });
await modDb.connect();
try {
  const row = await modDb.query(
    "update users set roles=ARRAY['master','moderator']::text[] where phone=$1 and 'master'=any(roles) returning roles",
    ['+79990000147']
  );
  if (row.rowCount !== 1) throw new Error('Synthetic moderator/master account missing');
} finally { await modDb.end(); }
const moderatorLogin = await fetch(BASE+'/api/auth/login', {
  method: 'POST', headers: {'content-type':'application/json'},
  body: JSON.stringify({ phone:'+79990000147', password:'Test-Role-Only-2026!' })
});
if (!moderatorLogin.ok) throw new Error('Moderator/master login failed');
const moderator = await moderatorLogin.json();
if (!moderator.user.roles.includes('moderator') || !moderator.user.roles.includes('master')
  || moderator.user.roles.includes('admin')) throw new Error('Wrong moderator roles');
for(const endpoint of ['/api/admin/stats','/api/admin/summary','/api/admin/settings',
                        '/api/admin/users','/api/admin/orders','/api/admin/agent-report']) {
  const response = await fetch(BASE+endpoint, {headers:{authorization:'Bearer '+moderator.token}});
  if(response.status!==403) throw new Error('Moderator may access '+endpoint+' with HTTP '+response.status);
}
const moderatorCases = await fetch(BASE+'/api/mod/cases',{headers:{authorization:'Bearer '+moderator.token}});
if(!moderatorCases.ok) throw new Error('Moderator cannot access cases');
const mb = await chromium.launch();
try {
  const context = await mb.newContext({viewport:{width:390,height:844},locale:'ru-RU'});
  const page = await context.newPage();
  await page.addInitScript(token => {
    localStorage.setItem('traksos.token',token);
    localStorage.setItem('traksos.mode','moderator');
  }, moderator.token);
  await page.goto(BASE+'/#/moderation');
  await page.getByRole('heading',{name:'Модерация'}).waitFor();
  await page.locator('.account-menu > summary').click();
  const nav = page.getByRole('navigation',{name:'Все разделы кабинета'});
  await nav.getByRole('link',{name:'Выездной мастер'}).click();
  await page.waitForURL(/#\/work/);
  await page.locator('.account-menu > summary').click();
  await nav.getByRole('link',{name:'Модератор'}).click();
  await page.waitForURL(/#\/moderation/);
  await page.goto(BASE+'/#/admin');
  await page.getByRole('heading',{name:'Модерация'}).waitFor();
  if (await page.getByRole('button',{name:'Статистика'}).count()) throw new Error('Moderator sees admin statistics');
  await page.goto(BASE+'/#/admin/test-center');
  await page.getByRole('heading',{name:'Модерация'}).waitFor();
  if(await page.getByRole('heading',{name:'Тестирование кабинетов'}).count())
    throw new Error('Moderator can see the admin sandbox');
  await context.close();
} finally { await mb.close(); }
console.log('Moderator/master role switching and financial-report access restrictions OK');
