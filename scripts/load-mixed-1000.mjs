// Isolated 1,000 simultaneously active authenticated sessions. Explicit
// role counts; bulk test accounts (no SMS); real HTTP APIs/PG, not production.
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {mkdir,writeFile} from 'node:fs/promises';
process.env.MODERATOR_PHONES='+79997500998';
// Initialize test-only staff allowlists before importing shared config.
const {setup,ok}=await import('../server/test/helpers.ts');
const {sha256}=await import('../server/src/util.ts');
const start=performance.now(),measurements=[],errors=[];
const COUNTS={client:630,driver:120,master:150,tow:55,service:25,
 insurer:18,moderator:1,admin:1};
const roles=Object.entries(COUNTS).flatMap(([role,count])=>
 role==='admin'?[]:Array.from({length:count},()=>role));
const NUM_USERS=1000;
assert.equal(roles.length+1,NUM_USERS);
const t=await setup();
const measure=async(label,records)=>{
 const began=performance.now();
 const values=await Promise.all(records.map(async x=>{
  const time=performance.now();
  const response=await t.api(x.method,x.path,x.body,x.user.token);
  const ms=performance.now()-time;
  if(response.status>=500)errors.push({label,role:x.user.role,status:response.status});
  return {response,ms,role:x.user.role,user:x.user};
 }));
 const times=values.map(v=>v.ms).sort((a,b)=>a-b);
 const quantile=p=>Math.round(times[Math.min(times.length-1,Math.ceil(times.length*p)-1)]);
 measurements.push({label,requests:values.length,p50Ms:quantile(.5),
  p95Ms:quantile(.95),p99Ms:quantile(.99),maxMs:quantile(1),
  wallMs:Math.round(performance.now()-began),
  http5xx:values.filter(x=>x.response.status>=500).length});
 assert.equal(errors.length,0,'HTTP 5xx in '+label);
 return values;
};
try{
 const root=await t.login('+79990000001');
 const rootMe=ok(await t.api('GET','/api/me',undefined,root.token));
 assert.ok(rootMe.roles.includes('admin'),'CI root must have the real admin role');
 const accounts=[{id:root.id,token:root.token,role:'admin'}];
 const entries=roles.map((role,i)=>({
  phone:'+799975'+String(i).padStart(5,'0'),
  name:'1000-account-load-'+i,role
 }));
 const values=[],args=[];
 for(let i=0;i<entries.length;i++){
  const e=entries[i];
  args.push(e.phone,e.name,[e.role]);
  values.push('($'+(i*3+1)+',$'+(i*3+2)+',$'+(i*3+3)+'::text[])');
 }
 const users=await t.db.query(
  'insert into users(phone,name,roles) values '+values.join(',')+' returning id,phone',args);
 assert.equal(users.length,NUM_USERS-1);
 const idByPhone=new Map(users.map(u=>[u.phone,u.id]));
 const sessions=[],sessionArgs=[];
 for(let i=0;i<entries.length;i++){
  const e=entries[i],userId=idByPhone.get(e.phone);
  const token=randomBytes(32).toString('base64url');
  accounts.push({id:userId,token,role:e.role});
  sessionArgs.push(sha256(token),userId);
  sessions.push('($'+(i*2+1)+',$'+(i*2+2)+",now()+interval '2 days')");
 }
 await t.db.query('insert into sessions(token_hash,user_id,expires_at) values '+
  sessions.join(','),sessionArgs);
 assert.equal(accounts.length,NUM_USERS);
 const actual=Object.fromEntries(Object.keys(COUNTS).map(role=>[
  role,accounts.filter(a=>a.role===role).length]));
 assert.deepEqual(actual,COUNTS);
 // Valid verified performers with distinct accounts; no external geolocation.
 await t.db.query(
  "insert into performer_profiles(user_id,kind,specialties,brands,verification,line_status,lat,lng) "+
  "select id,case when 'tow'=any(roles) then 'tow' else 'master' end,"+
  "case when 'tow'=any(roles) then array['tow']::text[] "+
  "else array['electric','diag']::text[] end,"+
  "'{\"Scania\":\"good\"}'::jsonb,'approved','online',59.94,30.34 "+
  "from users where 'master'=any(roles) or 'tow'=any(roles)");
 // One explicitly selected, verified and publication-consented ECU workshop.
 // Do not invoke an old generic SOS ECU flow just to pad the stress test.
 const ecuExpert=accounts.find(x=>x.role==='master');
 assert.ok(ecuExpert,'load fixture must provide a specialist');
 await t.db.query(
  "update performer_profiles set kind='ecu', "+
  "extras=jsonb_build_object('ecuStation',$2::jsonb) where user_id=$1",
  [ecuExpert.id,JSON.stringify({name:'Нагрузочная мастерская ЭБУ',
   address:'Санкт-Петербург, тестовая мастерская',
   lat:59.94,lng:30.34,published:true,publicationConsentConfirmed:true})]);
 const overview=await measure('1000 parallel identity reads',accounts.map(user=>({
  user,method:'GET',path:'/api/me'
 })));
 for(const result of overview){
  assert.equal(result.response.status,200,'identity denied: '+result.user.role+' '+JSON.stringify(result.response.body));
  assert.equal(result.response.body.id,result.user.id,
   'cross-account identity disclosure');
 }
 const paths={client:'/api/orders?as=client',driver:'/api/orders?as=client',
  master:'/api/performer/incoming',tow:'/api/performer/incoming',
  service:'/api/base',insurer:'/api/insurer/requests',
  moderator:'/api/mod/cases',admin:'/api/admin/stats?days=30'};
 const cabinets=await measure('1000 parallel role-specific cabinets',accounts.map(user=>({
  user,method:'GET',path:paths[user.role]
 })));
 for(const value of cabinets)
  assert.equal(value.response.status,200,
   'role dashboard failed: '+value.role+' '+JSON.stringify(value.response.body));
 const clients=accounts.filter(x=>x.role==='client');
 const orderRequests=await measure('120 parallel customer incident submissions',
  clients.slice(0,120).map((user,i)=>({
   user,method:'POST',path:'/api/orders',body:{
    service:i%12===0?'ecu':'electric',zoneId:i%12===0?'ecu_station':'spb',
    ecuSpecialistId:i%12===0?ecuExpert.id:undefined,brand:'Scania',
    lat:59.94,lng:30.34,address:'Санкт-Петербург, тестовая парковка',
    paymentMethod:'cash',description:'Нагрузочная заявка '+i
   }
  })));
 for(const x of orderRequests)assert.equal(x.response.status,200,
  'client order submission failed '+JSON.stringify(x.response.body));
 const ids=orderRequests.map(x=>x.response.body.order.id);
 assert.equal(new Set(ids).size,120);
 const support=await measure('40 parallel support requests',
  clients.slice(0,40).map((user,i)=>({
   user,method:'POST',path:'/api/support',body:{
    topic:'Мастер не приехал',
    text:'Нагрузочный вопрос по заявке для теста '+i,
    orderId:ids[i]
   }
  })));
 for(const x of support)assert.equal(x.response.status,200);
 const admin=accounts.find(x=>x.role==='admin');
 const stats=ok(await t.api('GET','/api/admin/stats?days=30',undefined,admin.token));
 const fromDb=await t.db.one('select count(*)::int as n from orders');
 assert.equal(stats.totals.created,fromDb.n,'admin reports differ from DB');
 const balance=await t.db.query(
  'select order_id from ledger_entries where order_id is not null group by order_id having sum(amount)<>0');
 assert.deepEqual(balance,[],'unbalanced ledger after load');
 const forbidden=await t.api('GET','/api/admin/stats',undefined,clients[0].token);
 assert.equal(forbidden.status,403);
 const report={scenario:'1000_mixed_role_real_http_pg',
  environment:'disposable CI PostgreSQL',accounts:accounts.length,
  distribution:COUNTS,orders:ids.length,supportRequests:support.length,
  unbalancedLedgers:balance.length,errors,measurements,
  durationMs:Math.round(performance.now()-start)};
 await mkdir('test-results',{recursive:true});
 await writeFile('test-results/load-mixed-1000.json',JSON.stringify(report,null,2));
 console.log('PASS: 1,000 AUTHENTICATED ACCOUNTS, ROLE CABINETS, ORDERS, SUPPORT AND LEDGER');
 console.log(JSON.stringify(report,null,2));
}catch(error){
 console.error('[load-mixed-1000]',error);
 await mkdir('test-results',{recursive:true});
 await writeFile('test-results/load-mixed-1000.json',JSON.stringify({
  scenario:'1000_mixed_role_real_http_pg',status:'failed',error:String(error),
  errors,measurements,durationMs:Math.round(performance.now()-start)
 },null,2));
 process.exitCode=1;
}finally{await t.close()}
