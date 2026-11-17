import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setup,ok} from './helpers.ts';

/** A tow-truck operator is a professional, but not an auto-repair specialist.
 * Moderators have separate admin endpoints, never a covert read privilege.
 */
test('community professional repair library is invisible to tow/driver/admin-only roles',async()=>{
 const t=await setup();
 try{
  const admin=await t.login('+79990000001');
  const driver=await t.login('+79994700701','driver');
  const tow=await t.login('+79994700702','tow');
  const master=await t.login('+79994700703','master');
  ok(await t.api('PUT','/api/performer/profile',{
    kind:'tow',name:'Эвакуатор',taxStatus:'self_employed',inn:'780000007002'
  },tow.token));
  ok(await t.api('PUT','/api/performer/profile',{
    kind:'master',name:'Диагност',specialties:['diag'],taxStatus:'self_employed',
    inn:'780000007003'
  },master.token));
  for(const user of [tow,master])ok(await t.api('POST',
    '/api/admin/performers/'+user.id+'/verify',{decision:'approved'},admin.token));
  const index='/api/community/knowledge';
  const sources='/api/community/knowledge/references';
  const room=await t.db.one<{id:string}>("select id from community_rooms where slug='diag-pro'");
  assert.ok(room?.id);
  for(const user of [driver,tow,admin]){
    assert.equal((await t.api('GET',index,undefined,user.token)).status,403);
    assert.equal((await t.api('GET',sources,undefined,user.token)).status,403);
    assert.equal((await t.api('GET',sources+'?q=EBS',undefined,user.token)).status,403);
    assert.equal((await t.api('GET','/api/community/pro-cases/rooms/'+room!.id,
      undefined,user.token)).status,404);
    assert.equal((await t.api('POST',index+'/propose',{
      title:'Попытка доступа к ремонтному разделу',
      make:'Renault',subsystem:'EBS',
      description:'Фиктивная попытка публикации технического материала без профессионального допуска.',
      rightsBasis:'own'
    },user.token)).status,403);
  }
  assert.equal((await t.api('GET',sources,undefined,master.token)).status,200);
  assert.equal((await t.api('GET',index,undefined,master.token)).status,200);
  assert.equal((await t.api('GET','/api/community/pro-cases/rooms/'+room!.id,
    undefined,master.token)).status,200);
  assert.equal((await t.api('GET','/api/admin/community/knowledge/references',
    undefined,admin.token)).status,200);
  assert.equal((await t.api('GET','/api/admin/community/knowledge/references',
    undefined,tow.token)).status,403);
 }finally{await t.close()}
});
