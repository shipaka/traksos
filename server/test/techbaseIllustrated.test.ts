import test from 'node:test';
import assert from 'node:assert/strict';
import { readTechBaseIllustrations } from '../src/domain/techbaseIllustrated.ts';
test('illustrated master corpus has local inert SVG, provenance and no exact-fit claims', async()=>{
 const {cards,families}=await readTechBaseIllustrations();
 assert.equal(cards.length,24); assert.equal(families.length,14);
 assert.ok(families.some(([make,models])=>make==='МАЗ'&&models.includes('5440')));
 assert.ok(families.some(([make,models])=>make==='Mercedes-Benz'&&models.includes('Axor')));
 for(const c of cards) for(const id of c.related) assert.ok(cards.some(x=>x.id===id),c.id+' -> '+id);
 assert.ok(cards.some(c=>c.category==='Пневматика'&&c.related.some(id=>cards.some(x=>x.id===id&&x.category==='Электрика и ЭБУ'))));
 assert.equal(new Set(cards.map(c=>c.id)).size,cards.length);
 for(const c of cards){ assert.match(c.image,/^<svg /); assert.match(c.image,/<title>/); assert.doesNotMatch(c.image,/<script|<foreignObject|\son\w+=|(?:href|src)=/i); assert.equal(new URL(c.url).protocol,'https:'); assert.equal(c.fitment,'not_confirmed'); assert.equal(c.reviewStatus,'source_checked_expert_pending'); assert.ok(c.scope && c.body && c.source); }
 for(const [id,count] of [['iso-7638-1',7],['iso-12098',15]] as const){const c=cards.find(x=>x.id===id)!;assert.equal(c.pins.length,count);assert.deepEqual(c.pins.map(p=>p[0]),Array.from({length:count},(_,i)=>String(i+1)));}
 assert.deepEqual(cards.find(c=>c.make==='Volvo')?.models,['FH','FM']);
});
