import {test} from 'node:test';
import assert from 'node:assert/strict';
import {partnerActivityReport} from '../src/domain/partnerActivityReport.ts';
const ms=(s:string)=>Date.parse(s);
const now=ms('2026-11-25T00:00:00Z');
const start=now-90*86400000;
const report=(overrides:Partial<Parameters<typeof partnerActivityReport>[0]>={})=>partnerActivityReport({
  nowMs:now,offers:[],boundedPresence:[],observedSinceMs:null,...overrides
});
test('empty and partial history is not a sanction or evidence of no demand',()=>{
  const r=report();
  assert.equal(r.partialHistory,true);
  assert.equal(r.total.personallyOffered,0);
  assert.equal(r.total.observedAvailableHours,0);
  assert.ok(r.weeks.length>=13&&r.weeks.length<=14);
  assert.equal(r.weekTimezone,'UTC');
  assert.equal(r.changesLevel,false);
  assert.equal(r.changesDispatch,false);
  assert.equal(r.changesCommission,false);
  assert.equal(report({observedSinceMs:start}).partialHistory,false);
});
test('order retry across UTC weeks counted once and assigned to first dispatch',()=>{
  const r=report({offers:[
    {orderId:'a',sentAtMs:ms('2026-11-23T01:00:00Z'),completedAsOf:true},
    {orderId:'a',sentAtMs:ms('2026-11-22T23:00:00Z'),completedAsOf:true},
    {orderId:'b',sentAtMs:start-1,completedAsOf:false},
    {orderId:'b',sentAtMs:start+1,completedAsOf:false},
    {orderId:'c',sentAtMs:now,completedAsOf:false},
  ]});
  assert.equal(r.total.personallyOffered,1);
  assert.equal(r.total.completedFromOffers,1);
  assert.equal(r.weeks.find(w=>w.weekStart==='2026-11-16')?.personallyOffered,1);
  assert.equal(r.weeks.find(w=>w.weekStart==='2026-11-23')?.personallyOffered,0);
});
test('bounded overlap union, UTC week split, half-open interval and invalid evidence',()=>{
  const r=report({boundedPresence:[
    {startMs:ms('2026-11-22T22:00:00Z'),endMs:ms('2026-11-23T01:00:00Z')},
    {startMs:ms('2026-11-23T00:00:00Z'),endMs:ms('2026-11-23T02:00:00Z')},
    {startMs:now-3600000,endMs:now+1},
    {startMs:now-3600000,endMs:NaN},
    {startMs:now,endMs:now-1}
  ],offers:[
    {orderId:'inside',sentAtMs:ms('2026-11-23T00:00:00Z'),completedAsOf:false},
    {orderId:'outside',sentAtMs:ms('2026-11-23T02:00:00Z'),completedAsOf:false},
  ]});
  assert.equal(r.total.observedAvailableHours,4);
  assert.equal(r.total.offersWhileObservedAvailable,1);
  assert.equal(r.weeks.find(w=>w.weekStart==='2026-11-16')?.observedAvailableHours,2);
  assert.equal(r.weeks.find(w=>w.weekStart==='2026-11-23')?.observedAvailableHours,2);
});
test('report clips evidence at lower boundary without rounding weekly totals',()=>{
  const r=report({boundedPresence:[{startMs:start-3600000,endMs:start+60000}]});
  assert.equal(r.total.observedAvailableMs,60000);
  assert.equal(r.total.observedAvailableHours,1/60);
  assert.throws(()=>report({nowMs:NaN}),RangeError);
});
