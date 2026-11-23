import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, ok } from './helpers.ts';

const base = {
  make: 'Scania', model: 'R', productionYear: 2014,
  ecu: 'EDC16', code: 'P0420',
  symptoms: 'Двигатель работает неровно под нагрузкой',
  checksPerformed: 'Проверены давление и питание датчиков',
  verifiedFix: 'Разъём заменён, параметры в норме',
  provenanceNote: 'Проверено по фактическим измерениям без данных клиента',
};

async function specialist(t: Awaited<ReturnType<typeof setup>>) {
  const admin = await t.login('+79990000001');
  const expert = await t.login('+79996662001','master');
  const client = await t.login('+79996662002');
  ok(await t.api('PUT','/api/performer/profile',{
    kind:'master',name:'Техспециалист',specialties:['diag'],
    taxStatus:'self_employed',inn:'780000000555',
  },expert.token));
  ok(await t.api('POST',`/api/admin/performers/${expert.id}/verify`,
    {decision:'approved'},admin.token));
  return {admin,expert,client};
}

test('verified specialist technical cases reject email, plate, phone and obfuscated customer identifiers before persistence',
  {timeout:60000}, async()=>{
  const t=await setup();
  try {
    const {admin,expert,client}=await specialist(t);
    assert.equal((await t.api('GET','/api/tech/repair-cases',undefined,client.token)).status,403);
    assert.equal((await t.api('POST','/api/tech/repair-cases',base,client.token)).status,403);
    const contaminated = [
      {symptoms:'Связаться с diag@example.ru после ремонта'},
      {checksPerformed:'Запись госномера: А123ВС178 для сверки'},
      {verifiedFix:'Клиенту звонить +7 (921) 123-45-67'},
      {verifiedFix:'Клиенту звонить +7 (921) 123-45-6\u200b7'},
      {provenanceNote:'Паспорт: 4010 123456 указан в акте'},
      {provenanceNote:'VIN: XTA210990Y1234567 проверили на месте'},
    ] as const;
    for(const patch of contaminated) {
      const answer=await t.api('POST','/api/tech/repair-cases',
        {...base,...patch},expert.token);
      assert.equal(answer.status,400,JSON.stringify({patch,answer:answer.body}));
      assert.equal(answer.body.error,'personal_data');
    }
    const stored=await t.db.one<{n:number}>(
      'select count(*)::int n from technical_repair_cases');
    assert.equal(stored?.n,0,'rejected customer identifiers cannot enter moderation');
    // Approved moderation staff may inspect the queue, never clients.
    assert.equal((await t.api('GET','/api/admin/tech/repair-cases',
      undefined,client.token)).status,403);
    assert.equal((await t.api('GET','/api/admin/tech/repair-cases',
      undefined,admin.token)).status,200);
  }finally{await t.close();}
});

test('technical case review is independent, pending-only, with literal search and no self-approval',
  {timeout:60000}, async()=>{
  const t=await setup();
  try {
    const {admin,expert}=await specialist(t);
    const a=ok(await t.api('POST','/api/tech/repair-cases',base,expert.token));
    assert.equal(a.reviewState,'pending');
    const before=ok(await t.api('GET','/api/tech/repair-cases',undefined,expert.token));
    assert.equal(before.items.some((x:any)=>x.id===a.id),false,
      'specialist must not read another pending internal draft');
    const approved=await t.api('POST',`/api/admin/tech/repair-cases/${a.id}/review`,
      {approve:true,note:'Проверены измерения и подтверждена применимость'},admin.token);
    assert.equal(approved.status,200,JSON.stringify(approved.body));
    const exists=ok(await t.api('GET','/api/tech/repair-cases?q=scania',
      undefined,expert.token));
    assert.ok(exists.items.some((x:any)=>x.id===a.id));
    assert.equal((await t.api('POST',`/api/admin/tech/repair-cases/${a.id}/review`,
      {approve:false,note:'Повторная попытка'},admin.token)).status,404,
      'no second audit decision for an already reviewed case');

    const b=ok(await t.api('POST','/api/tech/repair-cases',
      {...base,model:'R %',ecu:'EDC16_test'},expert.token));
    ok(await t.api('POST',`/api/admin/tech/repair-cases/${b.id}/review`,
      {approve:true,note:'Проверены протоколы диагностики двигателя'},admin.token));
    const wild=ok(await t.api('GET','/api/tech/repair-cases?q=%25',
      undefined,expert.token));
    assert.deepEqual(wild.items.map((x:any)=>x.id),[b.id],
      'percent sign is a literal catalog search, not SQL wildcard');
    const underscore=ok(await t.api('GET','/api/tech/repair-cases?q=_test',
      undefined,expert.token));
    assert.deepEqual(underscore.items.map((x:any)=>x.id),[b.id]);

    const own=ok(await t.api('POST','/api/tech/repair-cases',base,admin.token));
    const self=await t.api('POST',`/api/admin/tech/repair-cases/${own.id}/review`,
      {approve:true,note:'Пытаюсь подтвердить собственный материал'},admin.token);
    assert.equal(self.status,403,'a staff author cannot vouch for own repair evidence');
    const huge=await t.api('POST',
      '/api/admin/tech/repair-cases/9999999999999999999999999999999999/review',
      {approve:true,note:'Неверный номер проверяемой записи'},admin.token);
    assert.equal(huge.status,404,'malformed case ID must not produce database HTTP 500');
  }finally{await t.close();}
});
