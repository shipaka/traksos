import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {setup,ok} from './helpers.ts';

test('operator experiences are vehicle-keyed, moderated and isolated from private repair materials',async()=>{
 const t=await setup();
 try{
  const admin=await t.login('+79990000001');
  const owner=await t.login('+79995513001','client');
  const other=await t.login('+79995513002','client');
  const tow=await t.login('+79995513003','tow');
  const listing='/api/owner-experience';
  const model={catalogCategory:'trailer',brandKey:'krone',modelKey:'profi-liner'};
  const good={...model,topic:'operations',clientNonce:randomUUID(),
   title:'Опыт эксплуатации KRONE Profi Liner',
   body:'В длительных рейсах полезно проверять крепления тента и замков по оригинальной инструкции, особенно после сильного ветра.'};
  assert.equal((await t.api('GET',listing,undefined,tow.token)).status,403);
  assert.equal((await t.api('POST',listing,good,tow.token)).status,403);
  assert.equal((await t.api('GET','/api/admin/owner-experience/queue',undefined,owner.token)).status,403);
  assert.equal((await t.api('GET',listing,undefined,owner.token)).status,200);
  assert.equal((await t.api('POST',listing,{...good,modelKey:'invented',clientNonce:randomUUID()},owner.token)).status,400);
  assert.equal((await t.api('POST',listing,{...good,body:'Позвоните +79991112233'+good.body,clientNonce:randomUUID()},owner.token)).status,400);
  const created=ok(await t.api('POST',listing,good,owner.token));
  const id=created.post.id;
  assert.equal(created.post.reviewState,'pending');
  assert.equal(created.post.category,'trailer');
  assert.equal(created.post.brand,'KRONE');
  assert.equal(ok(await t.api('POST',listing,good,owner.token)).post.id,id,'same nonce must not duplicate the post');
  assert.equal(ok(await t.api('GET',listing,undefined,other.token)).items.length,0);
  assert.equal((await t.api('GET',listing+'/'+id,undefined,other.token)).status,404);
  const mine=ok(await t.api('GET',listing+'?mine=true',undefined,owner.token));
  assert.equal(mine.items.length,1);
  const queue=ok(await t.api('GET','/api/admin/owner-experience/queue',undefined,admin.token));
  assert.ok(queue.items.some((x:any)=>x.id===id));
  assert.equal(ok(await t.api('POST','/api/admin/owner-experience/'+id+'/review',{
    decision:'publish',note:'Материал подтверждён как личный опыт эксплуатации.'
  },admin.token)).post.review_state,'published');
  const published=ok(await t.api('GET',listing+'?category=trailer&brandKey=krone&modelKey=profi-liner',undefined,other.token));
  assert.equal(published.items.length,1);
  assert.ok(!JSON.stringify(published.items[0]).includes('author_id'));
  assert.ok(!JSON.stringify(published.items[0]).includes('professional'));
  assert.equal((await t.api('GET',listing+'?brandKey=wrong',undefined,other.token)).body.items.length,0);
  assert.equal(ok(await t.api('POST',listing+'/'+id+'/save',{saved:true},other.token)).saved,true);
  assert.equal(ok(await t.api('GET',listing+'?saved=true',undefined,other.token)).items[0].saveCount,1);
  assert.equal(ok(await t.api('POST',listing+'/'+id+'/report',{
    reason:'Указанная проверка замков может отличаться по поколению полуприцепа.'
  },other.token)).reported,true);
  assert.equal((await t.api('POST',listing+'/'+id+'/report',{
    reason:'Нельзя жаловаться на себя'},owner.token)).status,404);
  assert.ok(ok(await t.api('GET','/api/admin/owner-experience/queue',undefined,admin.token))
    .items.some((x:any)=>x.id===id&&x.pending_reports>0));
  ok(await t.api('POST','/api/admin/owner-experience/'+id+'/review',{
    decision:'hide',note:'Проверяем точность для другого поколения полуприцепа.'
  },admin.token));
  assert.equal(ok(await t.api('GET',listing,undefined,other.token)).items.length,0);
  assert.equal((await t.api('GET',listing+'/'+id,undefined,other.token)).status,404);
  assert.equal(ok(await t.api('GET',listing+'?mine=true',undefined,owner.token)).items.length,1);
  assert.equal((await t.api('DELETE',listing+'/'+id,undefined,other.token)).status,404);
  assert.equal(ok(await t.api('DELETE',listing+'/'+id,undefined,owner.token)).deleted,true);
  assert.equal(ok(await t.api('GET',listing+'?mine=true',undefined,owner.token)).items.length,0);
  const audits=await t.db.query("select action from audit_log where action='owner_experience.review'");
  assert.equal(audits.length,2);
 }finally{await t.close()}
});

test('owner experience cannot be attached to someone else garage vehicle or fake VIN',async()=>{
 const t=await setup();
 try{
  const owner=await t.login('+79995513021','client');
  const stranger=await t.login('+79995513022','client');
  const car=ok(await t.api('POST','/api/vehicle-reference/vehicles',{
    category:'truck',brandKey:'scania',modelKey:'r-series',year:2010
  },owner.token));
  const base={vehicleId:car.id,topic:'ownership',
    title:'Как устроена эксплуатация грузовой Scania',
    body:'В повседневных поездках удобно иметь в кабинете ссылку на заводскую книжку и историю обращений.',
    clientNonce:randomUUID()};
  assert.equal((await t.api('POST','/api/owner-experience',base,stranger.token)).status,404);
  const mine=ok(await t.api('POST','/api/owner-experience',base,owner.token));
  assert.equal(mine.post.category,'truck');
  assert.equal(mine.post.model,'R Series');
  assert.equal((await t.api('POST','/api/owner-experience',{
    ...base,clientNonce:randomUUID(),
    body:'VIN WDB12345678901234 '+base.body
  },owner.token)).status,400);
 }finally{await t.close()}
});
