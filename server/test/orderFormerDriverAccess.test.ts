import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, ok, type T } from './helpers.ts';

let t: T;
before(async () => { t = await setup(); });
after(async () => { await t.close(); });

const phone = (n: number) => '+7999777' + String(n).padStart(4, '0');
const vehicleBody = (n: number) => ({
  brand: 'Scania', model: 'R', year: 2018, plate: 'А' + String(n).padStart(3, '0') + 'АА178',
});
const apiOrder = (vehicleId: string) => ({
  service: 'electric', isSos: true, problem: 'no_start',
  description: 'Стартер не вращается после остановки',
  zoneId: 'spb', regionId: 'spb',
  address: 'Санкт-Петербург, тестовая стоянка у КАД',
  lat: 59.95, lng: 30.35, vehicleId,
});
async function qrOf(owner: {token:string}, id: string) {
  const list = ok(await t.api('GET', '/api/fleet', undefined, owner.token));
  const vehicle = list.cars.find((v:any)=>v.id === id);
  assert.ok(vehicle?.qrCode, 'owner must have a valid QR code');
  return vehicle.qrCode as string;
}
const hasOrder = (data: any[], orderId: string) => data.some(o=>o.id===orderId);

test('revoked driver loses order detail, archive, chat, repair photos, billing and actions; owner keeps history', async () => {
  const ownerA = await t.login(phone(1001));
  const ownerB = await t.login(phone(1002));
  const driverX = await t.login(phone(1003), 'driver');
  const carA = ok(await t.api('POST','/api/vehicles',vehicleBody(111),ownerA.token));
  const carB = ok(await t.api('POST','/api/vehicles',vehicleBody(112),ownerB.token));
  const qrA = await qrOf(ownerA,carA.id);
  const qrB = await qrOf(ownerB,carB.id);
  ok(await t.api('POST','/api/qr/'+qrA+'/join',{},driverX.token));
  const order = ok(await t.api('POST','/api/orders',apiOrder(carA.id),driverX.token)).order;
  assert.ok(order.id,'driver can create a real order for the assigned car');
  assert.deepEqual(await t.app.orders.customerRecipientsForOrder(order.id),
    [ownerA.id,driverX.id]);
  const performer = await t.login(phone(1004),'master');
  const bid = await t.db.one<{id:string}>(
    'insert into bids(order_id,performer_id,price,hour_price,eta_minutes) values($1,$2,$3,$4,$5) returning id',
    [order.id,performer.id,25_000,10_000,30]);
  assert.ok(bid?.id);
  assert.ok(hasOrder(ok(await t.api('GET','/api/orders',undefined,driverX.token)),order.id));
  assert.equal((await t.api('GET','/api/orders/'+order.id,undefined,driverX.token)).status,200);
  assert.equal((await t.api('GET','/api/orders/'+order.id+'/messages',undefined,driverX.token)).status,200);
  assert.equal((await t.api('GET','/api/orders/'+order.id+'/photos',undefined,driverX.token)).status,200);
  assert.equal((await t.api('GET','/api/orders/'+order.id+'/continuations',undefined,driverX.token)).status,200);

  // Remove X in the real UI lifecycle and immediately attach him to a
  // different fleet. Neither the same bearer token nor created_by is authority.
  ok(await t.api('POST',`/api/fleet/vehicles/${carA.id}/new-qr`,{},ownerA.token));
  assert.equal((await t.db.one<{owner_id:string|null}>(
    'select owner_id from users where id=$1',[driverX.id]))?.owner_id,null);
  ok(await t.api('POST','/api/qr/'+qrB+'/join',{},driverX.token));
  assert.equal((await t.db.one<{owner_id:string|null}>(
    'select owner_id from users where id=$1',[driverX.id]))?.owner_id,ownerB.id);

  assert.deepEqual(await t.app.orders.customerRecipientsForOrder(order.id),[ownerA.id],
    'old creator must not receive order-related push notifications');
  const archived = ok(await t.api('GET','/api/orders',undefined,driverX.token));
  assert.equal(hasOrder(archived,order.id),false,'full former fleet archive is private');
  assert.equal((await t.api('GET','/api/orders/'+order.id,undefined,driverX.token)).status,403);
  for (const route of [
    '/messages','/photos','/photos/00000000-0000-0000-0000-000000000001/file',
    '/payments','/reviews','/offers','/continuations',
  ]) {
    const result=await t.api('GET',`/api/orders/${order.id}`+route,undefined,driverX.token);
    assert.equal(result.status,403,'former driver must not read '+route);
  }
  const eventsBefore = await t.db.one<{n:number}>(
    'select count(*)::int as n from order_events where order_id=$1',[order.id]);
  for (const [suffix,body] of [
    ['cancel',{reason:'Отмена после смены владельца'}],
    ['retry',{}],['confirm',{}],['dispute',{reason:'Не согласен с суммой'}],
    ['messages',{body:'Бывший водитель пробует написать'}],
    [`offers/${bid!.id}/choose`,{}],
    ['part',{mode:'wait'}],
    ['emergency-dispute',{reason:'Не согласен с аварийным завершением'}],
  ] as const) {
    const attempt=await t.api('POST',`/api/orders/${order.id}/${suffix}`,body,driverX.token);
    assert.equal(attempt.status,403,'former driver cannot mutate '+suffix);
  }
  assert.deepEqual(await t.db.one(
    'select count(*)::int as n from order_events where order_id=$1',[order.id]),eventsBefore,
    'rejected actions must not append events');
  // The owner and the new vehicle's driver still have their rightful data.
  assert.equal((await t.api('GET','/api/orders/'+order.id,undefined,ownerA.token)).status,200);
  assert.ok(hasOrder(ok(await t.api('GET','/api/orders',undefined,ownerA.token)),order.id));
  assert.equal((await t.api('GET','/api/orders/'+order.id,undefined,ownerB.token)).status,403);
});

test('different car in SAME fleet does not confer access to old car order', async () => {
  const owner=await t.login(phone(1101));
  const x=await t.login(phone(1102),'driver');
  const a=ok(await t.api('POST','/api/vehicles',vehicleBody(121),owner.token));
  const b=ok(await t.api('POST','/api/vehicles',vehicleBody(122),owner.token));
  ok(await t.api('POST','/api/qr/'+await qrOf(owner,a.id)+'/join',{},x.token));
  const oldOrder=ok(await t.api('POST','/api/orders',apiOrder(a.id),x.token)).order;
  // The manual "Сменить водителя" action reassigns the same real user.
  ok(await t.api('POST',`/api/vehicles/${b.id}/driver`,{phone:phone(1102)},owner.token));
  const vA=await t.db.one<{driver_id:string|null}>('select driver_id from vehicles where id=$1',[a.id]);
  const vB=await t.db.one<{driver_id:string|null}>('select driver_id from vehicles where id=$1',[b.id]);
  assert.equal(vA?.driver_id,null);
  assert.equal(vB?.driver_id,x.id);
  assert.equal((await t.api('GET','/api/orders/'+oldOrder.id,undefined,x.token)).status,403);
  assert.equal(hasOrder(ok(await t.api('GET','/api/orders',undefined,x.token)),oldOrder.id),false);
  assert.equal((await t.api('GET','/api/orders/'+oldOrder.id,undefined,owner.token)).status,200);
});

test('invalid/stale owner_id and former creator are not treated as permanent participants', async () => {
  const owner=await t.login(phone(1201));
  const driver=await t.login(phone(1202),'driver');
  const vehicle=ok(await t.api('POST','/api/vehicles',vehicleBody(131),owner.token));
  const qr=await qrOf(owner,vehicle.id);
  ok(await t.api('POST','/api/qr/'+qr+'/join',{},driver.token));
  const order=ok(await t.api('POST','/api/orders',apiOrder(vehicle.id),driver.token)).order;
  // Emulate an older release that revoked vehicle.driver_id, but forgot owner_id.
  await t.db.query('update vehicles set driver_id=null,driver_since=null where id=$1',[vehicle.id]);
  const still=await t.db.one<{owner_id:string|null}>('select owner_id from users where id=$1',[driver.id]);
  assert.equal(still?.owner_id,owner.id);
  assert.equal((await t.api('GET','/api/orders/'+order.id,undefined,driver.token)).status,403);
  assert.equal(hasOrder(ok(await t.api('GET','/api/orders',undefined,driver.token)),order.id),false);
  assert.equal((await t.api('GET','/api/orders/'+order.id+'/messages',undefined,driver.token)).status,403);
});

test('realtime order participants follow the current vehicle assignment, never past created_by', async () => {
  const owner=await t.login(phone(1301));
  const oldDriver=await t.login(phone(1302),'driver');
  const replacement=await t.login(phone(1303),'driver');
  const vehicle=ok(await t.api('POST','/api/vehicles',vehicleBody(141),owner.token));
  ok(await t.api('POST','/api/qr/'+await qrOf(owner,vehicle.id)+'/join',{},oldDriver.token));
  const order=ok(await t.api('POST','/api/orders',apiOrder(vehicle.id),oldDriver.token)).order;
  let participants=await t.app.orders.participants(order.id);
  assert.ok(participants.includes(owner.id));
  assert.ok(participants.includes(oldDriver.id));
  ok(await t.api('POST',`/api/vehicles/${vehicle.id}/driver`,{phone:phone(1303)},owner.token));
  participants=await t.app.orders.participants(order.id);
  assert.ok(participants.includes(owner.id));
  assert.equal(participants.includes(oldDriver.id),false,
    'realtime broadcasts must stop addressing the former driver');
  // Newly appointed driver did not create this order, so cannot access it.
  assert.equal(participants.includes(replacement.id),false);
  assert.equal((await t.api('GET','/api/orders/'+order.id,undefined,replacement.token)).status,403);
});
