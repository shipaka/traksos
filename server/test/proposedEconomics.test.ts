import { test } from 'node:test';
import assert from 'node:assert/strict';
import { proposedEconomics } from '../../web/src/proposedEconomics.ts';

const example = {
  base: 1_000_000, partnerFeePct: 5, customerFeePct: 0,
  paymentRail: 'card' as const, acquiringPct: 2.8,
  supportCost: 3_000, riskReserve: 4_000,
  referralPctOfPlatformRevenue: 10, bonuses: 0,
  taxPctOfPlatformRevenue: 6, marketingCapPctOfPlatformRevenue: 30,
};
test('proposed 0% customer + 5% partner has no hidden extra customer charge', () => {
  const e = proposedEconomics(example);
  assert.equal(e.totalClient,1_000_000);
  assert.equal(e.clientFee,0);
  assert.equal(e.platformRevenue,50_000);
  assert.equal(e.partnerGets,950_000);
});
test('card processing on full transaction may leave only 70 rub before fixed overhead', () => {
  const e = proposedEconomics(example);
  assert.equal(e.processing,28_000);
  assert.equal(e.tax,3_000);
  assert.equal(e.referral,5_000);
  assert.equal(e.contribution,7_000);
  assert.equal(e.isEconomicallySafe,true);
});
test('SBP scenario beats card scenario by processing cost (illustrative only)', () => {
  const e = proposedEconomics({...example,paymentRail:'sbp',acquiringPct:0.7});
  assert.equal(e.processing,7_000);
  assert.equal(e.contribution,28_000);
});
test('marketing limit includes both referral and bonuses', () => {
  const exactly = proposedEconomics({...example,bonuses:10_000});
  assert.equal(exactly.cap,15_000);
  assert.equal(exactly.totalMarketing,15_000);
  assert.equal(exactly.exceedsMarketingCap,false);
  const excess = proposedEconomics({...example,bonuses:10_100});
  assert.equal(excess.exceedsMarketingCap,true);
  assert.equal(excess.isEconomicallySafe,false);
});
test('cash does not invent acquiring fees, bad card deals flag negative contribution', () => {
  assert.equal(proposedEconomics({...example,paymentRail:'cash',acquiringPct:2.8}).processing,0);
  const poor = proposedEconomics({...example,acquiringPct:3.6});
  assert.equal(poor.contribution,-1_000);
  assert.equal(poor.isEconomicallySafe,false);
});
