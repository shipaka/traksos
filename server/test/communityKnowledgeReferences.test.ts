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
  assert.equal(all.references.filter((x:any)=>x.source_kind==='manufacturer_portal').length,5);
  assert.ok(all.references.every((x:any)=>x.source_url.startsWith('https://')));
  assert.ok(all.references.every((x:any)=>x.license_code && x.attribution_author));
  const renault=ok(await t.api('GET',base+'?make=Renault',undefined,master.token));
  assert.equal(renault.references.length,13);
  assert.ok(renault.references.every((x:any)=>x.make===null||x.make==='Renault'));
  const common=ok(await t.api('GET',base+'?q=common%20rail',undefined,master.token));
  assert.ok(common.references.some((x:any)=>x.slug==='common-rail-overview'));
  const ebs=ok(await t.api('GET',base+'?subsystem=EBS',undefined,master.token));
  assert.ok(ebs.references.some((x:any)=>x.slug==='brake-air-disc-example'));
  const diagram=all.references.find((x:any)=>x.slug==='cooling-liquid-engine');
  const detail=ok(await t.api('GET',base+'/'+diagram.id,undefined,master.token));
  assert.equal(detail.license_code,'CC-BY-SA-2.5');
  assert.equal(detail.referenceOnly,true);
  assert.equal((await t.api('GET',base+'/'+diagram.id,undefined,driver.token)).status,403);
  assert.equal((await t.api('GET',base+'?page=100',undefined,master.token)).status,400);
 }finally{await t.close()}
});

test('administrator can withdraw and restore a source without creating a fake OEM manual',async()=>{
 const t=await setup();
 try{
  const admin=await t.login('+79990000001');
  const driver=await t.login('+79994550112','driver');
  const base='/api/community/knowledge/references';
  assert.equal((await t.api('GET','/api/admin/community/knowledge/references',
    undefined,driver.token)).status,403);
  const catalog=ok(await t.api('GET','/api/admin/community/knowledge/references',
    undefined,admin.token));
  assert.equal(catalog.sources.length,17);
  const doc=catalog.sources.find((x:any)=>x.slug==='alternator-rotor-stator');
  const portal=catalog.sources.find((x:any)=>x.slug==='daf-rmi-portal');
  assert.ok(doc&&portal);
  const edit=(id:string,status:string,token:string)=>
    t.api('POST','/api/admin/community/knowledge/references/'+id+'/review',{
      status,note:'Основание редакционного решения: требуется дополнительная техническая проверка.'
    },token);
  assert.equal((await edit(doc.id,'withdrawn',driver.token)).status,403);
  assert.equal((await edit(portal.id,'expert_approved',admin.token)).status,400);
  assert.equal((await edit(doc.id,'portal_link',admin.token)).status,400);
  assert.equal(ok(await edit(doc.id,'withdrawn',admin.token)).active,false);
  assert.equal((await t.api('GET',base+'/'+doc.id,undefined,admin.token)).status,404);
  assert.ok(!ok(await t.api('GET',base,undefined,admin.token))
    .references.some((x:any)=>x.id===doc.id));
  assert.equal(ok(await edit(doc.id,'illustrative',admin.token)).active,true);
  const entry=ok(await t.api('GET',base+'/'+doc.id,undefined,admin.token));
  assert.equal(entry.technical_status,'illustrative');
  assert.equal(entry.coverage,'generic');
  assert.equal(entry.referenceOnly,true);
  const audit=await t.db.query(
    "select action from audit_log where action='community.knowledge_source_review'");
  assert.equal(audit.length,2);
 }finally{await t.close()}
});
