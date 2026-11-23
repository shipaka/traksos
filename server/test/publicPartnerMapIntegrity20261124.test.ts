// Public map trust boundary: stationary SТО partner only, verified location + later opt-in.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, ok } from './helpers.ts';
const phone=(n:number)=>'+7999777'+String(n).padStart(4,'0');

test('Public partner map: verified geo evidence must PRECEDE explicit current consent',async()=>{
  const t=await setup();
  try{
    const station=await t.login(phone(4301),'service');
    const id=await t.db.one<{id:string}>(`
      insert into service_centers(owner_id,name,address,lat,lng,verification,
        accepts_confirmed_at,public_map_location_verified_at,public_map_opt_in,public_map_opted_at)
      values ($1,'СТО тест +7 999 123-45-67','Санкт-Петербург, Тестовая 1',59.94,30.31,
        'approved',now(),null,false,null)
      on conflict(owner_id) do update set name=excluded.name,address=excluded.address,
        lat=excluded.lat,lng=excluded.lng,verification='approved',
        accepts_confirmed_at=now(),public_map_location_verified_at=null,
        public_map_opt_in=false,public_map_opted_at=null
      returning id`,[station.id]);
    assert.ok(id?.id);
    const publicList=()=>t.api('GET','/api/public/partner-map');
    assert.equal(ok(await publicList()).points.length,0,'an unreviewed location must be private');
    assert.equal((await t.api('PUT','/api/service/public-map',
      {enabled:true},station.token)).status,400,'ordinary business approval is insufficient');
    // Simulate a legacy/invalid opt-in with no location evidence.
    await t.db.query(`update service_centers
      set public_map_opt_in=true,public_map_opted_at=now() where id=$1`,[id.id]);
    assert.equal(ok(await publicList()).points.length,0,'legacy opt-in without proof is not public');
    // Evidence newer than opt-in: a stale prior consent must not publish it.
    await t.db.query(`update service_centers
      set public_map_location_verified_at=now()+interval '1 hour' where id=$1`,[id.id]);
    assert.equal(ok(await publicList()).points.length,0,'future proof timestamps are not valid evidence');
    await t.db.query(`update service_centers
      set public_map_location_verified_at=now(),
          public_map_opted_at=now()-interval '1 day'
      where id=$1`,[id.id]);
    assert.equal(ok(await publicList()).points.length,0,'old consent before geo review must not publish');
    // Genuine separate proof, then fresh opt-in as the owner.
    await t.db.query(`update service_centers
      set public_map_location_verified_at=now()-interval '1 minute',
          public_map_opt_in=false,public_map_opted_at=null where id=$1`,[id.id]);
    const consent=ok(await t.api('PUT','/api/service/public-map',
      {enabled:true},station.token));
    assert.equal(consent.enabled,true);
    const visible=ok(await publicList());
    assert.equal(visible.source,'verified_stationary_opt_in');
    assert.equal(visible.points.length,1);
    assert.equal(visible.points[0].id,id.id);
    assert.equal(visible.points[0].kind,'service');
    assert.equal(visible.points[0].lat,59.94);
    assert.equal(visible.points[0].lng,30.31);
    assert.ok(!visible.points[0].name.includes('123-45-67'),
      'unwanted contact details in station name must not appear publicly');
    // User can withdraw consent immediately, no approval needed.
    ok(await t.api('PUT','/api/service/public-map',{enabled:false},station.token));
    assert.equal(ok(await publicList()).points.length,0);
  }finally{await t.close();}
});

test('Public partner map: status, role, weekly availability and coordinates are LIVE gates',async()=>{
  const t=await setup();
  try{
    const station=await t.login(phone(4302),'service');
    const center=await t.db.one<{id:string}>(`
      insert into service_centers(owner_id,name,address,lat,lng,verification,
        accepts_confirmed_at,public_map_location_verified_at,public_map_opt_in,public_map_opted_at)
      values ($1,'Сервис тест','Санкт-Петербург, Тестовая 2',59.95,30.35,'approved',
        now(),now()-interval '1 minute',true,now())
      on conflict(owner_id) do update set name=excluded.name,address=excluded.address,
        lat=excluded.lat,lng=excluded.lng,verification='approved',
        accepts_confirmed_at=now(),public_map_location_verified_at=now()-interval '1 minute',
        public_map_opt_in=true,public_map_opted_at=now()
      returning id`,[station.id]);
    assert.ok(center?.id);
    const list=async()=>ok(await t.api('GET','/api/public/partner-map')).points as any[];
    assert.equal((await list()).length,1);
    await t.db.query(`update service_centers set accepts_confirmed_at=now()-interval '8 days' where id=$1`,[center.id]);
    assert.equal((await list()).length,0,'expired operating-hours confirmation removes public pin');
    assert.equal((await t.api('PUT','/api/service/public-map',{enabled:true},station.token)).status,400);
    await t.db.query(`update service_centers set accepts_confirmed_at=now(),lat=null where id=$1`,[center.id]);
    assert.equal((await list()).length,0,'missing latitude never creates a point');
    await t.db.query(`update service_centers set lat=59.95,paused=true where id=$1`,[center.id]);
    assert.equal((await list()).length,0,'paused station must be hidden');
    await t.db.query(`update service_centers set paused=false where id=$1`,[center.id]);
    await t.db.query("update users set roles=array['client']::text[] where id=$1",[station.id]);
    assert.equal((await list()).length,0,'former service role is not a current public partner');
    assert.equal((await t.api('PUT','/api/service/public-map',{enabled:true},station.token)).status===200,
      false,'role revoked in DB cannot renew opt-in');
    await t.db.query("update users set roles=array['service']::text[] where id=$1",[station.id]);
    await t.db.query("update users set status='blocked' where id=$1",[station.id]);
    assert.equal((await list()).length,0,'blocked partner cannot remain on public map');
  }finally{await t.close();}
});
