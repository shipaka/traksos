import { test } from 'node:test';
import assert from 'node:assert/strict';
import { proposedEconomics } from '../../web/src/proposedEconomics.ts';

const example = {
  base: 1_000_000, partnerFeePct: 5, customerFeePct: 5,
  paymentRail: 'card' as const, acquiringPct: 2.8,
  supportCost: 3_000, riskReserve: 4_000,
  referralPctOfPlatformRevenue: 10, bonuses: 0,
  taxPctOfPlatformRevenue: 6, marketingCapPctOfPlatformRevenue: 30,
};
test('approved fee: performer 10,000 - 500, customer 10,000 + 500', () => {
  const e = proposedEconomics(example);
  assert.equal(e.clientFee,50_000);
  assert.equal(e.partnerFee,50_000);
  assert.equal(e.totalClient,1_050_000);
  assert.equal(e.partnerGets,950_000);
  assert.equal(e.platformRevenue,100_000);
});
test('each STO side is capped independently at 5,000 RUB per invoice', () => {
  const e = proposedEconomics({ ...example, base:20_000_000,customerFeeMax:500_000,partnerFeeMax:500_000 });
  assert.equal(e.clientFee,500_000);
  assert.equal(e.partnerFee,500_000);
  assert.equal(e.totalClient,20_500_000);
  assert.equal(e.partnerGets,19_500_000);
  assert.equal(e.platformRevenue,1_000_000);
});
test('card processing uses actual customer total and fees are two different flows', () => {
  const e = proposedEconomics(example);
  assert.equal(e.processing,29_400);
  assert.equal(e.tax,6_000);
  assert.equal(e.referral,10_000);
  assert.equal(e.contribution,47_600);
});
test('SBP scenario uses a different processing assumption', () => {
  const e = proposedEconomics({...example,paymentRail:'sbp',acquiringPct:0.7});
  assert.equal(e.processing,7_350);
  assert.equal(e.contribution,69_650);
});
test('marketing cap protects margin even with two separate fees', () => {
  const exact = proposedEconomics({...example,bonuses:20_000});
  assert.equal(exact.cap,30_000);
  assert.equal(exact.totalMarketing,30_000);
  assert.equal(exact.exceedsMarketingCap,false);
  const exceeded = proposedEconomics({...example,bonuses:20_100});
  assert.equal(exceeded.exceedsMarketingCap,true);
  assert.equal(exceeded.isEconomicallySafe,false);
});
test('cash does not invent acquiring cost and expensive processing can erase profits', () => {
  assert.equal(proposedEconomics({...example,paymentRail:'cash',acquiringPct:2.8}).processing,0);
  const bad = proposedEconomics({...example,acquiringPct:9});
  assert.ok(bad.contribution < 0);
  assert.equal(bad.isEconomicallySafe,false);
});
