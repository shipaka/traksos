import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validInn} from '../src/domain/inn.ts';
import {setup,ok} from './helpers.ts';

// Synthetic checksum fixtures, not assertions that these identifiers
// correspond to registered taxpayers.
const organization='0123456788',individual='012345678943';
test('INN checksum distinguishes 10 and 12 digits and preserves leading zeros',()=>{
 assert.equal(validInn(organization),true);
 assert.equal(validInn(individual),true);
 assert.equal(validInn(individual,true),true);
 assert.equal(validInn(organization,true),false);
 for(const value of ['','0000000000','000000000000','0123456789','012345678942',
    '012345678953','01234567894','0123456789430','01234567894A',' 012345678943']){
   assert.equal(validInn(value),false,value);
 }
});

test('profile API rejects new invalid checksums but leaves existing data accessible',{timeout:60000},async()=>{
 const t=await setup();
 try{
  const client=await t.login('+79997809521','client');
  const master=await t.login('+79997809522','master');
  const patch=(body:unknown)=>t.api('PATCH','/api/me',body,client.token);
  const save=(body:Record<string,unknown>)=>t.api('PUT','/api/performer/profile',{kind:'master',...body},master.token);
  const old='1234567890';
  await t.db.query('update users set company_inn=$2 where id=$1',[client.id,old]);
  assert.equal(ok(await patch({name:'Старые данные',companyInn:old})).company_inn,old);
  assert.equal(ok(await patch({name:'Другие настройки'})).company_inn,old);
  assert.equal((await patch({companyInn:'0123456789',name:'Запрещённое изменение'})).status,400);
  assert.equal(ok(await t.api('GET','/api/me',undefined,client.token)).name,'Другие настройки');
  assert.equal(ok(await patch({companyInn:organization})).company_inn,organization);
  assert.equal(ok(await patch({companyInn:individual})).company_inn,individual);
  assert.equal((await patch({companyInn:old})).status,400,'old invalid value cannot be restored after correction');
  assert.equal((await patch({companyInn:''})).status,400);
  assert.equal(ok(await patch({companyInn:null})).company_inn,individual,'null retains existing optional identifier');
  ok(await save({specialties:['electric']}));
  await t.db.query('update performer_profiles set inn=$2 where user_id=$1',[master.id,'123456789012']);
  assert.equal(ok(await save({inn:'123456789012'})).inn,'123456789012');
  assert.equal(ok(await save({prepMinutes:5})).inn,'123456789012');
  assert.equal((await save({inn:organization})).status,400);
  assert.equal((await save({inn:'012345678942',name:'Не сохранять'})).status,400);
  assert.notEqual(ok(await t.api('GET','/api/me',undefined,master.token)).name,'Не сохранять');
  assert.equal(ok(await save({inn:individual,taxStatus:'ip'})).inn,individual);
  assert.equal((await save({inn:'123456789012'})).status,400);
  assert.equal(ok(await save({inn:null})).inn,individual);
 }finally{await t.close();}
});
