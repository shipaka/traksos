import { test } from 'node:test';
import assert from 'node:assert/strict';
import { greatCircleKm, planCourierRoute, validCourierGeo } from '../src/services/shopCourierRoute.ts';

// Pure module extracted from draft #111: no DB, auth, GPS collection or live routing.
test('courier: 50 checked coordinates produce deterministic unique stop order', () => {
  const start = { lat: 59.93, lng: 30.32 };
  const stops = Array.from({length:50}, (_, i) => ({
    id: String(i), lat:59.75+(i%10)*.03, lng:30.1+Math.floor(i/10)*.06
  })).reverse();
  const first = planCourierRoute(start, stops);
  assert.deepEqual(planCourierRoute(start, stops), first);
  assert.equal(first.planning, 'coordinate_heuristic');
  assert.equal(first.orderedIds.length, stops.length);
  assert.equal(new Set(first.orderedIds).size, stops.length);
  assert.deepEqual([...first.orderedIds].sort(), stops.map(x=>x.id).sort());
  const byId = new Map(stops.map(x=>[x.id,x]));
  const directDistance = (ids:string[])=>ids.reduce((sum,id,i)=>{
    const from = i ? byId.get(ids[i-1])! : start;
    return sum + greatCircleKm(from, byId.get(id)!);
  },0);
  assert.ok(directDistance(first.orderedIds) <= directDistance(stops.map(x=>x.id)) + 1e-7);
  assert.ok(first.directKm !== null && first.directKm > 0);
});

test('courier: missing/invalid coordinates leave original manual order with no invented distance', () => {
  const starts = [{lat:59.93,lng:30.32},null];
  const stops = [{id:'B',lat:59.9,lng:30.2},{id:'A',lat:NaN,lng:30.3}];
  for (const start of starts) {
    const plan = planCourierRoute(start, stops);
    assert.deepEqual(plan.orderedIds, ['B','A']);
    assert.equal(plan.planning, 'manual_coordinates_missing');
    assert.equal(plan.directKm, null);
  }
  assert.equal(validCourierGeo({lat:100,lng:30}),false);
  assert.equal(validCourierGeo({lat:60,lng:181}),false);
  assert.equal(validCourierGeo({lat:60,lng:30}),true);
});

test('courier: duplicate stop IDs are rejected, preventing silent lost deliveries', () => {
  assert.throws(() => planCourierRoute(null,[
    {id:'same',lat:59.9,lng:30.3},{id:'same',lat:59.8,lng:30.2}
  ]),/duplicate courier stop ids/);
});

test('courier: zero and one stop are valid, without implying road routing or ETA', () => {
  const start = {lat:59.93,lng:30.32};
  assert.deepEqual(planCourierRoute(start,[]),{
    orderedIds:[],planning:'coordinate_heuristic',directKm:0
  });
  const point = {id:'1',lat:59.93,lng:30.32};
  assert.deepEqual(planCourierRoute(start,[point]),{
    orderedIds:['1'],planning:'coordinate_heuristic',directKm:0
  });
});
