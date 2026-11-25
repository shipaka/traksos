import test from 'node:test';
import assert from 'node:assert/strict';
import { partRefsForCard, samePart } from '../src/domain/techbasePartRefs.ts';
import { TECHBASE_ILLUSTRATED } from '../src/domain/techbaseIllustrated.ts';
test('catalogue references are exact identities, not VIN matches',()=>{
 assert.equal(partRefsForCard('scania-r-check-valve')[0].article,'1912297');
 assert.equal(partRefsForCard('scania-r-pressure-limit')[0].article,'1914109');
 assert.equal(partRefsForCard('scania-r-air-reservoir').length,2);
 assert.equal(partRefsForCard('ebs-modulator').length,0);
 for(const c of TECHBASE_ILLUSTRATED)for(const ref of partRefsForCard(c.id)){
  assert.equal(ref.fitment,'unknown');assert.equal(new URL(ref.source).protocol,'https:');
 }
 assert.equal(samePart({brand:' Scania ',article:'1912297'},{brand:'SCANIA',article:'1912297'}),true);
 assert.equal(samePart({brand:'Scania',article:'1912297'},{brand:'Volvo',article:'1912297'}),false);
 assert.equal(samePart({brand:'Scania',article:'1912297'},{brand:'Scania',article:'19122970'}),false);
 assert.equal(samePart({brand:'Scania',article:'001-2'},{brand:'Scania',article:'0012'}),false);
});
