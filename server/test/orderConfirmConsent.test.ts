import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setup,ok} from './helpers.ts';
import {publishedEcuWorkshop} from './ecuWorkshopFixture.ts';

test('service confirmation tolerates lost responses without charging twice',async()=>{
 const t=await setup();
 try{
  const client=await t.login('+79996662001','client');
  const master=await t.login('+79996662002','master');
  const outsider=await t.login('+79996662003','client');
  const made=ok(await t.api('POST','/api/orders',{
   service:'electric',zoneId:'spb',paymentMethod:'cash',
   address:'Санкт-Петербург, стоянка для проверки финансовых статусов',
   description:'Проверка согласования выезда и электрики'
  },client.token));
  const id=made.order.id as string;
  await t.db.query(
   "update orders set status='awaiting_confirmation',performer_id=$2,"+
   "call_out_amount=75000,work_amount=15000,amount_proposed_at=now() "+
   "where id=$1",[id,master.id]);
  const card=ok(await t.api('GET','/api/orders/'+id,undefined,client.token));
  assert.ok(card.amountProposalVersion);
  assert.equal(card.status,'awaiting_confirmation');
  const body={total:card.money.total,proposalVersion:card.amountProposalVersion,points:0};
  const calls=await Promise.all(Array.from({length:12},()=>t.api(
   'POST','/api/orders/'+id+'/confirm',body,client.token)));
  assert.ok(calls.every(x=>x.status===200),
   'all duplicate replies must be a safe acknowledgement: '+
    JSON.stringify(calls.map(x=>({status:x.status,error:x.body?.error}))));
  const status=ok(await t.api('GET','/api/orders/'+id,undefined,client.token));
  assert.equal(status.status,'completed');
  const events=await t.db.query<{id:string}>(
   "select id from order_events where order_id=$1 and type='amount_confirmed'",[id]);
  assert.equal(events.length,1,'only one contract consent event');
  const notices=await t.db.query<{id:string}>(
   "select id from notifications where user_id=$1 and data->>'orderId'=$2 "+
   "and title='Сумма подтверждена'",[master.id,id]);
  assert.equal(notices.length,1,'no repeated performer notification');
  const balance=await t.db.query<{account:string;amount:number}>(
   "select account,amount from ledger_entries where order_id=$1",[id]);
  assert.ok(balance.length>0);
  assert.equal(balance.reduce((sum,x)=>sum+Number(x.amount),0),0,
   'single confirmation must preserve balanced accounting');
  assert.equal((await t.api('POST','/api/orders/'+id+'/confirm',{
   ...body,total:body.total+100
  },client.token)).status,409,
   'a different amount must not be silently acknowledged');
  assert.equal((await t.api('POST','/api/orders/'+id+'/confirm',{
   ...body,points:100
  },client.token)).status,409,
   'retrying a different points request cannot rewrite settled consent');
  assert.equal((await t.api('POST','/api/orders/'+id+'/confirm',
   body,outsider.token)).status,403);
  assert.equal((await t.db.query(
   "select id from order_events where order_id=$1 and type='amount_confirmed'",
   [id])).length,1);
 }finally{await t.close()}
});

test('stale proposal version blocks consent even when the numeric total matches',async()=>{
 const t=await setup();
 try{
  const client=await t.login('+79996662011','client');
  const master=await t.login('+79996662012','master');
  const ecu=await publishedEcuWorkshop(t,'+79996662013');
  const made=ok(await t.api('POST','/api/orders',{
   service:'ecu',zoneId:'ecu_station',ecuSpecialistId:ecu.id,paymentMethod:'cash',
   address:'Санкт-Петербург, тестовая площадка проверки ЭБУ',
   description:'Проверка отдельной сметы специалиста по ЭБУ'
  },client.token));
  const id=made.order.id as string;
  await t.db.query(
   "update orders set status='awaiting_confirmation',performer_id=$2,"+
   "call_out_amount=75000,work_amount=15000,amount_proposed_at=now() "+
   "where id=$1",[id,master.id]);
  const card=ok(await t.api('GET','/api/orders/'+id,undefined,client.token));
  assert.ok(card.amountProposalVersion);
  await t.db.query(
   "update orders set amount_proposed_at=amount_proposed_at+interval '3 seconds' "+
   "where id=$1",[id]);
  const response=await t.api('POST','/api/orders/'+id+'/confirm',{
   total:card.money.total,points:0,proposalVersion:card.amountProposalVersion
  },client.token);
  assert.equal(response.status,409);
  assert.equal((await t.db.one<{status:string}>(
   'select status from orders where id=$1',[id]))?.status,'awaiting_confirmation');
  assert.equal((await t.db.query(
   "select id from order_events where order_id=$1 and type='amount_confirmed'",
   [id])).length,0);
  assert.equal((await t.db.query(
   'select id from ledger_entries where order_id=$1',[id])).length,0);
 }finally{await t.close()}
});

test('two independent service stages cannot spend the same owner bonus balance',async()=>{
 const t=await setup();
 try{
  const client=await t.login('+79996662021','client');
  const master=await t.login('+79996662022','master');
  const ecu=await publishedEcuWorkshop(t,'+79996662023');
  const ids:string[]=[];
  for(const i of [1,2]){
   const created=ok(await t.api('POST','/api/orders',{
    service:i===1?'electric':'ecu',zoneId:'spb',paymentMethod:'cash',
    ecuSpecialistId:i===2?ecu.id:undefined,
    address:'Санкт-Петербург, тестовая площадка '+i,
    description:'Независимое согласование работ №'+i
   },client.token));
   ids.push(created.order.id as string);
   await t.db.query(
    "update orders set status='awaiting_confirmation',performer_id=$2,"+
    "call_out_amount=80000,work_amount=10000,amount_proposed_at=now() "+
    "where id=$1",[created.order.id,master.id]);
  }
  await t.db.query(
   "insert into bonus_entries(user_id,amount,kind,note) "+
   "values($1,5000,'grant','Тестовый исходный бонусный остаток')",[client.id]);
  const cards=await Promise.all(ids.map(async id=>
   ok(await t.api('GET','/api/orders/'+id,undefined,client.token))));
  const result=await Promise.all(ids.map((id,i)=>t.api('POST',
    '/api/orders/'+id+'/confirm',
    {total:cards[i].money.total,points:0,
     proposalVersion:cards[i].amountProposalVersion},client.token)));
  assert.ok(result.every(x=>x.status===200),
   'both independent confirmations must settle without spending the bonus twice');
  const balance=await t.db.one<{n:number;spent:number}>(
   "select coalesce(sum(amount),0)::int as n,"+
   "coalesce(sum(-amount) filter(where kind='use'),0)::int as spent "+
   "from bonus_entries where user_id=$1",[client.id]);
  assert.equal(balance?.n,0);
  assert.equal(balance?.spent,5000,'one credit can only be spent once');
  const debits=await t.db.query<{order_id:string;amount:number}>(
   "select order_id,amount from bonus_entries "+
   "where user_id=$1 and kind='use'",[client.id]);
  assert.equal(debits.length,1,
   'serial owner-level credit lock prevents double bonus debit');
  for(const id of ids){
   assert.equal((await t.db.query(
    "select id from order_events where order_id=$1 and type='amount_confirmed'",
    [id])).length,1);
  }
 }finally{await t.close()}
});
