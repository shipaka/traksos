// Real HTTP/PostgreSQL mixed-role load test; uses an ephemeral TEST database ONLY.
// Run: node --import tsx scripts/load-mixed-200.mjs
// Actor distribution = 125 clients + 45 masters + 20 tow + 5 services
//                    + 3 insurers + 1 moderator + 1 administrator = 200.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {performance} from 'node:perf_hooks';

const MODERATOR_PHONE='+79994500001';
process.env.MODERATOR_PHONES=MODERATOR_PHONE;
const {setup,ok}=await import('../server/test/helpers.ts');
const t=await setup();
const started=performance.now();
const latencies=new Map();
const failures=[];
const actors=[];
const clients=[],masters=[],tows=[],services=[],insurers=[];
let admin,moderator;
let createdOrders=0,completedOrders=0,disputedOrders=0,bookings=0,insuranceCases=0;

function timer(label,ms) {
 const list=latencies.get(label)??[];
 list.push(Math.round(ms*100)/100);
 latencies.set(label,list);
}
async function request(actor,method,path,body,expected=200,label=method+' '+path.split('?')[0]) {
 const start=performance.now();
 const response=await t.api(method,path,body,actor?.token);
 timer(label,performance.now()-start);
 if(response.status>=500)failures.push({actor:actor?.kind,method,path,status:response.status,body:response.body});
 assert.equal(response.status,expected,method+' '+path+' ('+actor?.kind+') '+JSON.stringify(response.body));
 return response.body;
}
async function createUsers() {
 admin={...(await t.login('+79990000001')),kind:'admin'};actors.push(admin);
 moderator={...(await t.login(MODERATOR_PHONE)),kind:'moderator'};
 await t.db.query("update users set roles=ARRAY['moderator']::text[] where id=$1",[moderator.id]);
 actors.push(moderator);
 for(let i=0;i<125;i++){
  const x={...(await t.login('+7999400'+String(i).padStart(4,'0'))),kind:'client'};
  clients.push(x);actors.push(x);
 }
 for(let i=0;i<45;i++){
  const x={...(await t.login('+7999410'+String(i).padStart(4,'0'),'master')),kind:'master'};
  masters.push(x);actors.push(x);
 }
 for(let i=0;i<20;i++){
  const x={...(await t.login('+7999420'+String(i).padStart(4,'0'),'tow')),kind:'tow'};
  tows.push(x);actors.push(x);
 }
 for(let i=0;i<5;i++){
  const x={...(await t.login('+7999430'+String(i).padStart(4,'0'),'service')),kind:'service'};
  services.push(x);actors.push(x);
 }
 for(let i=0;i<3;i++){
  const x={...(await t.login('+7999440'+String(i).padStart(4,'0'),'insurer')),kind:'insurer'};
  insurers.push(x);actors.push(x);
 }
 assert.equal(actors.length,200);
 for(let i=0;i<masters.length;i++){
  const x=masters[i];
  await request(x,'PUT','/api/performer/profile',{
   name:'Нагрузочный мастер '+i,kind:'master',specialties:['electric','diag','air'],
   brands:{Scania:'excellent',DAF:'good'},taxStatus:'self_employed',inn:'780000000001'
  });
  await request(admin,'POST','/api/admin/performers/'+x.id+'/verify',{decision:'approved'});
  await request(x,'POST','/api/performer/location',{lat:59.933+(i%5)*.001,lng:30.335});
  await request(x,'POST','/api/performer/line',{lineStatus:'online'});
 }
 for(let i=0;i<tows.length;i++){
  const x=tows[i];
  await request(x,'PUT','/api/performer/profile',{name:'Нагрузочный эвакуатор '+i,kind:'tow',prepMinutes:15});
  await request(admin,'POST','/api/admin/performers/'+x.id+'/verify',{decision:'approved'});
  await request(x,'POST','/api/performer/location',{lat:59.933+(i%5)*.001,lng:30.335});
  await request(x,'POST','/api/performer/line',{lineStatus:'online'});
 }
 for(let i=0;i<services.length;i++){
  const x=services[i];
  const card=await request(x,'PUT','/api/base',{
   name:'Нагрузочная рембаза '+i,address:'Санкт-Петербург, Софийская, '+(40+i),
   lat:59.93,lng:30.35,brands:['Scania','DAF'],
   staff:{electric:'own',diag:'own',gearbox:'own'},
   conditions:['parking','pit'],accepts:['quick','long']
  });
  x.centerId=card.center.id;
  await request(admin,'POST','/api/admin/services/'+x.centerId+'/verify',{decision:'approved'});
 }
}
function percentile(values,p){
 if(!values.length)return null;
 const sorted=[...values].sort((a,b)=>a-b);
 return sorted[Math.min(sorted.length-1,Math.ceil(sorted.length*p)-1)];
}
function summary(){
 const metrics={};
 for(const [label,v] of latencies)
  metrics[label]={requests:v.length,p50_ms:percentile(v,.50),p95_ms:percentile(v,.95),p99_ms:percentile(v,.99),max_ms:Math.max(...v)};
 return metrics;
}
async function oneWave(){
 // 200 actual HTTP calls started at the same time, not simulated browser clicks.
 const start=performance.now();
 await Promise.all(actors.map(async actor=>{
  const me=await request(actor,'GET','/api/me',undefined,200,'GET /api/me × 200');
  assert.equal(me.id,actor.id,'Wrong identity when 200 sessions are active');
  assert.ok(me.roles.includes(actor.kind==='tow'?'tow':actor.kind),'Wrong cabinet role for '+actor.kind);
 }));
 const ms=performance.now()-start;
 assert.ok(ms<30_000,'200 simultaneous auth reads took '+Math.round(ms)+'ms');
 const paths={client:'/api/orders',master:'/api/performer/auctions',tow:'/api/performer/auctions',
   service:'/api/base',insurer:'/api/insurer/requests',moderator:'/api/mod/cases',admin:'/api/admin/summary'};
 const start2=performance.now();
 await Promise.all(actors.map(x=>request(x,'GET',paths[x.kind],undefined,200,'GET role-specific cabinets × 200')));
 return {auth_wall_ms:Math.round(ms),cabinet_wall_ms:Math.round(performance.now()-start2)};
}
async function ordersFlow(){
 // Everyone is ordinary (nonpriority) and workers are verified/on line.
 await request(admin,'PUT','/api/admin/settings/dispatch',{priorityFirst:false});
 const jobs=await Promise.all(Array.from({length:40},(_,i)=>{
  const client=clients[i],tow=i>=32;
  return request(client,'POST','/api/orders',{
   service:tow?'tow':'electric',zoneId:'spb',lat:59.934,lng:30.335,brand:'Scania',
   description:'Тест нагрузки: '+(tow?'эвакуация':'электрика')+' '+i,
   ...(tow?{destination:'Сервис на Софийской',cargo:'tractor',loaded:'empty',driverOnSite:true}:{})
  },200,'POST /api/orders × 40').then(z=>({client,worker:tow?tows[i-32]:masters[i],orderId:z.order.id,tow}));
 }));
 createdOrders=jobs.length;
 // A client sees the exact status assigned by the dispatcher; other clients cannot.
 await Promise.all(jobs.map(async j=>{
  const v=await request(j.client,'GET','/api/orders/'+j.orderId);
  assert.equal(v.id,j.orderId);
 }));
 await request(clients[100],'GET','/api/orders/'+jobs[0].orderId,undefined,403,'foreign private order denied');
 // Worker offers are independent. Concurrent selection must never double-book the worker.
 await Promise.all(jobs.map(async j=>{
  await request(j.worker,'POST','/api/orders/'+j.orderId+'/offers',{},200,'POST /api/orders/:id/offers × 40');
 }));
 for(const j of jobs){
  const proposals=await request(j.client,'GET','/api/orders/'+j.orderId+'/offers');
  const mine=proposals.offers.find(x=>x.performer_id===j.worker.id);
  assert.ok(mine,'Worker offer absent from client cabinet');
  await request(j.client,'POST','/api/orders/'+j.orderId+'/offers/'+mine.id+'/choose',{},200,'POST /choose × 40');
  const clientView=await request(j.client,'GET','/api/orders/'+j.orderId);
  const workerView=await request(j.worker,'GET','/api/orders/'+j.orderId);
  assert.equal(clientView.status,'accepted');
  assert.equal(workerView.status,clientView.status);
  assert.equal(clientView.performer.id,j.worker.id);
  assert.equal(clientView.money.callOut,workerView.money.callOut,'Price differs between cabinets');
 }
 // Finish 20 of them, dispute 5, leave 5 in progress, cancel the remaining 10.
 await Promise.all(jobs.slice(0,30).map(async j=>{
  await request(j.worker,'POST','/api/orders/'+j.orderId+'/step',{action:'arrive'});
  await request(j.worker,'POST','/api/orders/'+j.orderId+'/step',{action:'start_work'});
  await request(j.worker,'POST','/api/orders/'+j.orderId+'/amount',{
   extras:[{name:'Диагностика',amount:100000}],result:'solved'
  });
 }));
 await Promise.all(jobs.slice(0,20).map(async(j,i)=>{
  if(i<5){
   const two=await Promise.all([
    t.api('POST','/api/orders/'+j.orderId+'/confirm',{},j.client.token),
    t.api('POST','/api/orders/'+j.orderId+'/confirm',{},j.client.token)
   ]);
   assert.deepEqual(two.map(r=>r.status).sort(),[200,409],'Two competing confirmations must charge once');
  }else await request(j.client,'POST','/api/orders/'+j.orderId+'/confirm',{});
  const c=await request(j.client,'GET','/api/orders/'+j.orderId);
  const m=await request(j.worker,'GET','/api/orders/'+j.orderId);
  assert.equal(c.status,'completed');assert.equal(m.status,c.status);
  assert.equal(c.money.total,m.money.total,'Final amount mismatch');
  completedOrders++;
 }));
 await Promise.all(jobs.slice(20,25).map(async j=>{
  await request(j.client,'POST','/api/orders/'+j.orderId+'/dispute',{reason:'Сумма выше согласованной'});
  const c=await request(j.client,'GET','/api/orders/'+j.orderId);
  const m=await request(j.worker,'GET','/api/orders/'+j.orderId);
  assert.equal(c.status,m.status);assert.equal(c.status,'working');
  disputedOrders++;
 }));
 await Promise.all(jobs.slice(30).map(j=>request(j.client,'POST','/api/orders/'+j.orderId+'/cancel',{reason:'Отмена до начала работ'})));
 const ordinary=await request(moderator,'GET','/api/mod/cases');
 assert.ok(ordinary.counts.dispute>=5,'Moderator cannot see 5 disputes');
 await request(moderator,'GET','/api/admin/summary',undefined,403,'moderator forbidden admin finances');
 return jobs;
}
async function serviceFlow(){
 const day=new Date(t.clock.now().getTime()+3*3600_000).toISOString().slice(0,10);
 const jobs=await Promise.all(Array.from({length:10},async(_,i)=>{
  const client=clients[60+i],provider=services[i%5];
  const vehicle=await request(client,'POST','/api/vehicles',{
   brand:'Scania',model:'R520',year:2019,plate:'А'+String(100+i)+'АА78'
  },200,'POST service vehicle');
  const booking=await request(client,'POST','/api/services/'+provider.centerId+'/book',{
   vehicleId:vehicle.id,need:'electric',day,time:'14:00',arrival:'self',comment:'Проверить пневматику'
  },200,'POST /api/services/:id/book');
  return {client,provider,bookingId:booking.id};
 }));
 bookings=jobs.length;
 for(const j of jobs){
  await request(j.provider,'POST','/api/base/bookings/'+j.bookingId+'/respond',{action:'accept',time:'14:00'});
  await request(j.provider,'POST','/api/base/bookings/'+j.bookingId+'/status',{status:'arrived'});
  await request(j.provider,'POST','/api/base/bookings/'+j.bookingId+'/ready',{works:['Диагностика']});
  const invoice=await request(j.provider,'POST','/api/base/bookings/'+j.bookingId+'/invoice',{amount:600000});
  assert.equal(invoice.payout+invoice.commission,invoice.amount,'Service invoice split wrong');
  const clientView=await request(j.client,'GET','/api/bookings/'+j.bookingId);
  assert.equal(clientView.toPay,invoice.amount,'STO and client see different amounts');
  await request(j.client,'POST','/api/bookings/'+j.bookingId+'/confirm',{agree:true,stars:5});
 }
 const seen=await request(services[0],'GET','/api/base/money');
 assert.ok(seen.items.length>0,'STO finance cabinet has no completed jobs');
 return jobs;
}
async function insuranceFlow(){
 const docs=[];
 for(let i=0;i<6;i++){
  const client=clients[85+i],agent=insurers[i%3];
  const vehicle=await request(client,'POST','/api/vehicles',{
   brand:'Scania',model:'R520',year:2019,plate:'В'+String(100+i)+'ВВ78'
  });
  const truck={brand:'Scania',model:'R520',year:'2019',plate:'В'+String(100+i)+'ВВ78',
   vin:'YS2R4X20001234567',category:'N3',bodyType:'Тягач'};
  const result=await request(client,'POST','/api/vehicle-service-requests',{
   vehicleId:vehicle.id,kind:'insurance',comment:'Тестовый запрос '+i,
   insurance:{agentId:agent.id,consentToPartner:true,
    details:{applicant:{lastName:'Тестов',firstName:'Иван',middleName:''},vehicle:truck}}
  });
  const id=result.id;
  const clientCase=await request(client,'GET','/api/insurance/requests/'+id);
  const agentCase=await request(agent,'GET','/api/insurance/requests/'+id);
  assert.equal(clientCase.request.insurance_stage,agentCase.request.insurance_stage);
  await request(insurers[(i+1)%3],'GET','/api/insurance/requests/'+id,undefined,403,'foreign insurer case denied');
  await request(agent,'POST','/api/insurance/requests/'+id+'/accept',{});
  await request(agent,'POST','/api/insurance/requests/'+id+'/offers',{offers:[
   {company:'СК Тест',product:'ОСАГО',premiumKopecks:1100000,description:'Тест',coverage:'Грузовики'},
   {company:'СК Тест 2',product:'КАСКО',premiumKopecks:1400000,description:'Тест',coverage:'Повреждения'}
  ]});
  const offers=await request(client,'GET','/api/insurance/requests/'+id);
  await request(client,'POST','/api/insurance/requests/'+id+'/choose',{proposalId:offers.proposals[0].id});
  await request(agent,'POST','/api/insurance/requests/'+id+'/accept',{});
  await request(agent,'POST','/api/insurance/requests/'+id+'/messages',{message:'Полис готовится'});
  const buf=Buffer.from('%PDF-1.4\n'+'LOAD TEST PDF '.repeat(12));
  await request(agent,'POST','/api/insurance/requests/'+id+'/policy',{
   dataUrl:'data:application/pdf;base64,'+buf.toString('base64'),
   fileName:'only-demo.pdf',expiresOn:'2027-12-31'
  });
  const resultClient=await request(client,'GET','/api/insurance/requests/'+id);
  const resultAgent=await request(agent,'GET','/api/insurance/requests/'+id);
  assert.equal(resultClient.request.status,'completed');
  assert.equal(resultAgent.request.status,resultClient.request.status);
  assert.equal(resultClient.proposals.length,2);
  assert.ok(resultClient.hasPolicy);
  docs.push(id);
 }
 insuranceCases=docs.length;
 for(const agent of insurers) {
  const queue=await request(agent,'GET','/api/insurer/requests');
  assert.equal(queue.length,2,'Insurer partner sees someone else’s deal or misses own');
 }
 return docs;
}
async function invariants(){
 const q=(sql)=>t.db.query(sql);
 const active="('accepted','en_route','arrived','working','awaiting_confirmation')";
 assert.deepEqual(await q("select performer_id from orders where status in "+active+
  " group by performer_id having count(*)>1"),[],'Worker has two active cases');
 assert.deepEqual(await q("select id from orders where status in "+active+
  " and performer_id is null"),[],'Active case has no assigned worker');
 assert.deepEqual(await q("select id from orders where status='searching' and performer_id is not null"),[]);
 assert.deepEqual(await q("select order_id from ledger_entries where order_id is not null"+
  " group by order_id having sum(amount) <> 0"),[],'Unbalanced ledger across cabinets');
 assert.deepEqual(await q("select order_id from bids where status='chosen'"+
  " group by order_id having count(*)>1"),[],'Two winners of one auction');
 assert.deepEqual(await q("select id from orders where status='completed' and amount_confirmed_at is null"),[]);
 assert.deepEqual(await q("select order_id,kind from payments group by order_id,kind"+
  " having count(*)>1"),[],'Duplicate payment rows');
 assert.deepEqual(failures,[],'HTTP 5xx during concurrency');
}
try{
 await createUsers();
 const waves=await oneWave();
 await ordersFlow();
 await serviceFlow();
 await insuranceFlow();
 await invariants();
 const report={run:'isolated-local-postgres',users:actors.length,
  distribution:{client:clients.length,master:masters.length,tow:tows.length,service:services.length,
   insurer:insurers.length,moderator:1,admin:1},
  waves,createdOrders,completedOrders,disputedOrders,bookings,insuranceCases,
  totalWallMs:Math.round(performance.now()-started),http5xx:failures.length,metrics:summary()};
 await mkdir('test-results',{recursive:true});
 await writeFile('test-results/load-mixed-200.json',JSON.stringify(report,null,2));
 console.log('200 REAL HTTP sessions, parallel orders, billing, insurer/repair/moderator cross-cabinet consistency: PASS');
 console.log(JSON.stringify({users:report.users,waves,createdOrders,completedOrders,
  disputedOrders,bookings,insuranceCases,totalWallMs:report.totalWallMs,
  authP95Ms:report.metrics['GET /api/me × 200'].p95_ms,
  cabinetP95Ms:report.metrics['GET role-specific cabinets × 200'].p95_ms},null,2));
}catch(error){
 console.error('Mixed-role 200-user regression:',error);
 throw error;
}finally{await t.close();}
