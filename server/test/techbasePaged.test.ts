import test from 'node:test';
import assert from 'node:assert/strict';
import {techBaseIllustratedMeta,searchTechBaseIllustrations,readTechBaseIllustration} from '../src/domain/techbaseIllustrated.ts';
test('catalogue metadata and pages never embed illustration bodies; stable paging and exact reference search',async()=>{
 const meta=techBaseIllustratedMeta();
 assert.equal(meta.total,148);assert.equal(Object.hasOwn(meta,'cards'),false);
 const first=searchTechBaseIllustrations(),next=searchTechBaseIllustrations({page:1});
 assert.equal(first.items.length,20);assert.equal(first.total,148);assert.equal(first.hasMore,true);
 assert.ok(first.items.every(x=>!Object.hasOwn(x,'image')&&!Object.hasOwn(x,'body')));
 assert.ok(next.items.every(x=>!first.items.some(y=>y.id===x.id)));
 assert.equal(searchTechBaseIllustrations({limit:500}).items.length,50);
 const match=searchTechBaseIllustrations({q:'1912297',make:'Scania',model:'R',general:false});
 assert.ok(match.items.some(x=>x.id==='scania-r-check-valve'));
 assert.ok(searchTechBaseIllustrations({make:'Volvo',model:'FH',general:false}).items.every(x=>x.bindings.some(b=>b.make==='Volvo'&&b.model==='FH')));
 const selected=await readTechBaseIllustration('scania-r-check-valve');
 assert.ok(selected?.image.startsWith('<svg '));assert.ok(selected?.relatedCards.length);
 assert.equal(await readTechBaseIllustration('../private'),null);
});

import {setup,ok} from './helpers.ts';
test('each page and direct image request enforces current professional role',async()=>{
 const t=await setup();
 try{
  const owner=await t.login('+79997809001');
  const admin=await t.login('+79990000001');
  const moderator=await t.login('+79997809002');
  const master=await t.login('+79997809003','master');
  await t.db.query("update users set roles='{moderator}'::text[] where id=$1",[moderator.id]);
  await t.db.query("update performer_profiles set verification='approved' where user_id=$1",[master.id]);
  const list='/api/techbase/illustrations?limit=2',detail='/api/techbase/illustrations/scania-r-check-valve';
  for(const actor of [admin,moderator,master]){
   const initial=ok(await t.api('GET','/api/techbase?audience=master',undefined,actor.token));
   assert.equal(initial.illustrated.total,148);assert.equal(Object.hasOwn(initial.illustrated,'cards'),false);
   const page=ok(await t.api('GET',list,undefined,actor.token));
   assert.equal(page.items.length,2);assert.ok(page.items.every((c:any)=>!Object.hasOwn(c,'image')));
   const card=ok(await t.api('GET',detail,undefined,actor.token));assert.match(card.image,/^<svg /);
  }
  for(const path of [list,detail]){
   assert.equal((await t.api('GET',path,undefined,owner.token)).status,403);
   assert.equal((await t.api('GET',path)).status,401);
  }
  await t.db.query("update performer_profiles set verification='pending' where user_id=$1",[master.id]);
  for(const path of [list,detail])assert.equal((await t.api('GET',path,undefined,master.token)).status,403);
  assert.equal((await t.api('GET','/api/techbase/illustrations?limit=51',undefined,admin.token)).status,400);
  assert.equal((await t.api('GET','/api/techbase/illustrations/does-not-exist',undefined,admin.token)).status,404);
  const driver=ok(await t.api('GET','/api/techbase?audience=driver',undefined,owner.token));
  assert.equal(Object.hasOwn(driver,'illustrated'),false);
 }finally{await t.close();}
});
