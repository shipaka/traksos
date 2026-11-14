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
