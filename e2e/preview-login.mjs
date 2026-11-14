// Browser smoke for the actual owner demo path: phone + 10 digits -> admin -> eleven role previews.
// Local CI ONLY. Does not create users, touch production, send SMS or change approved design.
import { chromium } from 'playwright';
import pg from 'pg';
import { randomBytes, scryptSync } from 'node:crypto';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:8080';
if (!['localhost', '127.0.0.1'].includes(new URL(BASE).hostname))
  throw new Error('Preview test must only open the LOCAL web server');
const dbUrl = 'postgres://postgres@127.0.0.1:5432/traksos';
const db = new pg.Client({ connectionString: dbUrl });
await db.connect();
const phone = '+79990000001'; // Fake fixture, NEVER the owner phone.
const code = '0317284905';    // Fake fixture, NEVER an operator secret.
const salt = randomBytes(16).toString('hex');
const hash = `scrypt:${salt}:${scryptSync(code, Buffer.from(salt, 'hex'), 64).toString('hex')}`;
const row = await db.query(
  'select id,roles,password_hash,admin_preview_until from users where phone=$1',
  [phone],
);
if (row.rowCount !== 1 || !row.rows[0].roles.includes('admin') || !row.rows[0].roles.includes('master')) {
  await db.end();
  throw new Error('Local CI admin/master fixture missing');
}
const original = row.rows[0];
let browser;
try {
  await db.query(
    'update users set password_hash=$1,admin_preview_until=$2 where id=$3',
    [hash,new Date(Date.now()+30*60_000),original.id],
  );
  browser = await chromium.launch();
  await (await import('node:fs/promises')).mkdir('e2e/shots/sandbox',{recursive:true});
  const sessions = [];
  for (const width of [390,1440]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, locale: 'ru-RU' });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(BASE+'/#/login');
    await page.locator('input[type=tel]').fill(phone);
    await page.locator('input[type=password]').fill(code);
    await page.getByRole('button',{name:'Войти',exact:true}).click();
    await page.waitForURL(/#\/admin(?:$|\/)/,{timeout:20_000});
    await page.getByRole('heading',{name:'Администратор'}).waitFor();
    const previewLink = page.getByRole('link',{name:/Тестирование всех кабинетов/}).first();
    await previewLink.click();
    await page.getByRole('heading',{name:'Тестирование кабинетов'}).waitFor();
    for (const [id,label] of [
      ['client','Клиент'],['owner','Владелец / автопарк'],['driver','Водитель автопарка'],
      ['master','Выездной мастер'],['tow','Эвакуаторщик'],['service','Рембаза / СТО'],
      ['master_service','Мастер и своя СТО'],['insurer','Страховой партнёр'],
      ['inspection','Оператор техосмотра'],['moderator','Модератор'],['admin','Администратор'],
    ]) {
      const link=page.locator('a.sandbox-role-card[href="#/admin/test-center/'+id+'"]');
      await link.click();
      await page.waitForURL('**/#/admin/test-center/'+id);
      if(id==='service'){
        await page.getByRole('heading',{name:/Рембаза/}).waitFor();
        await page.locator('.service-preview-admin-bar').waitFor();
        await page.getByRole('button',{name:'Готовы принять'}).first().waitFor();
        await page.screenshot({path:'e2e/shots/sandbox/'+id+'-'+width+'.png',fullPage:true});
        await page.getByRole('button',{name:'Готовы принять'}).first().click();
        await page.getByRole('button',{name:'Отправить клиенту'}).first().click();
        await page.getByRole('button',{name:/Машины у вас/}).first().click();
        await page.locator('a[href="#/admin/test-center/service/base/car/demo-booking-1"]').click();
        await page.getByRole('heading',{name:/Scania/}).waitFor();
        await page.getByRole('button',{name:'Машина приехала'}).click();
        await page.locator('.service-preview-admin-bar a[href="#/admin/test-center"]').click();
      } else if(id==='master_service'){
        // Combined role opens the master workspace, then the separately isolated service entry.
        await page.getByRole('button',{name:'Моя СТО',exact:true}).click();
        await page.getByRole('link',{name:'Открыть полный тестовый кабинет СТО'}).waitFor();
        await page.screenshot({path:'e2e/shots/sandbox/'+id+'-'+width+'.png',fullPage:true});
        await page.getByRole('link',{name:'← Назад к выбору кабинетов'}).first().click();
      } else {
        const cabinetLabel=id==='owner'?'Владелец автопарка':label;
        await page.getByRole('main',{name:'Тестовый кабинет: '+cabinetLabel}).waitFor();
        await page.screenshot({path:'e2e/shots/sandbox/'+id+'-'+width+'.png',fullPage:true});
        // Each role has its own real navigation. The old shared "create request" selector
        // was invalid for fleet, master, insurer and inspection workspaces.
        if(id==='client'||id==='driver'){
          await page.getByRole('button',{name:'История',exact:true}).click();
          await page.getByRole('button',{name:'Помощь на дороге',exact:true}).waitFor();
        }else if(id==='owner'){
          await page.getByRole('button',{name:'Водители',exact:true}).click();
          await page.getByRole('textbox',{name:'Имя водителя'}).waitFor();
        }else if(id==='master'||id==='tow'){
          await page.getByRole('button',{name:'Мои выезды',exact:true}).click();
          await page.getByRole('button',{name:'Начать выезд'}).waitFor();
        }else if(id==='insurer'){
          await page.getByRole('button',{name:'Документы и полисы',exact:true}).click();
          await page.getByRole('heading',{name:'Документы и полисы'}).waitFor();
        }else if(id==='inspection'){
          await page.getByRole('button',{name:'Расписание',exact:true}).click();
          await page.getByRole('heading',{name:'Расписание осмотров'}).waitFor();
        }else if(id==='moderator'){
          await page.getByRole('button',{name:'Жалобы и обращения',exact:true}).click();
          await page.getByRole('heading',{name:'Жалобы и обращения'}).waitFor();
        }else{
          await page.locator('.sandbox-nav button').nth(1).click();
          await page.getByRole('button',{name:'Создать тестовую заявку'}).waitFor();
        }
        await page.getByRole('link',{name:'← Назад к выбору кабинетов'}).first().click();
      }
      await page.getByRole('heading',{name:'Тестирование кабинетов'}).waitFor();
    }
    if (errors.length) throw new Error('Browser error at '+width+': '+errors.join('; '));
    const token = await page.evaluate(()=>localStorage.getItem('traksos.token'));
    if (!token) throw new Error('Browser lacks authenticated session at '+width);
    sessions.push({page,context,token});
  }
  // Mimic midnight without waiting. Both fresh password attempts and existing sessions must fail.
  await db.query('update users set admin_preview_until=$1 where id=$2',
    [new Date('2000-01-01T00:00:00Z'),original.id]);
  for (const {page,context,token} of sessions) {
    const response = await fetch(BASE+'/api/me',{headers:{authorization:'Bearer '+token}});
    if (response.status !== 401) throw new Error('Expired preview API token was accepted');
    await page.reload();
    // The existing API client correctly redirects a 401 to #/login.
    await page.locator('input[type=tel]').waitFor({timeout:20_000});
    if (!page.url().includes('#/login'))
      throw new Error('Expired preview did not redirect to login');
    if (await page.getByRole('heading',{name:'Тестирование кабинетов'}).count())
      throw new Error('Expired browser session still displays administrator preview');
    await context.close();
  }
  const relog = await fetch(BASE+'/api/auth/login',{
    method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({phone,password:code}),
  });
  if (relog.status !== 401) throw new Error('Expired preview code allowed a fresh sign-in');
  console.log('Preview admin login (mobile + desktop), 11 roles, expiry and token revocation: OK');
} finally {
  if (browser) await browser.close();
  await db.query('update users set password_hash=$1,admin_preview_until=$2 where id=$3',
    [original.password_hash,original.admin_preview_until,original.id]);
  await db.end();
}
