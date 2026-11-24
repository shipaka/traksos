import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, ok, type T } from './helpers.ts';
import { FleetService } from '../src/services/fleet.ts';

let t: T;
before(async () => { t = await setup(); });
after(async () => { await t.close(); });

const phone = (n: number) => '+7999555' + String(n).padStart(4,'0');
const car = (n: number) => ({ brand:'Scania', model:'R', year:2017, plate:'А'+String(n).padStart(3,'0')+'АА178' });

async function fleet(owner: {token:string}, id: string) {
  const data = ok(await t.api('GET','/api/fleet',undefined,owner.token));
  const found = data.cars.find((c: any)=>c.id===id);
  assert.ok(found, 'vehicle must be in its real owner fleet');
  return found;
}
async function state(id: string) {
  return t.db.one<{owner_id:string|null;roles:string[]}>(
    'select owner_id,roles from users where id=$1', [id]);
}
async function assignment(id: string) {
  return t.db.one<{driver_id:string|null;qr_code:string}>(
    'select driver_id,qr_code from vehicles where id=$1', [id]);
}

test('fleet owner-only PUT cannot write settings or audit as a forbidden role', async () => {
  const owner = await t.login(phone(1001));
  const stranger = await t.login(phone(1002),'master');
  const beforeFleet = await t.db.one<{fleet:any;edo_pdf_only:boolean}>(
    'select fleet,edo_pdf_only from users where id=$1',[stranger.id]);
  const beforeAudit = await t.db.one<{n:number}>(
    "select count(*)::int as n from audit_log where actor_id=$1 and action='fleet.update'",[stranger.id]);
  const badPut = await t.api('PUT','/api/fleet',{mode:'approve',edoPdfOnly:true},stranger.token);
  assert.equal(badPut.status,403);
  assert.deepEqual(await t.db.one(
    'select fleet,edo_pdf_only from users where id=$1',[stranger.id]),beforeFleet);
  assert.deepEqual(await t.db.one(
    "select count(*)::int as n from audit_log where actor_id=$1 and action='fleet.update'",[stranger.id]),beforeAudit);
  assert.equal((await t.api('GET','/api/fleet',undefined,stranger.token)).status>=400,true);
  const accepted = ok(await t.api('PUT','/api/fleet',{mode:'approve',perOrder:500_000},owner.token));
  assert.equal(accepted.settings.mode,'approve');
  assert.equal(accepted.settings.perOrder,500_000);
  const saved = await t.db.one<{fleet:any}>('select fleet from users where id=$1',[owner.id]);
  assert.equal(saved?.fleet?.mode,'approve');
});

test('QR denies staff and non-customer roles at the service boundary without a side effect', async () => {
  const owner = await t.login(phone(1010));
  const vehicle = ok(await t.api('POST','/api/vehicles',car(11),owner.token));
  const qr = (await fleet(owner,vehicle.id)).qrCode;
  const notify = {notify:async()=>{}} as any;
  const service = new FleetService(t.db,notify,{monthSpent:async()=>0} as any);
  for (const [i,role] of ['master','tow','service','insurer','courier','inspection_operator','admin','moderator'].entries()) {
    const u = await t.login(phone(1020+i));
    await t.db.query('update users set roles=$2::text[] where id=$1',[u.id,[role]]);
    const before = await state(u.id);
    const result = await assignment(vehicle.id);
    await assert.rejects(service.qrJoin({id:u.id,phone:phone(1020+i),roles:[role],owner_id:null} as any,qr),
      (e:any)=>e?.status>=400,'role '+role+' must be forbidden');
    assert.deepEqual(await state(u.id),before);
    assert.deepEqual(await assignment(vehicle.id),result);
  }
  const outsider = await t.login(phone(1099));
  ok(await t.api('POST','/api/qr/'+qr+'/join',{},outsider.token));
  assert.equal((await state(outsider.id))?.owner_id,owner.id);
});

test('QR revocation releases the last driver, refuses the old code, and permits a new fleet', async () => {
  const a = await t.login(phone(1100));
  const b = await t.login(phone(1101));
  const x = await t.login(phone(1102),'driver');
  const v1 = ok(await t.api('POST','/api/vehicles',car(21),a.token));
  const v2 = ok(await t.api('POST','/api/vehicles',car(22),b.token));
  const oldQr = (await fleet(a,v1.id)).qrCode;
  const qrB = (await fleet(b,v2.id)).qrCode;
  assert.equal((await t.api('POST','/api/qr/invalid-token/join',{},x.token)).status,404);
  ok(await t.api('POST','/api/qr/'+oldQr+'/join',{},x.token));
  assert.equal((await state(x.id))?.owner_id,a.id);
  assert.equal((await assignment(v1.id))?.driver_id,x.id);
  ok(await t.api('POST',`/api/fleet/vehicles/${v1.id}/new-qr`,{},a.token));
  assert.equal((await assignment(v1.id))?.driver_id,null);
  assert.equal((await state(x.id))?.owner_id,null);
  assert.notEqual((await assignment(v1.id))?.qr_code,oldQr);
  assert.equal((await t.api('GET','/api/qr/'+oldQr)).status,404);
  assert.equal((await t.api('POST','/api/qr/'+oldQr+'/join',{},x.token)).status,404);
  ok(await t.api('POST','/api/qr/'+qrB+'/join',{},x.token));
  assert.equal((await state(x.id))?.owner_id,b.id);
  assert.equal((await assignment(v2.id))?.driver_id,x.id);
});

test('concurrent valid QR joins leave only the last driver associated with the owner', async () => {
  const owner = await t.login(phone(1200));
  const a = await t.login(phone(1201),'driver');
  const b = await t.login(phone(1202),'driver');
  const v = ok(await t.api('POST','/api/vehicles',car(31),owner.token));
  const qr = (await fleet(owner,v.id)).qrCode;
  const joins = await Promise.all([
    t.api('POST','/api/qr/'+qr+'/join',{},a.token),
    t.api('POST','/api/qr/'+qr+'/join',{},b.token),
  ]);
  assert.deepEqual(joins.map(r=>r.status),[200,200]);
  const assigned=(await assignment(v.id))?.driver_id;
  assert.ok(assigned===a.id||assigned===b.id);
  const loser=assigned===a.id?b:a;
  assert.equal((await state(assigned!))?.owner_id,owner.id);
  assert.equal((await state(loser.id))?.owner_id,null,
    'competing QR join must not leave an unassigned driver inside the fleet');
  // Repeat the already-confirmed join: never create a second assignment.
  ok(await t.api('POST','/api/qr/'+qr+'/join',{},(assigned===a.id?a:b).token));
  assert.equal((await assignment(v.id))?.driver_id,assigned);
});

test('manual driver assignment cannot bypass role ACL and releases a replaced driver', async () => {
  const owner = await t.login(phone(1300));
  const x = await t.login(phone(1301),'driver');
  const y = await t.login(phone(1302),'driver');
  const v = ok(await t.api('POST','/api/vehicles',car(41),owner.token));
  for (const [i,role] of ['master','tow','service','insurer','courier',
    'inspection_operator','admin','moderator'].entries()) {
    const rejected=await t.login(phone(1303+i));
    await t.db.query('update users set roles=$2::text[] where id=$1',[rejected.id,[role]]);
    const denied = await t.api('POST',`/api/vehicles/${v.id}/driver`,
      {phone:phone(1303+i)},owner.token);
    assert.equal(denied.status,403,'manual driver invitation must reject '+role);
    assert.equal((await assignment(v.id))?.driver_id,null);
    assert.deepEqual((await state(rejected.id))?.roles,[role]);
    assert.equal((await state(rejected.id))?.owner_id,null);
  }
  ok(await t.api('POST',`/api/vehicles/${v.id}/driver`,{phone:phone(1301)},owner.token));
  assert.equal((await state(x.id))?.owner_id,owner.id);
  ok(await t.api('POST',`/api/vehicles/${v.id}/driver`,{phone:phone(1302)},owner.token));
  assert.equal((await assignment(v.id))?.driver_id,y.id);
  assert.equal((await state(x.id))?.owner_id,null);
  ok(await t.api('POST',`/api/vehicles/${v.id}/driver`,{phone:null},owner.token));
  assert.equal((await assignment(v.id))?.driver_id,null);
  assert.equal((await state(y.id))?.owner_id,null);
  ok(await t.api('POST',`/api/vehicles/${v.id}/driver`,{phone:phone(1301)},owner.token));
  ok(await t.api('DELETE',`/api/vehicles/${v.id}`,undefined,owner.token));
  assert.equal((await state(x.id))?.owner_id,null,
    'deleting the last assigned car must detach the driver');
});

test('stale owner_id from a prior release can be repaired on a legitimate new QR join', async () => {
  const oldOwner=await t.login(phone(1400));
  const newOwner=await t.login(phone(1401));
  const user=await t.login(phone(1402),'driver');
  const carB=ok(await t.api('POST','/api/vehicles',car(51),newOwner.token));
  const qr=(await fleet(newOwner,carB.id)).qrCode;
  await t.db.query('update users set owner_id=$2 where id=$1',[user.id,oldOwner.id]);
  assert.equal((await state(user.id))?.owner_id,oldOwner.id);
  ok(await t.api('POST','/api/qr/'+qr+'/join',{},user.token));
  assert.equal((await state(user.id))?.owner_id,newOwner.id);
});

test('revoking one car does not detach a legacy driver still assigned to another car', async () => {
  const owner=await t.login(phone(1500));
  const driver=await t.login(phone(1501),'driver');
  const a=ok(await t.api('POST','/api/vehicles',car(61),owner.token));
  const b=ok(await t.api('POST','/api/vehicles',car(62),owner.token));
  const qr=(await fleet(owner,a.id)).qrCode;
  ok(await t.api('POST','/api/qr/'+qr+'/join',{},driver.token));
  // Older releases could allow one driver_id on more than one vehicle.
  await t.db.query('update vehicles set driver_id=$2,driver_since=now() where id=$1',[b.id,driver.id]);
  ok(await t.api('POST',`/api/fleet/vehicles/${a.id}/new-qr`,{},owner.token));
  assert.equal((await state(driver.id))?.owner_id,owner.id,
    'other still-assigned car must retain active fleet membership');
  ok(await t.api('POST',`/api/fleet/vehicles/${b.id}/new-qr`,{},owner.token));
  assert.equal((await state(driver.id))?.owner_id,null);
});

test('revoke and join racing for the same code cannot resurrect a revoked assignment', async () => {
  const owner=await t.login(phone(1600));
  const driver=await t.login(phone(1601),'driver');
  const vehicle=ok(await t.api('POST','/api/vehicles',car(71),owner.token));
  const qr=(await fleet(owner,vehicle.id)).qrCode;
  const [joined,revoked] = await Promise.all([
    t.api('POST','/api/qr/'+qr+'/join',{},driver.token),
    t.api('POST',`/api/fleet/vehicles/${vehicle.id}/new-qr`,{},owner.token),
  ]);
  assert.ok([200,404].includes(joined.status),'join either precedes revoke or loses with 404');
  assert.equal(revoked.status,200);
  assert.equal((await assignment(vehicle.id))?.driver_id,null);
  assert.equal((await state(driver.id))?.owner_id,null);
  assert.equal((await t.api('POST','/api/qr/'+qr+'/join',{},driver.token)).status,404);
});

test('fleet rules are visible only while the driver has a live assigned vehicle', async () => {
  const owner=await t.login(phone(1700));
  const driver=await t.login(phone(1701),'driver');
  const vehicle=ok(await t.api('POST','/api/vehicles',car(81),owner.token));
  const qr=(await fleet(owner,vehicle.id)).qrCode;
  // Legacy broken release: owner_id remained after the last vehicle was revoked.
  await t.db.query('update users set owner_id=$2 where id=$1',[driver.id,owner.id]);
  const stale=await t.api('GET','/api/fleet/rules',undefined,driver.token);
  assert.equal(stale.status,200);
  assert.equal(stale.body,null,'stale owner_id alone must not expose another fleet settings');
  ok(await t.api('POST','/api/qr/'+qr+'/join',{},driver.token));
  const linked=ok(await t.api('GET','/api/fleet/rules',undefined,driver.token));
  assert.equal(linked.mode,'limit');
  ok(await t.api('POST',`/api/fleet/vehicles/${vehicle.id}/new-qr`,{},owner.token));
  const revoked=await t.api('GET','/api/fleet/rules',undefined,driver.token);
  assert.equal(revoked.body,null);
});
