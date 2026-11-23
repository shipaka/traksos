import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, ok, type T } from './helpers.ts';

// Independent real HTTP/PostgreSQL admin reporting scenario on a disposable
// database. Never construct imaginary public pins or access production GPS.
let t:T;
let admin:{id:string;token:string},client:{id:string;token:string};

before(async()=>{
  t=await setup();
  admin=await t.login('+79990000001');
  client=await t.login('+79991234671','client');
  // A fresh disposable database may legitimately have NO published offer.
  // Consent is required only if an actual current revision exists.
  for(const audience of ['client','privacy']){
    const response=await t.api('GET','/api/offers/current/'+audience);
    assert.equal(response.status,200);
    if(response.body?.id)
      ok(await t.api('POST','/api/offers/'+response.body.id+'/accept',{},client.token));
  }
  // The shared fixture starts at a frozen future timestamp while PostgreSQL
  // uses its real clock for created_at; align these for real recent-demand SQL.
  t.clock.set(new Date().toISOString());
});
after(()=>t.close());

test('admin demand groups historical unmet requests by service and coarse zone only',async()=>{
  assert.equal((await t.api('GET','/api/admin/demand?days=30',undefined,client.token)).status,403,
    'demand history and counts must never be publicly accessible');
  const created=[];
  for(const [service,zoneId,regionId] of [
    ['electric','spb','spb'],['electric','gat','lo'],['tyre','spb','spb'],
  ] as const){
    const result=ok(await t.api('POST','/api/orders',{
      service,zoneId,regionId,paymentMethod:'cash',
      description:'TEST ONLY geographic supply-demand evidence'
    },client.token));
    const id=result.order?.id;
    assert.ok(id,'real order ID required for demand evidence');
    created.push({id,service,zoneId});
  }
  // The disposable DB moves two real created orders to a terminal state,
  // leaving one successfully-created service request without an absence
  // event. The aggregate must NOT invent a shortage for the third.
  await t.db.query("update orders set status='no_performer' where id=any($1::uuid[])",[
    [created[0].id,created[1].id]]);
  const data=ok(await t.api('GET','/api/admin/demand?days=30',undefined,admin.token));
  assert.ok(Array.isArray(data.byServiceZone));
  const rows=data.byServiceZone;
  assert.deepEqual(rows.map((r:any)=>({
    service:r.service,zone_id:r.zone_id,unfilled:r.unfilled,total:r.total
  })),[
    {service:'electric',zone_id:'gat',unfilled:1,total:1},
    {service:'electric',zone_id:'spb',unfilled:1,total:1}
  ].sort((a,b)=>a.service.localeCompare(b.service)||a.zone_id.localeCompare(b.zone_id)),
  'only actual unfilled demand may be used to prioritize partner recruitment');
  for(const row of rows){
    assert.deepEqual(Object.keys(row).sort(),
      ['service','zone_id','total','unfilled'].sort(),
      'the grouped report must not expose addresses, phone numbers or coordinates');
  }
});
