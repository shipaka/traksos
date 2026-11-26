import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateCheckpoint, sampledSnapshot,
  type CheckpointPlan, type ObservedPosition,
} from '../src/services/checkpointEvidenceCore.ts';

const now = new Date('2026-12-01T10:00:00Z');
const gate: CheckpointPlan = {
  orderId: 'order', performerId: 'worker',
  lat: 59.9343, lng: 30.3351, radiusM: 200,
  passState: 'not_required', clientApprovedAt: '2026-12-01T09:45:00Z',
};
function gps(secondsAgo: number, extras: Partial<ObservedPosition> = {}): ObservedPosition {
  return {
    lat: gate.lat, lng: gate.lng,
    receivedAt: new Date(now.getTime() - secondsAgo * 1000).toISOString(),
    source: 'gps', accuracyM: 12, accepted: true,
    ...extras,
  };
}
const reasons = (points: ObservedPosition[], current = gate, manual = false) =>
  evaluateCheckpoint(current, points, now, manual).reasons;

test('two recent independent accurate fixes produce a non-billable candidate', () => {
  const result = evaluateCheckpoint(gate, [gps(45), gps(12)], now);
  assert.equal(result.outcome, 'candidate');
  assert.equal(result.qualifiedNearSamples, 2);
  assert.equal(result.startBilling, false);
  assert.deepEqual(result.reasons, []);
});

test('one fix, stale fix, predicted fix or unsupported legacy GPS stays under review', () => {
  assert.ok(reasons([gps(12)]).includes('insufficient_independent_samples'));
  assert.ok(reasons([gps(360),gps(300)]).includes('stale_last_position'));
  assert.ok(reasons([gps(45,{source:'predicted'}),gps(12,{source:'predicted'})])
    .includes('no_recent_samples'));
  assert.ok(reasons([gps(45,{source:'unknown',accuracyM:null}),
    gps(12,{source:'unknown',accuracyM:null})]).includes('untrusted_position_source'));
});

test('gate radius, accuracy, spoof flag, high speed and pass state block auto candidate', () => {
  assert.ok(reasons([gps(45,{lat:gate.lat+0.003}),gps(12,{lat:gate.lat+0.003})])
    .includes('outside_checkpoint'));
  assert.ok(reasons([gps(45,{accuracyM:180}),gps(12,{accuracyM:180})])
    .includes('accuracy_too_low'));
  assert.ok(reasons([gps(45,{lat:gate.lat+0.01}),gps(43),gps(12)])
    .includes('implausible_jump'));
  assert.ok(reasons([gps(45,{mockLocation:true}),gps(12)])
    .includes('mock_location_flagged'));
  assert.ok(reasons([gps(45),gps(12)],{...gate,passState:'pending'})
    .includes('pass_not_cleared'));
  assert.ok(reasons([gps(45),gps(12)],gate,true)
    .includes('manual_review_requested'));
});

test('phone clock does not change server observation time', () => {
  const result=evaluateCheckpoint(gate,[
    gps(45,{deviceAt:'2001-01-01T00:00:00Z'}),
    gps(12,{deviceAt:'2038-01-01T00:00:00Z'}),
  ],now);
  assert.equal(result.outcome,'candidate');
  assert.equal(result.startBilling,false);
});

test('invalid geography and excessive snapshots fail closed', () => {
  assert.throws(()=>evaluateCheckpoint({...gate,lat:100},[],now));
  assert.throws(()=>evaluateCheckpoint({...gate,radiusM:999},[],now));
  assert.throws(()=>evaluateCheckpoint(gate,Array.from({length:201},()=>gps(45)),now));
  assert.equal(evaluateCheckpoint(gate,[],now).outcome,'needs_review');
  const clean=sampledSnapshot([
    gps(700),gps(45,{accepted:false}),gps(30,{source:'predicted'}),gps(12),
  ],now);
  assert.equal(clean.length,1);
});

test('duplicate timestamps and future server receipts cannot prove independent observations', () => {
  const duplicate=evaluateCheckpoint(gate,[gps(12),gps(12)],now);
  assert.equal(duplicate.outcome,'needs_review');
  assert.ok(duplicate.reasons.includes('insufficient_independent_samples'));
  assert.equal(duplicate.startBilling,false);
  const future=evaluateCheckpoint(gate,[gps(-5),gps(12)],now);
  assert.equal(future.outcome,'needs_review');
  assert.equal(future.consideredSamples,1);
  assert.equal(future.startBilling,false);
});
