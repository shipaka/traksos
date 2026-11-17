import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setup,ok} from './helpers.ts';
import {publishedEcuWorkshop} from './ecuWorkshopFixture.ts';

test('service case ledger separates contracts, bank truth and fleet driver permissions',async()=>{
 const t=await setup();
 try{
  const admin=await t.login('+79990000001');
  const owner=await t.login('+79996123001','client');
  const driver=await t.login('+79996123002','driver');
  const outsider=await t.login('+79996123003','client');
  const master=await t.login('+79996123004','master');
  const ecu=await publishedEcuWorkshop(t,'+79996123005');
  await t.db.query('update users set owner_id=$2 where id=$1',[driver.id,owner.id]);
  const parent=ok(await t.api('POST','/api/orders',{
   service:'electric',zoneId:'spb',paymentMethod:'cash',isSos:true,
   brand:'Renault',model:'Premium',year:2010,
   address:'Санкт-Петербург, тестовая стоянка 111',
   description:'Неисправность электропроводки грузовика, нужна диагностика'
  },driver.token));
  const root=parent.order.id as string;
  await t.db.query(
   "update orders set status='completed',call_out_amount=100000,"+
   "work_amount=50000,client_fee_pct=5,discount_amount=2000,"+
   "payment_method='online',amount_confirmed_at=now(),completed_at=now() "+
   "where id=$1",[root]);
  await t.db.query(
   "insert into order_events(order_id,actor_id,type,data) "+
   "values($1,$2,'amount_confirmed',$3)",[root,driver.id,{total:155500}]);
  await t.db.query(
   "insert into payments(order_id,kind,method,amount,client_fee,total,status,"+
   "provider,idempotency_key,refunded_amount) "+
   "values($1,'work','card',38000,2000,40000,'partially_refunded',"+
   "'mock',$2,12000)",[root,'service-case-ledger-'+root]);
  const added=ok(await t.api('POST','/api/orders',{
   service:'ecu',additionalTo:root,zoneId:'ecu_station',ecuSpecialistId:ecu.id,paymentMethod:'cash',
   address:'Санкт-Петербург, тестовая стоянка 111',
   description:'Дополнительная диагностика электронного блока управления'
  },owner.token));
  const extra=added.order.id as string;
  assert.notEqual(root,extra);
  await t.db.query(
   "update orders set status='awaiting_confirmation',call_out_amount=80000,"+
   "work_amount=25000,amount_proposed_at=now() where id=$1",[extra]);
  await t.db.query(
   "insert into order_events(order_id,actor_id,type,data) "+
   "values($1,$2,'amount_proposed','{}')",[extra,master.id]);
  const url='/api/orders/'+root+'/case-ledger';
  const full=ok(await t.api('GET',url,undefined,owner.token));
  assert.equal(full.rootId,root);
  assert.equal(full.separateContracts,true);
  assert.equal(full.limitedToCreator,false);
  assert.equal(full.stages.length,2);
  assert.equal(full.pendingApprovals,1);
  assert.equal(full.stages[0].price.confirmedTotal,155500,
   'confirmed price must not be mislabeled as bank-captured');
  assert.equal(full.stages[0].paymentEvidence.capturedNetKopecks,28000);
  assert.equal(full.stages[0].paymentEvidence.refundedKopecks,12000);
  assert.equal(full.stages[0].paymentEvidence.heldKopecks,0);
  assert.equal(full.stages[0].paymentEvidence.records[0].status,'partially_refunded');
  assert.equal(full.totals.confirmedKopecks,155500);
  assert.equal(full.totals.capturedNetKopecks,28000);
  assert.equal(full.stages[1].additionalTo,root);
  assert.equal(full.stages[1].price.confirmedTotal,null);
  assert.ok(full.stages[1].price.proposedTotal>0);
  assert.equal(full.stages[1].needsCustomerApproval,true);
  assert.equal(full.stages[1].paymentEvidence.records.length,0);
  assert.ok(!JSON.stringify(full).includes('provider_payment_id'));
  assert.ok(!JSON.stringify(full).includes('idempotency_key'));
  const ownerFromChild=ok(await t.api('GET','/api/orders/'+extra+
   '/case-ledger',undefined,owner.token));
  assert.deepEqual(ownerFromChild.stages.map((x:any)=>x.id),
   full.stages.map((x:any)=>x.id));
  const fleet=ok(await t.api('GET',url,undefined,driver.token));
  assert.equal(fleet.limitedToCreator,true);
  assert.deepEqual(fleet.stages.map((x:any)=>x.id),[root]);
  assert.equal((await t.api('GET','/api/orders/'+extra+'/case-ledger',
   undefined,driver.token)).status,404,
   'driver may not request owner-created ECU bill directly');
  assert.equal((await t.api('GET',url,undefined,master.token)).status,404,
   'contractor cannot inspect the other specialist fee or customer payments');
  assert.equal((await t.api('GET',url,undefined,outsider.token)).status,404);
  const staff=ok(await t.api('GET',url,undefined,admin.token));
  assert.equal(staff.stages.length,2);
  await t.db.query(
   "update orders set status='completed',payment_method='online',"+
   "amount_confirmed_at=now(),completed_at=now() where id=$1",[extra]);
  const missing=ok(await t.api('GET',url,undefined,owner.token));
  assert.equal(missing.pendingApprovals,0);
  assert.equal(missing.hasOpenPaymentReconciliation,true,
   'completed online service with no bank row must require reconciliation');
  assert.equal(missing.stages[1].requiresPaymentReconciliation,true);
  assert.equal(missing.stages[1].paymentEvidence.capturedNetKopecks,0);
 }finally{await t.close()}
});
