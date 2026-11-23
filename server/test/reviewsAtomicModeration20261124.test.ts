import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setup,ok} from './helpers.ts';

test('reviews: failed event/audit roll back opinion and reputation; parallel orders serialise target rating', {timeout:60000},async()=>{
 const t=await setup();
 try{
  const owner=await t.login('+79996565001');
  const performer=await t.login('+79996565002','master');
  const admin=await t.login('+79990000001');
  const ids:string[]=[];
  for(let n=0;n<3;n++){
   const row=await t.db.one<{id:string}>(
    "insert into orders(client_id,created_by,performer_id,service,zone_id,status) "+
    "values ($1,$1,$2,'electric','spb','completed') returning id",
    [owner.id,performer.id]);
   assert.ok(row);
   ids.push(row.id);
  }
  const rating=async()=>t.db.one<{rating:string|null;rating_count:number}>(
   'select rating,rating_count from users where id=$1',[performer.id]);
  // Simulate one server component failing *after* the review INSERT.
  await t.db.exec(`create function reject_rating_event() returns trigger language plpgsql as $$
   begin if new.type='review' then raise exception 'injected event outage'; end if; return new; end $$;
   create trigger reject_rating_event before insert on order_events
   for each row execute function reject_rating_event();`);
  try{
   const attempt=await t.api('POST',`/api/orders/${ids[0]}/review`,{stars:5},owner.token);
   assert.notEqual(attempt.status,200,'event failure should abort review submission');
   assert.equal((await t.db.query('select id from reviews')).length,0);
   assert.equal((await rating())?.rating_count??0,0);
  }finally{
   await t.db.exec('drop trigger if exists reject_rating_event on order_events; drop function if exists reject_rating_event()');
  }
  ok(await t.api('POST',`/api/orders/${ids[0]}/review`,{stars:5},owner.token));
  assert.equal((await t.api('POST',`/api/orders/${ids[0]}/review`,
   {stars:5},owner.token)).status,409,'duplicate review remains unique');
  const parallel=await Promise.all([
   t.api('POST',`/api/orders/${ids[1]}/review`,{stars:1},owner.token),
   t.api('POST',`/api/orders/${ids[2]}/review`,{stars:3},owner.token),
  ]);
  assert.ok(parallel.every(x=>x.status===200),JSON.stringify(parallel));
  const reviews=await t.db.query<{id:string;hidden:boolean}>(
   'select id,hidden from reviews where target_id=$1 order by id',[performer.id]);
  assert.equal(reviews.length,3);
  assert.equal((await rating())?.rating_count,3,'parallel votes must not overwrite rating counts');
  assert.equal((await t.db.query(
   "select id from order_events where actor_id=$1 and type='review'",[owner.id])).length,3);

  await t.db.exec(`create function reject_rating_audit() returns trigger language plpgsql as $$
   begin if new.action='review.moderate' then raise exception 'injected audit outage'; end if;
   return new; end $$;
   create trigger reject_rating_audit before insert on audit_log
   for each row execute function reject_rating_audit();`);
  try{
   const failed=await t.api('POST',`/api/admin/reviews/${reviews[0].id}`,
    {hidden:true},admin.token);
   assert.notEqual(failed.status,200);
   assert.equal((await t.db.one<{hidden:boolean}>(
    'select hidden from reviews where id=$1',[reviews[0].id]))?.hidden,false);
   assert.equal((await rating())?.rating_count,3,'moderation failure must preserve old reputation');
  }finally{
   await t.db.exec('drop trigger if exists reject_rating_audit on audit_log; drop function if exists reject_rating_audit()');
  }
  ok(await t.api('POST',`/api/admin/reviews/${reviews[0].id}`,{hidden:true},admin.token));
  assert.equal((await rating())?.rating_count,2,'moderation and recompute commit together');
  assert.equal((await t.db.one<{hidden:boolean}>(
   'select hidden from reviews where id=$1',[reviews[0].id]))?.hidden,true);
 }finally{await t.close();}
});
