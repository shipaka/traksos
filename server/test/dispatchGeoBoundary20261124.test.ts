import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rankCandidates, type Candidate, type DispatchOrder } from '../src/domain/dispatch.ts';
import { haversineKm } from '../src/domain/geo.ts';

const candidate=(id:string, patch:Partial<Candidate>={}):Candidate=>({
  user_id:id,kind:'master',specialties:['electric'],brands:{},
  is_priority:false,paused:false,line_status:'online',verification:'pending',
  lat:59.95,lng:30.35,rating:4,accepts_group:true,user_status:'active',...patch,
});
const order:DispatchOrder={service:'electric',brand:null,lat:59.95,lng:30.35,group_trip:false};
const options={radiusKm:50,maxCandidates:20,cashDebtLimit:10000,now:new Date('2026-11-24T09:00:00Z')};

test('arbitrary brand names never inherit prototype values or skip the explicit refusal rule',()=>{
  for(const brand of ['constructor','__proto__','toString']){
    const refusing=candidate('refusing',{brands:JSON.parse(JSON.stringify({[brand]:'refuse'}))});
    const excellent=candidate('excellent',{brands:JSON.parse(JSON.stringify({[brand]:'excellent'}))});
    const list=rankCandidates({...order,brand},[candidate('ordinary'),refusing,excellent],options);
    assert.deepEqual(list.map(x=>[x.user_id,x.reason]),[['excellent','excellent'],['ordinary','good']]);
  }
});

test('corrupted specialty, competence and rating records do not break valid candidates',()=>{
  const malformed=candidate('malformed',{specialties:null as unknown as string[]});
  const invalid=candidate('invalid',{brands:{DAF:'unknown'} as unknown as Candidate['brands'],rating:'NaN'});
  const list=rankCandidates({...order,brand:'DAF'},[malformed,invalid,candidate('valid')],options);
  assert.deepEqual(list.map(x=>[x.user_id,x.reason]),[['valid','good'],['invalid','good']]);
});

test('unknown or corrupt GPS never creates fictitious distances; known far candidates remain excluded',()=>{
  const candidates=[
    candidate('zero',{lat:0,lng:0}),candidate('bad',{lat:91,lng:30}),
    candidate('nan',{lat:NaN,lng:30}),candidate('missing',{lat:null}),
    candidate('far',{lat:55,lng:37}),candidate('local'),
  ];
  const ranked=rankCandidates(order,candidates,options);
  assert.equal(ranked[0].user_id,'local');
  assert.equal(ranked[0].distanceKm,0);
  assert.equal(ranked.some(x=>x.user_id==='far'),false);
  assert.equal(ranked.length,5);
  assert.ok(ranked.slice(1).every(x=>x.distanceKm===null));
  assert.ok(rankCandidates({...order,lat:0,lng:0},candidates,options).every(x=>x.distanceKm===null));
});

test('antipodal coordinates yield a finite great-circle distance despite roundoff',()=>{
  const a={lat:12.34,lng:40},b={lat:-12.34,lng:-140};
  const km=haversineKm(a,b);
  assert.ok(Number.isFinite(km));
  assert.ok(Math.abs(km-Math.PI*6371)<0.001);
});
