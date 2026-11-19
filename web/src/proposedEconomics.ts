/**
 * Proposed economics ONLY. Not connected to production billing.
 * All amounts are kopecks; fees/costs are scenario inputs and not payment-provider quotes.
 */
export type PaymentRail = 'cash' | 'sbp' | 'card' | 'invoice';
export type ProposedEconomicInput = {
  base: number;
  partnerFeePct: number;
  customerFeePct: number;
  paymentRail: PaymentRail;
  acquiringPct: number;
  supportCost: number;
  riskReserve: number;
  referralPctOfPlatformRevenue: number;
  bonuses: number;
  taxPctOfPlatformRevenue: number;
  marketingCapPctOfPlatformRevenue: number;
};
export const percent = (value: number, rate: number) => Math.round(value * rate / 100);
export function proposedEconomics(i: ProposedEconomicInput) {
  if (!Number.isFinite(i.base) || i.base < 0) throw new Error('base must be non-negative');
  const clientFee = percent(i.base, i.customerFeePct);
  const partnerFee = percent(i.base, i.partnerFeePct);
  const totalClient = i.base + clientFee;
  const platformRevenue = partnerFee + clientFee;
  const partnerGets = i.base - partnerFee;
  const processing = ['sbp','card'].includes(i.paymentRail) ? percent(totalClient, i.acquiringPct) : 0;
  const tax = percent(platformRevenue, i.taxPctOfPlatformRevenue);
  const referral = percent(platformRevenue, i.referralPctOfPlatformRevenue);
  const cap = percent(platformRevenue, i.marketingCapPctOfPlatformRevenue);
  const totalMarketing = referral + i.bonuses;
  const exceedsMarketingCap = totalMarketing > cap;
  const variableCosts = processing + tax + referral + i.bonuses + i.supportCost + i.riskReserve;
  const contribution = platformRevenue - variableCosts;
  return {clientFee,partnerFee,totalClient,platformRevenue,partnerGets,processing,tax,referral,cap,totalMarketing,
    exceedsMarketingCap,variableCosts,contribution,isEconomicallySafe:contribution > 0 && !exceedsMarketingCap};
}
