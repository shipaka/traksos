import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, ok, type T } from './helpers.ts';

let t: T;
let owner: { id: string; token: string }, driver: typeof owner, stranger: typeof owner, station: typeof owner, master: typeof owner;
let vehicle: string, booking: string, order: string, reservation: string, qr: string;
const path = '/api/client/calendar?from=2026-12-02&to=2026-12-02';
before(async () => {
  t = await setup();
  owner = await t.login('+79997810011');
  driver = await t.login('+79997810012');
  stranger = await t.login('+79997810013');
  station = await t.login('+79997810014', 'service');
  master = await t.login('+79997810015', 'master');
  vehicle = ok(await t.api('POST', '/api/vehicles', { brand: 'DAF', model: 'XF', plate: 'а482км178' }, owner.token)).id;
  qr = ok(await t.api('GET', '/api/fleet', undefined, owner.token)).cars[0].qrCode;
  ok(await t.api('POST', `/api/qr/${qr}/join`, {}, driver.token));
  const center = await t.db.one<any>("insert into service_centers(owner_id,name,address) values($1,'Тест СТО','Частный адрес') returning id", [station.id]);
  const b = await t.db.one<any>(`insert into service_bookings(center_id,client_id,created_by,vehicle_id,vehicle,need,when_day,when_time,comment)
    values($1,$2,$3,$4,'{"brand":"DAF","model":"XF"}','electric','2026-12-02','11:00','Личные заметки') returning id`, [center.id, owner.id, driver.id, vehicle]);
  booking = b.id;
  order = ok(await t.api('POST', '/api/orders', { service: 'electric', zoneId: 'spb', vehicleId: vehicle, description: 'Не горит свет' }, driver.token)).order.id;
  // The normal immediate checkout can already finish with no_performer
  // because this fixture has no online master. The calendar deliberately
  // excludes that terminal status. Seed a searching linked order explicitly
  // for the read-only calendar contract, not a fake successful live booking.
  await t.db.query("update orders set status='searching' where id=$1",[order]);
  const r = await t.db.one<any>(`insert into performer_time_reservations(performer_id,client_id,order_id,starts_at,ends_at)
    values($1,$2,$3,'2026-12-01T21:30:00Z','2026-12-01T22:30:00Z') returning id`, [master.id,owner.id,order]);
  reservation = r.id;
});
after(() => t?.close());

test('customer calendar distinguishes requests from confirmed appointments and uses Moscow civil dates', async () => {
  const result = ok(await t.api('GET',path,undefined,owner.token));
  assert.equal(result.timezone,'Europe/Moscow');
  assert.equal(result.truncated,false);
  const sto = result.items.find((x:any)=>x.id===booking);
  const mobile = result.items.find((x:any)=>x.id===reservation);
  assert.ok(sto,'linked STO fixture must be present');
  assert.ok(mobile,'linked non-terminal order fixture must be present');
  assert.equal(sto.confirmation,'pending');
  assert.equal(sto.confirmed_time,null);
  assert.equal(sto.requested_time,'11:00');
  assert.equal(mobile.day,'2026-12-02');
  assert.equal(mobile.order_id,order);
  assert.equal(mobile.confirmation,'pending');
  assert.ok(!('comment' in sto) && !('address' in sto));
  await t.db.query("update service_bookings set status='expected',accept_time='12:00' where id=$1",[booking]);
  const accepted = ok(await t.api('GET',path,undefined,owner.token)).items.find((x:any)=>x.id===booking);
  assert.equal(accepted.confirmation,'confirmed');
  assert.equal(accepted.confirmed_time,'12:00');
  await t.db.query("update service_bookings set status='cancelled' where id=$1",[booking]);
  const cancelled = ok(await t.api('GET',path,undefined,owner.token)).items.find((x:any)=>x.id===booking);
  assert.equal(cancelled.confirmation,'cancelled');
  assert.equal(cancelled.confirmed_time,null);
});

test('failed search does not appear as a live appointment; restoring a live fixture restores the calendar',async()=>{
  await t.db.query("update orders set status='no_performer' where id=$1",[order]);
  try {
    const result=ok(await t.api('GET',path,undefined,owner.token));
    assert.ok(!result.items.some((x:any)=>x.id===reservation));
    assert.equal((await t.db.one<any>('select status from performer_time_reservations where id=$1',[reservation]))?.status,'proposed');
  }finally{
    await t.db.query("update orders set status='searching' where id=$1",[order]);
  }
  assert.ok(ok(await t.api('GET',path,undefined,owner.token)).items.some((x:any)=>x.id===reservation));
});

test('calendar has role, account and live vehicle isolation and validates date ranges', async () => {
  assert.equal((await t.api('GET',path)).status,401);
  assert.equal((await t.api('GET',path,undefined,master.token)).status,403);
  assert.equal(ok(await t.api('GET',path,undefined,stranger.token)).items.length,0);
  assert.equal(ok(await t.api('GET',path,undefined,driver.token)).items.length,2);
  for(const range of ['from=2026-02-30&to=2026-03-01','from=2026-12-03&to=2026-12-02','from=2026-01-01&to=2026-12-31','from=2026-12-02']) {
    assert.equal((await t.api('GET','/api/client/calendar?'+range,undefined,owner.token)).status,400);
  }
  assert.equal(ok(await t.api('GET','/api/client/calendar?from=2026-12-01&to=2026-12-01',undefined,owner.token)).items.length,0);
  ok(await t.api('POST', `/api/qr/${qr}/join`, {}, stranger.token));
  assert.equal(ok(await t.api('GET',path,undefined,driver.token)).items.length,0);
  assert.equal(ok(await t.api('GET',path,undefined,stranger.token)).items.length,0);
  assert.equal(ok(await t.api('GET',path,undefined,owner.token)).items.length,2);
});


test('performer calendar is private, links only accessible real orders and agrees with customer calendar',async()=>{
  const p='/api/performer/calendar?from=2026-12-02&to=2026-12-02';
  // Profile existence is required in addition to the role.
  ok(await t.api('PUT','/api/performer/profile',{kind:'master',name:'Мастер',specialties:['electric']},master.token));
  assert.equal((await t.api('GET',p,undefined,owner.token)).status,403);
  assert.equal((await t.api('GET',p,undefined,station.token)).status,403);
  assert.equal(ok(await t.api('GET',p,undefined,master.token)).items.length,0,'an unassigned order without an invitation is not accessible');
  await t.db.query("update orders set performer_id=$2,status='accepted' where id=$1",[order,master.id]);
  const own=ok(await t.api('GET',p,undefined,master.token));
  const customer=ok(await t.api('GET',path,undefined,owner.token));
  const item=own.items.find((x:any)=>x.id===reservation);
  assert.ok(item);
  assert.equal(item.order_id,order);
  assert.deepEqual(item,customer.items.find((x:any)=>x.id===reservation));
  assert.ok(!('address' in item)&&!('phone' in item)&&!('client_id' in item));
  const second=await t.login('+79997810016','master');
  ok(await t.api('PUT','/api/performer/profile',{kind:'master',name:'Другой мастер',specialties:['electric']},second.token));
  assert.equal(ok(await t.api('GET',p,undefined,second.token)).items.length,0);
  await t.db.query("update orders set performer_id=$2 where id=$1",[order,second.id]);
  assert.equal(ok(await t.api('GET',p,undefined,master.token)).items.length,0,'reassignment revokes visibility');
  assert.equal(ok(await t.api('GET',p,undefined,second.token)).items.length,0,'reservation belongs to original performer only');
  await t.db.query("update orders set performer_id=$2,status='cancelled' where id=$1",[order,master.id]);
  const terminal=ok(await t.api('GET',p,undefined,master.token)).items;
  assert.equal(terminal.find((x:any)=>x.id===reservation)?.confirmation,'cancelled','cancelled order retains history, not a live appointment');
});


test('overnight reservation appears inside requested Moscow day, keeping actual interval in both calendars',async()=>{
  // Separate order: never resurrect the cancelled order from the prior test.
  const overnightOrder=ok(await t.api('POST','/api/orders',{service:'electric',zoneId:'spb',vehicleId:vehicle},owner.token)).order.id;
  await t.db.query("update orders set status='accepted',performer_id=$2 where id=$1",[overnightOrder,master.id]);
  const r=await t.db.one<any>(`insert into performer_time_reservations
    (performer_id,client_id,order_id,starts_at,ends_at,status,decision_at,decided_by)
    values($1,$2,$3,'2026-12-01T20:30:00Z','2026-12-01T22:30:00Z','confirmed',$4,$2) returning id`,
    [master.id,owner.id,overnightOrder,t.clock.now()]);
  const p='/api/performer/calendar?from=2026-12-02&to=2026-12-02';
  const a=ok(await t.api('GET',path,undefined,owner.token)).items.find((x:any)=>x.id===r.id);
  const b=ok(await t.api('GET',p,undefined,master.token)).items.find((x:any)=>x.id===r.id);
  assert.ok(a);
  assert.equal(a.day,'2026-12-02','group date must be inside the requested period');
  assert.equal(a.starts_at,'2026-12-01T20:30:00.000Z','actual start is not changed by grouping');
  assert.equal(a.ends_at,'2026-12-01T22:30:00.000Z');
  assert.deepEqual(a,b);
  const next=ok(await t.api('GET','/api/client/calendar?from=2026-12-03&to=2026-12-03',undefined,owner.token));
  assert.ok(!next.items.some((x:any)=>x.id===r.id));
});

test('STO calendar retains the appointment through repair, invoice, dispute and closed history', async () => {
  const center = await t.db.one<any>("select id from service_centers where owner_id=$1", [station.id]);
  assert.ok(center);
  const item = await t.db.one<any>(`insert into service_bookings
    (center_id,client_id,vehicle_id,vehicle,need,when_day,when_time,accept_time,status)
    values($1,$2,$3,'{"brand":"DAF","model":"XF"}','electric','2026-12-15','11:00','12:00','expected') returning id`,
    [center.id,owner.id,vehicle]);
  const calendarPath = '/api/client/calendar?from=2026-12-15&to=2026-12-15';
  const lifecycle = [
    ['expected','confirmed'], ['arrived','in_progress'], ['diagnostics','in_progress'],
    ['in_work','in_progress'], ['waiting_part','in_progress'], ['agreeing','in_progress'],
    ['ready','ready'], ['invoiced','invoiced'], ['disputed','disputed'], ['closed','completed']
  ];
  for (const [status,confirmation] of lifecycle) {
    await t.db.query("update service_bookings set status=$2 where id=$1",[item.id,status]);
    const row = ok(await t.api('GET',calendarPath,undefined,owner.token)).items.find((x:any)=>x.id===item.id);
    assert.ok(row, 'Missing calendar appointment at '+status);
    assert.equal(row.confirmation,confirmation);
    assert.equal(row.requested_time,'11:00');
    assert.equal(row.confirmed_time,'12:00');
    assert.ok(!('amount' in row) && !('comment' in row));
    assert.ok(!ok(await t.api('GET',calendarPath,undefined,stranger.token)).items.some((x:any)=>x.id===item.id));
  }
});
