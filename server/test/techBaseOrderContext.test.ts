import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setup,ok} from './helpers.ts';

test('manually entered truck model/year reach professional club and approved TechBase selection without PII',async()=>{
  const t=await setup();
  try{
    const admin=await t.login('+79990000001');
    const client=await t.login('+79996991001','client');
    const expert=await t.login('+79996991002','master');
    const stranger=await t.login('+79996991003','master');
    ok(await t.api('PUT','/api/performer/profile',{
      kind:'ecu',name:'Инженер электронных блоков',
      specialties:['electric','diag'],taxStatus:'self_employed',inn:'780006991002'
    },expert.token));
    ok(await t.api('PUT','/api/performer/profile',{
      kind:'master',name:'Посторонний диагност',
      specialties:['electric'],taxStatus:'self_employed',inn:'780006991003'
    },stranger.token));
    for(const x of [expert,stranger])ok(await t.api('POST',
      '/api/admin/performers/'+x.id+'/verify',{decision:'approved'},admin.token));

    const order=await t.db.one<{id:string}>(`
      insert into orders(client_id,created_by,service,status,performer_id,
        brand,model,year,description,address)
      values($1,$1,'ecu','accepted',$2,'Renault','Premium',2010,
        'Восстановление блока управления','Личный адрес клиента')
      returning id`,[client.id,expert.id]);
    const document=await t.db.one<{id:string}>(`
      insert into community_knowledge(author_id,title,make,model,model_year,subsystem,
        description,rights_basis,rights_review,technical_review)
      values($1,'Проверка EBS Premium','Renault','Premium',2010,'ecu',
        'Тестовая инструкция с авторскими правами без реальной заводской схемы',
        'own','approved','approved') returning id`,[expert.id]);

    const path='/api/community/knowledge/for-order/'+order!.id;
    assert.equal((await t.api('GET',path,undefined,client.token)).status,403);
    assert.equal((await t.api('GET',path,undefined,stranger.token)).status,404);
    const material=ok(await t.api('GET',path,undefined,expert.token));
    assert.equal(material.context.brand,'Renault');
    assert.equal(material.context.model,'Premium');
    assert.equal(material.context.year,2010);
    assert.ok(material.articles.some((x:any)=>x.id===document!.id),
      'reviewed material for exact model/year is discoverable without a garage vehicle record');
    for(const sensitive of ['phone','address','lat','lng','vin','plate','clientId','orderId'])
      assert.equal(sensitive in material.context,false,sensitive);
    assert.match(material.warning,/VIN/i);
    const preview=ok(await t.api('GET',
      '/api/community/pro-cases/order-preview/'+order!.id,undefined,expert.token));
    assert.equal(preview.make,'Renault');
    assert.equal(preview.model,'Premium');
    assert.equal(preview.modelYear,2010);
    for(const sensitive of ['phone','address','lat','lng','vin','plate','clientId','orderId'])
      assert.equal(sensitive in preview,false,sensitive);
    assert.equal((await t.api('GET',
      '/api/community/pro-cases/order-preview/'+order!.id,undefined,stranger.token)).status,404);
  }finally{await t.close()}
});
