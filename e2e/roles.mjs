import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const base = process.env.BASE_URL ?? 'http://localhost:8080';
async function acceptPendingOffers(page) {
  await page.waitForTimeout(900); // Wait for current offers to load after authentication.
  // Seeded demo accounts receive current client/partner offers on first sign-in.
  // Accept them through the actual UI before testing navigation beneath the modal.
  for (let i = 0; i < 4; i++) {
    const dialog = page.getByRole('dialog', { name: /Оферта|Согласие/ });
    if (!(await dialog.isVisible().catch(() => false))) break;
    const offerName = await dialog.getAttribute('aria-label');
    await dialog.locator('input[type=checkbox]').check();
    await dialog.getByRole('button', { name: 'Принимаю' }).click();
    await page.waitForFunction((name) => !document.querySelector('[role="dialog"][aria-label="' + name + '"]'), offerName);
  }
}

const shots = process.argv[2];
if (shots) await mkdir(shots, { recursive: true });

const roles = [
  { name: 'client', phone: '+79000000002', heading: /Что случилось/, paths: ['#/garage', '#/orders', '#/profile', '#/support'] },
  { name: 'owner', phone: '+79000000003', heading: /помощь уже рядом|Что случилось\?/i, paths: ['#/garage', '#/fleet', '#/fleet/finances', '#/orders', '#/profile'] },
  { name: 'driver', phone: '+79000000004', heading: /помощь уже рядом|Что случилось\?/i, paths: ['#/garage', '#/orders', '#/profile'] },
  { name: 'master', phone: '+79000000011', heading: /Кабинет|Дима/i, paths: ['#/work', '#/work/jobs', '#/work/me/money', '#/profile'] },
  { name: 'tow', phone: '+79000000021', heading: /Кабинет|Пётр/i, paths: ['#/work', '#/work/jobs', '#/profile'] },
  { name: 'repair-base', phone: '+79000000031', heading: /Рембаза/i, paths: ['#/base', '#/base/money', '#/base/me', '#/profile'] },
  { name: 'moderator', phone: '+79000000005', heading: /Администратор/i, paths: ['#/admin', '#/support', '#/profile'] },
];

const browser = await chromium.launch();
try {
  for (const role of roles) {
    const context = await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: 'ru-RU' });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(base + '/#/');
    await page.getByRole('button', { name: 'Войти в кабинет' }).click();
    await page.locator('input[type=tel]').fill(role.phone);
    await page.getByRole('button', { name: 'Получить код' }).click();
    const hint = await page.getByText(/Тестовый режим: код/).textContent();
    const match = hint?.match(/[0-9]{4,6}/);
    if (!match) throw new Error(role.name + ': test login code missing');
    await page.locator('input[autocomplete=one-time-code]').fill(match[0]);
    await page.getByRole('button', { name: 'Войти', exact: true }).click();
    await page.locator('.website-workspace').waitFor();
    await page.locator('.website-sidebar').waitFor({ state: role.name === 'moderator' ? 'attached' : 'visible' });
    await acceptPendingOffers(page);
    if (await page.locator('.native-app').count()) throw new Error(role.name + ': desktop loaded Android shell');
    await page.locator('.website-work-area main').first().waitFor({ state: 'visible' });
    if (shots) await page.screenshot({ path: shots + '/role-' + role.name + '-home.png' });
    for (const route of role.paths) {
      await page.goto(base + '/' + route);
      await page.locator('.website-workspace').waitFor();
      await page.locator('.website-work-area main').first().waitFor();
      // The same responsive cabinet shell must be present on every role's main page.
      if (['#/profile', '#/fleet', '#/work'].includes(route)) {
        await page.locator('.website-work-area .cabinet-heading').first().waitFor();
        const heading = await page.locator('.website-work-area .cabinet-heading h1').first().textContent();
        if (!heading?.trim()) throw new Error(role.name + ' ' + route + ': missing cabinet heading');
      }
      const overflow = await page.evaluate(() => ({
        viewport: document.documentElement.clientWidth,
        content: document.documentElement.scrollWidth,
      }));
      if (overflow.content > overflow.viewport + 2) throw new Error(role.name + ' ' + route + ': horizontal overflow ' + JSON.stringify(overflow));
      if (await page.locator('.tabbar:visible').count()) throw new Error(role.name + ' ' + route + ': Android tabbar on desktop');
      if (await page.getByText('Такой страницы нет', { exact: true }).count()) throw new Error(role.name + ': unknown route ' + route);
    }
    if (role.name === 'driver') {
      const res = await page.evaluate(async () => {
        const token = localStorage.getItem('traksos.token');
        return fetch('/api/fleet/finances', { headers: { Authorization: 'Bearer ' + token } }).then(r => r.status);
      });
      // Never permit a driver to view company financial records.
      if (res === 200) throw new Error('Driver was granted company financial access');
    }
    if (errors.length) throw new Error(role.name + ' browser errors: ' + errors.join('; '));
    await context.close();
    console.log('Role checked: ' + role.name + ', routes: ' + role.paths.length);
  }
  console.log('Daily roles verified: client, fleet owner, driver, master, tow, repair base and moderator');
} finally {
  await browser.close();
}
