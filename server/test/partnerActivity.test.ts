import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {setup,ok,type T} from './helpers.ts';

let t:T,master:any,client:any,admin:any;
before(async()=>{
 t=await setup();
 admin=await t.login('+79990000001');
 client=await t.login('+79995771201','client');
 master=await t.login('+79995771202','master');
 ok(await t.api('PUT','/api/performer/profile',{
   kind:'master',name:'Профессиональный водитель-мастер',
   specialties:['electric'],taxStatus:'self_employed',inn:'780000007712'
 },master.token));
});
after(()=>t.close());

test('partner weekly evidence is personal, private and never an automatic sanction',async()=>{
 const endpoint='/api/partner/activity';
 assert.equal((await t.api('GET',endpoint)).status,401);
 assert.equal((await t.api('GET',endpoint,undefined,client.token)).status,403);
 const first=ok(await t.api('GET',endpoint,undefined,master.token));
 assert.equal(first.windowDays,90);
 assert.equal(first.total.personallyOffered,0);
 assert.equal(first.total.completedFromOffers,0);
 assert.equal(first.sampleSufficient,false);
 assert.equal(first.changesLevel,false);
 assert.equal(first.changesDispatch,false);
 assert.equal(first.changesCommission,false);
 assert.equal(first.partialHistory,true);
 assert.ok(first.weeks.length>=13&&first.weeks.length<=14);
 assert.ok(first.weeks.every((x:any)=>!('otherWorkers' in x)&&!('ranking' in x)));
 const denied=await t.api('GET','/api/admin/partner/activity/'+master.id,
   undefined,master.token);
 assert.equal(denied.status,403);
 const adminData=ok(await t.api('GET','/api/admin/partner/activity/'+master.id,
   undefined,admin.token));
 assert.equal(adminData.total.personallyOffered,0);
});

test('count only offered orders, clip online status to each week, no invented regional market',async()=>{
 await t.db.query(
   "insert into partner_presence_events(user_id,line_status,paused,observed_at) "+
   "values($1,'online',false,'2026-11-20T08:00:00Z'), "+
   "($1,'offline',false,'2026-11-20T11:00:00Z')",[master.id]);
 const order1=await t.db.one<{id:string}>(
   "insert into orders(client_id,created_by,service,status,performer_id) "+
   "values($1,$1,'electric','completed',$2) returning id",[client.id,master.id]);
 const order2=await t.db.one<{id:string}>(
   "insert into orders(client_id,created_by,service,status) "+
   "values($1,$1,'electric','accepted') returning id",[client.id]);
 await t.db.query(
   "insert into order_dispatch(order_id,performer_id,rank,status,sent_at) "+
   "values($1,$3,1,'accepted','2026-11-20T09:00:00Z'), "+
   "($2,$3,1,'missed','2026-11-22T09:00:00Z')",[order1!.id,order2!.id,master.id]);
 const actual=ok(await t.api('GET','/api/partner/activity',undefined,master.token));
 assert.equal(actual.total.personallyOffered,2);
 assert.equal(actual.total.completedFromOffers,1);
 assert.equal(actual.total.offersWhileDeclaredOnline,1);
 assert.equal(actual.total.declaredAvailableHours,3);
 assert.equal(actual.sampleSufficient,false);
 const november=actual.weeks.filter((x:any)=>x.weekStart.startsWith('2026-11'));
 assert.equal(november.reduce((n:number,x:any)=>n+x.personallyOffered,0),2);
 assert.ok(actual.note.includes('лично')||actual.note.includes('личные'));
 assert.ok(actual.comparisonCaveat.includes('нет'));
 assert.equal(actual.changesLevel,false);
});
