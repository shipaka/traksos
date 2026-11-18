import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {setup,ok,type T} from './helpers.ts';

let t:T;
let admin:{token:string;id:string},owner:{token:string;id:string};
let master:{token:string;id:string},expert:{token:string;id:string},outsider:{token:string;id:string};
before(async()=>{
 t=await setup();
 admin=await t.login('+79990000001');
 owner=await t.login('+79997802001');
 master=await t.login('+79997802002','master');
 expert=await t.login('+79997802003','master');
 outsider=await t.login('+79997802004');
});
after(()=>t.close());

test('ECU handoff: named original worker, no money, verified station, versioned choice, historical access',async()=>{
 const truck=ok(await t.api('POST','/api/vehicles',{
  brand:'Renault',model:'Premium',year:2010,plate:'А222АА178'},owner.token));
 ok(await t.api('PATCH','/api/vehicles/'+truck.id+'/details',{
  vin:'VF611MTA000123456',engine:'DXi 11'},owner.token));
 const source=ok(await t.api('POST','/api/orders',{
  service:'electric',vehicleId:truck.id,zoneId:'spb',regionId:'spb',
  address:'Санкт-Петербург, Софийская улица, 60',
  description:'Машина не заводится, ошибка на ECU',paymentMethod:'cash'
 },owner.token)).order;
 await t.db.query("update orders set status='arrived',performer_id=$2,arrived_at=$3,result_note=$4 where id=$1",
  [source.id,master.id,t.clock.now(),'Проверены массы и питания, нет связи с блоком управления']);
 const countPayments=async()=>(await t.db.query('select id from payments where order_id=$1',[source.id])).length;
 const beforePayments=await countPayments();
 const sent=ok(await t.api('POST','/api/orders/'+source.id+'/ecu-handoff',{
  summary:'Проверены цепи питания и масса, подозрение на неисправность ЭБУ'
 },master.token));
 assert.equal(sent.created,true);
 assert.equal(ok(await t.api('POST','/api/orders/'+source.id+'/ecu-handoff',{
  summary:'Повторное нажатие из-за плохой связи — ничего нового не создаём'
 },master.token)).created,false);
 assert.equal((await t.db.query('select id from ecu_handoffs where source_order_id=$1',[source.id])).length,1);
 const linked=ok(await t.api('GET','/api/orders/'+source.id+'/ecu-handoff',undefined,owner.token));
 assert.equal(linked.id,sent.id);
 assert.equal((await t.api('GET','/api/ecu/handoffs/'+sent.id,undefined,outsider.token)).status,403);
 assert.equal((await t.api('POST','/api/ecu/handoffs/'+sent.id+'/quote',
  {diagnosisPrice:250000,explanation:'Проверю внутреннюю цепь на стенде'},expert.token)).status,403);
 const caseRow=ok(await t.api('GET','/api/admin/cases/'+source.id,undefined,admin.token));
 assert.ok(caseRow.case_number?.startsWith('М-'),'ECU referral upgrades single order into a numbered case');
 assert.equal(caseRow.ecu_referrals[0].source_order_id,source.id);
 assert.equal(caseRow.ecu_referrals[0].stage_no,2);
 assert.equal(caseRow.stages[0].performer_id,master.id);
 assert.equal(caseRow.ecu_referrals[0].diagnosis_price,null);
 await t.api('PUT','/api/performer/profile',{kind:'ecu',name:'Мастерская блоков ЭБУ'},expert.token);
 const submitted=ok(await t.api('PUT','/api/ecu/station',{
  publicName:'Стенд ЭБУ Север',address:'Санкт-Петербург, улица Салова, 45'
 },expert.token));
 assert.equal(submitted.station.approved_at,null);
 assert.deepEqual(ok(await t.api('GET','/api/ecu/handoffs',undefined,expert.token)),[]);
 assert.equal((await t.api('POST','/api/admin/ecu/stations/'+expert.id+'/verify',
  {approved:true},admin.token)).status,409);
 ok(await t.api('POST','/api/admin/performers/'+expert.id+'/verify',
  {decision:'approved'},admin.token));
 ok(await t.api('POST','/api/admin/ecu/stations/'+expert.id+'/verify',
  {approved:true},admin.token));
 const inbox=ok(await t.api('GET','/api/ecu/handoffs',undefined,expert.token));
 assert.equal(inbox.some((x:any)=>x.id===sent.id),true);
 const candidate=ok(await t.api('GET','/api/ecu/handoffs/'+sent.id,undefined,expert.token));
 assert.equal(candidate.actor,'candidate');
 assert.deepEqual(candidate.history,[]);
 assert.equal(candidate.vehicle.vin,null);
 const q1=ok(await t.api('POST','/api/ecu/handoffs/'+sent.id+'/quote',{
  diagnosisPrice:250000,explanation:'Диагностика на стенде, проверка питания и связи ЭБУ'
 },expert.token));
 assert.equal(q1.version,1);
 const q2=ok(await t.api('POST','/api/ecu/handoffs/'+sent.id+'/quote',{
  diagnosisPrice:350000,explanation:'Диагностика на стенде с осциллографом и заключением'
 },expert.token));
 assert.equal(q2.version,2);
 assert.equal((await t.api('POST','/api/ecu/handoffs/'+sent.id+'/choose',{
  quoteId:q1.id,version:1,price:250000,agree:true
 },owner.token)).status,409);
 assert.equal((await t.api('POST','/api/ecu/handoffs/'+sent.id+'/choose',{
  quoteId:q2.id,version:2,price:350000,agree:false
 },owner.token)).status,400);
 ok(await t.api('POST','/api/ecu/handoffs/'+sent.id+'/choose',{
  quoteId:q2.id,version:2,price:350000,agree:true
 },owner.token));
 assert.equal((await countPayments()),beforePayments,'no new payment/hold from technical handoff');
 const chosen=ok(await t.api('GET','/api/ecu/handoffs/'+sent.id,undefined,expert.token));
 assert.equal(chosen.actor,'expert');
 assert.equal(chosen.vehicle.vin,'VF611MTA000123456');
 assert.equal(chosen.history.length,1,'selected specialist reads the source technician report');
 assert.match(chosen.history[0].resultNote,/цепи|питания|массы/i);
 assert.equal(chosen.station.public_name,'Стенд ЭБУ Север');
 const note=ok(await t.api('POST','/api/ecu/handoffs/'+sent.id+'/notes',{
  body:'Нужна доставка блока. Позвоните +7 999 123 45 67'
 },expert.token));
 assert.match(note.body,/номер скрыт/);
 assert.equal((await t.api('POST','/api/ecu/handoffs/'+sent.id+'/notes',
  {body:'Вы не участник'},outsider.token)).status,403);
 ok(await t.api('POST','/api/ecu/handoffs/'+sent.id+'/close',{
  reason:'Диагностика согласована, технические вопросы закрыты'
 },owner.token));
 const closed=ok(await t.api('GET','/api/ecu/handoffs/'+sent.id,undefined,expert.token));
 assert.equal(closed.state,'closed');
 assert.equal((await countPayments()),beforePayments);
 assert.equal(ok(await t.api('POST','/api/orders/'+source.id+'/ecu-handoff',{
  summary:'Прежняя передача уже закрыта, новая не создаётся'
 },master.token)).created,false);
});
