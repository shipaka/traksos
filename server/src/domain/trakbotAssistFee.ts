/**
 * TrakBot fee policy. Pure eligibility logic only: no ledger entries, provider calls
 * or charge collection. A future payment integration must recheck order state and
 * consent server-side, atomically, and use an idempotent unique settlement key.
 */
export interface MasterAssistOutcome {
  explicitConsent: boolean;
  requestedByPerformer: boolean;
  groundedHelpDelivered: boolean;
  performerConfirmedUseful: boolean;
  orderCompleted: boolean;
  disputed: boolean;
  serviceAmountKopecks: number;
  rateBasisPoints?: number;
  capKopecks?: number;
}

export function proposedMasterAssistFee(input: MasterAssistOutcome): number {
  if (!input.explicitConsent || !input.requestedByPerformer ||
      !input.groundedHelpDelivered || !input.performerConfirmedUseful ||
      !input.orderCompleted || input.disputed) return 0;
  if (!Number.isSafeInteger(input.serviceAmountKopecks) || input.serviceAmountKopecks <= 0) return 0;
  // 200 basis points = proposed 2%, NOT an activated platform tariff.
  const bp = input.rateBasisPoints ?? 200;
  if (!Number.isInteger(bp) || bp < 0 || bp > 1000) return 0;
  const calculated = Math.round(input.serviceAmountKopecks * bp / 10_000);
  return input.capKopecks == null ? calculated
    : Number.isSafeInteger(input.capKopecks) && input.capKopecks >= 0 ? Math.min(calculated, input.capKopecks) : 0;
}

export type ClientAiResolution = 'release_reservation' | 'capture_if_provider_authorized' | 'no_charge';

export function clientAiSettlementDecision(input: {
  explicitConsent: boolean;
  providerConfirmedHold: boolean;
  trustworthyAnswerDelivered: boolean;
  usefulConsultationCompleted: boolean;
}): ClientAiResolution {
  if (!input.explicitConsent || !input.providerConfirmedHold) return 'no_charge';
  if (!input.trustworthyAnswerDelivered || !input.usefulConsultationCompleted)
    return 'release_reservation';
  return 'capture_if_provider_authorized';
}
