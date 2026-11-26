/**
 * Checkpoint (КПП) arrival evidence - independent of SOS state transitions,
 * navigation, GPS preview, payout, or billable waiting time.
 *
 * "candidate" means that multiple recent positions are consistent with the
 * gate, NOT proof of arrival, authorization to enter, or a paid milestone.
 * Current performer_route_samples lack accuracy and GPS source: they can
 * inform review but cannot silently become a candidate.
 */
import { haversineKm } from '../domain/geo.ts';

export type CheckpointPassState = 'not_required' | 'pending' | 'manually_cleared';
export type EvidenceOutcome = 'candidate' | 'needs_review';
export type CheckpointReason =
  | 'pass_not_cleared'
  | 'no_recent_samples'
  | 'untrusted_position_source'
  | 'accuracy_missing'
  | 'accuracy_too_low'
  | 'outside_checkpoint'
  | 'insufficient_independent_samples'
  | 'implausible_jump'
  | 'mock_location_flagged'
  | 'stale_last_position'
  | 'manual_review_requested';

export interface CheckpointPlan {
  orderId: string;
  performerId: string;
  lat: number;
  lng: number;
  radiusM: number;
  passState: CheckpointPassState;
  /** Client-selected checkpoint for this job; not the client's current GPS. */
  clientApprovedAt: string;
}

export interface ObservedPosition {
  lat: number;
  lng: number;
  /** Server-side receipt time; never trust the APK's wall clock for this. */
  receivedAt: string;
  /** Optional device timestamp, informational only; never used for billing. */
  deviceAt?: string | null;
  /** Raw route samples from old APKs may not have accuracy/source. */
  accuracyM?: number | null;
  source?: 'gps' | 'network' | 'unknown' | 'predicted';
  accepted: boolean;
  mockLocation?: boolean;
}

export interface CheckpointEvaluation {
  outcome: EvidenceOutcome;
  reasons: CheckpointReason[];
  evaluatedAt: string;
  checkpointRadiusM: number;
  /** Last REAL server-collected position. Not inferred position. */
  lastObservedAt: string | null;
  /** Distance of freshest accepted REAL point, for internal review only. */
  lastDistanceM: number | null;
  qualifiedNearSamples: number;
  consideredSamples: number;
  /** Included only for diagnostics. No amount, payout or ETA. */
  startBilling: false;
}

const MIN_RADIUS_M = 50;
const MAX_RADIUS_M = 500;
const MAX_ACCURACY_M = 75;
const RECENT_WINDOW_MS = 10 * 60_000;
const LAST_SEEN_MS = 120_000;
const MIN_SEPARATION_MS = 15_000;
const MAX_SPEED_MPS = 55; // 198 km/h, plus uncertainty allowance
const MAX_SAMPLE_COUNT = 200;

const validPoint = (p: { lat: number; lng: number }) =>
  Number.isFinite(p.lat) && Number.isFinite(p.lng) &&
  p.lat >= -90 && p.lat <= 90 && p.lng >= -180 && p.lng <= 180;

export function assertCheckpointPlan(plan: CheckpointPlan): void {
  if (!plan.orderId || !plan.performerId || !validPoint(plan)) {
    throw new Error('Invalid checkpoint coordinates or assigned order');
  }
  if (!Number.isInteger(plan.radiusM) || plan.radiusM < MIN_RADIUS_M || plan.radiusM > MAX_RADIUS_M) {
    throw new Error('Checkpoint radius must be 50..500 meters');
  }
  if (!['not_required', 'pending', 'manually_cleared'].includes(plan.passState)) {
    throw new Error('Unknown pass authorization state');
  }
  const t = Date.parse(plan.clientApprovedAt);
  if (!Number.isFinite(t) || !/^\d{4}-\d{2}-\d{2}T/.test(plan.clientApprovedAt)) {
    throw new Error('Client checkpoint acceptance timestamp required');
  }
}
function realRecent(p: ObservedPosition, nowMs: number) {
  const time = Date.parse(p.receivedAt);
  return validPoint(p) && Number.isFinite(time) &&
    p.accepted && p.source !== 'predicted' &&
    time <= nowMs && time >= nowMs - RECENT_WINDOW_MS;
}
function add(reasons: CheckpointReason[], reason: CheckpointReason): void {
  if (!reasons.includes(reason)) reasons.push(reason);
}

/**
 * Never transforms a GPS observation into a confirmed or payable arrival.
 * Suspicious movement reduces confidence; inaccurate signal triggers review.
 * Two separate recent accurate fixes are required for the "candidate" tier.
 */
export function evaluateCheckpoint(
  plan: CheckpointPlan,
  positions: readonly ObservedPosition[],
  at: Date,
  manualReview = false,
): CheckpointEvaluation {
  assertCheckpointPlan(plan);
  const nowMs = at.getTime();
  if (!Number.isFinite(nowMs)) throw new Error('Invalid server clock');
  if (positions.length > MAX_SAMPLE_COUNT) throw new Error('Too many GPS samples');
  const reasons: CheckpointReason[] = [];
  if (plan.passState === 'pending') add(reasons, 'pass_not_cleared');
  if (manualReview) add(reasons, 'manual_review_requested');

  const rawReal = positions.filter((p) => realRecent(p, nowMs))
    .sort((a, b) => Date.parse(a.receivedAt) - Date.parse(b.receivedAt));
  if (rawReal.length === 0) add(reasons, 'no_recent_samples');

  const last = rawReal[rawReal.length - 1];
  if (last && nowMs - Date.parse(last.receivedAt) > LAST_SEEN_MS) {
    add(reasons, 'stale_last_position');
  }
  if (positions.some((p) => p.mockLocation)) add(reasons, 'mock_location_flagged');

  const eligible: Array<ObservedPosition & { distanceM: number; timeMs: number }> = [];
  for (const p of rawReal) {
    const distanceM = haversineKm(plan, p) * 1000;
    const timeMs = Date.parse(p.receivedAt);
    if (p.source !== 'gps') {
      add(reasons, 'untrusted_position_source');
      continue;
    }
    if (p.accuracyM == null || !Number.isFinite(p.accuracyM)) {
      add(reasons, 'accuracy_missing');
      continue;
    }
    if (p.accuracyM <= 0 || p.accuracyM > MAX_ACCURACY_M) {
      add(reasons, 'accuracy_too_low');
      continue;
    }
    if (distanceM + p.accuracyM > plan.radiusM) {
      add(reasons, 'outside_checkpoint');
      continue;
    }
    eligible.push({ ...p, distanceM, timeMs });
  }

  // Check implausible jumps in ALL accurate GPS measurements, even when only
  // one endpoint is inside the gate. Accuracy uncertainty is accounted for.
  const accurateGps = rawReal.filter((p) => p.source === 'gps' &&
    p.accuracyM != null && Number.isFinite(p.accuracyM) &&
    p.accuracyM > 0 && p.accuracyM <= MAX_ACCURACY_M);
  for (let i = 1; i < accurateGps.length; i++) {
    const prev = accurateGps[i - 1];
    const curr = accurateGps[i];
    const durationSec = (Date.parse(curr.receivedAt) - Date.parse(prev.receivedAt)) / 1000;
    if (durationSec <= 0) continue; // duplicates do not count as two fixes
    const traveledM = haversineKm(prev, curr) * 1000;
    const toleranceM = (prev.accuracyM ?? 0) + (curr.accuracyM ?? 0) + 20;
    if (traveledM - toleranceM > durationSec * MAX_SPEED_MPS) {
      add(reasons, 'implausible_jump');
      break;
    }
  }

  const lastEligible = eligible[eligible.length - 1];
  if (!lastEligible ||
    nowMs - lastEligible.timeMs > LAST_SEEN_MS ||
    !eligible.some((p) => p.timeMs <= lastEligible.timeMs - MIN_SEPARATION_MS)) {
    add(reasons, 'insufficient_independent_samples');
  }
  // An old fix is not enough if the most recent REAL fix is already far away.
  if (last && validPoint(last)) {
    const lastDistance = haversineKm(plan, last) * 1000;
    if (lastDistance > plan.radiusM + (last.accuracyM ?? 0)) add(reasons, 'outside_checkpoint');
  }

  return {
    outcome: reasons.length === 0 ? 'candidate' : 'needs_review',
    reasons, evaluatedAt: at.toISOString(), checkpointRadiusM: plan.radiusM,
    lastObservedAt: last?.receivedAt ?? null,
    lastDistanceM: last ? Math.round(haversineKm(plan, last) * 1000) : null,
    qualifiedNearSamples: eligible.length,
    consideredSamples: rawReal.length,
    startBilling: false,
  };
}

/** Never claim future predicted coordinates are actual telemetry. */
export function sampledSnapshot(positions: readonly ObservedPosition[], now: Date): ObservedPosition[] {
  const nowMs = now.getTime();
  return positions.filter((p) => realRecent(p, nowMs)).slice(-MAX_SAMPLE_COUNT)
    .map((p) => ({
      lat: p.lat, lng: p.lng, receivedAt: p.receivedAt,
      deviceAt: p.deviceAt ?? null, accuracyM: p.accuracyM ?? null,
      source: p.source ?? 'unknown', accepted: true,
      mockLocation: !!p.mockLocation,
    }));
}
