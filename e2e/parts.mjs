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
const b = await chromium.launch(); const errs=[];
const C = async (l) => { await l.first().evaluate(e=>e.scrollIntoView({block:'center'})); await l.first().click(); };
const page = async (tok, w) => { const ctx = await b.newContext({...devices['iPhone 13']}); if (tok) await ctx.addInitScript((t)=>{try{localStorage.setItem('traksos.token',t)}catch{}}, tok); const p = await ctx.newPage(); p.on('pageerror',e=>errs.push(w+': '+e.message)); p.on('console',c=>c.type()==='error'&&!c.text().includes('TUNNEL')&&errs.push(w+': '+c.text())); return p; };
const shot = (p,n) => p.screenshot({path:`${OUT}/${n}.png`,fullPage:true});
await api('PUT','/api/performer/extras',{waitRate:90000},m);
const kp = await page(k,'client'); await kp.goto(BASE+'/#/order/'+o.id); await kp.waitForTimeout(1200);
await C(kp.getByText('Нужна запчасть, которой нет у мастера?')); await kp.waitForTimeout(300); await shot(kp,'x1-part');
await C(kp.getByRole('button',{name:/Мастер ждёт/})); await kp.waitForTimeout(1200); await shot(kp,'x2-wait');
const mp = await page(m,'master'); await mp.goto(BASE+'/#/order/'+o.id); await mp.waitForTimeout(1200); await shot(mp,'x3-master');
await mp.goto(BASE+'/#/work/me/level'); await mp.waitForTimeout(1000); await shot(mp,'x4-level');
const o2 = (await api('POST','/api/orders',{service:'electric',zoneId:'spb',description:'Свет 2'},k)).order;
await mp.goto(BASE+'/#/work'); await mp.waitForTimeout(1200); await shot(mp,'x5-line');
await b.close();
if (errs.length) { console.error('Ошибки в консоли:', errs); process.exit(1); }
console.log('Запчасть, уровень, рядом на линии: пройдено');
