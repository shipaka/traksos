import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setup,ok} from './helpers.ts';

test('insurer and admin queues count all scoped rows and do not hide older active requests',{timeout:60000},async()=>{
 const t=await setup();
 try{
  const admin=await t.login('+79990000001');
  const client=await t.login('+79997809501');
  const insurer=await t.login('+79997809502','insurer');
  const other=await t.login('+79997809503','insurer');
  const vehicle=async(plate:string)=>ok(await t.api('POST','/api/vehicles',{
    brand:'DAF',model:'XF',year:2016,plate
  },client.token)).id;
  const truck=await vehicle('А501АА178');
  const second=await vehicle('А502АА178');
  const foreign=await vehicle('А503АА178');
  const insert=async(car:string,assigned:string,kind:string,stage:string|null)=>{
    const row=await t.db.one<{id:string}>(`insert into vehicle_service_requests
      (owner_id,requested_by,vehicle_id,kind,assigned_to,status,insurance_stage,created_at)
      values($1,$1,$2,$3,$4,'sent_to_partner',$5,'2026-01-01T00:00:00Z') returning id`,
      [client.id,car,kind,assigned,stage]);
    return row!.id;
  };
  const old=await insert(truck,insurer.id,'insurance','received');
  const preparing=await insert(second,insurer.id,'insurance','preparing');
  const outsider=await insert(foreign,other.id,'insurance','received');
  const inspection=await insert(truck,insurer.id,'inspection',null);
  await t.db.query(`insert into vehicle_service_requests
    (owner_id,requested_by,vehicle_id,kind,assigned_to,status,created_at)
    select $1,$1,$2,'insurance',$3,'completed','2026-11-01T00:00:00Z'::timestamptz
    from generate_series(1,205)`,[client.id,truck,insurer.id]);
  const endpoint='/api/insurer/requests/page',staff='/api/admin/vehicle-service-requests/page';
  const get=async(path:string,token=insurer.token)=>ok(await t.api('GET',path,undefined,token));
  const active=await get(endpoint);
  assert.equal(active.active,2);assert.equal(active.history,205);
  assert.deepEqual(active.stages,{received:1,preparing:1});
  assert.deepEqual(new Set(active.items.map((x:any)=>x.id)),new Set([old,preparing]));
  assert.ok(active.items.every((x:any)=>!('insurance_details' in x)));
  const pages=[];
  for(let page=1;page<=7;page++){
    const r=await get(endpoint+'?view=history&page='+page);
    assert.equal(r.history,205);pages.push(...r.items.map((x:any)=>x.id));
  }
  assert.equal(pages.length,205);assert.equal(new Set(pages).size,205);
  const found=await get(endpoint+'?q='+encodeURIComponent('А502АА178'));
  assert.equal(found.active,1);assert.equal(found.history,0);
  assert.equal(found.items[0].id,preparing);
  const noForeign=await get(endpoint+'?q='+outsider);
  assert.equal(noForeign.active,0);assert.deepEqual(noForeign.items,[]);
  const ownOther=await get(endpoint,other.token);
  assert.equal(ownOther.active,1);assert.equal(ownOther.items[0].id,outsider);
  const all=await get(staff,admin.token);
  assert.equal(all.active,4);assert.equal(all.history,205);
  const inspections=await get(staff+'?kind=inspection',admin.token);
  assert.equal(inspections.active,1);assert.equal(inspections.items[0].id,inspection);
  const insurance=await get(staff+'?kind=insurance',admin.token);
  assert.equal(insurance.active,3);assert.equal(insurance.history,205);
  assert.equal((await t.api('GET',staff,undefined,insurer.token)).status,403);
  assert.equal((await t.api('GET',endpoint,undefined,client.token)).status,403);
  assert.equal((await t.api('GET',endpoint+'?page=0',undefined,insurer.token)).status,400);
  assert.equal((await t.api('GET',endpoint+'?view=unknown',undefined,insurer.token)).status,400);
  const legacy=await get('/api/insurer/requests');
  assert.ok(Array.isArray(legacy));assert.equal(legacy.length,100);
  assert.equal((await get('/api/admin/vehicle-service-requests',admin.token)).length,200);
 }finally{await t.close();}
});
