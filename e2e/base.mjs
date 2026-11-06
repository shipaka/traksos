// Рембаза целиком: карточка → проверка → запись клиента → ответ → ремонт → счёт → сверка → история машины. Нужна свежая база.
import { chromium, devices } from 'playwright';
const BASE = process.env.BASE_URL ?? 'http://localhost:8080', OUT = process.argv[2] ?? 'e2e/shots';
const api = async (m, p, b, t) => { const r = await fetch(BASE+p,{method:m,headers:{'content-type':'application/json',...(t?{authorization:'Bearer '+t}:{})},body:b?JSON.stringify(b):undefined}); return r.json(); };
const login = async (ph, role) => { const c = await api('POST','/api/auth/code',{phone:ph}); return (await api('POST','/api/auth/verify',{phone:ph,code:c.devCode,role})).token; };
const adm = await login('+79990000001'), k = await login('+79991112233'), s = await login('+79995556677','service');
for (const t of [k,s,adm]) for (const aud of ['client','performer','privacy']) { const o = await api('GET','/api/offers/current/'+aud); if (o) await api('POST','/api/offers/'+o.id+'/accept',{},t); }
await api('POST','/api/vehicles',{brand:'DAF',model:'XF',year:2016,plate:'а482км178'},k);
const b = await chromium.launch(); const errs=[];
const page = async (tok, w) => { const ctx = await b.newContext({...devices['iPhone 13'], geolocation:{latitude:59.9,longitude:30.3}, permissions:['geolocation']}); await ctx.addInitScript((t)=>{try{localStorage.setItem('traksos.token',t)}catch{}}, tok); const p = await ctx.newPage(); p.on('pageerror',e=>errs.push(w+': '+e.message)); p.on('console',c=>c.type()==='error'&&!c.text().includes('TUNNEL')&&errs.push(w+': '+c.text())); return p; };
const C = async (l) => { await l.first().evaluate(e=>e.scrollIntoView({block:'center'})); await l.first().click(); };
const shot = (p,n) => p.screenshot({path:`${OUT}/${n}.png`,fullPage:true});
// Рембаза заполняет карточку
const sp = await page(s,'service'); await sp.goto(BASE+'/#/as/service'); await sp.waitForTimeout(1200);
await C(sp.getByRole('link',{name:'Заполнить карточку'})); await sp.waitForTimeout(1000);
await shot(sp,'b1-setup');
await sp.getByPlaceholder('Например, Шушары-Трак').fill('Шушары-Трак');
await sp.getByPlaceholder('Шушары, Московское ш., 50').fill('Шушары, Московское ш., 50');
await C(sp.getByRole('button',{name:/Отметить место по GPS/})); await sp.waitForTimeout(500);
await C(sp.getByRole('button',{name:'DAF',exact:true}));
await C(sp.getByRole('button',{name:'Сохранить и пройти проверку'})); await sp.waitForTimeout(1200);
await shot(sp,'b2-pending');
const centers = await api('GET','/api/admin/services',undefined,adm);
// Админ одобряет через UI
const ap = await page(adm,'admin'); await ap.goto(BASE+'/#/admin'); await ap.waitForTimeout(800);
await C(ap.getByRole('button',{name:'Рембазы',exact:true})); await ap.waitForTimeout(500);
await C(ap.getByRole('button',{name:'Одобрить'})); await ap.waitForTimeout(800);
// Клиент: сервисы → карточка → запись
const kp = await page(k,'client'); await kp.goto(BASE+'/#/services'); await kp.waitForTimeout(1500);
await shot(kp,'c1-list');
await C(kp.getByText('Шушары-Трак').first()); await kp.waitForTimeout(800); await shot(kp,'c2-center');
await C(kp.getByRole('link',{name:'Записаться'})); await kp.waitForTimeout(800);
await C(kp.getByRole('button',{name:'Электрика',exact:true}));
await kp.getByPlaceholder(/Примерно к/).fill('14:00');
await kp.getByPlaceholder('Что беспокоит').fill('Не горит свет прицепа');
await shot(kp,'c3-book');
await C(kp.getByRole('button',{name:'Отправить запрос'})); await kp.waitForTimeout(1200); await shot(kp,'c4-booking');
// Рембаза отвечает
await sp.goto(BASE+'/#/base'); await sp.waitForTimeout(1200); await shot(sp,'b3-request');
await C(sp.getByRole('button',{name:'Готовы принять'})); await C(sp.getByRole('button',{name:'Отправить клиенту'})); await sp.waitForTimeout(800);
await C(sp.getByRole('tab',{name:/Машины у вас/})); await sp.waitForTimeout(300);
await C(sp.locator('a.list-item')); await sp.waitForTimeout(800);
await C(sp.getByRole('button',{name:'Машина приехала'})); await sp.waitForTimeout(800);
await C(sp.getByRole('button',{name:'Ждём запчасть'})); await sp.waitForTimeout(500);
await sp.getByPlaceholder('Дописать…').fill('Заказали разъём, будет в четверг'); await C(sp.getByRole('button',{name:'Добавить',exact:true})); await sp.waitForTimeout(500);
await C(sp.getByText('Показывать заметки клиенту')); await sp.waitForTimeout(500);
await C(sp.getByRole('button',{name:'Карточка компании'})); await sp.waitForTimeout(500);
await shot(sp,'b4-car');
await C(sp.getByRole('button',{name:'Машина готова — оформить работы'}));
await C(sp.getByRole('button',{name:'Электрика',exact:true}));
await C(sp.getByRole('button',{name:'Машина готова',exact:true})); await sp.waitForTimeout(800);
await sp.getByPlaceholder(/12 000/).fill('12000'); await C(sp.getByRole('button',{name:'Выставить счёт'})); await sp.waitForTimeout(800);
await shot(sp,'b5-invoice');
// Клиент сверяет
await kp.reload(); await kp.waitForTimeout(1200); await shot(kp,'c5-invoice');
await C(kp.getByRole('button',{name:'Всё верно'})); await C(kp.getByRole('button',{name:'5 из 5'}));
await C(kp.getByRole('button',{name:'Подтвердить работы'})); await kp.waitForTimeout(800); await shot(kp,'c6-closed');
await kp.goto(BASE+'/#/garage'); await kp.waitForTimeout(1000); await C(kp.getByRole('button',{name:/История/}).first()); await kp.waitForTimeout(500); await shot(kp,'c7-garage');
await kp.goto(BASE+'/#/orders'); await kp.waitForTimeout(800); await C(kp.getByRole('tab',{name:'История'})); await kp.waitForTimeout(500); await shot(kp,'c8-orders');
await b.close();
if (errs.length) { console.error('Ошибки в консоли:', errs); process.exit(1); }
console.log('Рембаза: сквозной сценарий пройден');
