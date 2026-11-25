import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {setup,ok,type T} from './helpers.ts';

let t:T,admin:{id:string;token:string},client:typeof admin,master:typeof admin,other:typeof admin;
before(async()=>{
  t=await setup();
  admin=await t.login('+79990000001');
  client=await t.login('+79997810801');
  master=await t.login('+79997810802','master');
  other=await t.login('+79997810803','master');
  for(const [u,name,lat] of [[master,'Первый',59.95],[other,'Второй',59.97]] as const){
    ok(await t.api('PUT','/api/performer/profile',{kind:'master',name,specialties:['electric']},u.token));
    ok(await t.api('POST',`/api/admin/performers/${u.id}/verify`,{decision:'approved'},admin.token));
    ok(await t.api('POST','/api/performer/line',{lineStatus:'online'},u.token));
    await t.db.query("update performer_profiles set lat=$2,lng=30.35,schedule='{\"on\":false}'::jsonb where user_id=$1",[u.id,lat]);
  }
});
after(()=>t?.close());
const search='/api/masters-nearby?service=electric&lat=59.95&lng=30.35';
const preview=async()=>ok(await t.api('GET',search,undefined,client.token));
async function reservation(status:string,offset:number){
  const start=new Date(t.clock.now().getTime()+offset*60_000);
  return (await t.db.one<any>(`insert into performer_time_reservations(performer_id,client_id,starts_at,ends_at,status,decision_at,decided_by)
    values($1,$2,$3,$4,$5,$6,$7) returning id`,[master.id,client.id,start,new Date(start.getTime()+30*60_000),status,
      status==='confirmed'?t.clock.now():null,status==='confirmed'?client.id:null]))!.id;
}
test('confirmed future booking excludes candidate from free count and preview but not online presence',async()=>{
  const initial=await preview();
  assert.equal(initial.online,2);
  assert.equal(initial.free,2);
  const proposed=await reservation('proposed',60);
  await reservation('confirmed',-120);
  assert.equal((await preview()).free,2);
  await t.db.query("update performer_time_reservations set status='confirmed',decision_at=$2,decided_by=$3 where id=$1",[proposed,t.clock.now(),client.id]);
  const reserved=await preview();
  assert.equal(reserved.online,2);
  assert.equal(reserved.free,1);
  assert.equal(reserved.match,1);
  assert.deepEqual(reserved.items.map((x:any)=>x.name),['Второй']);
  assert.ok(!('reserved' in reserved.items[0]));
  // The same non-expired reservation must exclude the closer colleague.
  const order=ok(await t.api('POST','/api/orders',{service:'electric',zoneId:'spb',lat:59.95,lng:30.35},client.token)).order;
  const nearby=ok(await t.api('GET','/api/performer/nearby',undefined,other.token));
  assert.equal(nearby.openNearby,1);
  assert.equal(nearby.ahead,0);
  await t.db.query("update performer_time_reservations set status='cancelled',cancelled_at=$2,cancellation_reason='Тест отмены записи' where id=$1",[proposed,t.clock.now()]);
  assert.equal((await preview()).free,2);
  assert.equal(ok(await t.api('GET','/api/performer/nearby',undefined,other.token)).ahead,1);
  ok(await t.api('POST',`/api/orders/${order.id}/cancel`,{reason:'Тест завершён'},client.token));
});
