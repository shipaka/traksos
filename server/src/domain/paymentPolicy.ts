/** Current policy: cash is retired for new orders. Historical debt/refund records remain.
 * Only non-production fixture tests may explicitly enable the legacy cash flow.
 */
export function legacyCashFixtureEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV !== 'production' && env.TRAKSOS_LEGACY_CASH_FIXTURES === '1';
}
