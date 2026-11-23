import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setup} from './helpers.ts';
import {VehicleReferenceService} from '../src/services/vehicleReference.ts';
import type {CatalogSnapshotInput} from '../src/domain/vehicleReference.ts';

const source=(key:string)=>({
  key,name:'Isolated licensed synthetic fleet catalog '+key,
  originUrl:'https://example.org/owned/'+key,
  licenseName:'Own synthetic fixture',
  licenseUrl:'https://example.org/legal/'+key,
  rightsEvidence:'All vehicle examples in this disposable test are invented and free of third party data',
});
const catalog=(revision:string,modelKey:string,modelName:string):CatalogSnapshotInput=>({
  sourceRevision:revision,
  brands:[{category:'truck',key:'renault',name:'Renault Trucks',aliases:['Рено'],
    models:[{key:modelKey,name:modelName,aliases:[],yearFrom:2000,yearTo:2030}]}],
});

test('vehicle catalogue: a model from source B is never misattributed to source A', {timeout:60000},async()=>{
  const t=await setup();
  try{
    const actor=await t.db.one<any>(
      "insert into users(phone,roles,status) values ('+79997763421',ARRAY['admin']::text[],'active') returning *");
    const reader=await t.db.one<any>(
      "insert into users(phone,roles,status) values ('+79997763422',ARRAY['client']::text[],'active') returning *");
    const svc=new VehicleReferenceService(t.db);
    for(const [key,modelKey,modelName] of [
      ['catalog-a','premium','Premium'],['catalog-b','t-series','T-Series'],
    ]){
      await svc.registerSource(actor,source(key));
      await svc.approveSource(actor,key,'Checked documented rights for synthetic isolated test data');
      await svc.stageSnapshot(actor,key,catalog('licensed-v1',modelKey,modelName));
      await svc.activateSnapshot(actor,key,'licensed-v1','Verified content before publication');
    }
    const result=await svc.validateSelection(reader,'client',{
      category:'truck',brandKey:'renault',modelKey:'t-series',year:2022,
    });
    assert.equal(result.verifiedCatalogReference,true);
    assert.equal(result.vinDecoded,false);
    assert.equal(result.partsFitmentVerified,false);
    assert.equal(result.brand.sourceKey,'catalog-b',
      'the brand must come from the same approved source as the selected model');
    assert.equal(result.model.sourceKey,'catalog-b');
    const original=await svc.validateSelection(reader,'client',{
      category:'truck',brandKey:'renault',modelKey:'premium',year:2010,
    });
    assert.equal(original.brand.sourceKey,'catalog-a');
    assert.equal(original.model.sourceKey,'catalog-a');
  }finally{await t.close();}
});

test('vehicle catalogue: matched row counts with changed model content fail SHA-256 before publication', {timeout:60000},async()=>{
  const t=await setup();
  try{
    const actor=await t.db.one<any>(
      "insert into users(phone,roles,status) values ('+79997763423',ARRAY['admin']::text[],'active') returning *");
    const svc=new VehicleReferenceService(t.db);
    const key='integrity-test';
    await svc.registerSource(actor,source(key));
    await svc.approveSource(actor,key,'Synthetic dataset rights reviewed and approved for test');
    const staged=await svc.stageSnapshot(actor,key,catalog('v1','premium','Premium'));
    const verified=await t.db.one<any>(
      'select content_sha256,brand_count,model_count from vehicle_ref_snapshots where id=$1',[staged.id]);
    assert.equal(verified?.brand_count,1);
    assert.equal(verified?.model_count,1);
    // The test deliberately bypasses the DB immutability trigger in a
    // disposable schema to simulate disk/import corruption with SAME counts.
    await t.db.query('alter table vehicle_ref_models disable trigger user');
    try{
      await t.db.query(
        "update vehicle_ref_models set display_name='Falsified Premium' where snapshot_id=$1",[staged.id]);
    }finally{
      await t.db.query('alter table vehicle_ref_models enable trigger user');
    }
    const after=await t.db.one<any>(
      'select content_sha256,brand_count,model_count from vehicle_ref_snapshots where id=$1',[staged.id]);
    assert.deepEqual(after,verified,'metadata and row counts can look legitimate despite tampering');
    await assert.rejects(
      svc.activateSnapshot(actor,key,'v1','Try publishing silently modified data'),
      /SHA-256/,
    );
    assert.equal((await t.db.one<any>(
      'select state from vehicle_ref_snapshots where id=$1',[staged.id]))?.state,'staged');
    assert.equal((await t.db.query('select id from vehicle_ref_registry_events where event_kind=\'revision_published\'')).length,0);
  }finally{await t.close();}
});
