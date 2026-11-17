import test from 'node:test';
import assert from 'node:assert/strict';
import { PublicVehicleDirectory } from '../src/services/publicVehicleDirectory.ts';
import { publicVehicleCard,publicRecoveryGallery,vehicleOwnerShelf } from '../src/services/vehicleOwnerShelf.ts';
import { VehicleTechnicalLibrary } from '../src/services/vehicleTechnicalLibrary.ts';
import { setup } from './helpers.ts';

const client={id:'client',status:'active',roles:['client'],owner_id:null} as any;
const tow={id:'tow',status:'active',roles:['tow'],owner_id:null} as any;
const master={id:'master',status:'active',roles:['master'],owner_id:null} as any;
const service={id:'service',status:'active',roles:['service'],owner_id:null} as any;
const admin={id:'admin',status:'active',roles:['admin'],owner_id:null} as any;

test('heavy trailer/real truck additions have stable sourced catalog keys',async()=>{
  const dir=new PublicVehicleDirectory();
  const tr=await dir.makes(client,'garage','',false,'trailer');
  for(const key of ['schmitz-cargobull','krone','grunwald','koegel'])
    assert.ok(tr.items.some(x=>x.key===key),key);
  const gr=await dir.models(client,'garage','trailer','grunwald');
  assert.ok(gr.items.some(x=>x.key==='gr-cs'));
  assert.equal((await dir.resolve('trailer','grunwald','gr-cs')).model,'Gr.CS (шторный)');
  assert.equal((await dir.resolve('truck','kamaz','65951')).brand,'КАМАЗ');
  assert.equal((await dir.resolve('truck','maz','5440')).model,'5440');
  assert.equal((await dir.resolve('truck','sitrak','c7h')).brand,'SITRAK');
  assert.equal((await dir.resolve('truck','shacman','x6000')).brand,'SHACMAN');
  await assert.rejects(dir.resolve('trailer','krone','invented'),/подтверждённого каталога/);
});
test('tow selector is a recovery-only whitelist, not a general truck catalog',async()=>{
  const dir=new PublicVehicleDirectory();
  const makes=await dir.makes(tow,'tow','',false,'truck');
  assert.ok(makes.items.some(x=>x.key==='scania'));
  assert.ok(makes.items.some(x=>x.key==='mercedes-benz'));
  assert.ok(makes.items.some(x=>x.key==='kamaz'));
  assert.ok(!makes.items.some(x=>x.key==='renault'));
  const scania=await dir.models(tow,'tow','truck','scania');
  assert.equal(scania.total,1);
  assert.ok(scania.items[0].key.includes('wrecker'));
  await assert.rejects(dir.models(tow,'tow','truck','renault'),/Марка отсутствует/);
  await assert.rejects(dir.makes(tow,'tow','',false,'trailer'),/Категория недоступна/);
});
test('owner images have credits, manuals are link-only and no repair instructions leak',async()=>{
  const registry=await vehicleOwnerShelf();
  assert.ok(registry.rows.some(x=>x.category==='trailer'&&x.bodyKind==='drawbar'));
  const renault=await publicVehicleCard('truck','renault','premium');
  assert.equal(renault.scope,'operator_only');
  assert.ok(renault.photo?.src.startsWith('https://commons.wikimedia.org/'));
  assert.ok(renault.photo?.author);
  assert.ok(renault.photo?.licenseUrl);
  assert.equal(renault.repairSchematicsIncluded,false);
  assert.ok(renault.manuals.some(x=>x.url==='https://driverguide.renault-trucks.com/'));
  assert.ok((await publicVehicleCard('truck','kamaz','54901')).manuals.some(x=>x.url==='https://guide.kamaz.ru/'));
  assert.ok((await publicVehicleCard('truck','kamaz','65951')).manuals.length===0,'do not claim K5 tractor manual fits recovery truck');
  assert.ok(!JSON.stringify(renault).includes('professional'));
  const mismatched=await publicVehicleCard('truck','renault','magnum');
  assert.equal(mismatched.photo,null,'never substitute the wrong model');
  const krone=await publicVehicleCard('trailer','krone','profi-liner');
  assert.ok(krone.manuals.some(x=>x.origin==='official_manufacturer_link'));
  const koegel=await publicVehicleCard('trailer','koegel','cargo');
  assert.ok(koegel.photo?.caption.includes('Kögel'));
});
test('recovery photo examples are licensed and never claim specific chassis identity',async()=>{
  const shelf=await publicRecoveryGallery();
  assert.equal(shelf.modelMatch,'not_verified');
  assert.ok(shelf.items.some(x=>x.makeKey==='scania'));
  assert.ok(shelf.items.every(x=>x.licenseUrl&&x.author&&x.sourcePage&&!x.specificModelVerified));
});
test('professional technical library denies tow, driver and admin-only even by API',async()=>{
  const db:any={one:async()=>({verification:'approved'}),query:async()=>[]};
  const library=new VehicleTechnicalLibrary(db);
  for(const user of [client,tow,admin])
    await assert.rejects(library.professional(user),/только мастерам и СТО/);
  assert.ok((await library.professional(master)).links.length>0);
  assert.ok((await library.professional(service)).links.length>0);
  const blocked=new VehicleTechnicalLibrary({one:async()=>({verification:'pending'}),query:async()=>[]} as any);
  await assert.rejects(blocked.professional(master),/подтверждённый профиль/);
});
test('new trailer entry persists with license-keyed model, owner book is safe; strangers denied',async()=>{
  const t=await setup();
  try{
    const owner=await t.login('+79990002313','client');
    const other=await t.login('+79990002314','client');
    const created=await t.api('POST','/api/vehicle-reference/vehicles',{
      category:'trailer',brandKey:'krone',modelKey:'profi-liner',plate:'А777АА78',
    },owner.token);
    assert.equal(created.status,200,JSON.stringify(created.body));
    assert.equal(created.body.catalog_category,'trailer');
    const view=await t.api('GET','/api/vehicle-reference/public-card?category=trailer&brandKey=krone&modelKey=profi-liner',undefined,owner.token);
    assert.equal(view.status,200);
    assert.equal(view.body.repairSchematicsIncluded,false);
    assert.ok(view.body.manuals.some((x:any)=>x.url.includes('krone-trailer.com')));
    assert.equal((await t.api('GET','/api/vehicles/'+created.body.id+'/history',undefined,other.token)).status,404);
    const denied=await t.api('GET','/api/vehicle-reference/recovery-gallery',undefined,owner.token);
    assert.equal(denied.status,403,'owner must not enumerate specialist-only tow picker');
    const unknownPhoto=await t.api('GET',
      '/api/vehicle-reference/public-card?category=truck&brandKey=renault&modelKey=not-a-model',
      undefined,owner.token);
    assert.equal(unknownPhoto.status,400);

  }finally{await t.close()}
});
