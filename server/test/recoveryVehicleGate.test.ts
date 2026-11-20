import test from 'node:test';
import assert from 'node:assert/strict';
import {setup,ok} from './helpers.ts';
import {vehicleOwnerShelf,isVerifiedRecoveryUnitLabel} from '../src/services/vehicleOwnerShelf.ts';

test('tow fleet server gate rejects normal trucks and accepts documented heavy wreckers',async()=>{
 const t=await setup();
 try{
  const user=await t.login('+79995674321','tow');
  const base={kind:'tow',name:'Специалист эвакуации',taxStatus:'self_employed',
   inn:'780000004321',specialties:['electric']};
  assert.equal((await t.api('PUT','/api/performer/profile',{
    ...base,car:{brand:'Scania R Series',plate:'А001АА78',color:'Синий'}
  },user.token)).status,400);
  assert.equal((await t.api('PUT','/api/performer/profile',{
    ...base,cars:[{brand:'Renault Premium',plate:'А001АА78'}]
  },user.token)).status,400);
  const record=(await vehicleOwnerShelf()).recovery.find(x=>x.makeKey==='scania');
  assert.ok(record);
  const brand=(record!.make+' '+record!.model.split(' — ')[0]).slice(0,50);
  assert.equal(await isVerifiedRecoveryUnitLabel(brand),true);
  const profile=ok(await t.api('PUT','/api/performer/profile',{
    ...base,car:{brand,plate:'А001АА78'},
    cars:[{brand,plate:'А001АА78'}]
  },user.token));
  assert.equal(profile.kind,'tow');
 }finally{await t.close()}
});
