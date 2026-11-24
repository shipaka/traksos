import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {AuthUser} from '../src/http/router.ts';
import type {CatalogSnapshotInput} from '../src/domain/vehicleReference.ts';
import {VehicleReferenceService} from '../src/services/vehicleReference.ts';
import {setup} from './helpers.ts';

test('vehicle registry requires current active administrator for all private reads and writes', {timeout:60000},async()=>{
 const t=await setup();
 try{
  const login=await t.login('+79990000001');
  const actor=await t.db.one<AuthUser>('select id,phone,name,roles,status,owner_id from users where id=$1',[login.id]);
  assert.ok(actor);
  const svc=new VehicleReferenceService(t.db);
  const source={key:'live-registry-ci',name:'Synthetic licensed catalog',
   originUrl:'https://example.org/catalog',licenseName:'Own synthetic test fixture',
   licenseUrl:'https://example.org/license',rightsEvidence:'Synthetic records created exclusively for disposable CI'};
  const reason='Synthetic fixture rights reviewed for isolated CI';
  const catalog:CatalogSnapshotInput={sourceRevision:'v1',brands:[{
   category:'truck',key:'renault',name:'Renault Trucks',aliases:[],
   models:[{key:'premium',name:'Premium',aliases:[],yearFrom:2000,yearTo:2030}],
  }]};
  await svc.registerSource(actor,source);
  await svc.approveSource(actor,source.key,reason);
  const staged=await svc.stageSnapshot(actor,source.key,catalog);
  const pending={...source,key:'live-registry-pending'};
  await svc.registerSource(actor,pending);
  const denied=(e:any)=>e?.status===403;
  const rejected=async()=>{
   await assert.rejects(svc.registerSource(actor,{...source,key:'live-registry-denied'}),denied);
   await assert.rejects(svc.approveSource(actor,pending.key,reason),denied);
   await assert.rejects(svc.revokeSource(actor,source.key,reason),denied);
   await assert.rejects(svc.stageSnapshot(actor,source.key,{...catalog,sourceRevision:'v2'}),denied);
   await assert.rejects(svc.activateSnapshot(actor,source.key,'v1',reason),denied);
   await assert.rejects(svc.listSources(actor),denied);
   await assert.rejects(svc.listVersions(actor,source.key),denied);
  };
  await t.db.query("update users set roles=array['client']::text[] where id=$1",[actor.id]);
  await rejected();
  await t.db.query("update users set roles=$2,status='blocked' where id=$1",[actor.id,actor.roles]);
  await rejected();
  await t.db.query("update users set status='active',deleted_at=now() where id=$1",[actor.id]);
  await rejected();
  assert.equal((await t.db.one<{state:string}>('select state from vehicle_ref_snapshots where id=$1',[staged.id]))?.state,'staged');
  assert.equal((await t.db.one<{state:string}>('select state from vehicle_ref_sources where source_key=$1',[pending.key]))?.state,'pending');
  assert.equal((await t.db.one<{state:string}>('select state from vehicle_ref_sources where source_key=$1',[source.key]))?.state,'approved');
  assert.equal((await t.db.query("select id from vehicle_ref_snapshots where source_key=$1 and revision='v2'",[source.key])).length,0);
  assert.equal((await t.db.query("select source_key from vehicle_ref_sources where source_key='live-registry-denied'")).length,0);
  await t.db.query('update users set deleted_at=null where id=$1',[actor.id]);
  assert.ok((await svc.listSources(actor)).some(r=>r.source_key===source.key));
  assert.ok((await svc.listVersions(actor,source.key)).some(r=>r.id===staged.id));
  await svc.activateSnapshot(actor,source.key,'v1',reason);
  assert.equal((await t.db.one<{state:string}>('select state from vehicle_ref_snapshots where id=$1',[staged.id]))?.state,'active');
 }finally{await t.close();}
});
