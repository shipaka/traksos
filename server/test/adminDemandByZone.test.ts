import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, ok, type T } from './helpers.ts';

// Independent real HTTP/PostgreSQL admin reporting scenario on a disposable
// database. Never construct imaginary public pins or access production GPS.
let t:T;
let admin:{id:string;token:string},client:{id:string;token:string};

before(async()=>{
  t=await setup();
  admin=await t.login('+79990000001');
  client=await t.login('+79991234671','client');
  // A fresh disposable database may legitimately have NO published offer.
  // Consent is required only if an actual current revision exists.
  for(const audience of ['client','privacy']){
    const response=await t.api('GET','/api/offers/current/'+audience);
    assert.equal(response.status,200);
    if(response.body?.id)
      ok(await t.api('POST','/api/offers/'+response.body.id+'/accept',{},client.token));
  }
  // The shared fixture starts at a frozen future timestamp while PostgreSQL
  // uses its real clock for created_at; align these for real recent-demand SQL.
  t.clock.set(new Date().toISOString());
});
after(()=>t.close());

test('admin demand filter rejects invalid SQL time windows before querying',async()=>{
  for(const suffix of ['days=abc','days=NaN','days=Infinity','days=','days=1.5',
    'wait=unknown','wait=Infinity','wait=-1.5']){
    const res=await t.api('GET','/api/admin/demand?'+suffix,undefined,admin.token);
    assert.equal(res.status,400,'invalid filter must never cause a SQL 500: '+suffix);
  }
  assert.equal((await t.api('GET','/api/admin/demand?days=7&wait=15',
    undefined,admin.token)).status,200);
});

test('admin demand groups historical unmet requests by service and coarse zone only',async()=>{
  assert.equal((await t.api('GET','/api/admin/demand?days=30',undefined,client.token)).status,403,
    'demand history and counts must never be publicly accessible');
  const created=[];
  for(const [service,zoneId,regionId] of [
    ['electric','spb','spb'],['electric','gat','lo'],['tyre','spb','spb'],
  ] as const){
    const result=ok(await t.api('POST','/api/orders',{
      service,zoneId,regionId,paymentMethod:'cash',
      description:'TEST ONLY geographic supply-demand evidence'
    },client.token));
    const id=result.order?.id;
    assert.ok(id,'real order ID required for demand evidence');
    created.push({id,service,zoneId});
  }
  // The disposable sandbox has no tyre performers. The real dispatch of
  // the third order therefore also records no_performer automatically.
  // Preserve this immutable evidence rather than pretending the third
  // order was matched. We explicitly mark the first two terminal as well.
  await t.db.query("update orders set status='no_performer' where id=any($1::uuid[])",[
    [created[0].id,created[1].id]]);
  const tyre=await t.db.one<{status:string}>(
    'select status from orders where id=$1',[created[2].id]);
  assert.equal(tyre?.status,'no_performer',
    'real zero-performer dispatch also counts as unmet tyre demand');
  const data=ok(await t.api('GET','/api/admin/demand?days=30',undefined,admin.token));
  assert.ok(Array.isArray(data.byServiceZone));
  const rows=data.byServiceZone;
  assert.deepEqual(rows.map((r:any)=>({
    service:r.service,zone_id:r.zone_id,unfilled:r.unfilled,total:r.total
  })),[
    {service:'electric',zone_id:'gat',unfilled:1,total:1},
    {service:'electric',zone_id:'spb',unfilled:1,total:1},
    {service:'tyre',zone_id:'spb',unfilled:1,total:1}
  ].sort((a,b)=>a.service.localeCompare(b.service)||a.zone_id.localeCompare(b.zone_id)),
  'only actual unfilled demand may be used to prioritize partner recruitment');
  for(const row of rows){
    assert.deepEqual(Object.keys(row).sort(),
      ['service','zone_id','total','unfilled'].sort(),
      'the grouped report must not expose addresses, phone numbers or coordinates');
  }
});

test('hydraulic job may be targeted by admin communications and commission campaign',async()=>{
  // Real POSTs, no mock UI buttons: this valid service appears in both the
  // admin dropdown and the API schema, and must be accepted by OpsService.
  const start=new Date(t.clock.now().getTime()+5*60_000).toISOString();
  const end=new Date(t.clock.now().getTime()+60*60_000).toISOString();
  assert.equal((await t.api('POST','/api/admin/announcements',{
    audience:'master',service:'hydraulics',title:'Гидравлика — запросы',
    body:'Учебное уведомление для проверки сохранения фильтра услуги.',
    startsAt:start,endsAt:end,published:false
  },client.token)).status,403,'only admin may target workers');
  const announcement=ok(await t.api('POST','/api/admin/announcements',{
    audience:'master',service:'hydraulics',title:'Гидравлика — запросы',
    body:'Учебное уведомление для проверки сохранения фильтра услуги.',
    startsAt:start,endsAt:end,published:false
  },admin.token));
  assert.equal(announcement.service,'hydraulics');
  assert.ok(announcement.id);
  const campaign=ok(await t.api('POST','/api/admin/commission-campaigns',{
    service:'hydraulics',commissionPct:0,startsAt:start,endsAt:end,
    enabled:true,reason:'Учебное включение гидравлики в фильтр без влияния на боевые тарифы'
  },admin.token));
  assert.equal(campaign.service,'hydraulics');
  assert.ok(campaign.id);
  const listed=ok(await t.api('GET','/api/admin/commission-campaigns',
    undefined,admin.token));
  assert.ok(listed.some((item:any)=>item.id===campaign.id&&item.service==='hydraulics'));
});

test('expired announcement stays draft and cannot be activated as real worker news',async()=>{
  // These dates are relative to the injected application clock; drafts are
  // historical records, but a published expired notice cannot be notified.
  const now=t.clock.now().getTime();
  const start=new Date(now-3*3_600_000).toISOString();
  const end=new Date(now-2*3_600_000).toISOString();
  const form={
    audience:'master',service:'hydraulics',
    title:'Учебное истёкшее объявление',
    body:'Это временная запись для регрессии публикации.',
    startsAt:start,endsAt:end
  };
  const published=await t.api('POST','/api/admin/announcements',{
    ...form,published:true
  },admin.token);
  assert.equal(published.status,400,'already expired publication must be rejected');
  const draft=ok(await t.api('POST','/api/admin/announcements',{
    ...form,published:false
  },admin.token));
  assert.equal(draft.published,false);
  const attempt=await t.api('PUT','/api/admin/announcements/'+draft.id+'/status',{
    published:true
  },admin.token);
  assert.equal(attempt.status,400,'expired draft cannot become a live announcement');
  const history=ok(await t.api('GET','/api/admin/announcements',
    undefined,admin.token));
  const saved=history.find((a:any)=>a.id===draft.id);
  assert.ok(saved,'historical draft is still accessible');
  assert.equal(saved.published,false,'failed publication never changes stored state');
});

test('non-dispatch services cannot receive worker commission campaigns',async()=>{
  // Both services are visible in announcements, but neither has the worker
  // commission mechanism: ECU is a stationary handoff, consultation is a
  // separately priced service. The API must reject even direct HTTP callers.
  const start=new Date(t.clock.now().getTime()+2*3_600_000).toISOString();
  const end=new Date(t.clock.now().getTime()+3*3_600_000).toISOString();
  for(const service of ['ecu','consult']){
    const body={
      service,commissionPct:0,startsAt:start,endsAt:end,
      enabled:true,reason:'Учебный запрос на несуществующий тип комиссии'
    };
    const response=await t.api('POST','/api/admin/commission-campaigns',body,admin.token);
    assert.equal(response.status,400,'invalid worker fee service must be refused: '+service);
    const msg=ok(await t.api('POST','/api/admin/announcements',{
      audience:'master',service,title:'Учебное сообщение '+service,
      body:'Объявления без комиссионных акций должны остаться возможны.',
      startsAt:start,endsAt:end,published:false
    },admin.token));
    assert.equal(msg.service,service,
      'disabling a nonsensical campaign must not disable real partner announcements');
  }
});

test('worker commission campaign cannot exceed the owner-approved 5% rate',async()=>{
  const now=t.clock.now().getTime();
  const body={
    service:'electric',
    startsAt:new Date(now+24*3_600_000).toISOString(),
    endsAt:new Date(now+25*3_600_000).toISOString(),
    enabled:true,
    reason:'Проверка максимума агентской комиссии на отдельном сроке',
  };
  for(const commissionPct of [5.5,100,-1]){
    const rejected=await t.api('POST','/api/admin/commission-campaigns',
      {...body,commissionPct},admin.token);
    assert.equal(rejected.status,400,
      'a discount campaign must not raise the worker fee to '+commissionPct+'%');
  }
  const accepted=ok(await t.api('POST','/api/admin/commission-campaigns',
    {...body,commissionPct:5},admin.token));
  assert.equal(Number(accepted.commission_pct),5,'the approved baseline is valid');
});

test('empty audience cannot mark worker announcement as sent',async()=>{
  const now=t.clock.now().getTime();
  const notice=ok(await t.api('POST','/api/admin/announcements',{
    audience:'master',service:'hydraulics',
    title:'Учебное объявление для мастеров',
    body:'Проверка отсутствия соответствующих специалистов.',
    startsAt:new Date(now-60_000).toISOString(),
    endsAt:new Date(now+3_600_000).toISOString(),
    published:true
  },admin.token));
  const result=await t.api('POST','/api/admin/announcements/'+notice.id+'/notify',
    {},admin.token);
  assert.equal(result.status,400);
  const stored=await t.db.one<{notified_at:Date|null}>(
    'select notified_at from worker_announcements where id=$1',[notice.id]);
  assert.equal(stored?.notified_at,null);
});

test('ECU alert reaches an electric master once and survives as a durable in-app notification',async()=>{
  // No fake external push or production recipient: an actual authenticated
  // electric master is registered in the disposable PostgreSQL environment.
  const master=await t.login('+79990000072','master');
  ok(await t.api('PUT','/api/performer/profile',{
    kind:'master',name:'Тестовый автоэлектрик ЭБУ',
    specialties:['electric'],brands:{Scania:'excellent'},
    taxStatus:'self_employed',inn:'780000000072',
    car:{brand:'Lada Largus',color:'белый',plate:'А123ВС78'}
  },master.token));
  const now=t.clock.now().getTime();
  const notice=ok(await t.api('POST','/api/admin/announcements',{
    audience:'master',service:'ecu',
    title:'Учебное ЭБУ для автоэлектрика',
    body:'Только одно внутреннее уведомление по реальному фильтру специализации.',
    startsAt:new Date(now-60_000).toISOString(),
    endsAt:new Date(now+3_600_000).toISOString(),
    published:true
  },admin.token));
  assert.equal((await t.api('POST','/api/admin/announcements/'+notice.id+'/notify',
    {},client.token)).status,403,'a client cannot send partner announcements');
  const result=ok(await t.api('POST','/api/admin/announcements/'+notice.id+'/notify',
    {},admin.token));
  assert.equal(result.recipients,1,
    'ECU notice must target the electric master rather than an empty audience');
  const inbox=ok(await t.api('GET','/api/me/notifications',undefined,master.token));
  const notices=inbox.items.filter((n:any)=>
    n.kind==='announcement'&&n.data?.announcementId===notice.id);
  assert.equal(notices.length,1,'one durable message must be visible in the real master inbox');
  assert.equal(notices[0].title,'Учебное ЭБУ для автоэлектрика');
  const stored=await t.db.one<{notified_at:Date|null;notified_count:number}>(
    'select notified_at,notified_count from worker_announcements where id=$1',[notice.id]);
  assert.ok(stored?.notified_at,'send status commits with the stored inbox message');
  assert.equal(stored.notified_count,1);
  assert.equal((await t.api('POST','/api/admin/announcements/'+notice.id+'/notify',
    {},admin.token)).status,400,'repeat click must not duplicate the same announcement');
  const count=await t.db.one<{n:number}>(
    'select count(*)::int as n from notifications where user_id=$1 and kind=$2 and data->>\'announcementId\'=$3',
    [master.id,'announcement',notice.id]);
  assert.equal(count?.n,1,'repeated sending does not create duplicate inbox records');
});
