import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup,ok } from './helpers.ts';

test('optional vehicle details: owner can change or clear, driver and stranger cannot',async()=>{
  const t=await setup();
  try {
    const owner=await t.login('+79997771231');
    const stranger=await t.login('+79997771232');
    const driver=await t.login('+79997771233','driver');
    const car=ok(await t.api('POST','/api/vehicles',
      {brand:'Renault',model:'Premium',year:2010},owner.token));
    const id=car.id;
    const found=ok(await t.api('PATCH','/api/vehicles/'+id+'/details',{
      vin:'VF611MTA000123456',engine:'DXi 11',configurationNotes:'Установлен другой редуктор'
    },owner.token));
    assert.equal(found.vin,'VF611MTA000123456');
    assert.equal(found.engine,'DXi 11');
    assert.equal(found.configuration_notes,'Установлен другой редуктор');
    const own=ok(await t.api('GET','/api/vehicles',undefined,owner.token));
    assert.equal(own.find((x:any)=>x.id===id)?.vin,found.vin);
    assert.equal((await t.api('PATCH','/api/vehicles/'+id+'/details',
      {vin:'1'},owner.token)).status,400);
    assert.equal((await t.api('PATCH','/api/vehicles/'+id+'/details',
      {vin:null},stranger.token)).status,404);
    await t.db.query('update users set owner_id=$2 where id=$1',[driver.id,owner.id]);
    assert.equal((await t.api('PATCH','/api/vehicles/'+id+'/details',
      {engine:'подмена'},driver.token)).status,403);
    const cleared=ok(await t.api('PATCH','/api/vehicles/'+id+'/details',
      {vin:null,engine:null,configurationNotes:null},owner.token));
    assert.equal(cleared.vin,null);
    assert.equal(cleared.engine,null);
  }finally{await t.close();}
});
