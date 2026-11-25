import {test} from 'node:test';
import assert from 'node:assert/strict';
import {SettingsService} from '../src/services/settings.ts';
import {setup} from './helpers.ts';

test('admin settings: concurrent independent writers preserve disjoint patches and every audit record', {timeout:60000},async()=>{
 const t=await setup();
 try{
  const admin=await t.login('+79990000001');
  await t.db.query("delete from settings where key='shop'");
  const patches=[
   {closedTitle:'Проверка заголовка витрины'},
   {closedText:'Проверка текста закрытого магазина'},
   {pickupAddress:'Пункт самовывоза №3'},
   {deliveryNote:'Проверка условий доставки'},
   {note:'Важное сообщение о поставках'},
   {deliveryPrice:65000},
   {pickup:false},
   {withMaster:false},
  ];
  // Distinct service instances model two or more app workers; no shared
  // JavaScript queue or mutex is available. SQL must serialize the RMW.
  await Promise.all(patches.map(p=>new SettingsService(t.db).set('shop',p,admin.id)));
  const row=await t.db.one<{value:any}>('select value from settings where key=$1',['shop']);
  assert.ok(row);
  for(const patch of patches){
   const [key,val]=Object.entries(patch)[0];
   assert.equal(row!.value[key],val,`lost update on ${key}`);
  }
  assert.equal(row!.value.enabled,false,'disabled shop policy must not be reopened');
  const audits=await t.db.query<any>(
   "select data from audit_log where action='settings.update' and target='shop'");
  assert.equal(audits.length,patches.length,'every committed mutation is audited once');
  for(const patch of patches)
   assert.ok(audits.some(x=>JSON.stringify(x.data)===JSON.stringify(patch)),
    `missing original audit patch ${JSON.stringify(patch)}`);

  // Fail an audit write after data upsert. The SETTINGS change must roll back
  // too; previously it was committed before the separate audit SQL call.
  await t.db.exec(`
   create function reject_shop_settings_audit() returns trigger as $$
   begin
     if new.action='settings.update' and new.target='shop' then
       raise exception 'test_settings_audit_failure';
     end if;
     return new;
   end;
   $$ language plpgsql;
   create trigger reject_shop_settings_audit before insert on audit_log
   for each row execute function reject_shop_settings_audit();`);
  const before=row!.value;
  await assert.rejects(
   new SettingsService(t.db).set('shop',{closedTitle:'НЕ ДОЛЖНО СОХРАНИТЬСЯ'},admin.id),
   /test_settings_audit_failure/);
  const after=await t.db.one<{value:any}>('select value from settings where key=$1',['shop']);
  assert.deepEqual(after?.value,before,'audit failure rolls back business configuration');
 }finally{await t.close();}
});


test('settings cache: an old in-flight SELECT cannot overwrite a newer committed admin patch', {timeout:60000},async()=>{
 const t=await setup();
 try{
  const admin=await t.login('+79990000001');
  let ready!:()=>void;
  let release!:()=>void;
  const scanned=new Promise<void>(resolve=>{ready=resolve;});
  const proceed=new Promise<void>(resolve=>{release=resolve;});
  let hold=true;
  const proxy={
   query:async(sql:string,params?:any[])=>{
    if(hold&&sql==='select key, value from settings'){
     hold=false;
     const prior=await t.db.query(sql,params);
     ready();
     await proceed;
     return prior;
    }
    return t.db.query(sql,params);
   },
   tx:(fn:any)=>t.db.tx(fn),
   one:(sql:string,params?:any[])=>t.db.one(sql,params),
  };
  const instance=new SettingsService(proxy as any);
  const stale=instance.all();
  await scanned;
  const written=await instance.set('shop',{closedTitle:'Новая подтверждённая надпись'},admin.id);
  assert.equal(written.closedTitle,'Новая подтверждённая надпись');
  release();
  const oldResult=await stale;
  assert.notEqual(oldResult.shop.closedTitle,'Новая подтверждённая надпись',
    'the delayed read really obtained the old snapshot');
  const latest=await instance.get('shop');
  assert.equal(latest.closedTitle,'Новая подтверждённая надпись',
    'old read must not repopulate the shared five-second cache');
 }finally{await t.close();}
});


test('settings cache isolates nested objects and arrays on initial and repeated reads',async()=>{
 let reads=0;
 const svc=new SettingsService({query:async()=>{reads++;return [];}} as any);
 const first=await svc.all();
 const original=first.pricing.zones[0].name;
 first.pricing.zones[0].name='Изменение только в локальной копии';
 first.pricing.zones.push({id:'local',name:'Не сохранённая зона',km:5});
 first.legal.brand='Not the approved brand';
 const next=await svc.all();
 assert.equal(next.legal.brand,'TrakSOS');
 assert.equal(next.pricing.zones[0].name,original);
 assert.equal(next.pricing.zones.some(x=>x.id==='local'),false);
 const nested=await svc.get('pricing');
 nested.zones.length=0;
 assert.ok((await svc.get('pricing')).zones.length>0);
 assert.equal(reads,1,'isolated results still use the same cache');
});

test('settings accepts own sections only and ignores malformed restored rows',async()=>{
 let writes=0;
 const svc=new SettingsService({
  query:async()=>[
   {key:'__proto__',value:{bad:true}},
   {key:'constructor',value:{bad:true}},
   {key:'shop',value:['not a section']},
   {key:'legal',value:null},
  ],
  tx:async()=>{writes++;throw Error('unexpected transaction');},
 } as any);
 const all=await svc.all();
 assert.equal(Object.hasOwn(all,'__proto__'),false);
 assert.equal(Object.hasOwn(all,'constructor'),false);
 assert.equal(Object.hasOwn(all.shop,'0'),false);
 assert.equal(all.legal.brand,'TrakSOS');
 for(const key of ['__proto__','constructor','toString','unknown']){
  await assert.rejects(svc.set(key as any,{} as any,null),/Нет такой настройки/);
 }
 assert.equal(writes,0);
});

test('settings cache refreshes when wall clock moves backward',async()=>{
 const realNow=Date.now;
 let now=100_000;
 let reads=0;
 const svc=new SettingsService({query:async()=>[
  {key:'shop',value:{closedTitle:'revision '+(++reads)}},
 ]} as any);
 Date.now=()=>now;
 try{
  assert.equal((await svc.get('shop')).closedTitle,'revision 1');
  now+=100;
  assert.equal((await svc.get('shop')).closedTitle,'revision 1');
  now-=1000;
  assert.equal((await svc.get('shop')).closedTitle,'revision 2');
 }finally{Date.now=realNow;}
});

test('settings: committed update is acknowledged despite unavailable post-commit SELECT and repairs malformed row', {timeout:60000},async()=>{
 const t=await setup();
 try{
  const admin=await t.login('+79990000001');
  await t.db.query("insert into settings(key,value) values ('shop',$1::jsonb) on conflict(key) do update set value=excluded.value",
   [JSON.stringify(['obsolete invalid section'])]);
  let outsideReads=0;
  const proxy={
   tx:(fn:any)=>t.db.tx(fn),
   query:async()=>{outsideReads++;throw Error('post_commit_read_unavailable');},
  };
  const service=new SettingsService(proxy as any);
  const saved=await service.set('shop',{closedTitle:'Подтверждённая настройка'},admin.id);
  assert.equal(saved.closedTitle,'Подтверждённая настройка');
  assert.equal(saved.enabled,false);
  assert.equal(typeof saved.closedText,'string');
  assert.equal(Object.hasOwn(saved,'0'),false);
  assert.equal(outsideReads,0,'successful write must not depend on a second database read');
  const row=await t.db.one<{value:any}>("select value from settings where key='shop'");
  assert.equal(row?.value.closedTitle,saved.closedTitle);
  assert.equal(Object.hasOwn(row?.value??{},'0'),false);
  const audits=await t.db.query("select id from audit_log where action='settings.update' and target='shop' and data->>'closedTitle'=$1",[saved.closedTitle]);
  assert.equal(audits.length,1);
 }finally{await t.close();}
});
