// Справка, персональные данные, очередь модератора, обжалование блокировки со страницы входа. Нужна свежая база и psql.
import { execSync } from 'node:child_process';
import { chromium, devices } from 'playwright';
const BASE = process.env.BASE_URL ?? 'http://localhost:8080', OUT = process.argv[2] ?? 'e2e/shots';
const api = async (m, p, b, t) => { const r = await fetch(BASE+p,{method:m,headers:{'content-type':'application/json',...(t?{authorization:'Bearer '+t}:{})},body:b?JSON.stringify(b):undefined}); return r.json(); };
const login = async (ph, role) => { const c = await api('POST','/api/auth/code',{phone:ph}); return (await api('POST','/api/auth/verify',{phone:ph,code:c.devCode,role})); };
const adm = (await login('+79990000001')).token, k = (await login('+79991112233')).token; const mm = await login('+79992223344','master'); const m = mm.token;
for (const t of [k,m,adm]) for (const aud of ['client','performer','privacy']) { const o = await api('GET','/api/offers/current/'+aud); if (o) await api('POST','/api/offers/'+o.id+'/accept',{},t); }
await api('PUT','/api/performer/profile',{kind:'master',name:'Иван',specialties:['electric'],taxStatus:'self_employed',inn:'780000000001'},m);
execSync(`psql -h 127.0.0.1 -U postgres -d ${process.env.PGDATABASE ?? 'traksos'} -qc "update performer_profiles set verification='approved'"`);
await api('POST','/api/performer/line',{lineStatus:'online'},m);
const o = (await api('POST','/api/orders',{service:'electric',zoneId:'spb',description:'Не горит свет'},k)).order;
await api('POST',`/api/orders/${o.id}/offers`,{},m); const l = await api('GET',`/api/orders/${o.id}/offers`,undefined,k);
await api('POST',`/api/orders/${o.id}/offers/${l.offers[0].id}/choose`,{},k);
await api('POST',`/api/orders/${o.id}/step`,{action:'arrive'},m);
await api('POST',`/api/orders/${o.id}/amount`,{workAmount:300000,result:'solved'},m);
await api('POST',`/api/orders/${o.id}/dispute`,{reason:'Работал 20 минут, а не час'},k);
const b = await chromium.launch(); const errs=[];
const C = async (l) => { await l.first().evaluate(e=>e.scrollIntoView({block:'center'})); await l.first().click(); };
const page = async (tok, w) => { const ctx = await b.newContext({...devices['iPhone 13']}); if (tok) await ctx.addInitScript((t)=>{try{localStorage.setItem('traksos.token',t)}catch{}}, tok); const p = await ctx.newPage(); p.on('pageerror',e=>errs.push(w+': '+e.message)); p.on('console',c=>c.type()==='error'&&!c.text().includes('TUNNEL')&&!(w==='blocked'&&c.text().includes('403'))&&errs.push(w+': '+c.text())); return p; };
const shot = (p,n) => p.screenshot({path:`${OUT}/${n}.png`,fullPage:true});
const kp = await page(k,'client');
await kp.goto(BASE+'/#/help'); await kp.waitForTimeout(800); await C(kp.locator('summary').nth(4)); await shot(kp,'h1-help');
await kp.goto(BASE+'/#/privacy'); await kp.waitForTimeout(800); await shot(kp,'p1-privacy');
const [dl] = await Promise.all([kp.waitForEvent('download'), C(kp.getByRole('button',{name:'Скачать мои данные'}))]);
console.log('download', dl.suggestedFilename());
const ap = await page(adm,'admin'); await ap.goto(BASE+'/#/admin'); await ap.waitForTimeout(1000); await C(ap.getByRole('button',{name:'Очередь',exact:true})); await ap.waitForTimeout(600); await shot(ap,'m1-queue');
await C(ap.locator('a.list-item')); await ap.waitForTimeout(800); await shot(ap,'m2-case');
await ap.getByPlaceholder('Коротко — стороны увидят').fill('Оплата за полчаса');
await C(ap.getByRole('button',{name:'Частично'})); await ap.waitForTimeout(800); await shot(ap,'m3-decided');
// Блокировка и обжалование со страницы входа
await api('POST',`/api/admin/users/${mm.user.id}/block`,{blocked:true,reason:'тест'},adm);
const bp = await page(null,'blocked'); await bp.goto(BASE+'/#/login'); await bp.waitForTimeout(800);
await C(bp.getByRole('button',{name:/Я мастер/})); await bp.locator('input[type=tel]').fill('+79992223344'); await bp.locator('input[type=checkbox]').first().check();
await C(bp.getByRole('button',{name:'Получить код'})); await bp.waitForTimeout(800);
const sms = (await bp.getByText(/Тестовый режим: код/).textContent()).match(/\d{4,6}/)[0];
await bp.locator('input[autocomplete=one-time-code]').fill(sms); await C(bp.getByRole('button',{name:'Войти'})); await bp.waitForTimeout(800);
await bp.getByPlaceholder(/Что произошло/).fill('Клиент сам предложил наличные, я отказался'); await C(bp.getByRole('button',{name:'Оспорить блокировку'})); await bp.waitForTimeout(800);
await shot(bp,'b1-appeal');
const q = await api('GET','/api/mod/cases?kind=appeal',undefined,adm); console.log('appeals', q.items.length);
await b.close();
if (errs.length) { console.error('Ошибки в консоли:', errs); process.exit(1); }
console.log('Справка, данные, модерация: сквозной сценарий пройден');
