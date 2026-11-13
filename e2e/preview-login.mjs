// Browser smoke for the actual owner demo path: phone + 10 digits -> admin -> ten role previews.
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
    for (const label of ['Клиент','Владелец / автопарк','Водитель автопарка',
      'Выездной мастер','Эвакуаторщик','Рембаза / СТО','Мастер и своя СТО',
      'Страховой партнёр','Модератор','Администратор']) {
      const role = page.getByRole('group',{name:'Выбор тестового кабинета'})
        .getByRole('button',{name:label,exact:true});
      await role.click();
      if (await role.getAttribute('aria-pressed') !== 'true')
        throw new Error('Preview role switch failed: '+label+' at '+width);
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
  console.log('Preview admin login (mobile + desktop), 10 roles, expiry and token revocation: OK');
} finally {
  if (browser) await browser.close();
  await db.query('update users set password_hash=$1,admin_preview_until=$2 where id=$3',
    [original.password_hash,original.admin_preview_until,original.id]);
  await db.end();
}
