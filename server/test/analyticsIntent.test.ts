import {test} from 'node:test';
import assert from 'node:assert/strict';
import {classifyIntent} from '../src/domain/analyticsIntent.ts';

test('browsing different services does not become a confirmed request',()=>{
  const electric=classifyIntent({viewed:true,clicked:true});
  const tow=classifyIntent({viewed:true,clicked:true,verified:{order:'submitted'}});
  assert.equal(electric.stage,'interest');
  assert.equal(electric.confirmedDemand,false);
  assert.equal(tow.confirmedDemand,true);
  assert.equal(tow.stage,'submitted');
});
test('zero results, departure and errors do not prove shortage or delayed demand',()=>{
  const no=classifyIntent({searchStarted:true,inactiveAfterWindow:true,verified:{searchResult:{count:0,cause:'filter_mismatch'}}});
  assert.equal(no.stage,'search');
  assert.equal(no.zeroResults,true);
  assert.equal(no.inactiveAfterSearch,true);
  assert.equal(no.verifiedUnservedAttempt,false);
  assert.equal(no.timing,'unknown');
  for(const cause of ['network_error','api_error','unknown','filter_mismatch'] as const){
    assert.equal(classifyIntent({callAttempted:true,verified:{attemptAvailability:{cause}}}).verifiedUnservedAttempt,false);
  }
});
test('only a call with trusted matching availability evidence counts as unserved',()=>{
  assert.equal(classifyIntent({callAttempted:true}).verifiedUnservedAttempt,false);
  assert.equal(classifyIntent({searchStarted:true,verified:{attemptAvailability:{cause:'busy'}}}).verifiedUnservedAttempt,false);
  const busy=classifyIntent({callAttempted:true,timing:'urgent',verified:{attemptAvailability:{cause:'busy'}}});
  assert.equal(busy.stage,'probable_request');
  assert.equal(busy.verifiedUnservedAttempt,true);
  assert.equal(busy.confirmedDemand,false);
  assert.equal(busy.timing,'urgent');
});
test('server milestones remain distinct and cancellation is not completion',()=>{
  assert.equal(classifyIntent({formStarted:true}).stage,'probable_request');
  assert.equal(classifyIntent({verified:{order:'assigned'}}).stage,'assigned');
  assert.equal(classifyIntent({verified:{order:'completed'}}).stage,'completed');
  const cancelled=classifyIntent({verified:{order:'cancelled'}});
  assert.equal(cancelled.stage,'submitted');
  assert.equal(cancelled.cancelled,true);
  assert.equal(cancelled.confirmedDemand,true);
  assert.equal(classifyIntent({timing:'scheduled'}).timing,'scheduled');
});
test('invalid search counts and absence of measurements are not observed zero',()=>{
  for(const count of [-1,NaN,Infinity,1.5]){
    const x=classifyIntent({verified:{searchResult:{count}}});
    assert.equal(x.zeroResults,false);
    assert.equal(x.hasObservedActivity,false);
    assert.equal(x.zeroResultCause,null);
  }
  assert.equal(classifyIntent({}).hasObservedActivity,false);
  assert.equal(classifyIntent({searchStarted:true,formStarted:true,inactiveAfterWindow:true}).inactiveAfterSearch,false);
});
