import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setup,ok} from './helpers.ts';

test('admin registry filters the full case set before paging and includes legacy workshop stages', {timeout:60000},async()=>{
  const t=await setup();
  try{
    const admin=await t.login('+79990000001');
    const client=await t.login('+79997809421');
    const station=await t.login('+79997809422','service');
    const root=ok(await t.api('POST','/api/orders',{
      service:'electric',zoneId:'spb',description:'Старое открытое обращение'
    },client.token)).order;
    const legacy=ok(await t.api('POST','/api/orders',{
      service:'electric',zoneId:'spb',description:'Старая связанная запись'
    },client.token)).order;
    // The dispatch fixture has no workers; an ordinary fresh order can become
    // no_performer immediately. Establish an explicit ongoing owner-approval
    // state before testing the administrative read model, not dispatch.
    await t.db.query("update orders set status='awaiting_owner',created_at='2026-01-01T00:00:00Z' where id=$1",[root.id]);
    assert.equal((await t.db.one<{status:string}>('select status from orders where id=$1',[root.id]))?.status,'awaiting_owner');
    await t.db.query("update orders set status='completed',created_at='2026-01-02T00:00:00Z' where id=$1",[legacy.id]);
    const center=ok(await t.api('PUT','/api/base',{
      name:'Тестовая станция',address:'Санкт-Петербург, Тестовая улица, 1',
      staff:{electric:'own'},accepts:['quick','long']
    },station.token)).center;
    ok(await t.api('POST','/api/admin/services/'+center.id+'/verify',{decision:'approved'},admin.token));
    const booking=ok(await t.api('POST','/api/services/'+center.id+'/book',{
      need:'electric',day:'2026-12-02',arrival:'self'
    },client.token));
    // Historical referral shape; no production migration or billing.
    await t.db.query('update service_bookings set from_order_id=$2,case_root_id=null where id=$1',[booking.id,legacy.id]);
    await t.db.query("insert into audit_log(actor_id,action,target,data) values($1,'order.resolve',$2,'{}'::jsonb)",[admin.id,legacy.id]);
    // Use real migrated order defaults and a real API-created source fixture.
    // Newer completed roots must not crowd out old matching cases.
    await t.db.query(`insert into orders(client_id,created_by,vehicle_id,service,is_sos,problem,description,address,lat,lng,
      zone_id,night,group_trip,tier,brand,estimate,payment_method,client_fee_pct,destination,cargo,loaded,driver_on_site,
      discount_amount,discount_reason,model,year,site,status,owner_note,
      commission_pct_override,location_region,verified_only,created_at)
      select client_id,created_by,vehicle_id,service,is_sos,problem,description,address,lat,lng,
      zone_id,night,group_trip,tier,brand,estimate,payment_method,client_fee_pct,destination,cargo,loaded,driver_on_site,
      discount_amount,discount_reason,model,year,site,'completed',owner_note,
      commission_pct_override,location_region,verified_only,'2026-11-01T00:00:00Z'::timestamptz
      from orders cross join generate_series(1,501) where id=$1`,[root.id]);
    const endpoint='/api/admin/cases';
    const get=async(suffix='')=>ok(await t.api('GET',endpoint+suffix,undefined,admin.token));
    const old=await get('?scope=active');
    assert.ok(old.some((x:any)=>x.id===root.id));
    assert.ok(old.some((x:any)=>x.id===legacy.id&&x.workshop_count===1));
    const active=await get('?scope=active&limit=1');
    assert.equal(active.items.length,1);
    assert.equal(active.hasMore,true);
    const next=await get('?scope=active&limit=1&before='+active.nextBefore);
    assert.notEqual(active.items[0].id,next.items[0].id);
    assert.equal(next.hasMore,false);
    assert.deepEqual(new Set([active.items[0].id,next.items[0].id]),new Set([root.id,legacy.id]));
    const moderated=await get('?scope=moderated&limit=10');
    assert.equal(moderated.items.length,1);
    assert.equal(moderated.items[0].id,legacy.id);
    const detail=await get('/'+legacy.id);
    assert.equal(detail.bookings.filter((x:any)=>x.id===booking.id).length,1);
    assert.equal(detail.multi,true);
    const number=detail.bookings[0].number;
    const searched=await get('?limit=100&q='+number);
    assert.ok(searched.items.some((x:any)=>x.id===legacy.id));
    const csv=await get('/'+legacy.id+'/export');
    assert.match(csv.csv,/СТО \(свод, не первичный документ\)/);
    const first=await get('?scope=closed&limit=100');
    const second=await get('?scope=closed&limit=100&before='+first.nextBefore);
    assert.equal(first.items.length,100);assert.equal(second.items.length,100);
    assert.equal(new Set([...first.items,...second.items].map((x:any)=>x.id)).size,200);
    assert.equal((await t.api('GET',endpoint+'?limit=0',undefined,admin.token)).status,400);
    assert.equal((await t.api('GET',endpoint+'?limit=10&before=bad',undefined,admin.token)).status,400);
    assert.equal((await t.api('GET',endpoint+'?limit=10',undefined,client.token)).status,403);
  }finally{await t.close();}
});
