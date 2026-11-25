import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, ok, type T } from './helpers.ts';

let t:T;
let admin:{id:string;token:string};
let client:{id:string;token:string};
let favorite:{id:string;token:string};
let priority:{id:string;token:string};
let other:{id:string;token:string};
before(async()=>{
  t=await setup();
  admin=await t.login('+79990000001');
  client=await t.login('+79996660011');
  favorite=await t.login('+79996660012','master');
  priority=await t.login('+79996660013','master');
  other=await t.login('+79996660014');
  for(const [worker,name] of [[favorite,'Старый знакомый'],[priority,'Приоритетный']] as const) {
    ok(await t.api('PUT','/api/performer/profile',
      {kind:'master',name,specialties:['electric'],brands:{Scania:'excellent'},
       taxStatus:'self_employed',inn:'780000000001'},worker.token));
    ok(await t.api('POST','/api/admin/performers/'+worker.id+'/verify',
      {decision:'approved'},admin.token));
    ok(await t.api('POST','/api/performer/line',{lineStatus:'online'},worker.token));
  }
  ok(await t.api('POST','/api/admin/performers/'+priority.id+'/priority',
    {isPriority:true},admin.token));
  await t.db.query(
    "insert into orders(client_id,created_by,performer_id,service,zone_id,status,completed_at)" +
    " values($1,$1,$2,'electric','spb','completed',$3)",
    [client.id,favorite.id,t.clock.now()]);
});
after(()=>t.close());

const orderRequest={
  service:'electric',description:'Аккумулятор стартер',regionId:'spb',
  zoneId:'spb',address:'Санкт-Петербург, Софийская улица',paymentMethod:'cash',
};
test('repeat hire is invited first, even before global priority; it requires actual acceptance',async()=>{
  const past=ok(await t.api('GET','/api/my-performers',undefined,client.token));
  assert.ok(past.some((p:any)=>p.id===favorite.id&&p.jobs===1));
  const response=ok(await t.api('POST','/api/orders',
    {...orderRequest,preferredPerformerId:favorite.id},client.token));
  const id=response.order.id;
  assert.equal(response.order.status,'searching','invitation must not assign a worker');
  assert.equal(response.order.preferredPerformerId,favorite.id);
  const sent=await t.db.query<{performer_id:string;status:string}>(
    'select performer_id,status from order_dispatch where order_id=$1',[id]);
  assert.deepEqual(sent,[{performer_id:favorite.id,status:'ringing'}]);
  assert.equal((await t.api('POST','/api/orders/'+id+'/accept',{},priority.token)).status,409);
  ok(await t.api('POST','/api/orders/'+id+'/decline',{},favorite.token));
  const after=await t.db.query<{performer_id:string;status:string}>(
    'select performer_id,status from order_dispatch where order_id=$1 and performer_id=$2',[id,favorite.id]);
  assert.equal(after[0].status,'declined');
  assert.equal((await t.db.one<{status:string}>('select status from orders where id=$1',[id]))?.status,'searching');
});
test('arbitrary user cannot target an unrelated performer or bypass proof of past service',async()=>{
  const fake=await t.api('POST','/api/orders',
    {...orderRequest,preferredPerformerId:priority.id},client.token);
  assert.equal(fake.status,403);
  const stranger=await t.api('POST','/api/orders',
    {...orderRequest,preferredPerformerId:favorite.id},other.token);
  assert.equal(stranger.status,403);
});
