// Мой парк: лимит → QR-наклейка → водитель входит по SMS → заказ дороже лимита → владелец подтверждает. Нужна свежая база.
import { chromium, devices } from 'playwright';
const BASE = process.env.BASE_URL ?? 'http://localhost:8080', OUT = process.argv[2] ?? 'e2e/shots';
const api = async (m, p, b, t) => { const r = await fetch(BASE+p,{method:m,headers:{'content-type':'application/json',...(t?{authorization:'Bearer '+t}:{})},body:b?JSON.stringify(b):undefined}); return r.json(); };
const login = async (ph, role) => { const c = await api('POST','/api/auth/code',{phone:ph}); return (await api('POST','/api/auth/verify',{phone:ph,code:c.devCode,role})).token; };
const k = await login('+79991112233');
for (const aud of ['client','performer','privacy']) { const o = await api('GET','/api/offers/current/'+aud); if (o) await api('POST','/api/offers/'+o.id+'/accept',{},k); }
const v = await api('POST','/api/vehicles',{brand:'DAF',model:'XF',year:2016,plate:'а482км178'},k);
const b = await chromium.launch(); const errs=[];
const C = async (l) => { await l.first().evaluate(e=>e.scrollIntoView({block:'center'})); await l.first().click(); };
const page = async (tok, w) => { const ctx = await b.newContext({...devices['iPhone 13']}); if (tok) await ctx.addInitScript((t)=>{try{localStorage.setItem('traksos.token',t)}catch{}}, tok); const p = await ctx.newPage(); p.on('pageerror',e=>errs.push(w+': '+e.message)); p.on('console',c=>c.type()==='error'&&!c.text().includes('TUNNEL')&&errs.push(w+': '+c.text())); return p; };
const kp = await page(k,'owner'); await kp.goto(BASE+'/#/garage'); await kp.waitForTimeout(1000);
await C(kp.getByRole('button',{name:/Мой парк/})); await kp.waitForTimeout(1000);
await kp.getByPlaceholder('без лимита').first().fill('1000');
await C(kp.getByRole('button',{name:'Сохранить',exact:true})); await kp.waitForTimeout(600);
await C(kp.getByRole('button',{name:'QR-наклейка'})); await kp.waitForTimeout(500);
const qrEl = kp.locator('[role=img][aria-label^="QR-код"]'); await qrEl.evaluate(e=>e.scrollIntoView({block:'center'}));
await qrEl.screenshot({path:`${OUT}/qr.png`});
await kp.screenshot({path:`${OUT}/f1-fleet.png`,fullPage:true});
const code = (await api('GET','/api/fleet',undefined,k)).cars[0].qrCode;
// Водитель сканирует наклейку — без входа
const dp = await page(null,'driver'); await dp.goto(BASE+'/#/qr/'+code); await dp.waitForTimeout(1000);
await dp.screenshot({path:`${OUT}/d1-qr.png`,fullPage:true});
await dp.locator('input[type=tel]').first().fill('+79993334455');
await dp.locator('input[type=checkbox]').first().check();
await C(dp.getByRole('button',{name:'Получить код'})); await dp.waitForTimeout(800);
const sms = (await dp.getByText(/Тестовый режим: код/).textContent()).match(/\d{4,6}/)[0];
await dp.locator('input[autocomplete=one-time-code]').fill(sms);
await C(dp.getByRole('button',{name:/Войти/})); await dp.waitForTimeout(1500);
await dp.screenshot({path:`${OUT}/d2-after-login.png`,fullPage:true});
await C(dp.getByRole('button',{name:'Я водитель этой машины'})); await dp.waitForTimeout(1500);
// Водитель вызывает электрика — дороже лимита
await dp.goto(BASE+'/#/new/electric'); await dp.waitForTimeout(1200);
await dp.screenshot({path:`${OUT}/d3-new.png`,fullPage:true});
const dTok = await dp.evaluate(()=>localStorage.getItem('traksos.token'));
for (const aud of ['client','privacy']) { const o = await api('GET','/api/offers/current/'+aud); if (o) await api('POST','/api/offers/'+o.id+'/accept',{},dTok); }
const o = (await api('POST','/api/orders',{service:'electric',zoneId:'spb',vehicleId:v.id,description:'Не горит свет прицепа'},dTok)).order;
await dp.goto(BASE+'/#/order/'+o.id); await dp.waitForTimeout(1000); await dp.screenshot({path:`${OUT}/d4-wait.png`,fullPage:true});
await kp.reload(); await kp.waitForTimeout(1200); await kp.screenshot({path:`${OUT}/f2-pending.png`,fullPage:true});
await C(kp.getByRole('button',{name:'Подтвердить',exact:true})); await kp.waitForTimeout(1000);
console.log('order status', (await api('GET','/api/orders/'+o.id,undefined,dTok)).status);
await b.close();
if (errs.length) { console.error('Ошибки в консоли:', errs); process.exit(1); }
console.log('Мой парк: сквозной сценарий пройден');
