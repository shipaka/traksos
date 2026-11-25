import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {setup,ok,type T} from './helpers.ts';

let t:T;
type User={id:string;token:string};
let admin:User,client:User,electric:User,tyre:User,tow:User,hybrid:User,pending:User,station:User,deleted:User;
before(async()=>{
  t=await setup();
  admin=await t.login('+79990000001');
  client=await t.login('+79997809401');
  const worker=async(phone:string,kind:'master'|'tow',specialties:string[],approve=true)=>{
    const user=await t.login(phone,kind);
    ok(await t.api('PUT','/api/performer/profile',{kind,name:'Тестовый исполнитель',specialties},user.token));
    if(approve)ok(await t.api('POST','/api/admin/performers/'+user.id+'/verify',{decision:'approved'},admin.token));
    return user;
  };
  electric=await worker('+79997809402','master',['electric']);
  tyre=await worker('+79997809403','master',['tyre']);
  tow=await worker('+79997809404','tow',['electric']);
  hybrid=await worker('+79997809405','master',['electric']);
  await t.db.query("update users set roles=array['master','tow']::text[] where id=$1",[hybrid.id]);
  pending=await worker('+79997809406','master',['electric'],false);
  deleted=await worker('+79997809407','master',['electric']);
  await t.db.query("update users set deleted_at=now() where id=$1",[deleted.id]);
  station=await t.login('+79997809408','service');
  const c=ok(await t.api('PUT','/api/base',{
    name:'Тестовая рембаза',address:'Тестовая улица, 10',lat:59.8,lng:30.38,
    brands:['DAF'],staff:{electric:'own'},conditions:['parking'],accepts:['quick']
  },station.token));
  ok(await t.api('POST','/api/admin/services/'+c.center.id+'/verify',{decision:'approved'},admin.token));
});
after(()=>t.close());

test('worker feed and broadcast share live role, approval, specialty and publication criteria',async()=>{
  const now=t.clock.now().getTime();
  const publish=async(title:string,audience:string,service:string|null,published=true,start=now-60000,end=now+3600000)=>{
    return ok(await t.api('POST','/api/admin/announcements',{
      title,body:'Тест объявления',audience,service,published,
      startsAt:new Date(start).toISOString(),endsAt:new Date(end).toISOString()
    },admin.token)).id as string;
  };
  const common=await publish('Общее объявление','all_workers',null);
  const el=await publish('Электрика','master','electric');
  const ecu=await publish('Диагностика ЭБУ','master','ecu');
  const tires=await publish('Шины','master','tyre');
  const towing=await publish('Эвакуация','tow','tow');
  const sto=await publish('Для СТО','service',null);
  const targeted=await publish('Электрика для всех','all_workers','electric');
  const draft=await publish('Черновик','all_workers',null,false);
  const future=await publish('Будущее','all_workers',null,true,now+1800000,now+3600000);
  const expired=await publish('Истёкшее','all_workers',null,false,now-3600000,now-1800000);
  // Simulate historical published data that has since expired.
  await t.db.query('update worker_announcements set published=true where id=$1',[expired]);
  const endpoint='/api/worker/announcements';
  const feed=async(user:User,suffix='')=>ok(await t.api('GET',endpoint+suffix,undefined,user.token));
  const ids=async(user:User,suffix='')=>(await feed(user,suffix)).map((x:any)=>x.id).sort();
  const expect=async(user:User,expected:string[],suffix='')=>assert.deepEqual(await ids(user,suffix),expected.sort());
  await expect(electric,[common,el,ecu,targeted],'?audience=master');
  await expect(tyre,[common,tires]);
  await expect(tow,[common,towing],'?audience=tow');
  await expect(station,[common,sto,targeted],'?audience=service');
  await expect(hybrid,[common,el,ecu,targeted],'?audience=master');
  await expect(hybrid,[common,towing],'?audience=tow');
  await expect(hybrid,[common,el,ecu,targeted,towing]);
  await expect(pending,[]);
  await expect(tyre,[common],'?service=electric');
  await expect(electric,[common,el,targeted],'?service=electric');
  assert.equal((await t.api('GET',endpoint+'?audience=tow',undefined,electric.token)).status,403);
  assert.equal((await t.api('GET',endpoint+'?audience=all_workers',undefined,electric.token)).status,400);
  assert.equal((await t.api('GET',endpoint+'?service=unknown',undefined,electric.token)).status,400);
  assert.equal((await t.api('GET',endpoint,undefined,client.token)).status,403);
  const visible=await feed(electric);
  assert.ok(visible.every((x:any)=>![draft,future,expired].includes(x.id)&&!('notified_count' in x)));
  const send=await t.api('POST','/api/admin/announcements/'+targeted+'/notify',{},admin.token);
  assert.equal(ok(send).recipients,3);
  const durable=await t.db.query<{user_id:string}>(
    "select user_id from notifications where kind='announcement' and data->>'announcementId'=$1",[targeted]);
  assert.deepEqual(durable.map(x=>x.user_id).sort(),[electric.id,hybrid.id,station.id].sort());
  assert.equal((await t.api('POST','/api/admin/announcements/'+targeted+'/notify',{},admin.token)).status,400);
  // Live role and verification changes remove access without any new query grant.
  await t.db.query("update performer_profiles set verification='pending' where user_id=$1",[electric.id]);
  await expect(electric,[]);
  assert.equal((await t.api('POST','/api/admin/announcements/'+draft+'/notify',{},admin.token)).status,400);
  assert.equal((await t.api('POST','/api/admin/announcements/'+future+'/notify',{},admin.token)).status,400);
  assert.equal((await t.api('POST','/api/admin/announcements/'+expired+'/notify',{},admin.token)).status,400);
});
