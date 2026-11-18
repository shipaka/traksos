import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {setup,ok,type T} from './helpers.ts';

let t:T;
let admin:{token:string;id:string};
let client:{token:string;id:string};
let master:{token:string;id:string};

before(async()=>{
  t=await setup();
  admin=await t.login('+79990000001');
  client=await t.login('+79991112233');
  master=await t.login('+79992223344','master');
  ok(await t.api('PUT','/api/performer/profile',{
    kind:'master',name:'Выездной диагност',specialties:['electric'],
    taxStatus:'self_employed',inn:'780000000001'
  },master.token));
  ok(await t.api('POST','/api/admin/performers/'+master.id+'/verify',
    {decision:'approved'},admin.token));
  ok(await t.api('POST','/api/performer/line',{lineStatus:'online'},master.token));
});
after(()=>t.close());

async function scheduledTestOrder(){
  // Existing real dispatch and status machine, no fabricated order rows.
  const o=ok(await t.api('POST','/api/orders',{
    service:'electric',zoneId:'spb',
    description:'Проверить электрическую неисправность на стоянке'
  },client.token)).order;
  ok(await t.api('POST','/api/orders/'+o.id+'/offers',{},master.token));
  const bids=ok(await t.api('GET','/api/orders/'+o.id+'/offers',undefined,client.token));
  ok(await t.api('POST','/api/orders/'+o.id+'/offers/'+bids.offers[0].id+'/choose',
    {},client.token));
  ok(await t.api('POST','/api/orders/'+o.id+'/step',{action:'arrive'},master.token));
  ok(await t.api('POST','/api/orders/'+o.id+'/amount',{
    extras:[{name:'Предохранитель',amount:40000}],result:'solved',
    note:'Проверены цепи питания и заменён предохранитель'
  },master.token));
  return o.id as string;
}
async function closeEmergency(id:string,key:string) {
  return t.api('POST','/api/orders/'+id+'/emergency-close',{
    requestKey:key,reason:'client_offline',workFinished:true,
    note:'Работа выполнена, заказчик сейчас без связи и не может подтвердить результат.'
  },master.token);
}

test('emergency flow: assigned performer can release physical work, not approve money',async()=>{
  const id=await scheduledTestOrder();
  const key='emergency-test-a-20261118';
  const first=ok(await closeEmergency(id,key));
  assert.equal(first.status,'pending_client');
  assert.equal(first.operationalStatus,'work_submitted_pending_client');
  assert.equal(ok(await closeEmergency(id,key)).created,false);
  const view=ok(await t.api('GET','/api/orders/'+id,undefined,client.token));
  assert.equal(view.status,'awaiting_confirmation');
  assert.equal(view.unilateralClosure.status,'pending_client');
  assert.equal(view.completedAt,null);
  assert.equal(view.statusLabel,'Работа сдана · ожидаем клиента');
  const perf=ok(await t.api('GET','/api/orders?as=performer',undefined,master.token));
  assert.equal(perf.find((o:any)=>o.id===id).unilateral_status,'pending_client');
  const state=await t.db.one<any>('select status,completed_at,amount_confirmed_at from orders where id=$1',[id]);
  assert.equal(state.status,'awaiting_confirmation');
  assert.equal(state.completed_at,null);
  assert.equal(state.amount_confirmed_at,null);
  const count=await t.db.one<{n:number}>(
    'select count(*)::int n from order_unilateral_closures where order_id=$1',[id]);
  assert.equal(count?.n,1);
  // Worker may take new work after server ACK, not while physically performing it.
  const busy=await t.app.orders.busyWith(t.db,master.id,null);
  assert.equal(busy,false);
  // Authenticated client approval follows the normal guarded /confirm and payment flow.
  const denied=await t.api('POST','/api/orders/'+id+'/confirm',
    {total:view.unilateralClosure.quoteTotal},master.token);
  assert.notEqual(denied.status,200,'performer cannot approve the customer amount');
  ok(await t.api('POST','/api/orders/'+id+'/confirm',
    {total:view.unilateralClosure.quoteTotal},client.token));
  const completed=ok(await t.api('GET','/api/orders/'+id,undefined,client.token));
  assert.equal(completed.status,'completed');
  assert.equal(completed.unilateralClosure.status,'accepted');
});

test('emergency flow: client disagreement enters moderation without reopening physical job',async()=>{
  const id=await scheduledTestOrder();
  ok(await closeEmergency(id,'emergency-test-b-20261118'));
  const prohibited=await t.api('POST','/api/orders/'+id+'/dispute',
    {reason:'Неправильная запчасть'},client.token);
  assert.equal(prohibited.status,409,'ordinary price dispute cannot restart the job');
  const disputed=ok(await t.api('POST','/api/orders/'+id+'/emergency-dispute',{
    reason:'После диагностики неисправность сохранилась; прошу проверить работу'
  },client.token));
  assert.equal(disputed.status,'disputed');
  const repeat=ok(await t.api('POST','/api/orders/'+id+'/emergency-dispute',{
    reason:'После диагностики неисправность сохранилась; прошу проверить работу'
  },client.token));
  assert.equal(repeat.status,'disputed');
  const cases=await t.db.query<any>(
    "select id from mod_cases where order_id=$1 and kind='dispute'",[id]);
  assert.equal(cases.length,1);
  const state=await t.db.one<any>('select status,amount_confirmed_at from orders where id=$1',[id]);
  assert.equal(state.status,'awaiting_confirmation');
  assert.equal(state.amount_confirmed_at,null);
  const forbidden=await t.api('POST','/api/orders/'+id+'/confirm',{total:100000},client.token);
  assert.equal(forbidden.status,409);
});

test('SLA: one reminder, one overdue moderator review, never customer consent',async()=>{
  const id=await scheduledTestOrder();
  ok(await closeEmergency(id,'emergency-test-c-20261118'));
  assert.deepEqual(await t.app.unilateral.tickSla({reminderHours:1,escalationHours:2}),
    {reminded:0,escalated:0});
  t.clock.advance(3601);
  assert.deepEqual(await t.app.unilateral.tickSla({reminderHours:1,escalationHours:2}),
    {reminded:1,escalated:0});
  assert.deepEqual(await t.app.unilateral.tickSla({reminderHours:1,escalationHours:2}),
    {reminded:0,escalated:0});
  t.clock.advance(3601);
  assert.deepEqual(await t.app.unilateral.tickSla({reminderHours:1,escalationHours:2}),
    {reminded:0,escalated:1});
  assert.deepEqual(await t.app.unilateral.tickSla({reminderHours:1,escalationHours:2}),
    {reminded:0,escalated:0});
  const closure=await t.db.one<any>(
    'select reminder_sent_at,escalated_at,escalation_case_id from order_unilateral_closures where order_id=$1',[id]);
  assert.ok(closure.reminder_sent_at);
  assert.ok(closure.escalated_at);
  assert.ok(closure.escalation_case_id);
  const count=await t.db.one<{n:number}>(
    "select count(*)::int n from mod_cases where order_id=$1 and kind='dispute'",[id]);
  assert.equal(count?.n,1);
  const notifications=await t.db.query<any>(
    "select kind from notifications where user_id=$1 and data->>'orderId'=$2 and kind='unilateral_reminder'",
    [client.id,id]);
  assert.equal(notifications.length,1);
  const state=await t.db.one<any>('select status,completed_at,amount_confirmed_at from orders where id=$1',[id]);
  assert.equal(state.status,'awaiting_confirmation');
  assert.equal(state.completed_at,null);
  assert.equal(state.amount_confirmed_at,null);
  // The client may object AFTER a moderator's timeout case already exists.
  // Upgrade that existing case, do not create a second case or revive the trip.
  ok(await t.api('POST','/api/orders/'+id+'/emergency-dispute',{
    reason:'После проверки машина всё ещё не заводится, работу оспариваю'
  },client.token));
  const reviewed=await t.db.query<any>(
    "select id,priority,text from mod_cases where order_id=$1 and kind='dispute'",[id]);
  assert.equal(reviewed.length,1);
  assert.equal(reviewed[0].priority,1);
  assert.match(reviewed[0].text,/машина всё ещё не заводится/);
  const afterDispute=await t.db.one<any>(
    'select status,completed_at from orders where id=$1',[id]);
  assert.equal(afterDispute.status,'awaiting_confirmation');
  assert.equal(afterDispute.completed_at,null);
});
