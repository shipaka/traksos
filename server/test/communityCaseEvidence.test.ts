import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {setup,ok} from './helpers.ts';

test('club evidence links require professional ACL, official HTTPS host and two independent approvals',async()=>{
 const t=await setup();
 try{
  const admin=await t.login('+79990000001');
  const mod=await t.login('+79990000002','client');
  await t.db.query("update users set roles=ARRAY['moderator']::text[] where id=$1",[mod.id]);
  const author=await t.login('+79996530001','master');
  const peer=await t.login('+79996530002','master');
  const driver=await t.login('+79996530003','driver');
  for(const [i,user]of [author,peer].entries()){
    ok(await t.api('PUT','/api/performer/profile',{
      kind:'master',name:'Специалист EBS '+i,
      specialties:['electric'],taxStatus:'self_employed',
      inn:'7800055000'+String(i).padStart(2,'0')
    },user.token));
    ok(await t.api('POST','/api/admin/performers/'+user.id+'/verify',
      {decision:'approved'},admin.token));
  }
  const room=ok(await t.api('GET','/api/community/rooms',undefined,author.token))
    .rooms.find((r:any)=>r.slug==='electric-pro');
  for(const user of [author,peer])
    ok(await t.api('POST','/api/community/rooms/'+room.id+'/join',{},user.token));
  const made=ok(await t.api('POST','/api/community/pro-cases',{
    roomId:room.id,clientNonce:randomUUID(),
    make:'Renault',model:'Premium',modelYear:2010,subsystem:'EBS',
    symptoms:'Для диагностического разбора требуется официальная схема системы EBS со ссылкой на версию компонента.'
  },author.token));
  const path='/api/community/pro-cases/'+made.case.id+'/evidence';
  const source={
    clientNonce:randomUUID(),
    title:'ZF WABCO — официальный каталог технических публикаций',
    sourceUrl:'https://www.zf.com/products/en/cv/footer/downloads/downloads.html',
    documentRevision:'2026-online-index',
    mediaKind:'manual',
    rightsNote:'Ссылаюсь на официальный каталог производителя, не переношу и не копирую его PDF.',
    applicabilityNote:'Указатель производителя не гарантирует применимость к данному ECU, нужна идентификация номера блока.'
  };
  assert.equal((await t.api('GET',path,undefined,driver.token)).status,404);
  assert.equal((await t.api('POST',path,source,driver.token)).status,404);
  const invalid=[
   'http://www.zf.com/products/manual.pdf',
   'https://evil.example.org/redirect',
   'https://www.zf.com.evil.example.com/guide',
   'https://www.zf.com@evil.example.org/capture',
   'https://user:secret@www.zf.com/info',
   'https://127.0.0.1/private',
   'https://www.zf.com:8443/doc',
   'https://www.zf.com/manual#token',
   'https://www.zf.com/manual?vin=test',
   'https://www.zf.com/guide/WDB12345678901234',
   'javascript:alert(1)'
  ];
  for(const url of invalid)assert.equal((await t.api('POST',path,{
    ...source,sourceUrl:url,clientNonce:randomUUID()
  },author.token)).status,400,'must reject unsafe external reference '+url);
  assert.equal((await t.api('POST',path,{
    ...source,clientNonce:randomUUID(),rightsNote:'Контакт специалиста: +7 999 111 22 33, передал заводскую инструкцию лично.'
  },author.token)).status,400,'private phone number must never enter club evidence');
  assert.equal((await t.api('POST',path,{
    ...source,clientNonce:randomUUID(),applicabilityNote:'На месте находится грузовик 59.934280,30.335099, сверьте по адресу.'
  },author.token)).status,400,'exact coordinates must never enter club evidence');
  const created=ok(await t.api('POST',path,source,author.token));
  assert.equal(created.created,true);
  assert.equal(created.published,false);
  const replay=ok(await t.api('POST',path,source,author.token));
  assert.equal(replay.id,created.id);
  assert.equal(replay.created,false);
  assert.equal((await t.api('POST',path,{...source,title:'Другое описание'},
    author.token)).status,409);
  const peerBefore=ok(await t.api('GET',path,undefined,peer.token)).evidence;
  assert.equal(peerBefore.length,0,'unreviewed link must not leak even in a professional club');
  const own=ok(await t.api('GET',path,undefined,author.token)).evidence;
  assert.equal(own.length,1);
  assert.equal(own[0].rightsReview,'pending');
  assert.ok(own[0].sourceUrl.startsWith('https://www.zf.com/'));
  const adminQueue='/api/admin/community/evidence/queue';
  assert.equal((await t.api('GET',adminQueue,undefined,peer.token)).status,403);
  let entry=ok(await t.api('GET',adminQueue,undefined,admin.token))
    .evidence.find((x:any)=>x.id===created.id);
  assert.equal(entry.needsRightsReview,true);
  const review='/api/admin/community/evidence/'+created.id+'/review';
  assert.equal((await t.api('POST',review,{
    stage:'rights',decision:'approved',
    note:'Проверено: это каталог правообладателя, внешняя ссылка без копирования.'
  },mod.token)).status,403,'rights approval is admin-only');
  assert.equal((await t.api('POST',review,{
    stage:'technical',decision:'approved',
    note:'Сначала необходима экспертиза прав, техническую оценку не разрешаем.'
  },mod.token)).status,409);
  ok(await t.api('POST',review,{
    stage:'rights',decision:'approved',
    note:'Это официальный портал производителя. Файлы и картинки не копируются.'
  },admin.token));
  assert.equal(ok(await t.api('GET',path,undefined,peer.token)).evidence.length,0,
    'rights review is not sufficient for publication');
  assert.equal((await t.api('POST',review,{
    stage:'technical',decision:'approved',
    note:'Один проверяющий не может провести обе независимые экспертизы.'
  },admin.token)).status,409);
  const result=ok(await t.api('POST',review,{
    stage:'technical',decision:'approved',
    note:'Внешний каталог относится к тормозной системе; подтверждение ECU и VIN требуется на стороне производителя.'
  },mod.token));
  assert.equal(result.published,true);
  const shown=ok(await t.api('GET',path,undefined,peer.token)).evidence;
  assert.equal(shown.length,1);
  assert.equal(shown[0].rightsReview,'approved');
  assert.equal(shown[0].technicalReview,'approved');
  assert.equal(shown[0].sourceUrl,source.sourceUrl);
  assert.ok(!JSON.stringify(shown).includes(author.id),
    'reviewed source must not reveal the author's account identifier');
  assert.equal((await t.api('POST',path+'/'+created.id+'/withdraw',{},driver.token)).status,404);
  assert.equal((await t.api('POST',path+'/'+created.id+'/withdraw',{},peer.token)).status,404);
  const removed=ok(await t.api('POST',path+'/'+created.id+'/withdraw',{},author.token));
  assert.equal(removed.status,'withdrawn');
  assert.equal(ok(await t.api('GET',path,undefined,peer.token)).evidence.length,0);
  const ownAfter=ok(await t.api('GET',path,undefined,author.token)).evidence;
  assert.equal(ownAfter[0].sourceUrl,null,'withdrawn link can no longer be opened from client');
  assert.equal((await t.api('POST',review,{
    stage:'rights',decision:'approved',note:'Повторно утверждать отозванный материал нельзя.'
  },admin.token)).status,409);
  const audits=await t.db.query<{action:string}>(
    "select action from audit_log where action like 'community.evidence_%'");
  assert.ok(audits.some(x=>x.action==='community.evidence_submitted'));
  assert.ok(audits.some(x=>x.action==='community.evidence_reviewed'));
  assert.ok(audits.some(x=>x.action==='community.evidence_withdrawn'));
 }finally{await t.close()}
});

test('hidden technical case cannot publish linked evidence and rejected evidence remains private',async()=>{
 const t=await setup();
 try{
  const admin=await t.login('+79990000001');
  const author=await t.login('+79996530011','master');
  const reporter=await t.login('+79996530012','master');
  for(const [i,user]of [author,reporter].entries()){
    ok(await t.api('PUT','/api/performer/profile',{
      kind:'master',name:'Диагност '+i,specialties:['electric'],
      taxStatus:'self_employed',inn:'7800055110'+String(i).padStart(2,'0')
    },user.token));
    ok(await t.api('POST','/api/admin/performers/'+user.id+'/verify',
      {decision:'approved'},admin.token));
  }
  const room=ok(await t.api('GET','/api/community/rooms',undefined,author.token))
    .rooms.find((r:any)=>r.slug==='electric-pro');
  for(const u of [author,reporter])
    ok(await t.api('POST','/api/community/rooms/'+room.id+'/join',{},u.token));
  const caseId=ok(await t.api('POST','/api/community/pro-cases',{
    roomId:room.id,clientNonce:randomUUID(),make:'Volvo',model:'FH',
    subsystem:'ABS',symptoms:'Инструкция может относиться к другой ревизии ABS, требуется проверка подлинности первоисточника.'
  },author.token)).case.id;
  const path='/api/community/pro-cases/'+caseId+'/evidence';
  const source={
    clientNonce:randomUUID(),title:'Каталог схем Knorr-Bremse',
    sourceUrl:'https://truckservices.knorr-bremse.com/en/gb/services/technical-documentation/',
    mediaKind:'diagram',documentRevision:'portal-current',
    rightsNote:'Публикуем только ссылку, файлы остаются на сайте правообладателя и не переиздаются.',
    applicabilityNote:'Применимость к конкретному году и ECU не подтверждена, необходим номер заводского блока.'
  };
  const id=ok(await t.api('POST',path,source,author.token)).id;
  ok(await t.api('POST','/api/community/pro-cases/'+caseId+'/report',{
    reason:'Есть вероятность опасной инструкции для тормозной системы'
  },reporter.token));
  const queued=ok(await t.api('GET','/api/admin/community/pro-cases/reports',
    undefined,admin.token)).reports.find((r:any)=>r.case_id===caseId);
  ok(await t.api('POST','/api/admin/community/pro-cases/reports/'+queued.id+'/review',{
    decision:'hide',note:'Документация не подходит к подтверждённому типу блока управления'
  },admin.token));
  assert.equal((await t.api('GET',path,undefined,author.token)).status,404);
  const review='/api/admin/community/evidence/'+id+'/review';
  assert.equal((await t.api('POST',review,{
    stage:'rights',decision:'approved',
    note:'Нельзя утверждать источник, пока родительский вопрос скрыт.'
  },admin.token)).status,409);
  assert.equal((await t.api('POST',path,source,author.token)).status,404);
 }finally{await t.close()}
});

test('erasing a professional account exports and removes their proposed evidence links',async()=>{
 const t=await setup();
 try{
  const admin=await t.login('+79990000001');
  const author=await t.login('+79996530021','master');
  ok(await t.api('PUT','/api/performer/profile',{
    kind:'master',name:'Пользователь для удаления',
    specialties:['electric'],taxStatus:'self_employed',inn:'780005501021'
  },author.token));
  ok(await t.api('POST','/api/admin/performers/'+author.id+'/verify',
    {decision:'approved'},admin.token));
  const room=ok(await t.api('GET','/api/community/rooms',undefined,author.token))
    .rooms.find((r:any)=>r.slug==='electric-pro');
  ok(await t.api('POST','/api/community/rooms/'+room.id+'/join',{},author.token));
  const item=ok(await t.api('POST','/api/community/pro-cases',{
    roomId:room.id,clientNonce:randomUUID(),make:'Renault',model:'Premium',
    subsystem:'Электрика',symptoms:'Вопрос о заводских каталогах схем электропроводки и безопасной диагностике питания.'
  },author.token));
  const id=ok(await t.api('POST','/api/community/pro-cases/'+item.case.id+'/evidence',{
    clientNonce:randomUUID(),title:'Каталог ZF для диагностики блока',
    sourceUrl:'https://www.zf.com/products/en/cv/footer/downloads/downloads.html',
    mediaKind:'manual',documentRevision:'2026-index',
    rightsNote:'Здесь только внешний каталог производителя без копирования авторских документов.',
    applicabilityNote:'Каталог не подтверждает подбор схемы по VIN и требует проверки конкретной ревизии блока.'
  },author.token)).id;
  const profile={id:author.id,phone:'+79996530021',name:null,
    roles:['master'],status:'active',owner_id:null};
  const archive=await t.app.privacy.export(profile);
  assert.ok(archive.professionalEvidenceLinks.some((x:any)=>x.title.includes('Каталог ZF')));
  await t.app.privacy.requestDelete(profile);
  t.clock.advance(31*86_400);
  assert.equal(await t.app.privacy.processDeletions(),1);
  assert.equal((await t.db.query('select 1 from community_case_evidence where id=$1',[id])).length,0);
 }finally{await t.close()}
});
