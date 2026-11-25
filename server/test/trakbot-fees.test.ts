import { test } from 'node:test';
import assert from 'node:assert/strict';
import { proposedMasterAssistFee, clientAiSettlementDecision } from '../src/domain/trakbotAssistFee.ts';

test('optional 2% master assistance is zero unless every condition is met', () => {
  const eligible = {
    explicitConsent: true,
    requestedByPerformer: true,
    groundedHelpDelivered: true,
    performerConfirmedUseful: true,
    orderCompleted: true,
    disputed: false,
    serviceAmountKopecks: 100_000,
  };
  assert.equal(proposedMasterAssistFee(eligible), 2_000);
  assert.equal(proposedMasterAssistFee({ ...eligible, capKopecks: 1_000 }), 1_000);
  assert.equal(proposedMasterAssistFee({ ...eligible, explicitConsent: false }), 0);
  assert.equal(proposedMasterAssistFee({ ...eligible, requestedByPerformer: false }), 0);
  assert.equal(proposedMasterAssistFee({ ...eligible, groundedHelpDelivered: false }), 0);
  assert.equal(proposedMasterAssistFee({ ...eligible, performerConfirmedUseful: false }), 0);
  assert.equal(proposedMasterAssistFee({ ...eligible, orderCompleted: false }), 0);
  assert.equal(proposedMasterAssistFee({ ...eligible, disputed: true }), 0);
  assert.equal(proposedMasterAssistFee({ ...eligible, serviceAmountKopecks: NaN }), 0);
});

test('client AI consent and provider hold are required before capturing; no answer releases hold', () => {
  const ready = { explicitConsent: true, providerConfirmedHold: true,
    trustworthyAnswerDelivered: true, usefulConsultationCompleted: true };
  assert.equal(clientAiSettlementDecision(ready), 'capture_if_provider_authorized');
  assert.equal(clientAiSettlementDecision({ ...ready, explicitConsent: false }), 'no_charge');
  assert.equal(clientAiSettlementDecision({ ...ready, providerConfirmedHold: false }), 'no_charge');
  assert.equal(clientAiSettlementDecision({ ...ready, trustworthyAnswerDelivered: false }), 'release_reservation');
  assert.equal(clientAiSettlementDecision({ ...ready, usefulConsultationCompleted: false }), 'release_reservation');
});
