// Real-browser smoke of every public account category, using synthetic dev-only numbers.
// Runs only against CI's local development server. Never use against production.
import { chromium, devices } from 'playwright';
import { mkdir } from 'node:fs/promises';
const BASE = process.env.BASE_URL ?? 'http://localhost:8080';
const OUT = process.env.SHOTS_DIR ?? 'e2e/shots/roles';
await mkdir(OUT, { recursive: true });
const origin = new URL(BASE);
if (!['localhost', '127.0.0.1'].includes(origin.hostname)) throw new Error('Role matrix must only run against local CI');
async function post(path, body) {
  const r = await fetch(BASE + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const data = await r.json().catch(() => null);
  if (!r.ok) throw new Error(path + ' HTTP ' + r.status + ': ' + data?.error);
  return data;
}
const cases = [
  { name: 'owner', phone: '+79990000141', role: 'client', url: '#/' },
  { name: 'driver', phone: '+79990000142', role: 'driver', url: '#/' },
  { name: 'tow', phone: '+79990000143', role: 'tow', url: '#/work' },
  { name: 'service', phone: '+79990000144', role: 'service', url: '#/base' },
  { name: 'insurer', phone: '+79990000145', role: 'insurer', url: '#/insurance' },
  { name: 'master_service', phone: '+79990000146', role: 'master', url: '#/base', secondRole: 'service' },
];
const browser = await chromium.launch();
const failures = [], results = [];
try {
  for (const entry of cases) {
    const context = await browser.newContext({ ...devices['Pixel 7'], deviceScaleFactor: 1, locale: 'ru-RU' });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    try {
      const code = await post('/api/auth/code', { phone: entry.phone });
      if (!/^\d{4,6}$/.test(code.devCode ?? '')) throw new Error('Dev code unavailable: CI must use development SMS only');
      const result = await post('/api/auth/verify', {
        phone: entry.phone, code: code.devCode, accountType: entry.name, password: 'Test-Role-Only-2026!'
      });
      const roles = result.user?.roles ?? [];
      if (!roles.includes(entry.role) || (entry.secondRole && !roles.includes(entry.secondRole)))
        throw new Error('Wrong registration roles: ' + JSON.stringify(roles));
      if (roles.includes('admin') || roles.includes('moderator')) throw new Error('Self-registered user gained staff access');
      await page.addInitScript(token => localStorage.setItem('traksos.token', token), result.token);
      await page.goto(BASE + '/' + entry.url, { waitUntil: 'domcontentloaded' });
      await page.locator('.app').waitFor();
      await page.locator('.account-menu > summary').waitFor();
      const widths = await page.evaluate(() => ({
        viewport: document.documentElement.clientWidth,
        content: document.documentElement.scrollWidth
      }));
      if (widths.content > widths.viewport + 2) throw new Error('Horizontal overflow ' + JSON.stringify(widths));
      await page.screenshot({ path: OUT + '/' + entry.name + '.png', fullPage: true });
      // Privileged pages must be inaccessible even when a direct URL is entered.
      await page.goto(BASE + '/#/admin', { waitUntil: 'domcontentloaded' });
      await page.locator('.app').waitFor();
      if (await page.getByText('Административная сводка').count()) throw new Error('Non-staff user can see admin dashboard');
      // Insurance cabinet must not be accessible to other categories.
      if (entry.name !== 'insurer') {
        await page.goto(BASE + '/#/insurance', { waitUntil: 'domcontentloaded' });
        await page.getByText('Нет доступа к кабинету страховщика').waitFor();
      }
      if (entry.name === 'insurer') {
        await page.goto(BASE + '/#/insurance', { waitUntil: 'domcontentloaded' });
        await page.getByRole('heading', { name: 'Страховой партнёр' }).waitFor();
        await page.getByText(/оформление страховых продуктов и договоров ещё не запущено/).waitFor();
        await page.getByRole('link', { name: 'Связаться с поддержкой' }).waitFor();
      }
      if (entry.name === 'driver') {
        await page.goto(BASE + '/#/fleet', { waitUntil: 'domcontentloaded' });
        await page.getByText('Парком управляет владелец').waitFor();
      }
      if (errors.length) throw new Error('JS errors: ' + errors.join('; '));
      results.push({ accountType: entry.name, roles, layout: 'OK', access: 'OK' });
    } catch (e) { failures.push({ accountType: entry.name, error: e.message }); }
    await context.close();
  }
} finally { await browser.close(); }
console.log(JSON.stringify({ results, failures }, null, 2));
if (failures.length) process.exitCode = 1;
