// TrackSOS reproducible 1,000 concurrent authenticated sessions, MIXED ROLES.
// Isolated disposable TEST_DATABASE_URL only. No SMS/bank calls and no VPS.
// Run with NODE_ENV=test TEST_DATABASE_URL=... node --import tsx scripts/load-mixed-1000.mjs
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {performance} from 'node:perf_hooks';

process.env.NODE_ENV='test';
process.env.ADMIN_PHONES='+79990000001';
// Moderator sessions must also satisfy the real staff phone allowlist.
// Non-admin users occupy indices 0..998, moderators are exactly 994..998.
process.env.MODERATOR_PHONES=Array.from({length:5},(_,i)=>
  '+79996'+String(994+i).padStart(6,'0')).join(',');
const {sha256}=await import('../server/src/util.ts');
const {setup,ok}=await import('../server/test/helpers.ts');
assert.ok(process.env.TEST_DATABASE_URL?.includes('traksos_load_1000_'),
  'Refusing to run against a non-disposable database; TEST_DATABASE_URL must contain traksos_load_1000_');
const t=await setup();
const COUNT={client:500,master:200,tow:120,service:80,insurer:60,driver:34,moderator:5,admin:1};
const paths={
  client:'/api/orders?as=client',master:'/api/performer/incoming',
  tow:'/api/performer/incoming',service:'/api/base',insurer:'/api/insurer/requests',
  driver:'/api/orders?as=client',moderator:'/api/mod/cases',admin:'/api/admin/stats?days=30',
};
const metrics=[];
const actors=[];
let admin=null;
const errors=[];
function summary(name,values,total){
  const a=[...values].sort((x,y)=>x-y);
  const at=(p)=>Number((a[Math.min(a.length-1,Math.ceil(a.length*p)-1)]??0).toFixed(1));
  const r={phase:name,count:a.length,p50_ms:at(.5),p95_ms:at(.95),p99_ms:at(.99),
    max_ms:at(1),wall_ms:Math.round(total)};
  metrics.push(r);
  console.log(name+': '+JSON.stringify(r));
}
async function burst(name,requests,expected=200) {
  const start=performance.now();
  const responses=await Promise.all(requests.map(async ({actor,method,path,body},i)=>{
    const began=performance.now();
    try{
      const response=await t.api(method,path,body,actor.token);
      return {response,ms:performance.now()-began,actor,i};
    }catch(e){
      return {response:{status:599,body:{error:String(e)}},
        ms:performance.now()-began,actor,i};
    }
  }));
  summary(name,responses.map(r=>r.ms),performance.now()-start);
  for(const r of responses)if(r.response.status!==expected){
    errors.push({phase:name,role:r.actor.role,status:r.response.status,
      error:String(r.response.body?.error??'').slice(0,100)});
  }
  assert.equal(responses.filter(x=>x.response.status!==expected).length,0,
    name+': '+JSON.stringify(errors.slice(-8)));
  return responses.map(r=>r.response.body);
}
function roleFor(i){
  let position=0;
  for(const role of ['client','master','tow','service','insurer','driver','moderator']){
    position+=COUNT[role];
    if(i<position)return role;
  }
  throw Error('Invalid role index: '+i);
}
async function seed(){
  const a=await t.login('+79990000001');
  admin={...a,role:'admin'};actors.push(admin);
  // User/session setup via PostgreSQL, NOT a simulated 1,000-SMS signup storm.
  const accountData=Array.from({length:999},(_,i)=>({
    phone:'+79996'+String(i).padStart(6,'0'),
    name:'Stress 1000 '+i,role:roleFor(i),
  }));
  for(let offset=0;offset<accountData.length;offset+=150){
    const chunk=accountData.slice(offset,offset+150);
    const params=[];
    const values=chunk.map((x,i)=>{
      params.push(x.phone,x.name,[x.role]);
      return '($'+(i*3+1)+',$'+(i*3+2)+',$'+(i*3+3)+'::text[])';
    }).join(',');
    const rows=await t.db.query(
      'insert into users(phone,name,roles) values '+values+' returning id,phone',params);
    const byPhone=new Map(rows.map(r=>[r.phone,r.id]));
    const valuesSession=[],paramsSession=[];
    chunk.forEach((x,i)=>{
      const token=randomBytes(32).toString('base64url');
      const id=byPhone.get(x.phone);
      actors.push({id,token,role:x.role});
      paramsSession.push(sha256(token),id);
      valuesSession.push('($'+(i*2+1)+',$'+(i*2+2)+",now()+interval '30 days')");
    });
    await t.db.query(
      'insert into sessions(token_hash,user_id,expires_at) values '+valuesSession.join(','),
      paramsSession);
  }
  assert.equal(actors.length,1000);
  assert.deepEqual(
    Object.fromEntries(Object.keys(COUNT).map(r=>[r,actors.filter(a=>a.role===r).length])),
    COUNT);
  await t.db.query(
    "insert into performer_profiles(user_id,kind,specialties,brands,verification,line_status,lat,lng) "+
    "select id,case when 'tow'=any(roles) then 'tow' else 'master' end, "+
    "case when 'tow'=any(roles) then array['tow']::text[] else array['electric','diag']::text[] end, "+
    "'{\"Scania\":\"good\",\"DAF\":\"good\"}'::jsonb,'approved','online',59.94,30.34 "+
    "from users where 'master'=any(roles) or 'tow'=any(roles)");
  const sessions=await t.db.one('select count(*)::int as n from sessions');
  assert.equal(sessions.n,1000);
}
async function scenarios(){
  const ids=await burst('1000 simultaneous GET /api/me',
    actors.map(actor=>({actor,method:'GET',path:'/api/me'})));
  ids.forEach((body,i)=>{
    assert.equal(body.id,actors[i].id,'Wrong identity or token leak at index '+i);
    const kind=actors[i].role;
    assert.ok(body.roles.includes(kind),kind+' cabinet has wrong auth roles');
  });
  const cabinets=await burst('1000 simultaneous role dashboards',
    actors.map(actor=>({actor,method:'GET',path:paths[actor.role]})));
  assert.equal(cabinets.length,1000);
  const clients=actors.filter(x=>x.role==='client');
  const claims=await Promise.all([
    t.api('GET','/api/admin/stats',undefined,clients[0].token),
    t.api('GET','/api/admin/agency/bank/statements',undefined,clients[1].token),
    t.api('GET','/api/admin/agency/report?from=2026-11-01&to=2026-11-30',undefined,clients[2].token),
  ]);
  assert.deepEqual(claims.map(x=>x.status),[403,403,403],
    'Ordinary client bypassed admin-only financial module');
  const orders=await burst('30 simultaneous SOS requests',clients.slice(0,30).map((actor,i)=>({
    actor,method:'POST',path:'/api/orders',
    body:{service:i%6===0?'tow':'electric',zoneId:'spb',
      brand:'Scania',lat:59.94,lng:30.34,
      address:'Нагрузочная парковка Санкт-Петербурга '+i,
      description:'Тест на тысячу участников: '+i,
      paymentMethod:'cash',
      ...(i%6===0?{destination:'Нагрузочное СТО',cargo:'tractor',loaded:'empty'}:{}),
    },
  })));
  const orderIds=orders.map(x=>x.order.id);
  assert.equal(new Set(orderIds).size,30,'Repeated order ID at 1000 active sessions');
  const supports=await burst('20 simultaneous client support requests',
    clients.slice(0,20).map((actor,i)=>({
      actor,method:'POST',path:'/api/support',
      body:{topic:'Не согласен с суммой',text:'Проверка поддержки для 1000 сеансов, номер '+i,
        orderId:orderIds[i]},
    })));
  assert.equal(new Set(supports.map(x=>x.id)).size,20,'Support lost a client case');
  const foreign=await Promise.all(orderIds.slice(0,10).map((id,i)=>t.api(
    'GET','/api/orders/'+id,undefined,clients[(i+1)%30].token)));
  assert.deepEqual(foreign.map(x=>x.status),Array(10).fill(403),
    'One client sees a different customer order');
  const adminView=ok(await t.api('GET','/api/admin/stats?days=30',undefined,admin.token));
  const totals=await t.db.one('select count(*)::int as n from orders');
  assert.equal(adminView.totals.created,totals.n,'Admin summary misses client orders');
  const unbalanced=await t.db.query('select order_id from ledger_entries '+
    'where order_id is not null group by order_id having sum(amount)<>0');
  assert.deepEqual(unbalanced,[],'Internal financial ledger is unbalanced');
  const sessions=await t.db.one('select count(*)::int as n from sessions');
  assert.equal(sessions.n,1000,'Session list was changed under load');
  return {orders:orderIds.length,supportTickets:supports.length,accountCount:1000};
}
const started=performance.now();
let scenario=null,success=false;
try{
  await seed();
  scenario=await scenarios();
  success=true;
}finally{
  const report={
    type:'mixed-roles-1000',environment:'disposable PostgreSQL CI',
    productionWrites:false,authSessions:actors.length,roles:COUNT,
    scenario,metrics,errors:errors.slice(0,50),
    elapsedMs:Math.round(performance.now()-started),success,
    disclaimer:'1000 authenticated real HTTP sessions; does not emulate 1000 paid orders or real bank transactions.',
  };
  await mkdir('test-results',{recursive:true});
  await writeFile('test-results/load-mixed-1000.json',JSON.stringify(report,null,2));
  console.log('TRACKSOS 1000 RESULT '+JSON.stringify(report));
  await t.close();
}
