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

// «Фото с камеры»: PNG с шумом, чтобы после сжатия оставалось похоже на настоящий снимок
import { deflateSync } from 'node:zlib';
function noisePng(w = 480, h = 360) {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w * 3; x++) raw[y * (w * 3 + 1) + 1 + x] = Math.random() * 255;
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
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

// how: 'help' — кнопка «Помогите», 'login' — вход по номеру, иначе текст роли в «Хочу работать с ТракSOS»
async function login(page, phoneNum, how) {
  await page.goto(BASE + '/#/login');
  if (how === 'help') await page.getByRole('button', { name: /Помогите/ }).click();
  else if (how === 'login') await page.getByRole('button', { name: 'Войти по номеру' }).click();
  else { await page.getByRole('button', { name: /Хочу работать/ }).click(); await page.getByRole('button', { name: how }).click(); }
  await page.locator('input[type=tel]').fill(phoneNum);
  if (how !== 'login') await page.locator('input[type=checkbox]').check();
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
await m.locator('input[placeholder="Имя, как увидят клиенты"]').fill('Иван');
await m.getByRole('button', { name: 'Самозанятый' }).click();
await m.locator('input[placeholder="ИНН, 12 цифр"]').fill('780000000001');
await m.locator('input[placeholder="Марка: Lada Largus"]').fill('Lada Largus');
await m.locator('input[placeholder="Госномер"]').fill('а123вс78');
await shot(m, '01-master-profile');
await m.getByRole('button', { name: /Дальше — фото/ }).click();
// Сразу после профиля — фото для проверки
await m.waitForURL(/work\/docs/);
await m.getByText(/^0 из \d$/).waitFor();
const n = await m.locator('input[type=file]').count();
for (let i = 0; i < n; i++) {
  await m.locator('input[type=file]').nth(i).setInputFiles({ name: 'photo.png', mimeType: 'image/png', buffer: noisePng() });
  await m.getByText(`${i + 1} из ${n}`).waitFor({ timeout: 10000 });
}
await shot(m, '01b-master-docs');
await m.getByRole('button', { name: 'Отправить на проверку' }).click();
await m.getByText('На проверке у модератора').waitFor();

// Модератор принимает фото и одобряет мастера в своей очереди
const a = await mk();
await login(a, '+79990000001', 'login');
// Админ входит по номеру — сразу в админку, без выбора роли
await a.waitForURL(/#\/admin/);
await a.getByRole('button', { name: 'Проверка', exact: true }).click();
await a.getByText('Отправил').waitFor();
for (let i = 0; i < n; i++) {
  await a.getByRole('button', { name: 'Принять' }).first().click();
  await a.waitForTimeout(400);
}
await shot(a, '01c-admin-verify');
await a.getByRole('button', { name: 'Одобрить' }).click();
await a.getByText('Очередь пуста').waitFor();
await m.goto(BASE + '/#/work');
await m.getByRole('button', { name: /^Свободен/ }).waitFor({ timeout: 10000 });
await m.getByRole('button', { name: /^Свободен/ }).click();
await m.getByText(/Геолокация включена/).waitFor();
await shot(m, '02-master-online');

// Клиент
const k = await mk();
await login(k, '+79991112233', 'help');
// «Помогите» — после кода сразу экран SOS
await k.waitForURL(/#\/sos/);
await k.goto(BASE + '/#/');
await k.getByText('Что случилось?').first().waitFor();
await shot(k, '03-client-home');
await k.getByRole('link', { name: /SOS/ }).first().click();
await k.getByRole('button', { name: /Не заводится/ }).click();
await k.getByRole('button', { name: /Электрик или диагност на выезд/ }).click();
await k.getByRole('button', { name: /Вызвать сейчас/ }).click(); // рано: подсветит, чего не хватает
await k.getByText('Осталось:').waitFor();
await k.locator('select[aria-label="Марка"]').selectOption('Scania');
await k.locator('select[aria-label="Модель"]').selectOption('R-серия');
await k.locator('select[aria-label="Год выпуска"]').selectOption('2012');
await k.locator('input[placeholder^="Адрес"]').fill('Тосно, М-11, стоянка у АЗС');
await k.getByRole('button', { name: /Тосно/ }).click();
await k.getByText('Проверьте перед вызовом').waitFor();
await k.locator('.agree input').check();
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
await a.goto(BASE + '/#/admin');
await a.getByRole('button', { name: 'Распределение' }).click();
await a.getByText('Сначала заявки нам').waitFor();
await shot(a, '12-admin-dispatch');
await a.getByRole('button', { name: 'Деньги', exact: true }).click();
await a.getByText('Способы оплаты').waitFor();
await shot(a, '13-admin-payments');

// Переходы между кабинетами: из админки в клиента и обратно, «Назад» ведёт в свой список
await a.getByRole('link', { name: /Клиент/ }).click();
await a.getByText('Что случилось?').first().waitFor();
await a.getByRole('link', { name: /Профиль/ }).click();
await a.getByRole('button', { name: 'Кабинет администратора' }).click();
await a.getByText('Администратор').first().waitFor();
await m.goto(BASE + '/#/work/jobs');
await m.locator('a.list-item').first().click();
await m.getByText('← Назад').click();
await m.waitForURL(/#\/work\/jobs$/);
await m.getByRole('link', { name: /Профиль/ }).click();
await m.getByRole('button', { name: /Финансы/ }).click();
await m.getByText('Операции', { exact: true }).waitFor();
await shot(m, '16b-master-money');
await m.getByText('← Профиль').click();
await m.getByRole('button', { name: /Аккаунт/ }).click();
await m.getByRole('button', { name: 'Кабинет клиента' }).click();
await m.getByText('Что случилось?').first().waitFor();

// Админ: поиск → карточка клиента → бонусы; клиент видит их в профиле
await a.goto(BASE + '/#/admin');
await a.getByRole('button', { name: 'Поиск', exact: true }).click();
await a.locator('input[placeholder^="Телефон, имя"]').fill('1112233');
await a.getByRole('button', { name: 'Найти' }).click();
await a.locator('a.list-item').first().click();
await a.waitForURL(/admin\/user\//);
for (const tab of ['Заявки', 'Машины', 'Отзывы', 'Платежи', 'Журнал', 'Профиль и цена']) {
  await a.getByRole('button', { name: tab, exact: true }).click();
  await a.waitForTimeout(150);
}
await a.locator('input[placeholder="Сумма, ₽"]').fill('300');
await a.locator('input[placeholder^="За что"]').fill('Подарок за первый заказ');
await a.getByRole('button', { name: 'Начислить' }).click();
await a.getByText('Бонусы начислены').waitFor();
await shot(a, '14-admin-user-card');
await k.goto(BASE + '/#/profile');
await k.getByText(/спишутся сами/).waitFor({ timeout: 10000 });

// Админ: карточка мастера → начисление; мастер видит в балансе
await a.goto(BASE + '/#/admin');
await a.getByRole('button', { name: 'Поиск', exact: true }).click();
await a.locator('input[placeholder^="Телефон, имя"]').fill('2223344');
await a.getByRole('button', { name: 'Найти' }).click();
await a.locator('a.list-item').first().click();
await a.getByRole('button', { name: 'Исполнитель', exact: true }).click();
await a.locator('input[placeholder="Сумма, ₽"]').fill('100');
await a.locator('input[placeholder^="Причина: компенсация"]').fill('Компенсация за простой');
await a.getByRole('button', { name: 'Начислить' }).click();
await a.getByText('Начислено').first().waitFor();
await shot(a, '15-admin-performer');

// Админ: новая редакция оферты → клиенту окно с галочкой → принял
await a.goto(BASE + '/#/admin');
await a.getByRole('button', { name: 'Оферты', exact: true }).click();
await a.getByRole('button', { name: 'Оферта для клиентов' }).click();
await a.locator('textarea').fill('# Оферта для клиентов\n\nТестовая редакция для проверки окна согласия. Здесь будет текст от юриста.\n\n1. Пункт первый');
await a.locator('input[placeholder^="Что изменилось"]').fill('Новая шкала отмены');
await a.getByRole('button', { name: 'Опубликовать' }).click();
await a.getByText(/Опубликовано/).waitFor();
// Админ тоже пользователь — новую редакцию для клиентов принимает и он
await a.getByRole('dialog').waitFor({ timeout: 10000 });
await a.getByRole('dialog').locator('input[type=checkbox]').check();
await a.getByRole('button', { name: 'Принимаю' }).click();
await a.getByRole('dialog').waitFor({ state: 'detached' });
await k.goto(BASE + '/#/');
await k.getByRole('dialog').waitFor({ timeout: 10000 });
await shot(k, '16-client-offer-gate');
await k.getByRole('dialog').locator('input[type=checkbox]').check();
await k.getByRole('button', { name: 'Принимаю' }).click();
await k.getByRole('dialog').waitFor({ state: 'detached' });

// Поддержка: клиент зовёт из заявки → админ отвечает из очереди → клиент видит ответ
await k.goto(BASE + '/#/orders');
await k.getByRole('tab', { name: 'История' }).click();
await shot(k, '17b-client-history');
await k.locator('a.list-item').first().click();
await k.getByRole('link', { name: 'Позвать поддержку' }).click();
await k.getByRole('button', { name: 'Не согласен с суммой' }).click();
await k.locator('textarea').fill('Хочу уточнить итоговую сумму');
await k.getByRole('button', { name: 'Отправить' }).click();
await k.waitForURL(/#\/support\//);
await a.goto(BASE + '/#/admin');
await a.getByRole('button', { name: 'Обращения', exact: true }).click();
await a.getByText('Ждёт ответа').click();
await a.locator('.compose input').fill('Здравствуйте! Сейчас проверим');
await a.locator('.compose button').click();
await k.getByText('Сейчас проверим').waitFor({ timeout: 10000 });
await shot(k, '17-client-support');
await a.getByRole('button', { name: 'Закрыть обращение' }).click();
await k.getByText(/Поддержка закрыла обращение/).waitFor({ timeout: 10000 });
await a.goto(BASE + '/#/admin');
await a.getByRole('button', { name: 'Статистика', exact: true }).click();
await a.getByText('Заявок в день').waitFor();
await shot(a, '18-admin-stats');
await k.goto(BASE + '/#/notifications');
await k.getByText('Поддержка ответила', { exact: false }).first().waitFor();

await browser.close();
if (errors.length) { console.error('ОШИБКИ:\n' + errors.join('\n')); process.exit(1); }
console.log('Сквозной сценарий пройден, ошибок в консоли нет');
