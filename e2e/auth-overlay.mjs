// Real browser regression: authentication overlays approved public pages.
// This test never sends SMS and never authenticates a production account.
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:8080';
if (!['localhost','127.0.0.1'].includes(new URL(BASE).hostname))
  throw Error('Auth overlay smoke must use the local CI server');
await mkdir('e2e/shots/auth-overlay', { recursive: true });
const browser = await chromium.launch();
try {
  for (const width of [390, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, locale: 'ru-RU' });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(BASE + '/#/');
    const landing = page.locator(width >= 900 ? '.owner20-home' : '.public-home');
    await landing.waitFor();
    const entry = page.locator(width >= 900 ? '.owner20-signin' : '.guest-header-actions a[href="#/login"]');
    await entry.click();
    await page.waitForURL('**/#/login');
    const dialog = page.getByRole('dialog', { name: 'Вход по номеру телефона' });
    await dialog.waitFor();
    const reveal = await dialog.evaluate(el => ({
      panel: getComputedStyle(el).animationName,
      trace: getComputedStyle(el, '::before').animationName,
      light: getComputedStyle(el, '::after').animationName,
      button: getComputedStyle(el.querySelector('.btn:not(.ghost)')).animationName
    }));
    if (reveal.panel !== 'tr-auth-sheet-in' || reveal.trace !== 'tr-auth-trace' ||
        reveal.light !== 'tr-auth-glow-arrive' || reveal.button !== 'tr-auth-cta-warmth')
      throw Error(width + ': approved reveal/glow missing ' + JSON.stringify(reveal));
    if (!await landing.isVisible()) throw Error(width + ': landing was replaced by login');
    if (await landing.getAttribute('aria-hidden') !== 'true' || await landing.getAttribute('inert') === null)
      throw Error(width + ': public buttons are still accessible behind login dialog');
    if (await page.locator('.auth-desktop-showcase:visible').count())
      throw Error(width + ': old full-page cinematic login illustration returned');
    if (!await dialog.locator('input[type=password]').isVisible())
      throw Error(width + ': password login missing');
    await page.screenshot({ path: 'e2e/shots/auth-overlay/login-' + width + '.png', animations: 'disabled' });

    await dialog.getByRole('button', { name: 'Нет аккаунта? Зарегистрироваться' }).click();
    await page.waitForURL('**/#/register');
    await page.getByRole('dialog', { name: 'Регистрация в TrakSOS' }).waitFor();
    if (!await landing.isVisible()) throw Error(width + ': signup replaced public landing');
    await page.screenshot({ path: 'e2e/shots/auth-overlay/register-' + width + '.png', animations: 'disabled' });

    await page.getByRole('navigation', { name: 'Тип регистрации' })
      .getByRole('link', { name: 'Зарегистрироваться как партнёр' }).click();
    await page.waitForURL('**/#/join');
    const partner = page.getByRole('dialog', { name: 'Работать с TrakSOS' });
    await partner.waitFor();
    if (await page.locator('.guest-partner-mobile-preview:visible,.auth-desktop-showcase:visible').count())
      throw Error(width + ': redundant cinematic artwork returned in partner dialog');
    await partner.getByRole('button', { name: 'Мастер', exact: true }).click();
    if (!await partner.getByRole('button', { name: 'Автономщик', exact: true }).isVisible())
      throw Error(width + ': master specialties unavailable in partner dialog');
    await page.screenshot({ path: 'e2e/shots/auth-overlay/partner-' + width + '.png', animations: 'disabled' });

    await page.keyboard.press('Escape');
    await page.waitForURL('**/#/');
    if (await page.getByRole('dialog').count()) throw Error(width + ': Escape did not close modal');
    if (!await landing.isVisible()) throw Error(width + ': landing missing after closing modal');
    await page.goto(BASE + '/#/login');
    await page.getByRole('dialog', { name: 'Вход по номеру телефона' }).waitFor();
    await page.locator('.tr-auth-backdrop').click({ position: {x: 5, y: 5} });
    await page.waitForURL('**/#/');
    if (await page.getByRole('dialog').count()) throw Error(width + ': backdrop click did not close modal');
    if (errors.length) throw Error(width + ': JS errors ' + errors.join('; '));
    await context.close();
  }
  // Accessibility: switching off motion must remove all decorative animation,
  // including the panel trace, flare and primary CTA.
  const reduced = await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce',locale:'ru-RU'});
  try {
    const page=await reduced.newPage();
    await page.goto(BASE+'/#/login');
    const dialog=page.getByRole('dialog',{name:'Вход по номеру телефона'});
    await dialog.waitFor();
    const names=await dialog.evaluate(el=>[
      getComputedStyle(el).animationName,
      getComputedStyle(el,'::before').animationName,
      getComputedStyle(el,'::after').animationName,
      getComputedStyle(el.querySelector('.btn:not(.ghost)')).animationName
    ]);
    if(names.some(name=>name!=='none'))
      throw Error('Reduced-motion browser still animates auth: '+names.join(', '));
  } finally { await reduced.close(); }
  console.log('Approved browser guest overlays at 390px and 1440px: login, client, partner, Escape, outside click, glow and reduced motion OK');
} finally { await browser.close(); }
