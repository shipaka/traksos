// Browser regression for the EXISTING temporary guest preview flow.
// Local CI only. All codes and data are fictitious. No production credentials,
// SMS, payments, or real admin sessions are created or modified.
import { chromium } from 'playwright';
import pg from 'pg';
import { createHmac, createHash, randomInt } from 'node:crypto';
import { mkdir } from 'node:fs/promises';

const BASE=process.env.BASE_URL ?? 'http://127.0.0.1:8080';
if (!['127.0.0.1','localhost'].includes(new URL(BASE).hostname))
  throw new Error('Temporary demo browser test must target localhost only');
const db=new pg.Client({connectionString:process.env.LOCAL_E2E_DATABASE_URL ?? 'postgres://postgres@127.0.0.1:5432/traksos'});
const secret=process.env.APP_SECRET ?? 'dev-secret-change-me';
const pinHash=pin=>createHmac('sha256',secret).update('operator-demo-v1:'+pin).digest('hex');
const sha256=token=>createHash('sha256').update(token).digest('hex');
let browser;
await db.connect();
const previous=(await db.query('select * from operator_demo_grant where id=1')).rows[0]??null;
const issuedTokens=[];
try {
  browser=await chromium.launch();
  await mkdir('e2e/shots/temporary-demo',{recursive:true});
  for (const width of [390,1440]){
    const code=String(randomInt(0,10_000_000_000)).padStart(10,'0');
    await db.query(`insert into operator_demo_grant(id,pin_hash,expires_at,attempts,redeemed_at)
      values (1,$1,now()+interval '4 hours',0,null)
      on conflict(id) do update set pin_hash=excluded.pin_hash,expires_at=excluded.expires_at,
        attempts=0,redeemed_at=null`,[pinHash(code)]);

    const context=await browser.newContext({viewport:{width,height:900},locale:'ru-RU'});
    const page=await context.newPage();
    const errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    try {
      await page.goto(BASE+'/#/preview');
      await page.getByRole('heading',{name:'Проверка тестовых кабинетов'}).waitFor();
      await page.locator('.operator-demo-app').waitFor();
      await page.getByText('ТЕСТОВЫЙ РЕЖИМ',{exact:true}).waitFor();
      if(await page.locator('.guest-header-actions, .guest-site-nav, .guest-mobile-business').count())
        throw Error(width+': public guest navigation leaked into private demo preview');
      if(await page.locator('input[type="tel"]').count())
        throw Error(width+': guest preview incorrectly requests a phone number');
      if(await page.locator('.sandbox-role-card').count())
        throw Error(width+': roles visible without any demo code');

      const pin=page.locator('#operator-demo-code');
      await pin.fill('0000000000');
      await page.getByRole('button',{name:'Открыть тестовые кабинеты'}).click();
      await page.getByRole('alert').getByText(/Неверный или устаревший код/).waitFor();
      await pin.fill(code);
      await page.getByRole('button',{name:'Открыть тестовые кабинеты'}).click();
      await page.waitForURL('**/#/admin/test-center');
      await page.getByRole('heading',{name:'Тестирование кабинетов'}).waitFor();
      const token=await page.evaluate(()=>sessionStorage.getItem('traksos.operatorDemoSession'));
      if(!token || token.length<40) throw Error(width+': no scoped preview token');
      issuedTokens.push(token);

      const roles=['client','owner','driver','master','tow','service',
        'master_service','insurer','inspection','courier','moderator','admin'];
      const actualRoles=await page.locator('a.sandbox-role-card').evaluateAll(nodes=>
        nodes.map(node=>node.getAttribute('href')?.split('/').at(-1)).sort());
      if(JSON.stringify(actualRoles)!==JSON.stringify([...roles].sort()))
        throw Error(width+': demo role list differs from the 12 approved roles: '+
          JSON.stringify(actualRoles));
      const protectedMe=await fetch(BASE+'/api/me',{headers:{authorization:'Bearer '+token}});
      if(protectedMe.status!==401)
        throw Error(width+': preview token could authenticate against real /api/me');

      for(const role of roles){
        await page.locator('a.sandbox-role-card[href="#/admin/test-center/'+role+'"]').click();
        await page.waitForURL('**/#/admin/test-center/'+role);
        await page.getByText('ТЕСТОВЫЙ ПРОСМОТР · НЕ РЕАЛЬНЫЙ АККАУНТ').waitFor();
        await page.locator('a[href="#/admin/test-center"]').first().click();
        await page.getByRole('heading',{name:'Тестирование кабинетов'}).waitFor();
      }

      // A fresh browser does not inherit this tab's demo credentials.
      const outsider=await browser.newContext({viewport:{width,height:900},locale:'ru-RU'});
      try{
        const other=await outsider.newPage();
        await other.goto(BASE+'/#/admin/test-center');
        await other.getByRole('heading',{name:'Проверка тестовых кабинетов'}).waitFor();
        if(await other.locator('.sandbox-role-card').count())
          throw Error(width+': preview leaked into an unrelated browser session');
      }finally{await outsider.close();}

      const secondUse=await fetch(BASE+'/api/public/demo/unlock',{
        method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({code}),
      });
      if(secondUse.status!==401) throw Error(width+': one-time code was reused');

      await page.screenshot({path:'e2e/shots/temporary-demo/roles-'+width+'.png',fullPage:true});

      // Revocation/expiry is checked by the server on each navigation.
      await db.query("update operator_demo_session set expires_at=now()-interval '1 second' where token_hash=$1",[sha256(token)]);
      await page.reload();
      await page.getByRole('heading',{name:'Проверка тестовых кабинетов'}).waitFor();
      if(await page.locator('.sandbox-role-card').count())
        throw Error(width+': expired demo session remained open');
      if(errors.length)throw Error(width+': JavaScript error: '+errors.join('; '));
    }finally{await context.close();}
  }
  console.log('Temporary one-use demo code: phone-free entry, all 12 role routes, fresh-browser isolation, no real API login, expiry — PASS (390/1440)');
}finally{
  if(browser)await browser.close();
  // Strictly local CI fixture cleanup. Never deletes other roles or real users.
  for(const token of issuedTokens)
    await db.query('delete from operator_demo_session where token_hash=$1',[sha256(token)]).catch(()=>{});
  if(previous){
    await db.query(`insert into operator_demo_grant(id,pin_hash,expires_at,attempts,redeemed_at)
      values (1,$1,$2,$3,$4)
      on conflict(id) do update set pin_hash=excluded.pin_hash,expires_at=excluded.expires_at,
        attempts=excluded.attempts,redeemed_at=excluded.redeemed_at`,
    [previous.pin_hash,previous.expires_at,previous.attempts,previous.redeemed_at]).catch(()=>{});
  }else await db.query('delete from operator_demo_grant where id=1').catch(()=>{});
  await db.end();
}
