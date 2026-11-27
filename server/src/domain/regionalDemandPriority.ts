// #325: deterministic advice, not a demand collector or a staffing estimator.
// Caller must scope aggregates to ONE service, region and shift, deduplicate
// real requests and exclude test/demo/bot activity before invoking this module.
// Null means unknown; zero means an observed zero, not missing data.
export interface RegionalDemandEvidence {
  comparableVisits: boolean;
  visits: number | null;
  previousVisits: number | null;
  realRequests: number | null;
  // Distinct real requests with confirmed lack of available suitable supply.
  // Do not include generic cancellations, empty searches or API errors.
  confirmedUnserved: number | null;
  // Distinct real requests with confirmed supply-related SLA failure.
  supplySlaFailures: number | null;
  // Union of the above sets, calculated upstream using distinct request IDs.
  confirmedSupplyAffected: number | null;
  // Complete historical coverage observations for the same scope and period.
  coverageObserved: boolean;
  // True only if eligible supply was observed to cover measured demand,
  // including load and availability during calls; not merely registered count.
  coverageAdequate: boolean | null;
}
export interface RegionalDemandThresholds {
  minVisits: number;
  minGrowthPercent: number;
  minSupplyAffected: number;
  minRequestsForAdequate: number;
}
// Provisional adjustable defaults, not owner-approved production thresholds.
export const REGIONAL_DEMAND_DEFAULTS: Readonly<RegionalDemandThresholds> = Object.freeze({
  minVisits: 30,
  minGrowthPercent: 30,
  minSupplyAffected: 3,
  minRequestsForAdequate: 5,
});
export type RegionalDemandStatus = 'confirmed_shortage' | 'early_interest' | 'observed_adequate' | 'insufficient_data';
export type RegionalDemandReason = 'invalid_metrics' | 'confirmed_supply_failures' |
  'comparable_interest_growth' | 'zero_baseline_interest' | 'observed_coverage' |
  'incomplete_or_small_sample';
export interface RegionalDemandAdvice {
  status: RegionalDemandStatus;
  reason: RegionalDemandReason;
  priority: 'urgent' | 'short_term' | 'monitor' | 'investigate';
  growthPercent: number | null;
  supplyAffected: number | null;
  // Never automatically recruit, change commissions, or infer a headcount.
  action: 'review_supply_and_recruit' | 'investigate_interest' | 'monitor' | 'collect_evidence';
}
const count = (v: number | null) => v === null || (Number.isSafeInteger(v) && v >= 0);
export function assessRegionalDemand(
  e: RegionalDemandEvidence,
  thresholds: RegionalDemandThresholds = REGIONAL_DEMAND_DEFAULTS,
): RegionalDemandAdvice {
  if (![thresholds.minVisits, thresholds.minSupplyAffected, thresholds.minRequestsForAdequate]
    .every(v => Number.isSafeInteger(v) && v >= 1) ||
    !Number.isFinite(thresholds.minGrowthPercent) || thresholds.minGrowthPercent <= 0) {
    throw new RangeError('Invalid regional demand thresholds');
  }
  const unknown = (reason: RegionalDemandReason, growthPercent: number | null = null): RegionalDemandAdvice =>
    ({status:'insufficient_data',reason,priority:'investigate',growthPercent,
      supplyAffected:null,action:'collect_evidence'});
  const {visits,previousVisits,realRequests,confirmedUnserved,supplySlaFailures,confirmedSupplyAffected} = e;
  if (![visits,previousVisits,realRequests,confirmedUnserved,supplySlaFailures,confirmedSupplyAffected].every(count) ||
    (realRequests !== null && [confirmedUnserved,supplySlaFailures,confirmedSupplyAffected].some(v => v !== null && v > realRequests)) ||
    (confirmedSupplyAffected !== null && (
      (confirmedUnserved !== null && confirmedSupplyAffected < confirmedUnserved) ||
      (supplySlaFailures !== null && confirmedSupplyAffected < supplySlaFailures) ||
      (confirmedUnserved !== null && supplySlaFailures !== null &&
        confirmedSupplyAffected > confirmedUnserved + supplySlaFailures)))) {
    return unknown('invalid_metrics');
  }
  const growthPercent = e.comparableVisits && visits !== null && previousVisits !== null && previousVisits > 0
    ? ((visits - previousVisits) / previousVisits) * 100 : null;
  // A partial sample can still prove a shortage, but not adequate coverage.
  // Use only verified request counts; never infer shortage from visitor clicks.
  if (realRequests !== null && confirmedSupplyAffected !== null &&
      confirmedSupplyAffected >= thresholds.minSupplyAffected) {
    return {status:'confirmed_shortage',reason:'confirmed_supply_failures',priority:'urgent',
      growthPercent,supplyAffected:confirmedSupplyAffected,action:'review_supply_and_recruit'};
  }
  // Growth from zero is an absolute early signal, not an infinite percentage.
  const zeroBaseline = e.comparableVisits && previousVisits === 0 && visits !== null && visits >= thresholds.minVisits;
  const comparableGrowth = growthPercent !== null && visits !== null && previousVisits !== null &&
    visits >= thresholds.minVisits && previousVisits >= thresholds.minVisits && growthPercent >= thresholds.minGrowthPercent;
  if (zeroBaseline || comparableGrowth) {
    return {status:'early_interest',reason:zeroBaseline?'zero_baseline_interest':'comparable_interest_growth',
      priority:'short_term',growthPercent,supplyAffected:confirmedSupplyAffected,action:'investigate_interest'};
  }
  if (e.coverageObserved && e.coverageAdequate === true && realRequests !== null &&
      realRequests >= thresholds.minRequestsForAdequate && confirmedUnserved === 0 &&
      supplySlaFailures === 0 && confirmedSupplyAffected === 0) {
    return {status:'observed_adequate',reason:'observed_coverage',priority:'monitor',
      growthPercent,supplyAffected:0,action:'monitor'};
  }
  return {...unknown('incomplete_or_small_sample',growthPercent),supplyAffected:confirmedSupplyAffected};
}
