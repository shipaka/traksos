import test from 'node:test';
import assert from 'node:assert/strict';
import { readTechBaseIllustrations } from '../src/domain/techbaseIllustrated.ts';
test('illustrated master corpus has local inert SVG, provenance and no exact-fit claims', async()=>{
 const {cards,families,categories}=await readTechBaseIllustrations();
 for(const cat of categories) assert.ok(cards.some(c=>c.category===cat),cat);
 assert.equal(cards.length,148); assert.equal(families.length,14);
 assert.equal(cards.filter(c=>c.id.startsWith('scania-r-')).length,100);
 const volvoNew=cards.filter(c=>c.id.startsWith('volvo-fh-')&&'details' in c);
 assert.equal(volvoNew.length,19);
 for(const c of volvoNew) if('details' in c) for(const key of ['capability','location','route','conditions','connectors','wiring','diagnostics'] as const) assert.ok(c.details[key],c.id+' '+key);
 assert.ok(cards.filter(c=>c.id.startsWith('scania-r-')).every(c=>c.make==='Scania'&&(c.models as readonly string[]).includes('R')&&c.pins.length===0));
 assert.ok(families.some(([make,models])=>make==='МАЗ'&&(models as readonly string[]).includes('5440')));
 assert.ok(families.some(([make,models])=>make==='Mercedes-Benz'&&(models as readonly string[]).includes('Axor')));
 for(const c of cards) for(const id of c.related) assert.ok(cards.some(x=>x.id===id),c.id+' -> '+id);
 assert.ok(cards.some(c=>c.category==='Пневматика'&&c.related.some(id=>cards.some(x=>x.id===id&&x.category==='Электрика и ЭБУ'))));
 assert.equal(new Set(cards.map(c=>c.id)).size,cards.length);
 for(const c of cards){ assert.match(c.image,/^<svg /); assert.match(c.image,/<title>/); assert.doesNotMatch(c.image,/<script|<foreignObject|\son\w+=|(?:href|src)=/i); assert.equal(new URL(c.url).protocol,'https:'); assert.equal(c.fitment,'not_confirmed'); assert.equal(c.reviewStatus,'source_checked_expert_pending'); assert.ok(c.scope && c.body && c.source); }
 for(const [id,count] of [['iso-7638-1',7],['iso-12098',15]] as const){const c=cards.find(x=>x.id===id)!;assert.equal(c.pins.length,count);assert.deepEqual(c.pins.map(p=>p[0]),Array.from({length:count},(_,i)=>String(i+1)));}
 assert.deepEqual(cards.find(c=>c.make==='Volvo')?.models,['FH','FM']);
});

test('legacy model filters remain thematic and common images have no invented fitments',async()=>{const {cards}=await readTechBaseIllustrations();assert.ok(cards.every(c=>c.bindings.every(b=>b.status==='thematic')));assert.equal(cards.find(c=>c.id==='ebs-modulator')?.bindings.length,0);assert.ok(cards.find(c=>c.id==='scania-r-check-valve')?.bindings.some(b=>b.make==='Scania'&&b.model==='R'));});
