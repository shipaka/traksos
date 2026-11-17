import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {setup,ok} from './helpers.ts';

test('only the author can appeal a hidden case and a different moderator may overturn it',async()=>{
  const t=await setup();
  try{
    const admin=await t.login('+79990000001');
    const reviewer=await t.login('+79990000002','client');
    await t.db.query("update users set roles=ARRAY['moderator']::text[] where id=$1",
      [reviewer.id]);
    const writer=await t.login('+79996300101','master');
    const colleague=await t.login('+79996300102','master');
    const outsider=await t.login('+79996300103','driver');
    for(const [i,u] of [writer,colleague].entries()){
      ok(await t.api('PUT','/api/performer/profile',{
        kind:'master',name:'Слесарь '+i,
        specialties:['electric'],taxStatus:'self_employed',
        inn:'7800000330'+String(i).padStart(2,'0')
      },u.token));
      ok(await t.api('POST','/api/admin/performers/'+u.id+'/verify',
        {decision:'approved'},admin.token));
    }
    const rooms=ok(await t.api('GET','/api/community/rooms',undefined,writer.token));
    const roomId=rooms.rooms.find((x:any)=>x.slug==='electric-pro').id;
    for(const user of [writer,colleague])
      ok(await t.api('POST','/api/community/rooms/'+roomId+'/join',{},user.token));
    const base='/api/community/pro-cases';
    const data=ok(await t.api('POST',base,{
      roomId,clientNonce:randomUUID(),make:'Renault',model:'Premium',modelYear:2010,
      subsystem:'EBS',symptoms:'На тягаче проявляются непостоянные ошибки EBS после прогрева, питание и массу уже проверили.',
      dtcCodes:['P0401']
    },writer.token));
    const caseId=data.case.id;
    ok(await t.api('POST',base+'/'+caseId+'/report',{
      reason:'В данном описании может находиться опасная техническая рекомендация'
    },colleague.token));
    const moderation='/api/admin/community/pro-cases/reports';
    const reports=ok(await t.api('GET',moderation,undefined,admin.token)).reports;
    const report=reports.find((x:any)=>x.case_id===caseId&&x.reply_id===null);
    assert.ok(report);
    ok(await t.api('POST',moderation+'/'+report.id+'/review',{
      decision:'hide',note:'Проверена техническая опасность совета: требуется дополнительный аудит'
    },admin.token));
    assert.equal((await t.api('GET',base+'/'+caseId,undefined,writer.token)).status,404);

    const own='/api/community/pro-cases/my-moderation';
    assert.equal(ok(await t.api('GET',own,undefined,outsider.token)).decisions.length,0);
    const list=ok(await t.api('GET',own,undefined,writer.token));
    const decision=list.decisions.find((x:any)=>x.report_id===report.id);
    assert.ok(decision);
    assert.ok(!('reporter_id' in decision));
    assert.ok(!('reporter_phone' in decision));

    const appealEndpoint=base+'/appeals';
    const appeal={reportId:report.id,
      grounds:'Это собственное описание исходной неисправности, а не указание изменять заводские настройки; прошу пересмотреть скрытие.'};
    assert.equal((await t.api('POST',appealEndpoint,appeal,colleague.token)).status,404,
      'the reporting specialist cannot appeal someone else\'s removed material');
    const opened=ok(await t.api('POST',appealEndpoint,appeal,writer.token));
    assert.equal(opened.status,'pending');
    assert.equal(opened.created,true);
    const replay=ok(await t.api('POST',appealEndpoint,appeal,writer.token));
    assert.equal(replay.id,opened.id);
    assert.equal(replay.created,false);
    assert.equal((await t.api('POST',appealEndpoint,
      {...appeal,grounds:appeal.grounds+' изменено'},writer.token)).status,409);
    const reviewPath='/api/admin/community/pro-cases/appeals';
    assert.equal((await t.api('GET',reviewPath,undefined,writer.token)).status,403);
    const queue=ok(await t.api('GET',reviewPath,undefined,reviewer.token)).appeals;
    assert.equal(queue.filter((x:any)=>x.id===opened.id).length,1);
    assert.equal((await t.api('POST',reviewPath+'/'+opened.id+'/review',{
      decision:'overturned',note:'Независимая проверка показала отсутствие опасных советов'
    },admin.token)).status,409,'the original moderator cannot review their own decision');
    const approved=ok(await t.api('POST',reviewPath+'/'+opened.id+'/review',{
      decision:'overturned',note:'Другим модератором проверен контекст, опасного содержания нет'
    },reviewer.token));
    assert.equal(approved.restored,true);
    assert.equal(approved.knowledgeRequiresReview,false);
    assert.equal((await t.api('POST',reviewPath+'/'+opened.id+'/review',{
      decision:'upheld',note:'Нельзя повторно рассматривать завершённое обжалование'
    },reviewer.token)).status,409);
    assert.equal(ok(await t.api('GET',base+'/'+caseId,undefined,writer.token)).id,caseId);
    const after=ok(await t.api('GET',own,undefined,writer.token)).decisions;
    assert.equal(after.find((x:any)=>x.report_id===report.id)?.appeal_status,'overturned');
    const audits=await t.db.query<{action:string}>(
      "select action from audit_log where action='community.technical_appeal_review'");
    assert.equal(audits.length,1);
  }finally{await t.close()}
});

test('appeal may be upheld without revealing original reporter identity',async()=>{
  const t=await setup();
  try{
    const admin=await t.login('+79990000001');
    const mod=await t.login('+79990000002','client');
    await t.db.query("update users set roles=ARRAY['moderator']::text[] where id=$1",[mod.id]);
    const writer=await t.login('+79996300111','master');
    const colleague=await t.login('+79996300112','master');
    for(const [i,u] of [writer,colleague].entries()){
      ok(await t.api('PUT','/api/performer/profile',{
        kind:'master',name:'Электрик '+i,specialties:['electric'],
        taxStatus:'self_employed',inn:'7800000440'+String(i).padStart(2,'0')
      },u.token));
      ok(await t.api('POST','/api/admin/performers/'+u.id+'/verify',
        {decision:'approved'},admin.token));
    }
    const room=(ok(await t.api('GET','/api/community/rooms',undefined,writer.token))
      .rooms.find((x:any)=>x.slug==='electric-pro'));
    for(const u of [writer,colleague])
      ok(await t.api('POST','/api/community/rooms/'+room.id+'/join',{},u.token));
    const made=ok(await t.api('POST','/api/community/pro-cases',{
      roomId:room.id,clientNonce:randomUUID(),subsystem:'Зарядка',
      symptoms:'Напряжение генератора нестабильно при включении дополнительного оборудования, нужен безопасный порядок диагностики.',
      dtcCodes:[]
    },writer.token));
    const base='/api/community/pro-cases';
    ok(await t.api('POST',base+'/'+made.case.id+'/report',{
      reason:'Подозрение на небезопасную диагностику зарядки'
    },colleague.token));
    const report=ok(await t.api('GET','/api/admin/community/pro-cases/reports',
      undefined,admin.token)).reports[0];
    ok(await t.api('POST','/api/admin/community/pro-cases/reports/'+report.id+'/review',{
      decision:'hide',note:'Риск неправильной диагностики с вмешательством в электропроводку'
    },admin.token));
    const open=ok(await t.api('POST',base+'/appeals',{
      reportId:report.id,
      grounds:'Материал описывает симптомы и просит совета без конкретных указаний, поэтому прошу оставить карточку для коллег.'
    },writer.token));
    const reviewed=ok(await t.api('POST','/api/admin/community/pro-cases/appeals/'+open.id+'/review',{
      decision:'upheld',note:'Проверено другим модератором: публикация всё ещё требует правок'
    },mod.token));
    assert.equal(reviewed.restored,false);
    assert.equal((await t.api('GET',base+'/'+made.case.id,undefined,writer.token)).status,404);
    const list=ok(await t.api('GET',base+'/my-moderation',undefined,writer.token));
    assert.equal(list.decisions[0].appeal_status,'upheld');
    assert.ok(!JSON.stringify(list).includes(colleague.id));
  }finally{await t.close()}
});
