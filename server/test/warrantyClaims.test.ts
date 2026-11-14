import { test } from 'node:test';
import assert from 'node:assert/strict';

// A reviewer on the protected staff allowlist is needed for independent appeal.
process.env.MODERATOR_PHONES = '+79998886695';
const {setup,ok}=await import('./helpers.ts');

async function completedRepair() {
  const t=await setup();
  const admin=await t.login('+79990000001');
  const client=await t.login('+79998886681');
  const stranger=await t.login('+79998886682');
  const performer=await t.login('+79998886683','master');
  const reviewer=await t.login('+79998886695');
  await t.db.query("update users set roles='{moderator}'::text[] where id=$1",[reviewer.id]);
  ok(await t.api('PUT','/api/performer/profile',{
    kind:'master',name:'Гарантийный мастер',specialties:['electric'],
    taxStatus:'self_employed',inn:'780000000888',
  },performer.token));
  ok(await t.api('POST',`/api/admin/performers/${performer.id}/verify`,
    {decision:'approved'},admin.token));
  ok(await t.api('POST','/api/performer/line',{lineStatus:'online'},performer.token));
  const created=ok(await t.api('POST','/api/orders',
    {service:'electric',zoneId:'spb',isSos:true,paymentMethod:'cash',
     description:'Выездной ремонт генератора'},client.token));
  const id=created.order.id as string;
  ok(await t.api('POST',`/api/orders/${id}/offers`,{},performer.token));
  const bids=ok(await t.api('GET',`/api/orders/${id}/offers`,undefined,client.token));
  assert.ok(bids.offers?.length);
  ok(await t.api('POST',`/api/orders/${id}/offers/${bids.offers[0].id}/choose`,
    {},client.token));
  ok(await t.api('POST',`/api/orders/${id}/step`,{action:'arrive'},performer.token));
  ok(await t.api('POST',`/api/orders/${id}/amount`,
    {extras:[{name:'Контакт',amount:40000}],result:'solved'},performer.token));
  ok(await t.api('POST',`/api/orders/${id}/confirm`,{},client.token));
  const order=await t.db.one<any>('select * from orders where id=$1',[id]);
  assert.equal(order.status,'completed');
  return {t,admin,client,stranger,performer,reviewer,id};
}

test('warranty: 12 concurrent customer clicks produce one claim, no price dispute and no foreign access',
  {timeout:60000},async()=>{
  const f=await completedRepair();
  try{
    const req={
      defect:'После ремонта генератор снова не заряжает, нужна независимая проверка',
      requestedRemedy:'full_refund',
      evidence:'Видеозапись и сообщения сохранены в обращении',
    };
    const create=()=>f.t.api('POST',`/api/orders/${f.id}/warranty-claims`,req,f.client.token);
    const responses=await Promise.all(Array.from({length:12},create));
    assert.ok(responses.every(x=>x.status===200),JSON.stringify(responses));
    const ids=[...new Set(responses.map(x=>x.body.id))];
    assert.equal(ids.length,1);
    const id=ids[0];
    const claims=await f.t.db.query('select id from warranty_claims where order_id=$1',[f.id]);
    assert.equal(claims.length,1);
    const events=await f.t.db.query<any>('select event from warranty_claim_events where claim_id=$1',[id]);
    assert.deepEqual(events.map(x=>x.event),['opened']);
    const details=ok(await f.t.api('GET',`/api/warranty-claims/${id}`,undefined,f.client.token));
    assert.equal(details.requestedRemedy,'full_refund');
    assert.equal(details.status,'submitted');
    assert.equal(details.fulfilment,'not_started');
    assert.equal(details.caseRootId,f.id);
    assert.equal((await f.t.api('GET',`/api/warranty-claims/${id}`,undefined,f.stranger.token)).status,403);
    assert.equal((await f.t.api('POST',`/api/orders/${f.id}/warranty-claims`,
      {...req,defect:'У меня новая отдельная жалоба'},f.client.token)).status,409);
    assert.equal((await f.t.api('POST',`/api/orders/${f.id}/warranty-claims`,
      req,f.stranger.token)).status,403);
    assert.equal((await f.t.api('GET','/api/admin/warranty-claims',undefined,f.client.token)).status,403);
    const mine=ok(await f.t.api('GET','/api/warranty-claims',undefined,f.performer.token));
    assert.equal(mine.length,1);
    const queue=ok(await f.t.api('GET','/api/admin/warranty-claims',undefined,f.admin.token));
    assert.equal(queue.length,1);
    assert.equal(queue[0].status,'submitted');
    assert.equal((await f.t.db.query("select id from mod_cases where order_id=$1",[f.id])).length,0,
      'a warranty claim is not a price dispute');
  } finally {await f.t.close();}
});

test('warranty: executor explanation, evidence, staff decision and independent appeal; NO funds moved',
  {timeout:60000},async()=>{
  const f=await completedRepair();
  try{
    const ledgerBefore=await f.t.db.query<any>(
      'select account,performer_id,amount,kind from ledger_entries where order_id=$1 order by id',[f.id]);
    const payoutBefore=await f.t.db.query<any>('select * from payouts where order_id=$1',[f.id]);
    const created=ok(await f.t.api('POST',`/api/orders/${f.id}/warranty-claims`,
      {defect:'Замена контакта не помогла, сбой электрической системы возвращается',
       requestedRemedy:'alternative'},f.client.token));
    const id=created.id;
    assert.equal((await f.t.api('POST',`/api/warranty-claims/${id}/respond`,
      {position:'contest_fault',note:'Я не выполнял эту работу'},f.stranger.token)).status,403);
    const response=ok(await f.t.api('POST',`/api/warranty-claims/${id}/respond`,
      {position:'contest_fault',note:'Проводку проверил, отказ вызван другой неисправностью'},f.performer.token));
    assert.equal(response.performerPosition,'contest_fault');
    assert.equal((await f.t.api('POST',`/api/admin/warranty-claims/${id}/decide`,
      {decision:'full_refund',note:'Я сам решил'},f.client.token)).status,403);
    ok(await f.t.api('POST',`/api/warranty-claims/${id}/evidence`,
      {note:'В телефонном разговоре указан личный номер +79990000000, есть фото'},f.client.token));
    const review=ok(await f.t.api('POST',`/api/admin/warranty-claims/${id}/review`,
      {},f.admin.token));
    assert.equal(review.status,'reviewing');
    const decided=ok(await f.t.api('POST',`/api/admin/warranty-claims/${id}/decide`,
      {decision:'repair_by_alternative',
       note:'Нужна проверка записей и контрольная диагностика другого специалиста'},f.admin.token));
    assert.equal(decided.status,'decision_recorded');
    assert.equal(decided.decision,'repair_by_alternative');
    assert.equal(decided.fulfilment,'not_started');
    assert.equal((await f.t.api('POST',`/api/admin/warranty-claims/${id}/decide`,
      {decision:'full_refund',note:'Повторное списание без проверки невозможно'},f.admin.token)).status,409);
    const appeal=ok(await f.t.api('POST',`/api/warranty-claims/${id}/appeal`,
      {reason:'Исполнитель возражает против выводов о качестве работ и требует проверку'},f.performer.token));
    assert.equal(appeal.status,'appealed');
    assert.equal(appeal.appealCount,1);
    assert.equal((await f.t.api('POST',`/api/admin/warranty-claims/${id}/decide`,
      {decision:'not_fault',note:'Нужна независимая переоценка первоначального заключения'},f.admin.token)).status,403,
      'original reviewer cannot decide their own appealed case');
    const reviewed=ok(await f.t.api('POST',`/api/admin/warranty-claims/${id}/decide`,
      {decision:'needs_external_review',
       note:'Независимых технических доказательств пока недостаточно, требуется экспертиза'},
      f.reviewer.token));
    assert.equal(reviewed.status,'decision_recorded');
    assert.equal(reviewed.decision,'needs_external_review');
    assert.equal((await f.t.api('POST',`/api/warranty-claims/${id}/appeal`,
      {reason:'Предоставляю новые доказательства повторной неисправности'},f.client.token)).status,409);
    const events=await f.t.db.query<any>(
      'select event from warranty_claim_events where claim_id=$1 order by id',[id]);
    assert.deepEqual(events.map(e=>e.event),[
      'opened','performer_responded','evidence_added','review_started',
      'decision_recorded','decision_appealed','decision_recorded',
    ]);
    const evidence=ok(await f.t.api('GET',`/api/warranty-claims/${id}`,undefined,f.performer.token));
    const e=evidence.events.find((x:any)=>x.event==='evidence_added');
    assert.ok(e);
    assert.ok(!e.data.note.includes('+79990000000'),'phone is masked in evidence');
    const ledgerAfter=await f.t.db.query<any>(
      'select account,performer_id,amount,kind from ledger_entries where order_id=$1 order by id',[f.id]);
    const payoutAfter=await f.t.db.query<any>('select * from payouts where order_id=$1',[f.id]);
    assert.deepEqual(ledgerAfter,ledgerBefore,'no money or unrelated contractor balances change on claim');
    assert.deepEqual(payoutAfter,payoutBefore,'no executor payout deducted by filing or decision');
    assert.equal((await f.t.db.query('select id from orders where continuation_of=$1',[f.id])).length,0,
      'the complaint itself never charges a new order to customer');
  } finally {await f.t.close();}
});

test('warranty: unfinished orders and nonparticipants cannot file', {timeout:60000},async()=>{
  const t=await setup();
  try{
    const client=await t.login('+79998886684');
    const stranger=await t.login('+79998886689');
    const created=ok(await t.api('POST','/api/orders',
      {service:'electric',zoneId:'spb',isSos:true,paymentMethod:'cash'},client.token));
    const id=created.order.id;
    const p={defect:'Неисправность проявляется снова после работы',requestedRemedy:'assessment'};
    assert.equal((await t.api('POST',`/api/orders/${id}/warranty-claims`,p,client.token)).status,409);
    assert.equal((await t.api('POST',`/api/orders/${id}/warranty-claims`,p,stranger.token)).status,403);
    assert.equal((await t.db.query('select id from warranty_claims')).length,0);
  } finally {await t.close();}
});


test('warranty rework: original executor fixes for free, 12 staff retries still one job',
  {timeout:60000},async()=>{
  const f=await completedRepair();
  try{
    const claim=ok(await f.t.api('POST',`/api/orders/${f.id}/warranty-claims`,
      {defect:'Генератор снова перестал работать сразу после ремонта',
       requestedRemedy:'rework'},f.client.token));
    assert.equal((await f.t.api('POST',`/api/admin/warranty-claims/${claim.id}/remedies`,
      {performerId:f.performer.id,budgetKopecks:0,task:'Заново проверить контакты генератора'},
      f.admin.token)).status,409,'no assignment before reviewed decision');
    ok(await f.t.api('POST',`/api/admin/warranty-claims/${claim.id}/decide`,
      {decision:'repair_by_original',
       note:'По согласованной претензии первичный исполнитель исправляет результат без доплаты'},
      f.admin.token));
    const input={performerId:f.performer.id,budgetKopecks:0,
      task:'Повторно проверить контакты генератора без оплаты клиента'};
    const responses=await Promise.all(Array.from({length:12},()=>
      f.t.api('POST',`/api/admin/warranty-claims/${claim.id}/remedies`,
        input,f.admin.token)));
    assert.ok(responses.every(x=>x.status===200),JSON.stringify(responses));
    const ids=[...new Set(responses.map(x=>x.body.id))];
    assert.equal(ids.length,1,'twelve staff submissions must authorize one corrective job');
    const id=ids[0];
    const shown=ok(await f.t.api('GET',`/api/warranty-remedies/${id}`,undefined,
      f.client.token));
    assert.equal(shown.clientChargeKopecks,0);
    assert.equal(shown.fundingSource,'performer_in_kind');
    assert.equal(shown.authorizedBudgetKopecks,0);
    assert.equal(shown.caseRootId,f.id);
    assert.equal(shown.sourceOrderId,f.id);
    assert.equal((await f.t.api('GET',`/api/warranty-remedies/${id}`,undefined,
      f.stranger.token)).status,403);
    assert.equal((await f.t.api('POST',`/api/warranty-remedies/${id}/respond`,
      {accept:true},f.stranger.token)).status,403);
    assert.equal((await f.t.api('POST',`/api/admin/warranty-remedies/${id}/record-expense`,
      {amountKopecks:40000,bankReference:'REWORK-123456',
       transferredAt:f.t.clock.now().toISOString()},f.admin.token)).status,409);
    assert.equal(ok(await f.t.api('POST',`/api/warranty-remedies/${id}/respond`,
      {accept:true},f.performer.token)).status,'accepted');
    const report=ok(await f.t.api('POST',`/api/warranty-remedies/${id}/report`,
      {report:'Контакты и клеммы восстановлены, генератор заряжает стабильно'},
      f.performer.token));
    assert.equal(report.status,'reported_done');
    assert.equal((await f.t.api('POST',`/api/warranty-remedies/${id}/confirm`,
      {},f.stranger.token)).status,403);
    const confirmed=ok(await f.t.api('POST',`/api/warranty-remedies/${id}/confirm`,
      {},f.client.token));
    assert.equal(confirmed.status,'client_confirmed');
    assert.equal(confirmed.clientChargeKopecks,0);
    assert.equal((await f.t.db.query('select id from warranty_rework_jobs where claim_id=$1',[claim.id])).length,1);
    assert.equal((await f.t.db.query('select id from warranty_platform_expenses')).length,0);
    assert.equal((await f.t.db.query('select id from orders where continuation_of=$1',[f.id])).length,0);
    assert.equal((await f.t.db.query('select id from payouts where order_id=$1',[f.id])).length,0);
  }finally{await f.t.close();}
});

test('warranty alternative: bank transfer proof is recorded once from platform only, not the original master',
  {timeout:60000},async()=>{
  const f=await completedRepair();
  try{
    const alternative=await f.t.login('+79998886686','master');
    ok(await f.t.api('PUT','/api/performer/profile',{
      kind:'master',name:'Исполнитель гарантии',specialties:['electric'],
      taxStatus:'self_employed',inn:'780000000889'},alternative.token));
    ok(await f.t.api('POST',`/api/admin/performers/${alternative.id}/verify`,
      {decision:'approved'},f.admin.token));
    const claim=ok(await f.t.api('POST',`/api/orders/${f.id}/warranty-claims`,
      {defect:'Повторный отказ заряда, требуются независимые контрольные работы',
       requestedRemedy:'alternative'},f.client.token));
    ok(await f.t.api('POST',`/api/admin/warranty-claims/${claim.id}/decide`,
      {decision:'repair_by_alternative',
       note:'Повторную диагностику проводит иной проверенный специалист; бюджет подтверждён площадкой'},
      f.admin.token));
    const offerPath=`/api/admin/warranty-claims/${claim.id}/remedies`;
    assert.equal((await f.t.api('POST',offerPath,
      {performerId:f.performer.id,budgetKopecks:120000,task:'Исправить результат предыдущей работы'},
      f.admin.token)).status,409);
    assert.equal((await f.t.api('POST',offerPath,
      {performerId:alternative.id,budgetKopecks:0,task:'Исправить результат предыдущей работы'},
      f.admin.token)).status,400);
    assert.equal((await f.t.api('POST',offerPath,
      {performerId:alternative.id,budgetKopecks:120000,task:'Исправить результат предыдущей работы'},
      f.client.token)).status,403);
    const offered=ok(await f.t.api('POST',offerPath,
      {performerId:alternative.id,budgetKopecks:120000,
       task:'Выполнить независимую повторную диагностику системы зарядки'},
      f.admin.token));
    const id=offered.id;
    assert.equal(offered.fundingSource,'platform');
    assert.equal(offered.clientChargeKopecks,0);
    assert.equal((await f.t.api('POST',`/api/warranty-remedies/${id}/respond`,
      {accept:true},f.performer.token)).status,403);
    assert.equal((await f.t.api('POST',`/api/warranty-remedies/${id}/confirm`,
      {},f.client.token)).status,409);
    const originalLedger=await f.t.db.query<any>(
      'select id,account,amount,performer_id,kind from ledger_entries order by id');
    const originalPayouts=await f.t.db.query<any>('select id,performer_id,amount,status from payouts order by id');
    ok(await f.t.api('POST',`/api/warranty-remedies/${id}/respond`,
      {accept:true},alternative.token));
    ok(await f.t.api('POST',`/api/warranty-remedies/${id}/report`,
      {report:'Контрольная диагностика проведена, неисправность устранена и проверена'},
      alternative.token));
    ok(await f.t.api('POST',`/api/warranty-remedies/${id}/confirm`,{},f.client.token));
    const payload={
      amountKopecks:110000,bankReference:'WARRANTY-PAID-987654',
      transferredAt:f.t.clock.now().toISOString(),
    };
    const endpoint=`/api/admin/warranty-remedies/${id}/record-expense`;
    assert.equal((await f.t.api('POST',endpoint,payload,f.client.token)).status,403);
    const receipts=await Promise.all(Array.from({length:12},()=>f.t.api('POST',endpoint,payload,f.admin.token)));
    assert.ok(receipts.every(x=>x.status===200),JSON.stringify(receipts));
    assert.equal([...new Set(receipts.map(x=>x.body.id))].length,1);
    const expense=await f.t.db.query<any>('select * from warranty_platform_expenses where job_id=$1',[id]);
    assert.equal(expense.length,1);
    assert.equal(expense[0].amount_kopecks,110000);
    const journal=await f.t.db.query<any>(
      'select account,amount_kopecks from warranty_platform_expense_ledger where expense_id=$1 order by account',
      [expense[0].id]);
    assert.deepEqual(journal.map(x=>x.account),['platform','warranty_expense']);
    assert.equal(journal.reduce((v,x)=>v+x.amount_kopecks,0),0,'balanced platform expense');
    assert.equal(journal.find(x=>x.account==='platform').amount_kopecks,-110000);
    const changed=await f.t.api('POST',endpoint,
      {...payload,amountKopecks:120000},f.admin.token);
    assert.equal(changed.status,409);
    assert.deepEqual(await f.t.db.query(
      'select id,account,amount,performer_id,kind from ledger_entries order by id'),originalLedger,
      'never debit the original or unrelated master');
    assert.deepEqual(await f.t.db.query(
      'select id,performer_id,amount,status from payouts order by id'),originalPayouts,
      'existing payouts remain untouched');
    assert.equal((await f.t.db.query('select id from payments where order_id=$1',[f.id])).length,0,
      'no customer charge is created by remediation');
    assert.equal((await f.t.db.query('select id from orders where continuation_of=$1',[f.id])).length,0);
  }finally{await f.t.close();}
});
