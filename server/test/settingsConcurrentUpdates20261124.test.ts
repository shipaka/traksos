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
