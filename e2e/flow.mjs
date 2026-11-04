import { chromium, devices } from 'playwright';
const BASE = process.env.BASE_URL ?? 'http://localhost:8080';
const OUT = process.argv[2] ?? 'e2e/shots';
await (await import('node:fs/promises')).mkdir(OUT, { recursive: true });
const shot = async (page, name) => page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false });
const errors = [];

async function api(method, path, body, token) {
  const r = await fetch(BASE + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return r.json();
}

const browser = await chromium.launch();
const phone = { ...devices['Pixel 7'], deviceScaleFactor: 1 };
const mk = async () => {
  const ctx = await browser.newContext({ ...phone, locale: 'ru-RU', geolocation: { latitude: 59.93, longitude: 30.31 }, permissions: ['geolocation'] });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => m.type() === 'error' && !m.text().includes('fonts.g') && !m.text().includes('ERR_') && errors.push('console: ' + m.text()));
  return page;
};

async function login(page, phoneNum, roleText) {
  await page.goto(BASE + '/#/login');
  await page.getByRole('button', { name: roleText }).click();
  await page.locator('input[type=tel]').fill(phoneNum);
  await page.locator('input[type=checkbox]').check();
  await page.getByRole('button', { name: 'Получить код' }).click();
  const hint = await page.getByText(/Тестовый режим: код/).textContent();
  await page.locator('input[autocomplete=one-time-code]').fill(hint.match(/\d{4}/)[0]);
  await page.getByRole('button', { name: 'Войти' }).click();
}

// Админ — через API
const c = await api('POST', '/api/auth/code', { phone: '+79990000001' });
const admin = await api('POST', '/api/auth/verify', { phone: '+79990000001', code: c.devCode });

// Мастер
const m = await mk();
await login(m, '+79992223344', 'Я мастер');
await m.waitForURL(/work\/profile/);
await m.locator('label:has-text("Имя") input').fill('Иван');
await m.getByRole('button', { name: 'Самозанятый' }).click();
await m.locator('input[placeholder="ИНН, 12 цифр"]').fill('780000000001');
await m.locator('input[placeholder="Марка: Lada Largus"]').fill('Lada Largus');
await m.locator('input[placeholder="Госномер"]').fill('а123вс78');
await shot(m, '01-master-profile');
await m.getByRole('button', { name: 'Сохранить' }).click();
await m.waitForURL(/#\/work$/);
await m.getByText('Профиль на проверке').waitFor();
const users = await api('GET', '/api/admin/users?q=2223344', null, admin.token);
await api('POST', `/api/admin/performers/${users[0].id}/verify`, { decision: 'approved' }, admin.token);
await m.getByRole('button', { name: 'Свободен' }).waitFor({ timeout: 10000 });
await m.getByRole('button', { name: 'Свободен' }).click();
await m.getByText(/Геолокация включена/).waitFor();
await shot(m, '02-master-online');

// Клиент
const k = await mk();
await login(k, '+79991112233', 'Мне нужна помощь');
await k.getByText('Что случилось?').first().waitFor();
await shot(k, '03-client-home');
await k.getByRole('button', { name: /SOS/ }).first().click();
await k.getByRole('button', { name: /Не заводится/ }).click();
await k.locator('input[placeholder^="Марка"]').fill('скан');
await k.getByRole('button', { name: 'Scania' }).click();
await k.locator('input[placeholder^="Адрес"]').fill('Тосно, М-11, стоянка у АЗС');
await k.getByRole('button', { name: /Тосно/ }).click();
await k.getByText('Сколько это будет стоить').waitFor();
await shot(k, '04-client-new-order');
await k.getByRole('button', { name: 'Вызвать сейчас' }).click();
await k.waitForURL(/order\//);
await k.locator('.radar').waitFor();
await k.waitForTimeout(1500);
await shot(k, '05-client-searching');

// Мастеру заявка приходит как звонок — откликается по обычной цене
await m.getByRole('alertdialog').waitFor({ timeout: 10000 });
await shot(m, '06-master-incoming-call');
await m.getByRole('alertdialog').getByRole('button', { name: /Беру за/ }).click();
await m.getByRole('alertdialog').waitFor({ state: 'detached' });

// Клиент видит отклик и выбирает
await k.getByRole('button', { name: /Выбрать за/ }).waitFor({ timeout: 15000 });
await k.waitForTimeout(600);
await shot(k, '06b-client-offers');
await k.getByRole('button', { name: /Выбрать за/ }).click();
await m.waitForURL(/order\//, { timeout: 10000 });
await k.getByText('Иван').first().waitFor({ timeout: 10000 });
await shot(k, '07-client-accepted');

// Чат
await k.locator('.compose input').fill('Позвоните мне 8 921 111-22-33');
await k.locator('.compose button').click();
await m.getByText('[номер скрыт]').first().waitFor({ timeout: 10000 });

// Статусы
await m.locator('button.btn', { hasText: 'Выехал' }).click();
await m.locator('button.btn:not([disabled])', { hasText: 'Я на месте' }).waitFor();
await m.locator('button.btn', { hasText: 'Я на месте' }).click();
await m.getByRole('button', { name: 'Начал работу' }).click();
await m.locator('.card:has-text("Закрыть выезд") input[inputmode=numeric]').fill('2100');
await m.locator('input[placeholder^="Что сделали"]').fill('Зачистил массу, заменил клемму');
await shot(m, '08-master-close');
await m.getByRole('button', { name: 'Отправить клиенту' }).click();
await k.getByText(/Мастер назвал сумму/).waitFor({ timeout: 10000 });
await shot(k, '09-client-confirm');
await k.getByRole('button', { name: /Подтверждаю/ }).click();
await k.getByText('Как отработал мастер?').waitFor({ timeout: 10000 });
await k.getByRole('button', { name: '5 из 5' }).click();
await k.getByRole('button', { name: 'Приехал быстро' }).click();
await k.getByRole('button', { name: 'Оставить отзыв' }).click();
await k.getByText('Спасибо за отзыв').waitFor();
await shot(k, '10-client-done');
await m.getByText('Как прошло с клиентом?').waitFor({ timeout: 10000 });
await m.getByRole('button', { name: '4 из 5' }).click();
await m.getByRole('button', { name: 'Оставить отзыв' }).click();
await m.goto(BASE + '/#/work');
await m.getByText('Долг по комиссии с наличных').waitFor();
await shot(m, '11-master-balance');

// Админ в браузере
const a = await mk();
await login(a, '+79990000001', 'Мне нужна помощь');
await a.getByText('Что случилось?').first().waitFor();
await a.goto(BASE + '/#/admin');
await a.getByRole('button', { name: 'Распределение' }).click();
await a.getByText('Сначала заявки нам').waitFor();
await shot(a, '12-admin-dispatch');
await a.getByRole('button', { name: 'Оплата и выплаты' }).click();
await a.getByText('Способы оплаты').waitFor();
await shot(a, '13-admin-payments');

await browser.close();
if (errors.length) { console.error('ОШИБКИ:\n' + errors.join('\n')); process.exit(1); }
console.log('Сквозной сценарий пройден, ошибок в консоли нет');
