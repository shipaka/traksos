import test from 'node:test';
import assert from 'node:assert/strict';
import { PublicVehicleDirectory, categoriesForActor } from '../src/services/publicVehicleDirectory.ts';
import { VehicleTechnicalLibrary } from '../src/services/vehicleTechnicalLibrary.ts';
import { VehicleHelpAvailability } from '../src/services/vehicleHelpAvailability.ts';
import { setup } from './helpers.ts';

const client={id:'client',roles:['client'],owner_id:null,status:'active'} as any;
const master={id:'master',roles:['master'],owner_id:null,status:'active'} as any;
const dual={id:'dual',roles:['admin','master'],owner_id:null,status:'active'} as any;

test('real pinned CC-BY directory has truck, van, bus and passenger models',async()=>{
  const dir=new PublicVehicleDirectory();
  const info=await dir.metadata();
  assert.equal(info.source,'VehiclesDB');
  assert.equal(info.version,'2026.11.11');
  assert.ok(info.count>=8000);
  const evidence=await dir.truckEvidence(client,'garage','renault','premium');
  assert.equal(evidence.category,'truck');
  assert.equal(evidence.applicabilityVerified,false);
  assert.ok(evidence.registrationEvidence?.notProductionYears!==false);
  const manTgx=await dir.truckEvidence(client,'garage','man','tgx');
  assert.equal(manTgx.production?.yearFrom,2007);
  assert.equal(manTgx.applicabilityVerified,false);
  const renaultAe=await dir.truckEvidence(client,'garage','renault','ae');
  assert.ok(renaultAe.registrationEvidence?.firstRegistrationObserved);
  assert.equal(renaultAe.registrationEvidence?.notProductionYears,true);
  await assert.rejects(dir.truckEvidence(client,'garage','renault','fake-model'),/подтверждённого каталога/);
  assert.equal(info.attribution.license,'CC BY 4.0');
  const makes=await dir.makes(client,'garage','Renault',false,'truck');
  assert.ok(makes.items.some((m)=>m.key==='renault'&&m.category==='truck'));
  const cars=await dir.makes(master,'master','Lada',false,'passenger');
  assert.ok(cars.items.some((m)=>m.key==='lada'));
  const model=await dir.models(client,'garage','truck','renault','premium');
  assert.ok(model.items.some((m)=>m.key==='premium'&&m.name==='Premium'));
  assert.equal((await dir.resolve('truck','renault','premium')).partsFitmentVerified,false);
  await assert.rejects(dir.resolve('truck','renault','not-a-real-model'),/подтверждённого каталога/);
  assert.deepEqual(await dir.exactGarageMatch(client,'  RENAULT  ','premium'),{
    status:'exact',selection:{category:'truck',brandKey:'renault',modelKey:'premium'}});
  assert.deepEqual(await dir.exactGarageMatch(client,'Renault','premium-unknown'),{status:'unmatched',selection:null});
  await assert.rejects(dir.exactGarageMatch(master,'Renault','Premium'),/Гараж/);
  await assert.rejects(dir.models(client,'garage','passenger','lada'),/Категория транспорта/);
  assert.ok(categoriesForActor(dual,'master',true).includes('truck'));
});

test('technical OEM links are verified master/service only; ordinary users see safe reminders',async()=>{
  const db:any={one:async()=>({roles:['client','master','admin'],repair_approved:true,workshop_approved:false}),query:async()=>[]};
  const library=new VehicleTechnicalLibrary(db);
  const tips=await library.tips(client);
  assert.ok(tips.items.length>=5);
  assert.ok(tips.items.every((t)=>!('url'in t)&&!('rights'in t)));
  await assert.rejects(library.professional(client),/подтверждённым мастерам/);
  await assert.rejects(library.professional(master,{category:'passenger'}),/только грузового транспорта/);
  const resource=await library.professional(master,{make:'volvo'});
  assert.ok(resource.links.some((r)=>r.url.startsWith('https://www.volvotrucks')));
  assert.ok(resource.links.every((l)=>l.rights==='LINK_ONLY'||l.kind==='educational_diagram'));
  assert.ok(resource.links.some((l)=>l.rights==='LINK_ONLY'));
  assert.ok(!resource.links.some((l)=>l.sourceStatus==='hold_upstream'));
  const admin=await library.professional(dual);
  assert.ok(admin.links.length>=20);
  assert.ok(admin.links.every((r)=>r.sourceStatus!=='hold_upstream'));
  assert.ok(admin.links.every((r)=>r.vehicleClasses?.includes('truck')||r.vehicleClasses?.includes('trailer')));
  const manGuides=await library.professional(master,{category:'truck',q:'TGX'});
  assert.ok(manGuides.links.some((r)=>r.id==='man-manted'));
  const trailers=await library.professional(master,{category:'trailer',q:'BPW'});
  assert.ok(trailers.links.some((r)=>r.id==='bpw-downloads'));
  assert.ok(!trailers.links.some((r)=>r.id==='scania-bodybuilder'));
  assert.ok(!admin.links.some((r)=>r.id==='commons-diesel-scr'));
  assert.ok(admin.links.some((r)=>r.kind==='educational_diagram'&&r.author&&r.licenseUrl));
  const blocked=new VehicleTechnicalLibrary({
    one:async()=>({roles:['master'],repair_approved:false,workshop_approved:false}),query:async()=>[],
  } as any);
  await assert.rejects(blocked.professional(master),/подтверждённым мастерам/);
});

test('no local GPS or offline/old/busy performer means no advertising a nearby specialist',async()=>{
  const settings:any={all:async()=>({dispatch:{radiusKm:60}})};
  const now=()=>new Date('2026-11-17T18:00:00.000Z');
  const rows=[
    {kind:'master',specialties:['electric'],verification:'approved',line_status:'online',
      user_status:'active',lat:59.94,lng:30.31,location_at:'2026-11-17T17:59:00Z',
      paused:false,extras:null,brands:{},schedule:null,off_schedule_until:null,busy:false},
    {kind:'master',specialties:['electric'],verification:'approved',line_status:'online',
      user_status:'active',lat:52.5,lng:30.31,location_at:'2026-11-17T17:59:00Z',
      paused:false,extras:null,brands:{},schedule:null,off_schedule_until:null,busy:false},
  ];
  const db:any={query:async()=>rows};
  const svc=new VehicleHelpAvailability(db,settings,now);
  assert.equal((await svc.nearby(client,{service:'electric'})).canRecommend,false);
  const good=await svc.nearby(client,{service:'electric',lat:59.93,lng:30.30});
  assert.equal(good.canRecommend,true);
  assert.equal(good.count,1);
  assert.equal(good.etaAvailable,false);
  assert.equal(good.metric,'straight_line_km');
  rows[0].busy=true;
  assert.equal((await svc.nearby(client,{service:'electric',lat:59.93,lng:30.30})).count,0);
});

test('integrated strict garage / missing-model queue / admin review and data separation',async()=>{
  const t=await setup();
  try{
    const owner=await t.login('+79990002001','client');
    const admin=await t.login('+79990000001');
    const meta=await t.api('GET','/api/vehicle-reference/meta');
    assert.equal(meta.status,200);
    assert.ok(meta.body.count>=8000);
    const makes=await t.api('GET','/api/vehicle-reference/makes?purpose=garage&category=truck&q=Renault',undefined,owner.token);
    assert.equal(makes.status,200);
    assert.ok(makes.body.items.some((m:any)=>m.key==='renault'));
    const add=await t.api('POST','/api/vehicle-reference/vehicles',{
      category:'truck',brandKey:'renault',modelKey:'premium',year:2010,plate:'А111АА178',
    },owner.token);
    assert.equal(add.status,200,JSON.stringify(add.body));
    assert.equal(add.body.brand,'Renault');
    assert.equal(add.body.model,'Premium');
    const stored=await t.db.one<any>('select catalog_brand_key,catalog_model_key,catalog_source_version from vehicles where id=$1',[add.body.id]);
    assert.equal(stored?.catalog_model_key,'premium');
    assert.equal(stored?.catalog_source_version,'2026.11.11');
    assert.equal((await t.api('POST','/api/vehicle-reference/vehicles',{
      category:'truck',brandKey:'renault',modelKey:'fake-unknown-model',
    },owner.token)).status,400);
    const request=await t.api('POST','/api/vehicle-reference/missing',{
      purpose:'garage',category:'truck',make:'NEW TRUCK',model:'SERIES-X',year:2023,note:'not available in known list',
    },owner.token);
    assert.equal(request.status,200,JSON.stringify(request.body));
    assert.ok(request.body.id);
    const duplicate=await t.api('POST','/api/vehicle-reference/missing',{
      purpose:'garage',category:'truck',make:'NEW TRUCK',model:'SERIES-X',year:2023,
    },owner.token);
    assert.equal(duplicate.status,409);
    const queueDenied=await t.api('GET','/api/admin/vehicle-reference/missing',undefined,owner.token);
    assert.equal(queueDenied.status,403);
    const queue=await t.api('GET','/api/admin/vehicle-reference/missing',undefined,admin.token);
    assert.equal(queue.status,200);
    assert.ok(queue.body.some((x:any)=>x.id===request.body.id));
    const approved=await t.api('PATCH','/api/admin/vehicle-reference/missing/'+request.body.id,
      {status:'accepted',note:'Follow up with authoritative license and revision approval'},admin.token);
    assert.equal(approved.status,200);
    assert.equal(approved.body.catalogUpdated,false);
    const none=await t.api('POST','/api/vehicle-reference/vehicles',{
      category:'truck',brandKey:'new-truck',modelKey:'series-x',
    },owner.token);
    assert.equal(none.status,400,'Moderation acceptance never auto-adds invented models');
    assert.equal((await t.api('GET','/api/vehicle-reference/professional',undefined,owner.token)).status,403);
    assert.equal((await t.api('GET','/api/vehicle-reference/professional',undefined,admin.token)).status,403);
    const attribution=await t.api('GET','/api/vehicle-reference/attribution');
    // Raw markdown is deliberately not JSON; verify the response code only.
    assert.equal(attribution.status,200);
  }finally{await t.close();}
});

test('legacy TechBase API requires verified specialist for both audiences',async()=>{
  const t=await setup();
  try{
    const master=await t.login('+79990002021','master');
    const service=await t.login('+79990002022','service');
    for(const actor of [master,service]){
      for(const audience of ['driver','master']){
        const denied=await t.api('GET','/api/techbase?audience='+audience,undefined,actor.token);
        assert.equal(denied.status,403,'fresh specialist must not read '+audience);
      }
      await t.db.query("update performer_profiles set verification='approved' where user_id=$1",[actor.id]);
      const profile=await t.db.one<any>('select verification from performer_profiles where user_id=$1',[actor.id]);
      assert.equal(profile?.verification,'approved','test fixture must have a verified specialist profile');
      const granted=await t.api('GET','/api/techbase?audience=master',undefined,actor.token);
      assert.equal(granted.status,200,JSON.stringify(granted.body));
      assert.ok(granted.body.documents?.length);
      assert.ok(granted.body.documents.every((d:any)=>d.audience==='master'));
    }
  }finally{await t.close();}
});

test('parallel missing-model submissions respect the per-account daily quota',async()=>{
  const t=await setup();
  try{
    const owner=await t.login('+79990002031','client');
    const other=await t.login('+79990002032','client');
    const propose=(token:string,i:number)=>t.api('POST','/api/vehicle-reference/missing',{
      purpose:'garage',category:'truck',make:'Parallel Truck',model:'Series '+i,
    },token);
    const results=await Promise.all(Array.from({length:12},(_,i)=>propose(owner.token,i)));
    assert.equal(results.filter(r=>r.status===200).length,5,JSON.stringify(results.map(r=>r.status)));
    assert.equal(results.filter(r=>r.status===409).length,7);
    const own=await t.api('GET','/api/vehicle-reference/missing/mine',undefined,owner.token);
    assert.equal(own.status,200);
    assert.equal(own.body.length,5);
    const independent=await propose(other.token,0);
    assert.equal(independent.status,200);
    const otherRows=await t.api('GET','/api/vehicle-reference/missing/mine',undefined,other.token);
    assert.equal(otherRows.status,200);
    assert.equal(otherRows.body.length,1);
    assert.ok(!own.body.some((r:any)=>r.id===independent.body.id));
  }finally{await t.close();}
});

test('legacy catalog link preserves identity and access, audits once, and clears stale keys',async()=>{
  const t=await setup();
  try{
    const owner=await t.login('+79990002041','client');
    const other=await t.login('+79990002042','client');
    const driver=await t.login('+79990002043','client');
    const legacy=await t.api('POST','/api/vehicles',{
      brand:'Renault',model:'Premium',year:2010,plate:'А123АА178',
    },owner.token);
    assert.equal(legacy.status,200,JSON.stringify(legacy.body));
    const id=legacy.body.id;
    await t.db.query('update vehicles set vin=$2 where id=$1',[id,'VF611111111111111']);
    const qr=legacy.body.qr_code;
    assert.ok(qr);
    assert.equal((await t.api('POST','/api/qr/'+qr+'/join',{},driver.token)).status,200);
    const matchUrl='/api/vehicle-reference/vehicles/'+id+'/match';
    assert.equal((await t.api('GET',matchUrl,undefined,other.token)).status,404);
    const specialist=await t.login('+79990002044','master');
    assert.equal((await t.api('GET',matchUrl,undefined,specialist.token)).status,403);
    const unassigned=await t.login('+79990002045','client');
    await t.db.query("update users set owner_id=$2,roles='{driver}'::text[] where id=$1",[unassigned.id,owner.id]);
    assert.equal((await t.api('GET',matchUrl,undefined,unassigned.token)).status,404);
    assert.equal((await t.api('POST','/api/vehicle-reference/vehicles',{
      category:'truck',brandKey:'renault',modelKey:'premium',year:2010
    },unassigned.token)).status,403);
    for(const actor of [owner,driver]){
      const match=await t.api('GET',matchUrl,undefined,actor.token);
      assert.equal(match.status,200);
      assert.equal(match.body.status,'exact');
      assert.deepEqual(match.body.selection,{category:'truck',brandKey:'renault',modelKey:'premium'});
      assert.ok(!('vin' in match.body));
      assert.ok(!('plate' in match.body));
    }
    const url='/api/vehicle-reference/vehicles/'+id+'/catalog';
    const choice={category:'truck',brandKey:'renault',modelKey:'premium'};
    assert.equal((await t.api('PATCH',url,choice,other.token)).status,404);
    assert.equal((await t.api('PATCH',url,choice,driver.token)).status,403);
    assert.equal((await t.api('PATCH',url,{category:'truck',brandKey:'man',modelKey:'tgx'},owner.token)).status,409);
    assert.equal((await t.api('PATCH',url,{...choice,modelKey:'not-a-real-model'},owner.token)).status,400);
    const concurrent=await Promise.all(Array.from({length:4},()=>t.api('PATCH',url,choice,owner.token)));
    for(const r of concurrent){
      assert.equal(r.status,200,JSON.stringify(r.body));
      assert.equal(r.body.id,id);
      assert.equal(r.body.brand,'Renault');
      assert.equal(r.body.model,'Premium');
      assert.equal(r.body.year,2010);
      assert.equal(r.body.plate,'А123АА178');
      assert.equal(r.body.vin,'VF611111111111111');
      assert.equal(r.body.driver_id,driver.id);
      assert.equal(r.body.qr_code,qr);
      assert.equal(r.body.catalog_model_key,'premium');
    }
    const audit=await t.db.one<{count:number}>(
      "select count(*)::int as count from audit_log where action='vehicle.catalog_linked' and target=$1",[id]);
    assert.equal(audit?.count,1);
    const driverList=await t.api('GET','/api/vehicles',undefined,driver.token);
    assert.equal(driverList.body[0].catalog_model_key,'premium');
    // An unrelated update must not detach the confirmed catalog.
    await t.db.query('update vehicles set year=2011 where id=$1',[id]);
    assert.equal((await t.db.one<any>('select catalog_model_key from vehicles where id=$1',[id]))?.catalog_model_key,'premium');
    // A legacy on-site identity correction must never leave a wrong manual/photo.
    await t.db.query("update vehicles set brand='MAN',model='TGX' where id=$1",[id]);
    const corrected=await t.db.one<any>('select * from vehicles where id=$1',[id]);
    assert.equal(corrected.catalog_category,null);
    assert.equal(corrected.catalog_brand_key,null);
    assert.equal(corrected.catalog_model_key,null);
    assert.equal(corrected.catalog_source_version,null);
    assert.equal(corrected.vin,'VF611111111111111');
    assert.equal(corrected.driver_id,driver.id);
    assert.equal((await t.api('PATCH',url,choice,owner.token)).status,409);
    const relink=await t.api('PATCH',url,{category:'truck',brandKey:'man',modelKey:'tgx'},owner.token);
    assert.equal(relink.status,200,JSON.stringify(relink.body));
    assert.equal(relink.body.catalog_model_key,'tgx');
  }finally{await t.close();}
});
