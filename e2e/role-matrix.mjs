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
  { name: 'master', phone: '+79990000147', role: 'master', url: '#/work' },
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
      const mobileNav = page.locator('.tabbar');
      if (await mobileNav.count()) {
        const linkCount = await mobileNav.locator('a').count();
        const svgCount = await mobileNav.locator('a .ic svg[aria-hidden="true"]').count();
        if (!linkCount || svgCount !== linkCount)
          throw new Error('Premium role navigation icons missing: ' + svgCount + '/' + linkCount);
      }
      const widths = await page.evaluate(() => ({
        viewport: document.documentElement.clientWidth,
        content: document.documentElement.scrollWidth
      }));
      if (widths.content > widths.viewport + 2) throw new Error('Horizontal overflow ' + JSON.stringify(widths));
      await page.screenshot({ path: OUT + '/' + entry.name + '.png', fullPage: true });
      // UI hiding is insufficient: ensure the server refuses direct privileged API access.
      for (const endpoint of ['/api/admin/summary', '/api/admin/users', '/api/admin/settings']) {
        const resp = await fetch(BASE + endpoint, {
          headers: { authorization: 'Bearer ' + result.token }
        });
        if (resp.status !== 403) throw new Error(
          entry.name + ' accessed ' + endpoint + ': HTTP ' + resp.status + ' (expected 403)'
        );
      }
      // A random unauthenticated client must not read protected profile data.
      const unauth = await fetch(BASE + '/api/me');
      if (unauth.status !== 401) throw new Error('Unauthenticated profile access: HTTP ' + unauth.status);
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
        await page.getByRole('heading', { name: 'Страхование', exact: true }).waitFor();
        await page.getByText(/Назначенных заявок пока нет/).waitFor();
        await page.getByRole('button', { name: 'Общее', exact: true }).waitFor();
        // Partner sub-workspaces must behave as full usable pages, not decorative tabs.
        await page.getByRole('button', { name: 'Техосмотры', exact: true }).click();
        await page.getByRole('heading', { name: 'Техосмотры', exact: true }).waitFor();
        if (await page.getByRole('button', { name: 'Техосмотры', exact: true }).getAttribute('aria-pressed') !== 'true')
          throw new Error('Inspection workspace tab not selected');
        await page.screenshot({ path: OUT + '/insurer-inspections.png', fullPage: true });
        await page.getByRole('button', { name: 'Финансы', exact: true }).click();
        await page.getByRole('heading', { name: 'Финансы', exact: true }).waitFor();
        await page.screenshot({ path: OUT + '/insurer-finance.png', fullPage: true });
        await page.getByRole('button', { name: 'Общее', exact: true }).click();
        await page.getByRole('link', { name: 'Помощь и инструкции' }).click();
        if (!(await page.evaluate(() => location.hash)).startsWith('#/help'))
          throw new Error('Partner help link is broken');
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
