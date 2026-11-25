import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {setup,ok,type T} from './helpers.ts';

let t:T;
let owner:{id:string;token:string},master:{id:string;token:string};
let expert:{id:string;token:string},service:{id:string;token:string},admin:{id:string;token:string};
before(async()=>{
 t=await setup();
 owner=await t.login('+79997804501');
 master=await t.login('+79997804502','master');
 expert=await t.login('+79997804503','master');
 service=await t.login('+79997804504','service');
 admin=await t.login('+79990000001');
 ok(await t.api('PUT','/api/performer/profile',{kind:'ecu',name:'Эксперт ЭБУ'},expert.token));
 ok(await t.api('PUT','/api/ecu/station',{
  publicName:'Мастерская ЭБУ',address:'Санкт-Петербург, Софийская улица, 9'
 },expert.token));
 ok(await t.api('POST','/api/admin/performers/'+expert.id+'/verify',
  {decision:'approved'},admin.token));
 ok(await t.api('POST','/api/admin/ecu/stations/'+expert.id+'/verify',
  {approved:true},admin.token));
});
after(()=>t.close());

test('selected ECU expert sees ordered shop work notes but never hidden STO notes or private contacts',async()=>{
 const center=ok(await t.api('PUT','/api/base',{
  name:'Рембаза Восток',address:'Санкт-Петербург, Софийская улица, 28',
  staff:{electric:'own'},accepts:['quick','long']
 },service.token)).center;
 ok(await t.api('POST','/api/admin/services/'+center.id+'/verify',{decision:'approved'},admin.token));
 const truck=ok(await t.api('POST','/api/vehicles',{
  brand:'MAN',model:'TGX',year:2018,plate:'А519АС178'},owner.token));
 const order=ok(await t.api('POST','/api/orders',{
  service:'diag',regionId:'spb',zoneId:'spb',vehicleId:truck.id,
  description:'После ДТП не выходит на связь блок, нужна проверка ЭБУ',
  address:'Санкт-Петербург, Софийская улица, 28',paymentMethod:'cash'
 },owner.token)).order;
 await t.db.query(
  "update orders set status='completed',performer_id=$2,result='cause_found',result_note=$3,completed_at=$4 where id=$1",
  [order.id,master.id,'На выходе блока нет сигнала после восстановления питания',t.clock.now()]);
 const booking=ok(await t.api('POST','/api/services/'+center.id+'/book',{
  vehicleId:truck.id,need:'electric',day:'2026-12-02',arrival:'self',
  caseOrderId:order.id,comment:'Восстановление проводки без раскрытия телефона'
 },owner.token));
 const privateLine='Внутренний номер клиента: +7 999 123 45 67 и скрытая смета 30000';
 await t.db.query(
  "update service_bookings set status='in_work',notes=$2::jsonb,notes_public=false,works=$3::text[],arrived_at=$4 where id=$1",
  [booking.id,JSON.stringify([{text:privateLine,at:'2026-12-01T12:00:00Z'}]),
   ['Проверка проводки','Снятие ЭБУ для стенда'],t.clock.now()]);
 const h=ok(await t.api('POST','/api/orders/'+order.id+'/ecu-handoff',{
  summary:'На блоке нет ответа после проверки питания и проводки, требуется стендовая диагностика'
 },master.token));
 const candidate=ok(await t.api('GET','/api/ecu/handoffs/'+h.id,undefined,expert.token));
 assert.deepEqual(candidate.history,[]);
 assert.deepEqual(candidate.workshops,[],'workshop history is private before selection');
 const offered=ok(await t.api('POST','/api/ecu/handoffs/'+h.id+'/quote',{
  diagnosisPrice:200000,explanation:'Стендовая диагностика с итоговой ведомостью ошибок'
 },expert.token));
 ok(await t.api('POST','/api/ecu/handoffs/'+h.id+'/choose',{
  quoteId:offered.id,version:1,price:200000,agree:true
 },owner.token));
 const chosen=ok(await t.api('GET','/api/ecu/handoffs/'+h.id,undefined,expert.token));
 assert.equal(chosen.history.length,1);
 assert.equal(chosen.history[0].performerName!=null,true,'original master stays attached');
 assert.equal(chosen.workshops.length,1);
 assert.equal(chosen.workshops[0].centerName,'Рембаза Восток');
 assert.deepEqual(chosen.workshops[0].works,['Проверка проводки','Снятие ЭБУ для стенда']);
 assert.deepEqual(chosen.workshops[0].publicNotes,[],'private workshop notes cannot leak through ECU handoff');
 assert.equal(JSON.stringify(chosen).includes('30000'),false,'the internal estimate is never forwarded');
 const publicLine='Осмотрены контакты, тел. +7 999 123 45 67, VIN WMA06XZZXHW123456';
 await t.db.query('update service_bookings set notes=$2::jsonb,notes_public=true where id=$1',
  [booking.id,JSON.stringify([{text:publicLine,at:'2026-12-01T12:02:00Z'}])]);
 const shared=ok(await t.api('GET','/api/ecu/handoffs/'+h.id,undefined,expert.token));
 assert.equal(shared.workshops[0].publicNotes.length,1);
 assert.match(shared.workshops[0].publicNotes[0].text,/номер скрыт/);
 assert.doesNotMatch(shared.workshops[0].publicNotes[0].text,/\+7 999 123 45 67|WMA06XZZXHW123456/);
 const others=await t.login('+79997804505','master');
 assert.equal((await t.api('GET','/api/ecu/handoffs/'+h.id,undefined,others.token)).status,403);
});
