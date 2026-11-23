import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyNoPerformerReason, type PartnerPresence } from '../src/domain/noPerformerReason.ts';

const partner = (patch: Partial<PartnerPresence> = {}): PartnerPresence => ({
  kind: 'master', specialties: ['electric'], user_status: 'active',
  verification: 'approved', line_status: 'online', paused: false,
  extras: null, lat: 59.934, lng: 30.335, ...patch,
});
const snapshot = (patch: Partial<Parameters<typeof classifyNoPerformerReason>[0]> = {}) => ({
  service: 'electric', verifiedOnly: false,
  lat: 59.934, lng: 30.335, radiusKm: 50, invited: false,
  profiles: [] as PartnerPresence[], ...patch,
});

test('no partner claim requires proven absence of matching active profiles anywhere', () => {
  assert.equal(classifyNoPerformerReason(snapshot()), 'not_connected');
  assert.equal(classifyNoPerformerReason(snapshot({
    profiles: [partner({specialties:['tyre']})],
  })), 'not_connected');
  assert.equal(classifyNoPerformerReason(snapshot({
    profiles: [partner({user_status:'blocked'})],
  })), 'not_connected');
  assert.equal(classifyNoPerformerReason(snapshot({
    profiles: [partner({verification:'pending'})], verifiedOnly:true,
  })), 'unknown', 'pending badge is not proof the specialty is unconnected');
});

test('actual invited calls take precedence and become no_response', () => {
  assert.equal(classifyNoPerformerReason(snapshot({invited:true})), 'no_response');
  assert.equal(classifyNoPerformerReason(snapshot({
    profiles:[partner({line_status:'offline'})], invited:true,
  })), 'no_response');
});

test('real offer outranks invitation-only no_response when all bids are withdrawn', () => {
  assert.equal(classifyNoPerformerReason(snapshot({
    invited: true, hadOffer: true, profiles: [partner()],
  })), 'offers_withdrawn');
  assert.equal(classifyNoPerformerReason(snapshot({
    invited: false, hadOffer: true, profiles: [],
  })), 'offers_withdrawn', 'do not erase a proven bid when the worker profile is deleted');
  assert.equal(classifyNoPerformerReason(snapshot({
    invited: true, hadOffer: false, profiles: [partner()],
  })), 'no_response', 'bidding invitations with zero bids remain no_response');
});

test('nearby offline, paused and vacation partners can be temporarily unavailable', () => {
  for (const patch of [
    {line_status:'offline'},
    {paused:true},
    {extras:{vacation:true}},
  ]) {
    assert.equal(classifyNoPerformerReason(snapshot({profiles:[partner(patch)]})),
      'temporarily_unavailable');
  }
});

test('unknown GPS, distant/unknown locations and active workers never prove no partner', () => {
  for (const options of [
    {lat:null, lng:null},
    {profiles:[partner({lat:null,lng:null})]},
    {profiles:[partner({lat:55.75,lng:37.62})]},
    {profiles:[partner()]},
    {verifiedOnly:true,profiles:[partner({verification:'pending',line_status:'offline'})]},
  ]) {
    assert.equal(classifyNoPerformerReason(snapshot({
      profiles:[partner({line_status:'offline'})],...options,
    })), 'unknown');
  }
});
