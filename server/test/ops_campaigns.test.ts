import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, ok, type T } from './helpers.ts';
import { commissionPct, split } from '../src/domain/money.ts';
import { defaultSettings } from '../src/domain/defaults.ts';

let t:T;
let admin:{token:string;id:string};
let customer:{token:string;id:string};
let master:{token:string;id:string};
before(async()=>{
  t=await setup();
  admin=await t.login('+79990000001');
  customer=await t.login('+79992221101');
  master=await t.login('+79992221102','master');
});
after(()=>t.close());

test('unfilled orders and slow acceptance are retained by hour, service and incident review',async()=>{
  const time=t.clock.now();
  const insert=async(service:string,status:string,hour:number, acceptedMinutes?:number)=>{
    const created=new Date(time.getTime()-hour*3_600_000);
    const accepted=acceptedMinutes===undefined?null:new Date(created.getTime()+acceptedMinutes*60_000);
    return (await t.db.one<{id:string}>(`insert into orders(client_id,created_by,service,zone_id,status,created_at,accepted_at)
      values($1,$1,$2,'spb',$3,$4,$5) returning id`,
      [customer.id,service,status,created,accepted]))!.id;
  };
  const missed=await insert('electric','no_performer',1);
  await insert('electric','cancelled',2);
  await insert('air','searching',1);
  await insert('tow','completed',3,26);
  const result=ok(await t.api('GET','/api/admin/demand?days=7&wait=15',undefined,admin.token));
  assert.equal(result.summary.total,4);
  assert.equal(result.summary.unfilled,1);
  assert.equal(result.summary.cancelled_before_acceptance,1);
  assert.equal(result.summary.waiting_now,1);
  assert.equal(result.summary.accepted_late,1);
  assert.equal(result.hourly.reduce((n:any,x:any)=>n+x.unfilled,0),1);
  assert.equal(result.byService.find((x:any)=>x.service==='electric').unfilled,1);
  assert.equal(result.incidents.length,4);
  assert.equal((await t.api('GET','/api/admin/demand',undefined,customer.token)).status,403);
  assert.equal((await t.api('PUT',`/api/admin/demand/${missed}/review`,{
    state:'resolved',note:'Мастеров не было ночью',
  },customer.token)).status,403);
  ok(await t.api('PUT',`/api/admin/demand/${missed}/review`,{
    state:'resolved',note:'Набор в ночную смену',
  },admin.token));
  const again=ok(await t.api('GET','/api/admin/demand?days=7&wait=15',undefined,admin.token));
  assert.equal(again.incidents.find((x:any)=>x.id===missed).review_state,'resolved');
  assert.equal(again.summary.unfilled,1,'marked as reviewed, never disappears from facts');
});

test('targeted worker announcements show only for intended role and dates',async()=>{
  const start=new Date(t.clock.now().getTime()-60_000).toISOString();
  const end=new Date(t.clock.now().getTime()+3_600_000).toISOString();
  const notice=ok(await t.api('POST','/api/admin/announcements',{
    audience:'master',service:null,title:'Ночные вызовы',
    body:'За неделю в этом интервале не нашли мастеров. Просим выходить на линию.',
    startsAt:start,endsAt:end,published:true,
  },admin.token));
  assert.equal(notice.audience,'master');
  assert.equal((await t.api('POST','/api/admin/announcements',{
    audience:'master',title:'Обход',body:'Запрещено',startsAt:start,endsAt:end,published:true,
  },master.token)).status,403);
  const masterNotices=ok(await t.api('GET','/api/worker/announcements',undefined,master.token));
  assert.ok(masterNotices.some((x:any)=>x.id===notice.id));
  const separate=await t.login('+79992221103','tow');
  const towNotices=ok(await t.api('GET','/api/worker/announcements',undefined,separate.token));
  assert.ok(!towNotices.some((x:any)=>x.id===notice.id));
  t.clock.advance(3601);
  const expired=ok(await t.api('GET','/api/worker/announcements',undefined,master.token));
  assert.ok(!expired.some((x:any)=>x.id===notice.id));
});

test('zero-commission campaign is saved only for NEW matching orders, immutable after expiry',async()=>{
  const start=new Date(t.clock.now().getTime()+60_000).toISOString();
  const end=new Date(t.clock.now().getTime()+3_600_000).toISOString();
  const promo=ok(await t.api('POST','/api/admin/commission-campaigns',{
    service:'electric',commissionPct:0,startsAt:start,endsAt:end,
    enabled:true,reason:'Нужны электрики в ночную смену',
  },admin.token));
  assert.equal(promo.commission_pct,0);
  const overlap=await t.api('POST','/api/admin/commission-campaigns',{
    service:null,commissionPct:1,startsAt:start,endsAt:end,enabled:true,reason:'Конфликт',
  },admin.token);
  assert.equal(overlap.status,400);
  assert.equal((await t.api('POST','/api/admin/commission-campaigns',{
    service:'electric',commissionPct:0,startsAt:start,endsAt:end,enabled:true,reason:'Запрещено',
  },customer.token)).status,403);
  const first=ok(await t.api('POST','/api/orders',{service:'electric',zoneId:'spb'},customer.token));
  let row=await t.db.one<any>('select commission_pct_override from orders where id=$1',[first.order.id]);
  assert.equal(row.commission_pct_override,null,'not yet active');
  t.clock.advance(61);
  const second=ok(await t.api('POST','/api/orders',{service:'electric',zoneId:'spb'},customer.token));
  const other=ok(await t.api('POST','/api/orders',{service:'air',zoneId:'spb'},customer.token));
  row=await t.db.one<any>('select commission_pct_override,commission_campaign_id from orders where id=$1',[second.order.id]);
  assert.equal(Number(row.commission_pct_override),0);
  assert.equal(row.commission_campaign_id,promo.id);
  const air=await t.db.one<any>('select commission_pct_override from orders where id=$1',[other.order.id]);
  assert.equal(air.commission_pct_override,null);
  const regular=commissionPct(defaultSettings.fees,{isPriority:false});
  assert.ok(regular>0);
  assert.equal(split(defaultSettings.fees,200000,{isPriority:false,overridePct:Number(row.commission_pct_override)}).commission,0);
  t.clock.advance(3601);
  const unchanged=await t.db.one<any>('select commission_pct_override from orders where id=$1',[second.order.id]);
  assert.equal(Number(unchanged.commission_pct_override),0,'existing order retains its rate');
  const next=ok(await t.api('POST','/api/orders',{service:'electric',zoneId:'spb'},customer.token));
  const normal=await t.db.one<any>('select commission_pct_override from orders where id=$1',[next.order.id]);
  assert.equal(normal.commission_pct_override,null,'new order after expiry has normal commission');
});
