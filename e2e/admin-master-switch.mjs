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
  await page.getByRole('summary',{name:'Открыть меню кабинета'}).click();
  const nav=page.getByRole('navigation',{name:'Все разделы кабинета'});
  await nav.getByRole('link',{name:'Выездной мастер'}).click();
  await page.waitForURL(/#\/work/);
  await page.getByRole('summary',{name:'Открыть меню кабинета'}).click();
  await nav.getByRole('link',{name:'Администратор'}).click();
  await page.waitForURL(/#\/admin/);
  if(exceptions.length)throw new Error('JavaScript error: '+exceptions.join(' | '));
  console.log('Admin and master cabinets switch correctly within one account');
  await context.close();
} finally {await browser.close();}
