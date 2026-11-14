// Standalone mobile smoke test of the new operational admin console.
// Runs after the main end-to-end flow has created the admin password.
import { chromium, devices } from 'playwright';
import { mkdir } from 'node:fs/promises';

const BASE = process.env.BASE_URL ?? 'http://localhost:8080';
const OUT = process.argv[2] ?? 'e2e/shots';
await mkdir(OUT, {recursive:true});
const r = await fetch(BASE+'/api/auth/login', {
  method:'POST',headers:{'content-type':'application/json'},
  body:JSON.stringify({phone:'+79990000001',password:'TrakSOS-Test-2026!'}),
});
if(!r.ok)throw new Error('Admin test login failed with HTTP '+r.status);
const {token}=await r.json();
const browser=await chromium.launch();
const page=await browser.newPage({...devices['Pixel 7'],deviceScaleFactor:1,locale:'ru-RU'});
page.setDefaultTimeout(12000);
await page.addInitScript(t=>localStorage.setItem('traksos.token',t),token);
const errors=[];
page.on('pageerror',e=>errors.push(e.message));
const assertFits = async name => {
  const widths = await page.evaluate(() => [document.documentElement.clientWidth,document.documentElement.scrollWidth]);
  if(widths[1]>widths[0]+2)throw new Error(name+' mobile horizontal overflow '+widths.join('/'));
};

await page.goto(BASE+'/#/admin/section/demand');
await page.getByText('Контроль невыполненных заявок').waitFor();
await page.getByText('Спрос по часам (Москва, МСК)').waitFor();
await page.getByText('Реестр проблемных заявок').waitFor();
await assertFits('Demand dashboard');
await page.screenshot({path:OUT+'/23-admin-demand.png'});

await page.goto(BASE+'/#/admin/section/announcements');
await page.getByText('Объявления для исполнителей').waitFor();
await page.getByText('Временная комиссия площадки').waitFor();
await page.getByRole('button',{name:'Сохранить объявление'}).waitFor();
await page.getByRole('button',{name:'Назначить комиссию'}).waitFor();
await assertFits('Commission campaigns');
await page.screenshot({path:OUT+'/24-admin-campaigns.png'});
if(errors.length)throw new Error('Admin operations page errors: '+errors.join('; '));
await browser.close();
