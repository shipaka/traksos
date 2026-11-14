// Stronger replacement for obsolete single-screen sandbox tests.
// Local CI ONLY: admin/master role, real sign-in, 10 registered-role screens,
// mobile+desktop, expiry and API-token invalidation. No production accounts.
import {chromium} from 'playwright';
import pg from 'pg';
import {randomBytes,randomInt,scryptSync} from 'node:crypto';
const BASE=process.env.BASE_URL??'http://127.0.0.1:8080';
if(!['localhost','127.0.0.1'].includes(new URL(BASE).hostname))
 throw Error('Refusing to test against a nonlocal server');
const db=new pg.Client({connectionString:'postgres://postgres@127.0.0.1:5432/traksos'});
await db.connect();
const phone='+79990000001';
const row=await db.query('select id,roles,password_hash,admin_preview_until from users where phone=$1',[phone]);
if(row.rowCount!==1||!row.rows[0].roles.includes('admin'))throw Error('Local admin fixture missing');
const old=row.rows[0];
const code=String(randomInt(1_000_000_000,9_999_999_999));
const salt=randomBytes(16).toString('hex');
const hash='scrypt:'+salt+':'+scryptSync(code,Buffer.from(salt,'hex'),64).toString('hex');
let browser;
try{
 await db.query("update users set roles=array(select distinct unnest(roles || array['master']::text[])),password_hash=$1,admin_preview_until=$2 where id=$3",
  [hash,new Date(Date.now()+30*60_000),old.id]);
 const auth=await fetch(BASE+'/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},
   body:JSON.stringify({phone,password:code})});
 if(auth.status!==200)throw Error('Temporary local administrator login failed');
 const {token,user}=await auth.json();
 if(!user.roles.includes('master')||!user.roles.includes('admin'))throw Error('Admin/master roles missing');
 browser=await chromium.launch();
 const sessions=[];
 for(const width of [390,1440]){
  const context=await browser.newContext({viewport:{width,height:900},locale:'ru-RU'});
  const page=await context.newPage();
  const errors=[];
  page.on('pageerror',err=>errors.push(err.message));
  const writes=[];
  page.on('request',req=>{
    if(req.url().includes('/api/')&&!['GET','HEAD'].includes(req.method()))writes.push(req.method()+' '+req.url());
  });
  await page.addInitScript(t=>{
    localStorage.setItem('traksos.token',t);
    localStorage.setItem('traksos.mode','admin');
  },token);
  await page.goto(BASE+'/#/admin/test-center');
  await page.getByRole('heading',{name:'Тестирование кабинетов'}).waitFor();
  for(const role of ['client','owner','driver','master','tow','master_service','service','insurer','moderator','admin']){
   await page.locator('a.sandbox-role-card[href="#/admin/test-center/'+role+'"]').click();
   if(role==='service'){
    await page.locator('.service-preview-admin-bar').waitFor();
    await page.locator('.service-preview-admin-bar a[href="#/admin/test-center"]').click();
   }else{
    await page.locator('.role-preview-bar').waitFor();
    // The real mobile shell intentionally hides its desktop sidebar.
    // Check the actual navigation surface visible to this device instead.
    if(width>=900){
      await page.locator('.desktop-layout .desktop-sidebar').waitFor({state:'visible'});
    }else{
      await page.locator('.account-menu > summary').waitFor({state:'visible'});
      await page.locator('.account-menu > summary').click();
      await page.locator('.account-menu nav a').first().waitFor({state:'visible'});
      await page.locator('.account-menu > summary').click();
    }
    await page.locator('.role-preview-bar a[href="#/admin/test-center"]').click();
   }
   await page.getByRole('heading',{name:'Тестирование кабинетов'}).waitFor();
  }
  await page.goto(BASE+'/#/admin/test-center/client');
  await page.locator(width>=900?'.desktop-hero h1':'.mobile-home-heading h1').waitFor({state:'visible'});
  if(writes.length)throw Error('Preview made forbidden production writes: '+writes.join(', '));
  if(errors.length)throw Error('JavaScript errors: '+errors.join('; '));
  sessions.push({page,context,token});
 }
 await db.query('update users set admin_preview_until=$1 where id=$2',[new Date('2000-01-01T00:00:00Z'),old.id]);
 for(const {page,context,token} of sessions){
  const api=await fetch(BASE+'/api/me',{headers:{authorization:'Bearer '+token}});
  if(api.status!==401)throw Error('Expired admin preview session remained valid');
  await page.reload();
  await page.locator('input[type=tel]').waitFor({timeout:20000});
  if(!page.url().includes('#/login'))throw Error('Expired browser session not redirected');
  await context.close();
 }
 const relog=await fetch(BASE+'/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},
   body:JSON.stringify({phone,password:code})});
 if(relog.status!==401)throw Error('Expired preview password still accepted');
 console.log('Admin role preview, master permission, mobile/desktop, token expiry: OK');
}finally{
 if(browser)await browser.close();
 await db.query('update users set roles=$1,password_hash=$2,admin_preview_until=$3 where id=$4',
  [old.roles,old.password_hash,old.admin_preview_until,old.id]);
 await db.end();
}
