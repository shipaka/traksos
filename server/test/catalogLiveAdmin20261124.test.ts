import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {AuthUser} from '../src/http/router.ts';
import {ShopCatalogService} from '../src/services/shopCatalog.ts';
import {setup} from './helpers.ts';

test('catalog import, preview and publication require a currently active admin', {timeout:60000},async()=>{
 const t=await setup();
 try{
  const login=await t.login('+79990000001');
  const actor=await t.db.one<AuthUser>('select id,phone,name,roles,status,owner_id from users where id=$1',[login.id]);
  assert.ok(actor);
  const catalog=new ShopCatalogService(t.db,t.app.settings);
  const batch={sourceNote:'Синтетический каталог CI',rightsConfirmed:true,dryRun:false,
   rows:[{brand:'Scania',article:'CI-LIVE-ADMIN-01',name:'Насос CI',category:'engine'}]};
  await catalog.importBatch(actor,batch);
  const entry=await t.db.one<{id:string;reviewed:boolean}>(
   'select id,reviewed from shop_catalog_entries where article=$1',[batch.rows[0].article]);
  assert.ok(entry);
  assert.equal(entry.reviewed,false);
  const next={...batch,rows:[{...batch.rows[0],article:'CI-LIVE-ADMIN-02'}]};
  const denied=(e:any)=>e?.status===403;
  await t.db.query("update users set roles=array['client']::text[] where id=$1",[actor.id]);
  await assert.rejects(catalog.importBatch(actor,next),denied);
  await assert.rejects(catalog.importBatch(actor,{...next,dryRun:true}),denied);
  await assert.rejects(catalog.review(actor,entry.id,true),denied);
  await t.db.query('update users set roles=$2 where id=$1',[actor.id,actor.roles]);
  await t.db.query("update users set status='blocked' where id=$1",[actor.id]);
  await assert.rejects(catalog.importBatch(actor,next),denied);
  await assert.rejects(catalog.review(actor,entry.id,true),denied);
  await t.db.query("update users set status='active',deleted_at=now() where id=$1",[actor.id]);
  await assert.rejects(catalog.review(actor,entry.id,true),denied);
  assert.equal((await t.db.one<{reviewed:boolean}>('select reviewed from shop_catalog_entries where id=$1',[entry.id]))?.reviewed,false);
  assert.equal((await t.db.query('select id from shop_catalog_entries where article=$1',[next.rows[0].article])).length,0);
  await t.db.query('update users set deleted_at=null where id=$1',[actor.id]);
  await catalog.review(actor,entry.id,true);
  assert.equal((await t.db.one<{reviewed:boolean}>('select reviewed from shop_catalog_entries where id=$1',[entry.id]))?.reviewed,true);
 }finally{await t.close();}
});
