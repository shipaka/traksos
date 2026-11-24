// Exercise the gate against actual Chromium errors, not just a mocked array.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { watchPageErrors } from './visual-page-errors.mjs';

const browser=await chromium.launch();
try {
  const page=await browser.newPage();
  const assertClean=watchPageErrors(page);
  await page.setContent('<main>Initial screen</main>');
  await assertClean('initial');
  // This exception occurs AFTER an initially successful checkpoint; the DOM
  // remains visible, as it would in the old false-green smoke test.
  const emitted=page.waitForEvent('pageerror');
  await page.evaluate(()=>setTimeout(()=>{throw new Error('CI late exception sentinel')},0));
  await emitted;
  assert.equal(await page.locator('main').isVisible(),true);
  await assert.rejects(()=>assertClean('after route'),/after route:.*CI late exception sentinel/);
  await page.goto('about:blank');
  await assert.rejects(()=>assertClean('after navigation'),/CI late exception sentinel/);
  const fresh=await browser.newPage();
  const assertFresh=watchPageErrors(fresh);
  await fresh.setContent('<main>Independent context</main>');
  await assertFresh('fresh');
  console.log('PASS visual pageerror gate: late error rejected, sticky across navigation, isolated clean page accepted');
} finally {await browser.close();}
