import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cancelStage, cancelSplit } from '../src/domain/money.ts';

test('cancellation tiers remain discrete and transparent', () => {
  assert.equal(cancelStage('searching'), 'searching');
  assert.equal(cancelStage('accepted'), 'accepted');
  assert.equal(cancelStage('en_route', { startKm: 100, leftKm: 70 }), 'en_route_first_half');
  assert.equal(cancelStage('en_route', { startKm: 100, leftKm: 50 }), 'en_route_second_half');
  assert.equal(cancelStage('en_route', { startKm: 100, leftKm: 20 }), 'en_route_second_half');
  assert.equal(cancelStage('arrived'), 'arrived');
  assert.equal(cancelStage('en_route', { byPerformer: true }), 'performer_fault');
});

test('invalid GPS estimates never justify the full cancellation tier', () => {
  for (const leftKm of [null, NaN, Infinity, -Infinity, -1]) {
    assert.equal(cancelStage('en_route', { startKm: 100, leftKm }), 'en_route_first_half');
  }
  for (const startKm of [null, 0, -1, NaN, Infinity]) {
    assert.equal(cancelStage('en_route', { startKm, leftKm: 0 }), 'en_route_first_half');
  }
});

test('cancellation money splits prepaid call-out and service fee only once', () => {
  const scale = {
    searching: 0,
    accepted: 0.25,
    en_route_first_half: 0.5,
    en_route_second_half: 1,
    arrived: 1,
    performer_fault: 0,
  };
  const total = 400_000 + 20_000;
  for (const [stage, expectedKeep] of [
    ['searching', 0],
    ['accepted', 105_000],
    ['en_route_first_half', 210_000],
    ['en_route_second_half', 420_000],
    ['arrived', 420_000],
    ['performer_fault', 0],
  ] as const) {
    const result = cancelSplit(scale, stage, 400_000, 20_000);
    assert.equal(result.toPerformer + result.platformKeeps, expectedKeep, stage);
    assert.equal(result.refund + expectedKeep, total, stage);
  }
});
