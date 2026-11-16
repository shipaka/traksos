import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setup,ok} from './helpers.ts';

test('open TechBase references preserve source, licensing, professional ACL and manufacturer scope',async()=>{
 const t=await setup();
 try{
  const admin=await t.login('+79990000001');
  const driver=await t.login('+79994550102','driver');
  const master=await t.login('+79994550103','master');
  const base='/api/community/knowledge/references';
  assert.equal((await t.api('GET',base)).status,401);
  assert.equal((await t.api('GET',base,undefined,driver.token)).status,403);
  assert.equal((await t.api('GET',base,undefined,master.token)).status,403);
  ok(await t.api('PUT','/api/performer/profile',{
    kind:'master',name:'Проверяющий электрик',
    specialties:['electric'],taxStatus:'self_employed',inn:'780000000101'
  },master.token));
  ok(await t.api('POST','/api/admin/performers/'+master.id+'/verify',
    {decision:'approved'},admin.token));
  const all=ok(await t.api('GET',base,undefined,master.token));
  assert.equal(all.references.length,17);
  assert.equal(all.references.filter(x=>x.source_kind==='manufacturer_portal').length,5);
  assert.ok(all.references.every(x=>x.source_url.startsWith('https://')));
  assert.ok(all.references.every(x=>x.license_code && x.attribution_author));
  const renault=ok(await t.api('GET',base+'?make=Renault',undefined,master.token));
  assert.equal(renault.references.length,13);
  assert.ok(renault.references.every(x=>x.make===null||x.make==='Renault'));
  const common=ok(await t.api('GET',base+'?q=common%20rail',undefined,master.token));
  assert.ok(common.references.some(x=>x.slug==='common-rail-overview'));
  const ebs=ok(await t.api('GET',base+'?subsystem=EBS',undefined,master.token));
  assert.ok(ebs.references.some(x=>x.slug==='brake-air-disc-example'));
  const diagram=all.references.find(x=>x.slug==='cooling-liquid-engine');
  const detail=ok(await t.api('GET',base+'/'+diagram.id,undefined,master.token));
  assert.equal(detail.license_code,'CC-BY-SA-2.5');
  assert.equal(detail.referenceOnly,true);
  assert.equal((await t.api('GET',base+'/'+diagram.id,undefined,driver.token)).status,403);
  assert.equal((await t.api('GET',base+'?page=100',undefined,master.token)).status,400);
 }finally{await t.close()}
});
