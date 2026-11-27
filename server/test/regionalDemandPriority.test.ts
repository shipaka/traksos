import assert from 'node:assert/strict';
import {test} from 'node:test';
import {assessRegionalDemand, REGIONAL_DEMAND_DEFAULTS, type RegionalDemandEvidence} from '../src/domain/regionalDemandPriority.ts';

const evidence = (patch: Partial<RegionalDemandEvidence> = {}): RegionalDemandEvidence => ({
  comparableVisits:false, visits:null, previousVisits:null, realRequests:null,
  confirmedUnserved:null, supplySlaFailures:null, confirmedSupplyAffected:null,
  coverageObserved:false, coverageAdequate:null, ...patch,
});
test('growth alone is early interest, never a confirmed shortage', () => {
  const result=assessRegionalDemand(evidence({comparableVisits:true,visits:130,previousVisits:100}));
  assert.equal(result.status,'early_interest');
  assert.equal(result.priority,'short_term');
  assert.equal(result.growthPercent,30);
  assert.equal(result.supplyAffected,null);
});
test('zero baseline reports absolute interest without a fabricated growth percent', () => {
  const result=assessRegionalDemand(evidence({comparableVisits:true,visits:30,previousVisits:0}));
  assert.equal(result.reason,'zero_baseline_interest');
  assert.equal(result.growthPercent,null);
  assert.equal(assessRegionalDemand(evidence({comparableVisits:true,visits:29,previousVisits:0})).status,'insufficient_data');
});
test('tiny or noncomparable samples cannot trigger early interest', () => {
  assert.equal(assessRegionalDemand(evidence({comparableVisits:true,visits:100,previousVisits:2})).status,'insufficient_data');
  const result=assessRegionalDemand(evidence({comparableVisits:false,visits:200,previousVisits:50}));
  assert.equal(result.status,'insufficient_data');
  assert.equal(result.growthPercent,null);
});
test('confirmed supply failures take priority even when interest data is unavailable', () => {
  const result=assessRegionalDemand(evidence({realRequests:6,confirmedUnserved:2,supplySlaFailures:2,confirmedSupplyAffected:3}));
  assert.equal(result.status,'confirmed_shortage');
  assert.equal(result.priority,'urgent');
  assert.equal(result.supplyAffected,3);
  assert.equal(result.action,'review_supply_and_recruit');
});
test('overlapping failures cannot be summed as separate affected requests', () => {
  const result=assessRegionalDemand(evidence({realRequests:6,confirmedUnserved:2,supplySlaFailures:2,confirmedSupplyAffected:2}));
  assert.equal(result.status,'insufficient_data');
  assert.equal(result.supplyAffected,2);
  assert.equal(assessRegionalDemand(evidence({realRequests:6,confirmedUnserved:2,supplySlaFailures:2})).status,'insufficient_data');
});
test('no requests and unknown coverage are not green signals', () => {
  const base={realRequests:0,confirmedUnserved:0,supplySlaFailures:0,confirmedSupplyAffected:0,coverageObserved:true,coverageAdequate:true};
  assert.equal(assessRegionalDemand(evidence(base)).status,'insufficient_data');
  assert.equal(assessRegionalDemand(evidence({...base,realRequests:10,coverageObserved:false})).status,'insufficient_data');
  assert.equal(assessRegionalDemand(evidence({...base,realRequests:10,supplySlaFailures:null})).status,'insufficient_data');
  assert.equal(assessRegionalDemand(evidence({...base,realRequests:10,coverageAdequate:null})).status,'insufficient_data');
  assert.equal(assessRegionalDemand(evidence({...base,realRequests:10})).status,'observed_adequate');
});
test('invalid aggregate counts fail closed instead of issuing advice', () => {
  for(const patch of [
    {visits:-1}, {realRequests:NaN}, {previousVisits:1.5},
    {realRequests:2,confirmedSupplyAffected:3},
    {realRequests:10,confirmedUnserved:4,confirmedSupplyAffected:3},
    {realRequests:10,confirmedUnserved:1,supplySlaFailures:1,confirmedSupplyAffected:3},
  ]) {
    assert.equal(assessRegionalDemand(evidence(patch)).reason,'invalid_metrics');
  }
});
test('provisional thresholds are configurable and invalid configuration is rejected', () => {
  const sample=evidence({realRequests:5,confirmedUnserved:2,supplySlaFailures:0,confirmedSupplyAffected:2});
  assert.equal(assessRegionalDemand(sample).status,'insufficient_data');
  assert.equal(assessRegionalDemand(sample,{...REGIONAL_DEMAND_DEFAULTS,minSupplyAffected:2}).status,'confirmed_shortage');
  assert.throws(()=>assessRegionalDemand(sample,{...REGIONAL_DEMAND_DEFAULTS,minSupplyAffected:0}),RangeError);
});
