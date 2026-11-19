import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {migrate} from '../src/db/migrate.ts';
import {setup,ok,type T} from './helpers.ts';

// Test the new additive migrations on a database WITH existing case data,
// not only the empty DB that normal CI initializes. Uses a disposable test DB.
let t:T;
let owner:{id:string;token:string},tech:{id:string;token:string};
before(async()=>{
 t=await setup();
 owner=await t.login('+79997806701');
 tech=await t.login('+79997806702','master');
});
after(()=>t.close());

test('populated legacy case survives new recommendation migrations without fabricated charges or links',async()=>{
 const existing=ok(await t.api('POST','/api/orders',{
  service:'electric',zoneId:'spb',regionId:'spb',brand:'Renault',
  address:'Санкт-Петербург, Софийская улица, 60',
  description:'Старый выезд без согласования продолжения',paymentMethod:'cash'
 },owner.token)).order;
 await t.db.query(
  "update orders set status='arrived',performer_id=$2,arrived_at=$3 where id=$1",
  [existing.id,tech.id,t.clock.now()]);
 const original=await t.db.one<{id:string;number:number;client_id:string}>(
  'select id,number,client_id from orders where id=$1',[existing.id]);
 assert.ok(original);

 // Emulate a populated schema from immediately before the two additions:
 // no recommendation table, no nullable recommendation links yet.
 await t.db.exec('alter table orders drop column continuation_recommendation_id;');
 await t.db.exec('alter table service_bookings drop column continuation_recommendation_id;');
 await t.db.exec('drop table order_continuation_recommendations;');
 const migrations=[
  '20261118_performer_continuation_recommendations.sql',
  '20261119_order_recommendation_exact_link.sql'
 ];
 // Recreate the historical migration ledger, then use the REAL production
 // migration runner (including transaction boundaries and sorted ordering).
 await t.db.query('delete from schema_migrations where name=any($1::text[])',[migrations]);
 assert.deepEqual(await migrate(t.db),migrations);
 assert.deepEqual(await migrate(t.db),[],'the migration runner is retry-safe');
 // A DBA accidentally re-running either additive SQL file is harmless too.
 for(const filename of migrations){
  const sql=await readFile(new URL('../migrations/'+filename,import.meta.url),'utf8');
  await t.db.exec(sql);
 }
 const afterUpgrade=await t.db.one<{
  id:string;number:number;client_id:string;continuation_recommendation_id:string|null
 }>('select id,number,client_id,continuation_recommendation_id from orders where id=$1',[existing.id]);
 assert.equal(afterUpgrade?.id,original?.id);
 assert.equal(afterUpgrade?.number,original?.number);
 assert.equal(afterUpgrade?.client_id,original?.client_id);
 assert.equal(afterUpgrade?.continuation_recommendation_id,null,
  'legacy orders must not acquire an invented approval');
 assert.equal((await t.db.query('select id from payments where order_id=$1',[existing.id])).length,0,
  'schema upgrade must never create a payment');

 const recommendation=ok(await t.api('POST','/api/orders/'+existing.id+'/continuations',{
  target:'tow',summary:'Восстановление на месте невозможно, необходимо отправить отдельный эвакуатор'
 },tech.token));
 assert.equal((await t.api('POST','/api/orders',{
  service:'tow',zoneId:'spb',regionId:'spb',brand:'Renault',
  address:'Санкт-Петербург, Софийская улица, 60',
  destination:'Санкт-Петербург, Софийская улица, 70',
  description:'Эвакуация после ремонта',paymentMethod:'cash',cargo:'tractor',
  parallelWith:existing.id,parallelConsent:true,parallelCallOut:0,
  recommendationId:recommendation.id,
 },owner.token)).status,403,'unapproved recommendation cannot be used after migration');
 ok(await t.api('POST','/api/orders/'+existing.id+'/continuations/'+recommendation.id+'/decision',
  {approve:true},owner.token));
 const estimate=ok(await t.api('POST','/api/pricing/estimate',{
  service:'tow',zoneId:'spb',regionId:'spb',address:'Санкт-Петербург, Софийская улица, 60'
 }));
 const nextBody={
  service:'tow',zoneId:'spb',regionId:'spb',brand:'Renault',
  address:'Санкт-Петербург, Софийская улица, 60',
  destination:'Санкт-Петербург, Софийская улица, 70',
  description:'Эвакуация после ремонта',paymentMethod:'cash',cargo:'tractor',
  parallelWith:existing.id,parallelConsent:true,parallelCallOut:estimate.callOut,
  recommendationId:recommendation.id
 };
 const next=ok(await t.api('POST','/api/orders',nextBody,owner.token)).order;
 assert.equal(next.caseRootId,existing.id);
 assert.equal((await t.db.one<{continuation_recommendation_id:string}>(
  'select continuation_recommendation_id from orders where id=$1',[next.id])
 )?.continuation_recommendation_id,recommendation.id);
 assert.equal((await t.api('POST','/api/orders',nextBody,owner.token)).status,409,
  'the new unique index prevents an approval from being used twice');
 assert.equal((await t.db.query('select id from payments where order_id=$1',[existing.id])).length,0);
});
