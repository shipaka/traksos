import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, ok } from './helpers.ts';

// Real HTTP + transactional PostgreSQL: distinguish a missing property during
// partial profile saves from a deliberate JSON null resetting a custom tariff.
// All amounts are test-only kopecks, no production payments or orders.
test('performer price overrides: set, partial update, explicit reset and re-save',
  { timeout: 60000 }, async () => {
  const t = await setup();
  try {
    const master = await t.login('+79997106501', 'master');
    ok(await t.api('PUT', '/api/performer/profile', {
      kind: 'master', name: 'Цена по умолчанию',
      specialties: ['electric'], brands: { Scania: 'good' },
      callOutPrice: 250_000, hourPrice: 250_000, kmRate: 5_000,
    }, master.token));
    let p = ok(await t.api('GET', '/api/performer/profile', undefined, master.token));
    assert.equal(p.call_out_price, 250_000);
    assert.equal(p.hour_price, 250_000);
    assert.equal(p.km_rate, 5_000);

    // A profile subsection that only saves brands must not clear a price.
    ok(await t.api('PUT', '/api/performer/profile', {
      kind: 'master', brands: { Scania: 'excellent' },
    }, master.token));
    p = ok(await t.api('GET', '/api/performer/profile', undefined, master.token));
    assert.equal(p.call_out_price, 250_000);
    assert.equal(p.hour_price, 250_000);
    assert.equal(p.km_rate, 5_000);

    // Clearing the three price fields explicitly via the atomic existing
    // endpoint must remove all overrides while retaining matching/extras.
    const reset = ok(await t.api('PUT', '/api/performer/request-settings', {
      profile: { kind: 'master', callOutPrice: null, hourPrice: null, kmRate: null },
      extras: { stock: ['Сканер под марку'] },
    }, master.token));
    assert.equal(reset.call_out_price, null);
    assert.equal(reset.hour_price, null);
    assert.equal(reset.km_rate, null);
    assert.equal(reset.brands.Scania, 'excellent');
    assert.deepEqual(reset.extras.stock, ['Сканер под марку']);
    p = ok(await t.api('GET', '/api/performer/profile', undefined, master.token));
    assert.equal(p.call_out_price, null);
    assert.equal(p.hour_price, null);
    assert.equal(p.km_rate, null);

    // Null reset of only ONE field must not erase another saved override.
    ok(await t.api('PUT', '/api/performer/profile', {
      kind: 'master', callOutPrice: 300_000, hourPrice: 200_000, kmRate: 7_000,
    }, master.token));
    const oneReset = ok(await t.api('PUT', '/api/performer/profile', {
      kind: 'master', callOutPrice: null,
    }, master.token));
    assert.equal(oneReset.call_out_price, null);
    assert.equal(oneReset.hour_price, 200_000);
    assert.equal(oneReset.km_rate, 7_000);

    // The same distinction applies to tow km-based pricing.
    const tow = await t.login('+79997106502', 'tow');
    ok(await t.api('PUT', '/api/performer/profile', {
      kind: 'tow', name: 'Эвакуатор', kmRate: 11_000, prepMinutes: 15,
    }, tow.token));
    const towReset = ok(await t.api('PUT', '/api/performer/request-settings', {
      profile: { kind: 'tow', kmRate: null },
      extras: { prepAck: true },
    }, tow.token));
    assert.equal(towReset.km_rate, null);
    assert.equal(towReset.prep_minutes, 15);
    assert.equal(towReset.extras.prepAck, true);

    const invalid = await t.api('PUT', '/api/performer/profile', {
      kind: 'master', callOutPrice: -1,
    }, master.token);
    assert.equal(invalid.status, 400);
    const afterInvalid = ok(await t.api('GET', '/api/performer/profile', undefined, master.token));
    assert.equal(afterInvalid.call_out_price, null);
    assert.equal(afterInvalid.hour_price, 200_000);
  } finally {
    await t.close();
  }
});
