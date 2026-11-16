import { test } from 'node:test';
import assert from 'node:assert/strict';
import { plausibleGpsStep } from '../src/domain/geo.ts';

const now = new Date('2026-11-16T12:00:00.000Z');
const origin = { lat: 59.9343, lng: 30.3351, at: new Date(now.getTime() - 10_000) };

test('GPS sanity filter rejects invalid coordinates and impossible jumps', () => {
  assert.equal(plausibleGpsStep(null, { lat: NaN, lng: 30 }, now), false);
  assert.equal(plausibleGpsStep(null, { lat: 91, lng: 30 }, now), false);
  assert.equal(plausibleGpsStep(origin, { lat: 55.7558, lng: 37.6173 }, now), false);
  assert.equal(plausibleGpsStep(origin, { lat: 59.9344, lng: 30.3352 }, now), true);
});

test('GPS filter tolerates realistic travel and long offline gaps', () => {
  assert.equal(plausibleGpsStep(origin, { lat: 59.938, lng: 30.3351 }, now), true);
  assert.equal(plausibleGpsStep({ ...origin, at: new Date(now.getTime() - 20 * 60_000) },
    { lat: 60.5, lng: 30.5 }, now), true);
  assert.equal(plausibleGpsStep({ ...origin, at: new Date(now.getTime() + 10_000) },
    { lat: 59.9343, lng: 30.3351 }, now), false);
});

test('plausible GPS points do not prove route progress or arrival', () => {
  assert.equal(plausibleGpsStep(null, { lat: 59.9343, lng: 30.3351 }, now), true);
  // No financial decision is made by this filter.
});
