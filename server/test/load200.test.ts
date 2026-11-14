// Isolated, reproducible HTTP + PostgreSQL stress/integrity scenario.
// 200 valid active sessions, no SMS, no external providers, no production URLs.
// Tests real request authorization, order/support concurrency and financial consistency.
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {mkdir,writeFile} from 'node:fs/promises';
import {sha256} from '../src/util.ts';

// Staff access is phone-allowlisted even in a test database.
const staffPhone='+79994000197';
process.env.MODERATOR_PHONES=staffPhone;
const {setup,ok}=await import('./helpers.ts');
type Account={id:string;phone:string;token:string;role:string};
type ApiResult={status:number;body:any};

const COUNTS={client:100,master:45,tow:25,service:15,insurer:12,moderator:1,driver:1,admin:1};
const allAccounts:Account[]=[];
let t:Awaited<ReturnType<typeof setup>>;
let admin:Account;
let moderator:Account;
const runs:{phase:string;count:number;success:number;clientErrors:number;serverErrors:number;p50Ms:number;p95Ms:number;p99Ms:number;maxMs:number;elapsedMs:number}[]=[];
const recordedErrors:{phase:string;role:string;status:number;message:string}[]=[];

function roleAt(index:number):string{
 if(index<100)return 'client';
 if(index<145)return 'master';
 if(index<170)return 'tow';
 if(index<185)return 'service';
 if(index<197)return 'insurer';
 if(index===197)return 'moderator';
 return 'driver';
}
function quantile(values:number[],q:number):number{
 const sorted=[...values].sort((a,b)=>a-b);
 return sorted.length?Math.round(sorted[Math.min(sorted.length-1,Math.floor((sorted.length-1)*q))]):0;
}
function track(phase:string,results:{value:ApiResult;ms:number;role:string}[],elapsedMs:number){
 const durations=results.map(x=>x.ms);
 const errors=results.filter(x=>x.value.status>=500);
 for(const x of results)if(x.value.status>=400)
   recordedErrors.push({phase,role:x.role,status:x.value.status,message:String(x.value.body?.error??'').slice(0,100)});
 const sample={
   phase,count:results.length,success:results.filter(x=>x.value.status>=200&&x.value.status<300).length,
   clientErrors:results.filter(x=>x.value.status>=400&&x.value.status<500).length,serverErrors:errors.length,
   p50Ms:quantile(durations,.5),p95Ms:quantile(durations,.95),p99Ms:quantile(durations,.99),
   maxMs:Math.ceil(Math.max(0,...durations)),elapsedMs:Math.ceil(elapsedMs),
 };
 runs.push(sample);
 assert.equal(errors.length,0,phase+': server errors '+JSON.stringify(errors.slice(0,4).map(x=>x.value.body)));
 return sample;
}
async function burst(phase:string,requests:{who:Account;method:string;path:string;body?:unknown}[]){
 const start=performance.now();
 // All HTTP requests are launched together. PostgreSQL has its real pool limit.
 const result=await Promise.all(requests.map(async req=>{
   const began=performance.now();
   const value=await t.api(req.method,req.path,req.body,req.who.token);
   return {value,role:req.who.role,ms:performance.now()-began};
 }));
 track(phase,result,performance.now()-start);
 return result.map(x=>x.value);
}
function account(role:string,index=0):Account{
 const a=allAccounts.filter(x=>x.role===role)[index];
 if(!a)throw Error('No account for '+role+' '+index);
 return a;
}

before(async()=>{
 t=await setup();
 const logged=await t.login('+79990000001');
 admin={...logged,phone:'+79990000001',role:'admin'};
 allAccounts.push(admin);
 // One bulk database fixture creates 199 DISTINCT realistic active sessions
 // without simulating a 200-SMS registration campaign.
 const entries=Array.from({length:199},(_,i)=>({
   phone:'+79994'+String(i).padStart(6,'0'),name:'Test '+roleAt(i)+' '+i,role:roleAt(i),
 }));
 assert.equal(entries[197].phone,staffPhone);
 const params:unknown[]=[];
 const values=entries.map((x,i)=>{
   params.push(x.phone,x.name,[x.role]);
   return '('+(i*3+1===0?'':('$'+(i*3+1)+',$'+(i*3+2)+',$'+(i*3+3)+'::text[]'))+')';
 }).join(',');
 const rows=await t.db.query<{id:string;phone:string}>(
   'insert into users(phone,name,roles) values '+values+' returning id,phone',params);
 const idByPhone=new Map(rows.map(x=>[x.phone,x.id]));
 const sessionParams:unknown[]=[];
 const tuples=entries.map((x,i)=>{
   const token=randomBytes(32).toString('base64url');
   allAccounts.push({id:idByPhone.get(x.phone)!,phone:x.phone,token,role:x.role});
   sessionParams.push(sha256(token),idByPhone.get(x.phone));
   return '($'+(i*2+1)+',$'+(i*2+2)+",now()+interval '30 days')";
 });
 await t.db.query('insert into sessions(token_hash,user_id,expires_at) values '+tuples.join(','),sessionParams);
 // 70 verified on-line specialists with distinct logins, realistic dispatch.
 await t.db.query(
   "insert into performer_profiles(user_id,kind,specialties,brands,verification,line_status,lat,lng) "+
   "select id,case when 'tow'=any(roles) then 'tow' else 'master' end, "+
   "case when 'tow'=any(roles) then array['tow']::text[] else array['electric','diag']::text[] end, "+
   "'{\"Scania\":\"good\",\"DAF\":\"good\"}'::jsonb,'approved','online',59.94,30.34 "+
   "from users where 'master'=any(roles) or 'tow'=any(roles)",
 );
 moderator=account('moderator');
 assert.equal(allAccounts.length,200);
 assert.deepEqual(Object.fromEntries(Object.keys(COUNTS).map(role=>[role,allAccounts.filter(a=>a.role===role).length])),COUNTS);
});

after(async()=>{
 if(t){
   try{
     const report={date:'2026-11-14',environment:'isolated CI PostgreSQL, not production',
       activeSessions:200,roleCounts:COUNTS,dbPoolConnections:10,runs,
       handledClientErrors:recordedErrors.slice(0,80)};
     await mkdir('e2e/shots',{recursive:true});
     await writeFile('e2e/shots/load-200-integrity.json',JSON.stringify(report,null,2));
     console.log('200-active-users performance/integrity report: '+JSON.stringify({counts:COUNTS,runs},null,2));
   }finally{await t.close();}
 }
});

test('200 simultaneous authenticated users: two waves of real role-specific HTTP requests', {timeout:180_000},async()=>{
 const me=await burst('200 concurrent GET /api/me',allAccounts.map(who=>({who,method:'GET',path:'/api/me'})));
 assert.ok(me.every(x=>x.status===200),'each valid test session must load its own user');
 for(let i=0;i<allAccounts.length;i++)
   assert.equal(me[i].body.id,allAccounts[i].id,'never return another user profile');
 const route:Record<string,string>={
   client:'/api/orders?as=client',
   driver:'/api/orders?as=client',
   master:'/api/performer/incoming',
   tow:'/api/performer/incoming',
   service:'/api/base',
   insurer:'/api/insurer/requests',
   moderator:'/api/mod/cases',
   admin:'/api/admin/stats?days=30',
 };
 const dashboard=await burst('200 concurrent role dashboards',
   allAccounts.map(who=>({who,method:'GET',path:route[who.role]})));
 assert.ok(dashboard.every(x=>x.status===200),
   'role-specific dashboard returned unexpected HTTP status '+JSON.stringify(dashboard.filter(x=>x.status!==200).slice(0,6)));
 assert.equal((await t.api('GET','/api/admin/stats',undefined,account('client').token)).status,403);
 assert.equal((await t.api('GET','/api/orders?as=client',undefined,account('insurer').token)).status,403);
 assert.equal((await t.api('GET','/api/mod/cases',undefined,account('client').token)).status,403);
});

test('200 users interact: concurrent orders, support, role visibility and balanced ledger', {timeout:180_000},async()=>{
 const clients=allAccounts.filter(x=>x.role==='client');
 const creators=clients.slice(0,24);
 const orders=await burst('24 concurrent incident creations',creators.map((who,i)=>({
   who,method:'POST',path:'/api/orders',body:{
     service:i%5===0?'tow':'electric',zoneId:'spb',brand:'Scania',lat:59.94,lng:30.34,
     address:'Тестовая стоянка Санкт-Петербург',description:'Стресс-тест заявки '+i,
     paymentMethod:'cash',
     ...(i%5===0?{destination:'Тестовое СТО',cargo:'tractor',loaded:'empty'}:{}),
   },
 })));
 assert.ok(orders.every(x=>x.status===200),'order creation must complete without conflicts between different clients');
 const ids=orders.map(x=>x.body.order.id as string);
 assert.equal(new Set(ids).size,24,'orders must have unique IDs');
 const tickets=await burst('20 concurrent customer support messages',clients.slice(0,20).map((who,i)=>({
   who,method:'POST',path:'/api/support',body:{
     topic:i%4===0?'Не согласен с суммой':'Мастер не приехал',
     text:'Тестовая проверка поддержки, обращение номер '+i,
     orderId:ids[i],
   },
 })));
 assert.ok(tickets.every(x=>x.status===200),'each customer opens a visible support case');
 const idTickets=tickets.map(x=>x.body.id);
 const supportAdmin=ok(await t.api('GET','/api/admin/support',undefined,admin.token));
 const supportModerator=ok(await t.api('GET','/api/admin/support',undefined,moderator.token));
 for(const id of idTickets){
   assert.ok(supportAdmin.some((x:any)=>x.id===id),'missing support ticket in admin cabinet');
   assert.ok(supportModerator.some((x:any)=>x.id===id),'missing support ticket in moderator cabinet');
 }
 const stats=ok(await t.api('GET','/api/admin/stats?days=30',undefined,admin.token));
 const dbOrders=(await t.db.one<{count:number}>('select count(*)::int as count from orders'))!.count;
 assert.equal(stats.totals.created,dbOrders,'admin order counter differs from PostgreSQL');
 assert.equal(stats.incidents.total,dbOrders,'one case without continuation counts once');
 for(let i=0;i<24;i++){
   const card=ok(await t.api('GET','/api/orders/'+ids[i],undefined,creators[i].token));
   assert.equal(card.id,ids[i]);
   assert.equal((await t.api('GET','/api/orders/'+ids[i],undefined,clients[(i+1)%100].token)).status,403);
 }
 const ledger=await t.db.query(
   'select order_id,sum(amount)::bigint as balance from ledger_entries where order_id is not null group by order_id having sum(amount)<>0');
 assert.deepEqual(ledger,[],'ledger debits and credits must balance for all orders');
 const sessions=(await t.db.one<{count:number}>('select count(*)::int as count from sessions'))!.count;
 assert.equal(sessions,200);
});

test('concurrent duplicate support notifications do not create multiple tickets for one order', {timeout:120_000},async()=>{
 const client=account('client',80);
 const order=ok(await t.api('POST','/api/orders',
   {service:'electric',zoneId:'spb',brand:'DAF',paymentMethod:'cash'},client.token)).order;
 const requests=Array.from({length:12},(_,i)=>({who:client,method:'POST',path:'/api/support',
   body:{topic:'Мастер не приехал',text:'Повторное нажатие обращения в поддержку '+i,orderId:order.id}}));
 const replies=await burst('12 concurrent support retries for one order',requests);
 assert.ok(replies.every(x=>x.status===200));
 assert.equal(new Set(replies.map(x=>x.body.id)).size,1,
   'idempotent support flow must not create multiple tickets for the same client and order');
 const saved=await t.db.query('select id from support_tickets where user_id=$1 and order_id=$2 and status=$3',
   [client.id,order.id,'open']);
 assert.equal(saved.length,1,'exactly one open ticket per customer and order');
 const messages=await t.db.one<{total:number}>('select count(*)::int as total from support_messages where ticket_id=$1',[saved[0].id]);
 assert.equal(messages?.total,12,'all 12 messages must be preserved in the one conversation');
});
