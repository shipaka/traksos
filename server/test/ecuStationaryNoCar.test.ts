import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setup,ok} from './helpers.ts';

test('stationary ECU profile rejects a performer vehicle and clears stale roadside car when switching kinds',async()=>{
  const t=await setup();
  try{
    const expert=await t.login('+79999712241','master');
    const car={brand:'Lada Largus',color:'белый',plate:'А123ВС178'};
    const roadside=ok(await t.api('PUT','/api/performer/profile',{
      kind:'master',name:'Эксперт ремонта',specialties:['diag'],
      car,cars:[car]
    },expert.token));
    assert.equal(roadside.car?.plate,car.plate);
    assert.equal(roadside.cars.length,1);
    assert.equal((await t.api('PUT','/api/performer/profile',{
      kind:'ecu',name:'Эксперт стационарного ЭБУ',
      specialties:['diag'],car,cars:[car]
    },expert.token)).status,400,
      'ECU identity must not accept a roadside vehicle');
    const stationary=ok(await t.api('PUT','/api/performer/profile',{
      kind:'ecu',name:'Эксперт стационарного ЭБУ',specialties:['diag']
    },expert.token));
    assert.equal(stationary.kind,'ecu');
    assert.equal(stationary.car,null,'the previous roadside car is no longer part of the stationary profile');
    assert.deepEqual(stationary.cars,[]);
    const updated=ok(await t.api('PUT','/api/performer/profile',{
      kind:'ecu',name:'Эксперт ЭБУ, мастерская',taxStatus:'ip',inn:'781234567890'
    },expert.token));
    assert.equal(updated.car,null);
    assert.deepEqual(updated.cars,[]);
    assert.equal((await t.api('PUT','/api/performer/profile',{
      kind:'ecu',name:'Эксперт ЭБУ',cars:[car]
    },expert.token)).status,400);
  }finally{
    await t.close();
  }
});
