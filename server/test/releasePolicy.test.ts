import assert from 'node:assert/strict';
import { test } from 'node:test';
import { legacyCashFixtureEnabled, shopFixtureEnabled } from '../src/domain/paymentPolicy.ts';

test('release policy: discontinued cash and unopened shop cannot be re-enabled by production env', () => {
  for (const env of [
    { NODE_ENV: 'production', TRAKSOS_LEGACY_CASH_FIXTURES: '1', TRAKSOS_SHOP_FIXTURES: '1' },
    { NODE_ENV: 'production' },
  ]) {
    assert.equal(legacyCashFixtureEnabled(env), false);
    assert.equal(shopFixtureEnabled(env), false);
  }
});

test('release policy: legacy transactions and shop fixture are isolated to explicit non-production tests', () => {
  assert.equal(legacyCashFixtureEnabled({ NODE_ENV: 'development' }), false);
  assert.equal(shopFixtureEnabled({ NODE_ENV: 'development' }), false);
  assert.equal(legacyCashFixtureEnabled({ NODE_ENV: 'test', TRAKSOS_LEGACY_CASH_FIXTURES: '1' }), true);
  assert.equal(shopFixtureEnabled({ NODE_ENV: 'test', TRAKSOS_SHOP_FIXTURES: '1' }), true);
});