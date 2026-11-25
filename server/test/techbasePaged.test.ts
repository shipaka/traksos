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
