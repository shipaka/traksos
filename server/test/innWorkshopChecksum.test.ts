import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setup,ok} from './helpers.ts';

test('workshop INN rejects changed invalid checksums and preserves legacy cards',{timeout:60000},async()=>{
 const t=await setup();
 try{
  const station=await t.login('+79997809531','service');
  const save=(body:Record<string,unknown>)=>t.api('PUT','/api/base',body,station.token);
  const read=async()=>ok(await t.api('GET','/api/base',undefined,station.token)).center;
  const initial={name:'Учебная СТО',address:'Тестовый адрес, 1'};
  assert.equal((await save({...initial,inn:'0123456789'})).status,400);
  assert.equal(await read(),null,'invalid creation must leave no center');
  const created=ok(await save({...initial,inn:'0123456788'})).center;
  assert.equal(created.inn,'0123456788');
  const legacy='1234567890';
  await t.db.query('update service_centers set inn=$2 where id=$1',[created.id,legacy]);
  assert.equal(ok(await save({inn:legacy,hours:'09:00–18:00'})).center.inn,legacy);
  assert.equal(ok(await save({hours:'10:00–19:00'})).center.inn,legacy);
  const invalid=await save({inn:'012345678942',name:'Не сохранять'});
  assert.equal(invalid.status,400);assert.equal(invalid.body.error,'bad_inn');
  assert.equal((await read()).name,initial.name);
  assert.equal(ok(await save({inn:'012345678943'})).center.inn,'012345678943');
  assert.equal((await save({inn:legacy})).status,400);
  assert.equal((await save({inn:''})).status,400);
  assert.equal(ok(await save({inn:null})).center.inn,'012345678943');
 }finally{await t.close();}
});
