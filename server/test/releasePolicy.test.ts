import assert from 'node:assert/strict';
import { test } from 'node:test';
import { legacyCashFixtureEnabled, shopFixtureEnabled, mockCheckoutFixtureEnabled, isolatedSandboxMockEnabled } from '../src/domain/paymentPolicy.ts';

test('release policy: discontinued cash and unopened shop cannot be re-enabled by production env', () => {
  for (const env of [
    { NODE_ENV: 'production', TRAKSOS_LEGACY_CASH_FIXTURES: '1', TRAKSOS_SHOP_FIXTURES: '1' },
    { NODE_ENV: 'production' },
  ]) {
    assert.equal(legacyCashFixtureEnabled(env), false);
    assert.equal(shopFixtureEnabled(env), false);
    assert.equal(mockCheckoutFixtureEnabled(env), false);
  }
});

test('release policy: legacy transactions and shop fixture are isolated to explicit non-production tests', () => {
  assert.equal(legacyCashFixtureEnabled({ NODE_ENV: 'development' }), false);
  assert.equal(shopFixtureEnabled({ NODE_ENV: 'development' }), false);
  assert.equal(mockCheckoutFixtureEnabled({ NODE_ENV: 'development' }), false);
  assert.equal(legacyCashFixtureEnabled({ NODE_ENV: 'test', TRAKSOS_LEGACY_CASH_FIXTURES: '1' }), true);
  assert.equal(shopFixtureEnabled({ NODE_ENV: 'test', TRAKSOS_SHOP_FIXTURES: '1' }), true);
  assert.equal(mockCheckoutFixtureEnabled({ NODE_ENV: 'test', TRAKSOS_PAYMENT_FIXTURES: '1' }), true);
});
test('isolated sandbox permits demo checkout only with explicit mock/log providers', () => {
  const sandbox = {
    NODE_ENV: 'production', SANDBOX_INSTANCE: 'true', TRAKSOS_SANDBOX_MOCK_CHECKOUT: 'true',
    PAYMENT_PROVIDER: 'mock', SMS_PROVIDER: 'log', PUSH_PROVIDER: 'log',
  };
  assert.equal(isolatedSandboxMockEnabled(sandbox), true);
  assert.equal(mockCheckoutFixtureEnabled(sandbox), true);
  assert.equal(legacyCashFixtureEnabled(sandbox), false);
  assert.equal(shopFixtureEnabled(sandbox), false);
  assert.equal(isolatedSandboxMockEnabled({...sandbox, SANDBOX_INSTANCE:'false'}), false);
  assert.equal(isolatedSandboxMockEnabled({...sandbox, PAYMENT_PROVIDER:'bank'}), false);
  assert.equal(isolatedSandboxMockEnabled({...sandbox, SMS_PROVIDER:'smsru'}), false);
  assert.equal(isolatedSandboxMockEnabled({...sandbox, TRAKSOS_SANDBOX_MOCK_CHECKOUT:'false'}), false);
  assert.equal(mockCheckoutFixtureEnabled({NODE_ENV:'production',TRAKSOS_PAYMENT_FIXTURES:'1'}),false);
});
