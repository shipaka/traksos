/** Current policy: cash is retired for new orders. Historical debt/refund records remain.
 * Only non-production fixture tests may explicitly enable the legacy cash flow.
 */
export function legacyCashFixtureEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV !== 'production' && env.TRAKSOS_LEGACY_CASH_FIXTURES === '1';
}

/** Shop remains closed on production and real sandbox until a separately approved release.
 * Old SQL settings cannot re-open it. Only disposable, non-production tests opt in.
 */
export function shopFixtureEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV !== 'production' && env.TRAKSOS_SHOP_FIXTURES === '1';
}

/** Legacy non-production E2E only: no live bank has been connected.
 * Production and the real sandbox MUST NEVER accept mock money as paid.
 */
export function mockCheckoutFixtureEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV !== 'production' && env.TRAKSOS_PAYMENT_FIXTURES === '1';
}
