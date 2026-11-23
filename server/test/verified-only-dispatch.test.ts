import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {setup,ok,type T} from './helpers.ts';

let t:T,client:any,admin:any,approved:any,pending:any;
before(async()=>{
  t=await setup();
  admin=await t.login('+79990000001');
  client=await t.login('+79991110000');
  approved=await t.login('+79993339981','master');
  pending=await t.login('+79993339982','master');
  for(const [u,name] of [[approved,'Проверенный'],[pending,'Непроверенный']] as const){
    ok(await t.api('PUT','/api/performer/profile',{name,kind:'master',specialties:['electric']},u.token));
    ok(await t.api('POST','/api/performer/line',{lineStatus:'online'},u.token));
    ok(await t.api('POST','/api/performer/location',{lat:59.934,lng:30.335},u.token));
  }
  ok(await t.api('POST','/api/admin/performers/'+approved.id+'/verify',{decision:'approved'},admin.token));
});
after(()=>t.close());

test('client sees unverified masters without the filter, but only approved with it',async()=>{
  const all=ok(await t.api('GET','/api/masters-nearby?service=electric',undefined,client.token));
  assert.ok(all.items.some((x:any)=>x.verification!=='approved'),'unverified master hidden without consent');
  assert.ok(all.items.some((x:any)=>x.verification==='approved'),'approved master missing');
  assert.equal(all.items[0].verification,'approved','verified workers should rank first');
  const filtered=ok(await t.api('GET','/api/masters-nearby?service=electric&verifiedOnly=1',undefined,client.token));
  assert.ok(filtered.items.every((x:any)=>x.verification==='approved'));
  assert.ok(filtered.items.length>0);
});

test('verifiedOnly persists in order and excludes pending masters from the actual dispatch',async()=>{
  const placed=ok(await t.api('POST','/api/orders',{service:'electric',zoneId:'spb',verifiedOnly:true},client.token));
  assert.equal(placed.order.verifiedOnly,true);
  await t.app.orders.startDispatch(placed.order.id);
  const dispatch=await t.db.query<{user_id:string}>(
    "select d.performer_id as user_id from order_dispatch d where d.order_id=$1",[placed.order.id]);
  assert.ok(!dispatch.some(x=>x.user_id===pending.id),'pending partner was invited despite only-verified consent');
});

test('nearby counters share a real radius; unknown geography is explicitly nationwide',async()=>{
  const distant=ok(await t.api('GET',
    '/api/masters-nearby?service=electric&lat=55.75&lng=37.62',
    undefined,client.token));
  assert.equal(distant.scope,'nearby');
  assert.equal(distant.online,0,'distant city must not inflate local online counts');
  assert.equal(distant.free,0);
  assert.equal(distant.match,0);
  assert.equal(distant.items.length,0);
  const near=ok(await t.api('GET',
    '/api/masters-nearby?service=electric&lat=59.934&lng=30.335',
    undefined,client.token));
  assert.equal(near.scope,'nearby');
  assert.ok(near.online>=2);
  assert.ok(near.free>=2);
  assert.ok(near.match>=2);
  const unknown=ok(await t.api('GET','/api/masters-nearby?service=electric',
    undefined,client.token));
  assert.equal(unknown.scope,'network','unknown position must not claim one city');
  assert.equal(unknown.radiusKm,null);
});

test('explicit cheap sorting is applied across the full pool before truncation',async()=>{
  await t.db.query('update performer_profiles set call_out_price=$2 where user_id=$1',[approved.id,800_000]);
  await t.db.query('update performer_profiles set call_out_price=$2 where user_id=$1',[pending.id,100_000]);
  const recommended=ok(await t.api('GET',
    '/api/masters-nearby?service=electric&sort=recommended',undefined,client.token));
  assert.equal(recommended.items[0].verification,'approved','default search should promote verified');
  const cheap=ok(await t.api('GET',
    '/api/masters-nearby?service=electric&sort=cheap',undefined,client.token));
  assert.notEqual(cheap.items[0].verification,'approved','the explicit price sort must take precedence');
  assert.ok(cheap.items[0].callOut < cheap.items[1].callOut);
  const invalid=await t.api('GET','/api/masters-nearby?service=electric&sort=unknown',undefined,client.token);
  assert.equal(invalid.status,400);
});

test('explicit sort searches more than eight eligible masters before selecting a shortlist',async()=>{
  // Reproduce a network with nine verified expensive workers and two cheap
  // pending workers: the cheapest candidate starts OUTSIDE the old top-eight.
  await t.db.query('update performer_profiles set call_out_price=$2 where user_id=$1',
    [approved.id,900_000]);
  await t.db.query('update performer_profiles set call_out_price=$2 where user_id=$1',
    [pending.id,750_000]);
  for(let i=0;i<9;i++){
    const phone='+799933397'+String(i).padStart(2,'0');
    const account=await t.login(phone,'master');
    ok(await t.api('PUT','/api/performer/profile',{
      kind:'master',name:i===8?'СамыйДешёвый':'Дорогой'+i,
      specialties:['electric']
    },account.token));
    ok(await t.api('POST','/api/performer/line',{lineStatus:'online'},account.token));
    ok(await t.api('POST','/api/performer/location',{lat:59.934,lng:30.335},account.token));
    if(i<8)ok(await t.api('POST','/api/admin/performers/'+account.id+'/verify',
      {decision:'approved'},admin.token));
    await t.db.query('update performer_profiles set call_out_price=$2 where user_id=$1',
      [account.id,i===8?500:600_000+i*10_000]);
  }
  const base='/api/masters-nearby?service=electric&lat=59.934&lng=30.335';
  const rec=ok(await t.api('GET',base+'&sort=recommended',undefined,client.token));
  const cheap=ok(await t.api('GET',base+'&sort=cheap',undefined,client.token));
  assert.ok(rec.match>=11,'preview must evaluate every eligible worker before slicing');
  assert.equal(rec.items.length,8,'UI shortlist stays compact');
  assert.ok(rec.items.every((x:any)=>x.verification==='approved'),
    'default recommendations should prioritize verified candidates');
  assert.equal(cheap.items.length,8);
  assert.equal(cheap.items[0].name,'СамыйДешёвый',
    'cheapest pending master cannot vanish behind eight recommended candidates');
  assert.equal(cheap.items[0].verification!=='approved',true,
    'unverified worker remains eligible without verified-only filter');
  const restricted=ok(await t.api('GET',base+'&sort=cheap&verifiedOnly=1',
    undefined,client.token));
  assert.ok(restricted.items.every((x:any)=>x.verification==='approved'),
    'client opt-in must still remove pending masters even under explicit price sort');
});

test('paused, vacation and off-schedule masters cannot inflate the free counter',async()=>{
  const base='/api/masters-nearby?service=electric&lat=59.934&lng=30.335';
  const initial=ok(await t.api('GET',base,undefined,client.token));
  assert.ok(initial.free>=2);
  await t.db.query('update performer_profiles set paused=true where user_id=$1',[pending.id]);
  const paused=ok(await t.api('GET',base,undefined,client.token));
  assert.equal(initial.free-paused.free,1,'paused master incorrectly counted as free');
  await t.db.query('update performer_profiles set paused=false where user_id=$1',[pending.id]);

  await t.db.query(
    "update performer_profiles set extras=jsonb_set(coalesce(extras,'{}'::jsonb),'{vacation}','true'::jsonb) where user_id=$1",
    [pending.id]);
  const vacation=ok(await t.api('GET',base,undefined,client.token));
  assert.equal(initial.free-vacation.free,1,'master on vacation counted as free');
  await t.db.query("update performer_profiles set extras=extras-'vacation' where user_id=$1",[pending.id]);

  const off={on:true,days:{mon:false,tue:false,wed:false,thu:false,fri:false,sat:false,sun:false},
    from:'09:00',to:'18:00',phoneTo:'20:00'};
  await t.db.query('update performer_profiles set schedule=$2,off_schedule_until=null where user_id=$1',
    [pending.id,JSON.stringify(off)]);
  const offDuty=ok(await t.api('GET',base,undefined,client.token));
  assert.equal(initial.free-offDuty.free,1,'off-schedule master counted as free');
  assert.ok(offDuty.free>=offDuty.match,'matching count cannot exceed available count');
  await t.db.query('update performer_profiles set schedule=null where user_id=$1',[pending.id]);
});
