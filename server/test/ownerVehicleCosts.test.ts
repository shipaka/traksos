import test from 'node:test';
import assert from 'node:assert/strict';
import {setup,ok} from './helpers.ts';

test('vehicle expenses are owner-only, separated from platform transactions and exportable',async()=>{
 const t=await setup();
 try{
  const owner=await t.login('+79995675001','client');
  const stranger=await t.login('+79995675002','client');
  const tow=await t.login('+79995675003','tow');
  const vehicle=ok(await t.api('POST','/api/vehicle-reference/vehicles',{
    category:'trailer',brandKey:'krone',modelKey:'profi-liner',year:2019
  },owner.token));
  const url='/api/vehicles/'+vehicle.id+'/costs';
  assert.equal((await t.api('GET',url,undefined,stranger.token)).status,404);
  assert.equal((await t.api('GET',url,undefined,tow.token)).status,403);
  assert.equal((await t.api('POST',url,{
    kind:'fuel',amountKopeks:1000,incurredOn:'2026-11-16'
  },stranger.token)).status,404);
  const fuel=ok(await t.api('POST',url,{
    kind:'fuel',amountKopeks:129950,incurredOn:'2026-11-15',note:'Личная запись о топливе'
  },owner.token));
  assert.ok(fuel.entry.id);
  const tyres=ok(await t.api('POST',url,{
    kind:'tyres',amountKopeks:300000,incurredOn:'2026-11-12'
  },owner.token));
  assert.ok(tyres.entry.id);
  const list=ok(await t.api('GET',url,undefined,owner.token));
  assert.equal(list.totalKopeks,429950);
  assert.equal(list.entries.length,2);
  assert.equal(list.separateFromPlatformPayments,true);
  assert.equal((await t.api('DELETE',url+'/'+fuel.entry.id,undefined,stranger.token)).status,404);
  assert.equal(ok(await t.api('DELETE',url+'/'+fuel.entry.id,undefined,owner.token)).deleted,true);
  assert.equal(ok(await t.api('GET',url,undefined,owner.token)).totalKopeks,300000);
  const exported=ok(await t.api('GET','/api/me/data/export',undefined,owner.token));
  assert.ok(JSON.stringify(exported).includes('ownerVehicleExpenses')||
    JSON.stringify(exported).includes('300000'));
 }finally{await t.close()}
});
