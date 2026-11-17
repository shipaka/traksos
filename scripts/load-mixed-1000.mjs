/**
 * 1000 active role-specific accounts and a real HTTP/PostgreSQL stress run.
 * Disposable TEST_DATABASE_URL only; no production endpoints or payments.
 * Run through .github/workflows/load-1000.yml.
 */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';

if (process.env.NODE_ENV !== 'test' || !process.env.TEST_DATABASE_URL ||
    !/traksos_(load_1000|test)/.test(new URL(process.env.TEST_DATABASE_URL).pathname)) {
  throw new Error('Refusing 1000-user test outside disposable test DB and NODE_ENV=test');
}
process.env.ADMIN_PHONES='+79990000001';
// The 999th non-admin fixture is the moderator (index 998).
process.env.MODERATOR_PHONES='+79995000998';
const { setup, ok } = await import('../server/test/helpers.ts');
const { sha256 } = await import('../server/src/util.ts');
const t = await setup();
const roles = [
  ['client', 500],['master', 235],['tow', 125],['service', 70],
  ['insurer', 50],['driver', 18],['moderator', 1],['admin', 1],
];
const accounts=[];
const metrics=[];
const errors=[];
let madeOrders=0, madeTickets=0;
const stats=(values,p)=> {
  if(!values.length)return 0;
  const s=[...values].sort((a,b)=>a-b);
  return Math.round(s[Math.min(s.length-1,Math.floor((s.length-1)*p))]);
};
function record(label,observed,wallMs) {
  const duration=observed.map(x=>x.ms);
  const bad=observed.filter(x=>x.status<200||x.status>=300);
  const entry={
    name:label,total:observed.length,success:observed.length-bad.length,
    rejected4xx:bad.filter(x=>x.status>=400&&x.status<500).length,
    failed5xx:bad.filter(x=>x.status>=500).length,
    p50Ms:stats(duration,.5),p95Ms:stats(duration,.95),p99Ms:stats(duration,.99),
    wallMs:Math.round(wallMs),
  };
  metrics.push(entry);
  errors.push(...bad.slice(0,8).map(x=>({phase:label,status:x.status})));
  assert.equal(bad.length,0,label+' returned invalid HTTP statuses: '+JSON.stringify(errors.slice(-8)));
}
async function wave(label,requests,expected=200){
  const start=performance.now();
  const replies=await Promise.all(requests.map(async req=>{
    const begun=performance.now();
    try {
      const res=await t.api(req.method,req.path,req.body,req.actor.token);
      return {status:res.status,body:res.body,ms:performance.now()-begun};
    } catch(e) {
      return {status:0,body:{message:String(e)},ms:performance.now()-begun};
    }
  }));
  // The report itself never contains tokens, account identifiers or raw GPS.
  record(label,replies.map(x=>({status:x.status===expected?200:x.status,ms:x.ms})),
    performance.now()-start);
  return replies.map(x=>x.body);
}
function rolePath(role){
  return {
    client:'/api/orders?as=client',driver:'/api/orders?as=client',
    master:'/api/performer/incoming',tow:'/api/performer/incoming',
    service:'/api/base',insurer:'/api/insurer/requests',
    moderator:'/api/mod/cases',admin:'/api/admin/stats?days=30',
  }[role];
}
async function fixtures(){
  const admin={...(await t.login('+79990000001')),role:'admin'};
  accounts.push(admin);
  const rowEntries=[];
  for(const [role,total] of roles){
    const add=role==='admin'?0:total;
    for(let i=0;i<add;i++){
      const index=rowEntries.length;
      rowEntries.push({
        phone:'+79995'+String(index).padStart(6,'0'),
        name:'Load1000 '+role+' '+i,role,
      });
    }
  }
  assert.equal(rowEntries.length,999);
  const userArgs=[];
  const userValues=rowEntries.map((x,i)=>{
    userArgs.push(x.phone,x.name,[x.role]);
    const n=i*3;
    return '($'+(n+1)+',$'+(n+2)+',$'+(n+3)+'::text[])';
  });
  const users=await t.db.query(
    'insert into users(phone,name,roles) values '+userValues.join(',')+
    ' returning id,phone',userArgs,
  );
  const byPhone=new Map(users.map(r=>[r.phone,r.id]));
  const sessionArgs=[];
  const sessionValues=rowEntries.map((x,i)=>{
    const token=randomBytes(32).toString('base64url');
    const id=byPhone.get(x.phone);
    accounts.push({id,token,role:x.role});
    sessionArgs.push(sha256(token),id);
    return '($'+(i*2+1)+',$'+(i*2+2)+",now()+interval '2 days')";
  });
  await t.db.query(
    'insert into sessions(token_hash,user_id,expires_at) values '+
    sessionValues.join(','),sessionArgs,
  );
  // Real, verified worker rows to exercise role-specific /incoming routes.
  await t.db.query(
    "insert into performer_profiles(user_id,kind,specialties,brands,verification,line_status,lat,lng) "+
    "select id,case when 'tow'=any(roles) then 'tow' else 'master' end, "+
    "case when 'tow'=any(roles) then array['tow']::text[] else array['electric','diag']::text[] end, "+
    "'{}'::jsonb,'approved','online',59.94,30.34 "+
    "from users where 'master'=any(roles) or 'tow'=any(roles)",
  );
  assert.equal(accounts.length,1000);
  for(const [role,count] of roles)
    assert.equal(accounts.filter(x=>x.role===role).length,count);
  const sessions=await t.db.one(
    'select count(*)::int as n from sessions where expires_at>now()');
  assert.equal(Number(sessions.n),1000);
}
try {
  await fixtures();
  // Exactly one burst of 1000 simultaneously authenticated HTTP requests.
  // Identity verification is tied to each token, never a reused admin token.
  const me=await wave('1000 simultaneous authenticated GET /api/me',
    accounts.map(actor=>({actor,method:'GET',path:'/api/me'})));
  for(let i=0;i<accounts.length;i++){
    assert.equal(me[i].id,accounts[i].id,'cross-user identity leakage');
    assert.ok(me[i].roles.includes(accounts[i].role),
      'wrong role for '+accounts[i].role);
  }
  // 1000 role-specific dashboard calls in bounded groups of 200, to keep the
  // test meaningful without intentional kernel socket exhaustion.
  for(let start=0;start<1000;start+=200){
    const batch=accounts.slice(start,start+200);
    await wave('200 dashboards, batch '+(start/200+1),
      batch.map(actor=>({actor,method:'GET',path:rolePath(actor.role)})));
  }

  const clients=accounts.filter(x=>x.role==='client');
  const owners=clients.slice(0,60);
  const orders=await wave('60 simultaneous SOS order creations',
    owners.map((actor,i)=>({actor,method:'POST',path:'/api/orders',body:{
      service:'electric',zoneId:'spb',paymentMethod:'cash',
      brand:'Scania',address:'Одноразовый тест СПб',
      description:'Тестовое обращение '+i,lat:59.94,lng:30.34,
    }})));
  const ids=orders.map(x=>x.order.id);
  assert.equal(new Set(ids).size,60,'duplicate order IDs');
  madeOrders=ids.length;
  await wave('60 owners read their own orders',owners.map((actor,i)=>({
    actor,method:'GET',path:'/api/orders/'+ids[i],
  })));
  // Authorization isolation under concurrent real requests.
  const forbidden=await Promise.all(owners.slice(0,40).map((actor,i)=>
    t.api('GET','/api/orders/'+ids[(i+1)%60],undefined,actor.token)));
  assert.ok(forbidden.every(x=>x.status===403),
    'one client can access another client order');
  const tickets=await wave('30 simultaneous support cases',
    clients.slice(0,30).map((actor,i)=>({
      actor,method:'POST',path:'/api/support',
      body:{topic:'Мастер не приехал',text:'Одноразовая проверка службы поддержки номер '+i,
        orderId:ids[i]},
    })));
  madeTickets=tickets.length;
  const admin=accounts.find(x=>x.role==='admin');
  const moderator=accounts.find(x=>x.role==='moderator');
  const queue=ok(await t.api('GET','/api/admin/support',undefined,admin.token));
  const moderation=ok(await t.api('GET','/api/admin/support',undefined,moderator.token));
  assert.ok(Array.isArray(queue)&&Array.isArray(moderation));
  const total=await t.db.one(
    'select count(*)::int as n from orders where id=any($1::uuid[])',[ids]);
  assert.equal(Number(total.n),60);
  const payment=await t.db.one(
    'select count(*)::int as n from payments');
  assert.equal(Number(payment.n),0,'load test must not trigger any payment');
  const report={
    environment:'isolated PostgreSQL + HTTP, no production writes',
    targetUsers:1000,activeSessions:accounts.length,
    roleCounts:Object.fromEntries(roles),
    orders:madeOrders,supportCases:madeTickets,
    crossAccountDenied:forbidden.length,payments:0,
    metrics,errors,
  };
  await mkdir('test-results',{recursive:true});
  await writeFile('test-results/load-mixed-1000.json',JSON.stringify(report,null,2));
  console.log('1000-user mixed load passed: '+JSON.stringify({
    activeSessions:report.activeSessions,orders:madeOrders,supportCases:madeTickets,
    metrics:metrics.map(({name,p95Ms,wallMs})=>({name,p95Ms,wallMs})),
  }));
} finally {
  await t.close();
}
