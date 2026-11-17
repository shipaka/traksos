import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setup,ok} from './helpers.ts';

test('documented vehicle evidence is not a VIN match and never guesses applicability',async()=>{
  const t=await setup();
  try{
    const admin=await t.login('+79990000001');
    const master=await t.login('+79996300201','master');
    const driver=await t.login('+79996300202','driver');
    ok(await t.api('PUT','/api/performer/profile',{
      kind:'master',name:'Электрик тестовой применяемости',
      specialties:['electric'],taxStatus:'self_employed',inn:'780000050201'
    },master.token));
    ok(await t.api('POST','/api/admin/performers/'+master.id+'/verify',
      {decision:'approved'},admin.token));
    const article=await t.db.one<{id:string}>(`
      insert into community_knowledge(author_id,title,make,model,model_year,subsystem,
        description,rights_basis,rights_review,technical_review)
      values($1,'Проверка питания блока EBS','Renault','Premium',2010,'EBS',
        'Тестовый собственный материал, не представляющий заводскую распиновку.',
        'own','approved','approved') returning id`,[master.id]);
    assert.ok(article);
    const base='/api/community/knowledge/applicability/'+article!.id;
    assert.equal((await t.api('GET',base,undefined,driver.token)).status,403);
    assert.equal((await t.api('GET',base,undefined,master.token)).body.status,
      'vehicle_details_required');
    const without=ok(await t.api('GET',base+
      '?make=Renault&model=Premium&year=2010',undefined,master.token));
    assert.equal(without.status,'unknown');
    assert.equal(without.evidenceExists,false);
    assert.equal(without.matchIsVinVerified,false);
    assert.equal(without.vinNeverStored,true);
    assert.equal((await t.api('GET',base+'?make=Renault&model=Premium&year=1900',
      undefined,master.token)).status,400);

    const adminBase='/api/admin/community/knowledge/applicability/'+article!.id;
    assert.equal((await t.api('POST',adminBase,{
      make:'Scania',model:'Premium',yearFrom:2010,yearTo:2010,
      evidenceUrl:'https://example.org/records/test-only',
      sourceRevision:'rev-test-1',
      verificationNote:'Тестовая ревизия для проверки, не используется как реальная заводская схема'
    },admin.token)).status,400);
    const evidence={
      make:'Renault',model:'Premium',yearFrom:2009,yearTo:2011,
      engineCode:'DXI11',ecuVariant:'EBS-3',
      evidenceUrl:'https://example.org/records/test-only',
      sourceRevision:'rev-test-1',
      verificationNote:'В тестовой среде фиксируем точное сочетание двигателя и блока, но не подтверждаем VIN'
    };
    assert.equal((await t.api('POST',adminBase,evidence,master.token)).status,403);
    const created=ok(await t.api('POST',adminBase,evidence,admin.token));
    assert.equal(created.vinVerified,false);
    const noVariant=ok(await t.api('GET',base+'?make=Renault&model=Premium&year=2010',
      undefined,master.token));
    assert.equal(noVariant.status,'engine_or_ecu_details_required');
    assert.equal(noVariant.documentedVariants.length,0);
    const wrong=ok(await t.api('GET',base+
      '?make=Renault&model=Premium&year=2010&engineCode=DXI13&ecuVariant=EBS-3',
      undefined,master.token));
    assert.equal(wrong.status,'engine_or_ecu_details_required');
    const found=ok(await t.api('GET',base+
      '?make=Renault&model=Premium&year=2010&engineCode=DXI11&ecuVariant=EBS-3',
      undefined,master.token));
    assert.equal(found.status,'documented_variant');
    assert.equal(found.matchIsVinVerified,false);
    assert.equal(found.documentedVariants.length,1);
    assert.equal(found.documentedVariants[0].source_revision,evidence.sourceRevision);
    assert.ok(!('vin' in found.documentedVariants[0]));
    assert.ok(!JSON.stringify(found).includes('VIN-TEST-USER'));
    const otherYear=ok(await t.api('GET',base+
      '?make=Renault&model=Premium&year=2014&engineCode=DXI11&ecuVariant=EBS-3',
      undefined,master.token));
    assert.equal(otherYear.status,'unknown','absence of evidence must not become false incompatibility');

    const adminView=ok(await t.api('GET',adminBase,undefined,admin.token));
    assert.equal(adminView.entries.length,1);
    assert.equal(adminView.entries[0].status,'active');
    const statusUrl=adminBase+'/records/'+created.id+'/status';
    assert.equal(ok(await t.api('POST',statusUrl,{
      status:'withdrawn',note:'Материал требует уточнения ревизии оригинального файла'
    },admin.token)).status,'withdrawn');
    assert.equal(ok(await t.api('GET',base+
      '?make=Renault&model=Premium&year=2010&engineCode=DXI11&ecuVariant=EBS-3',
      undefined,master.token)).status,'unknown');
    ok(await t.api('POST',statusUrl,{
      status:'active',note:'Проверены условия использования и версия исходного документа'
    },admin.token));
    await t.db.query("update community_knowledge set technical_review='pending' where id=$1",
      [article!.id]);
    assert.equal((await t.api('GET',base,undefined,master.token)).status,404,
      'evidence must never make a withdrawn/unapproved article public');
    assert.equal((await t.api('POST',statusUrl,{
      status:'active',note:'Не публиковать материал до повторной проверки'
    },admin.token)).status,409);
  }finally{await t.close()}
});
