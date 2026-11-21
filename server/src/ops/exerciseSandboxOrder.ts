// Full backend round trip with actual sandbox API routes and seeded fake users.
// Create -> fake bank hold -> master accepts -> depart/arrive/work ->
// customer confirms the price -> fake work payment -> ledger reconciliation.
// The ONLY shortcuts are fictional identities and the external bank transport.
// This script is destructive within its disposable sandbox DB: NEVER run on VPS.
import { randomUUID } from 'node:crypto';
import { config } from '../config.ts';
import { createDb } from '../db/index.ts';
import { issueSandboxTicket, type SandboxRole } from '../services/sandboxTickets.ts';

if (!config.sandboxInstance || process.env.TRAKSOS_RUN_DISPOSABLE_SCENARIO !== 'true')
  throw new Error('Refusing real workflow rehearsal outside explicitly disposable sandbox');
const origin = 'http://127.0.0.1:' + config.port;
const pause = (ms:number) => new Promise(resolve => setTimeout(resolve,ms));
function check(value:unknown,message:string): asserts value {
  if (!value) throw new Error('ISOLATED SANDBOX SCENARIO: ' + message);
}
async function call(method:string,route:string,token?:string,body?:unknown):Promise<any> {
  const response = await fetch(origin+route,{
    method,
    headers:{...(token?{authorization:'Bearer '+token}:{}),
      ...(body!==undefined?{'content-type':'application/json'}:{})},
    ...(body===undefined?{}:{body:JSON.stringify(body)}),
    signal:AbortSignal.timeout(18_000),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(method+' '+route+' -> '+response.status+' '+text.slice(0,500));
  if (response.headers.get('content-type')?.includes('json'))
    return text ? JSON.parse(text) : null;
  return text;
}
async function roleToken(role:SandboxRole):Promise<string> {
  const ticket = issueSandboxTicket(role,config.sandboxSharedSecret);
  const response = await call('POST','/api/sandbox/exchange',undefined,{ticket});
  check(response?.role===role && response?.sandbox===true && response?.token,
    'single-use role ticket exchange failed for '+role);
  return response.token;
}
async function acceptTerms(token:string, audiences:string[]) {
  for (const audience of audiences) {
    const offer = await call('GET','/api/offers/current/'+audience);
    if (offer?.id) await call('POST','/api/offers/'+offer.id+'/accept',token,{});
  }
}
async function fakeCheckout(url:string) {
  const path = new URL(url).pathname;
  check(/^\/api\/dev\/mock-pay\/sandbox_mock_[a-f0-9-]{36}$/.test(path),
    'checkout was not bound to sandbox-only fake payment');
  await call('POST',path);
}
async function until<T>(name:string,fn:()=>Promise<T | null>,timeout=16_000):Promise<T> {
  const deadline=Date.now()+timeout;
  let value:T|null=null;
  while(Date.now()<deadline){
    value=await fn();if(value)return value;
    await pause(250);
  }
  throw new Error(name+' not available before deadline');
}

const db=await createDb(config.databaseUrl);
try {
  const [customer,master,admin] = await Promise.all([
    roleToken('client'),roleToken('master'),roleToken('admin')]);
  await acceptTerms(customer,['client','privacy']);
  await acceptTerms(master,['performer','privacy']);
  const unique='Sandbox проверка '+randomUUID().slice(0,8);
  const created=await call('POST','/api/orders',customer,{
    service:'electric',isSos:false,description:unique+' · поиск неисправности',
    address:'Санкт-Петербург, учебная стоянка',regionId:'spb',zoneId:'spb',
    city:'Санкт-Петербург',lat:59.93,lng:30.36,brand:'Scania',model:'R440',year:2012,
    tier:'eco',night:false,paymentMethod:'online',
  });
  const id=created?.order?.id;
  check(typeof id==='string' && created.confirmationUrl,
    'real order was not created with pending fictitious hold');
  await fakeCheckout(created.confirmationUrl);
  await until('master incoming call',async()=>{
    const incoming=await call('GET','/api/performer/incoming',master);
    return Array.isArray(incoming) && incoming.some((o:any)=>o.order_id===id) ? true : null;
  });
  const accepted=await call('POST','/api/orders/'+id+'/accept',master,{});
  check(accepted.status==='accepted','master did not accept the same order');
  await call('POST','/api/orders/'+id+'/step',master,{action:'depart'});
  await call('POST','/api/orders/'+id+'/step',master,{action:'arrive'});
  await call('POST','/api/orders/'+id+'/step',master,{action:'start_work'});
  await call('POST','/api/orders/'+id+'/amount',master,{
    extras:[{name:'Учебная клемма',amount:35_000}],
    result:'solved',note:'Учебный ремонт завершён',
  });
  const [clientView,masterView,adminView]=await Promise.all([
    call('GET','/api/orders/'+id,customer),call('GET','/api/orders/'+id,master),
    call('GET','/api/orders/'+id,admin)]);
  check(clientView.status==='awaiting_confirmation' &&
    clientView.number===masterView.number && masterView.number===adminView.number,
    'order number/status diverged between accounts');
  const price=clientView.money;
  check(price.amount===masterView.money.amount &&
    price.amount===adminView.money.amount &&
    price.total===price.amount+price.clientFee-price.discount &&
    masterView.money.total===price.amount,
    'fictitious price changed between customer, master and administrator');
  check(masterView.money.payout===price.amount-masterView.money.commission+
    masterView.money.pointsCommission,
    'master payout and commission do not reconcile');
  await call('POST','/api/orders/'+id+'/confirm',customer,{total:price.total,points:0});

  // Work money is a separate bank operation; complete it with the same fake
  // checkout page as a human tester, without calling finance handlers directly.
  const work=await until('pending work mock checkout',async()=>{
    const payments=await call('GET','/api/orders/'+id+'/payments',customer);
    return Array.isArray(payments) ?
      payments.find((p:any)=>p.kind==='work' && p.status==='pending' && p.confirmation_url) : null;
  });
  await fakeCheckout(work.confirmation_url);
  const finished=await until('finished order',async()=>{
    const o=await call('GET','/api/orders/'+id,customer);
    return o.status==='completed'?o:null;
  });
  const finalMaster=await call('GET','/api/orders/'+id,master);
  check(finished.money.amount===finalMaster.money.amount &&
    finished.money.total===price.total && finished.number===finalMaster.number,
    'final booking price diverged from agreed amount');

  const balance=await db.one<{total:string}>(
    'select coalesce(sum(amount),0)::text as total from ledger_entries where order_id=$1',[id]);
  check(balance?.total==='0','real ledger does not balance after fictional payment');
  const history=await db.query<{type:string}>(
    'select type from order_events where order_id=$1 order by id',[id]);
  for (const step of ['created','accepted','depart','arrive','start_work','amount_proposed','amount_confirmed'])
    check(history.some(event=>event.type===step),'missing durable order event: '+step);
  // Independent second incident: fleet driver creates an order using the
  // vehicle actually assigned by the owner. Owner approves it using the same
  // real API, then master works, customer confirms and the mock bank settles.
  const [fleetOwner,driver] = await Promise.all([roleToken('owner'),roleToken('driver')]);
  await acceptTerms(fleetOwner,['client','privacy']);
  await acceptTerms(driver,['client','privacy']);
  const ownerFleet = await call('PUT','/api/fleet',fleetOwner,{mode:'approve'});
  check(ownerFleet?.settings?.mode==='approve','fleet owner approval policy was not applied');
  const ownVehicle=await db.one<{id:string}>(
    "select id from vehicles where driver_id=(select id from users where phone=$1) limit 1",
    ['+79000000004']);
  check(ownVehicle?.id,'fictitious driver has no assigned fleet truck');
  const driverCreated=await call('POST','/api/orders',driver,{
    service:'electric',isSos:false,description:'Учебная заявка водителя '+randomUUID().slice(0,8),
    vehicleId:ownVehicle.id,address:'Санкт-Петербург, учебная стоянка',
    regionId:'spb',zoneId:'spb',city:'Санкт-Петербург',
    lat:59.93,lng:30.36,tier:'eco',night:false,paymentMethod:'online',
  });
  const driverId=driverCreated?.order?.id;
  check(driverId && driverCreated.order.status==='awaiting_owner' &&
      !driverCreated.confirmationUrl,
    'driver order was not held for fleet owner financial approval');
  const fleetPending=await call('GET','/api/fleet',fleetOwner);
  check(fleetPending.pending.some((o:any)=>o.id===driverId),
    'new driver incident is missing from the owner approval queue');
  const ownerApproved=await call('POST','/api/orders/'+driverId+'/owner-decision',fleetOwner,{
    approve:true,
  });
  check(ownerApproved?.status==='searching',
    'fleet owner approval did not launch the real order');
  const fleetHold=await until('fleet owner bank hold',async()=>{
    const ps=await call('GET','/api/orders/'+driverId+'/payments',fleetOwner);
    return Array.isArray(ps) ? ps.find((p:any)=>p.kind==='call_out' && p.confirmation_url):null;
  });
  await fakeCheckout(fleetHold.confirmation_url);
  await until('master incoming approved fleet job',async()=>{
    const incoming=await call('GET','/api/performer/incoming',master);
    return Array.isArray(incoming) && incoming.some((o:any)=>o.order_id===driverId)?true:null;
  });
  const fleetAccepted=await call('POST','/api/orders/'+driverId+'/accept',master,{});
  check(fleetAccepted?.status==='accepted','master could not accept driver fleet order');
  for (const action of ['depart','arrive','start_work'])
    await call('POST','/api/orders/'+driverId+'/step',master,{action});
  await call('POST','/api/orders/'+driverId+'/amount',master,{
    extras:[{name:'Учебный кабель',amount:12_000}],result:'solved',
    note:'Учебная диагностика транспорта владельца',
  });
  const [dv,ov,mv,av]=await Promise.all([
    call('GET','/api/orders/'+driverId,driver),
    call('GET','/api/orders/'+driverId,fleetOwner),
    call('GET','/api/orders/'+driverId,master),
    call('GET','/api/orders/'+driverId,admin),
  ]);
  check([dv,ov,mv,av].every(v=>v.number===dv.number && v.status==='awaiting_confirmation'),
    'fleet order number or status diverged between four roles');
  check(dv.money.total===ov.money.total && ov.money.total===av.money.total &&
    mv.money.amount===ov.money.amount && mv.money.total===ov.money.amount &&
    dv.money.total===dv.money.amount+dv.money.clientFee-dv.money.discount,
    'fleet order amounts diverged between driver, owner, master and admin');
  await call('POST','/api/orders/'+driverId+'/confirm',fleetOwner,{
    total:ov.money.total,points:0,
  });
  const fleetWork=await until('fleet work fake checkout',async()=>{
    const ps=await call('GET','/api/orders/'+driverId+'/payments',fleetOwner);
    return Array.isArray(ps)?ps.find((p:any)=>p.kind==='work' && p.status==='pending' && p.confirmation_url):null;
  });
  await fakeCheckout(fleetWork.confirmation_url);
  const driverCompleted=await until('driver order completed',async()=>{
    const o=await call('GET','/api/orders/'+driverId,driver);
    return o.status==='completed'?o:null;
  });
  const ownerCompleted=await call('GET','/api/orders/'+driverId,fleetOwner);
  const masterCompleted=await call('GET','/api/orders/'+driverId,master);
  check(driverCompleted.money.total===ownerCompleted.money.total &&
    driverCompleted.money.total===ov.money.total &&
    masterCompleted.money.amount===ov.money.amount,
    'driver/owner/master final sum disagreed after payment');
  const fleetLedger=await db.one<{sum:string}>(
    'select coalesce(sum(amount),0)::text as sum from ledger_entries where order_id=$1',
    [driverId]);
  check(fleetLedger?.sum==='0','driver order ledger does not balance');
  const fleetEvents=await db.query<{type:string}>(
    'select type from order_events where order_id=$1 order by id',[driverId]);
  for(const action of ['created','owner_approved','accepted','depart','arrive','amount_proposed','amount_confirmed'])
    check(fleetEvents.some(e=>e.type===action),'fleet missing event '+action);
  console.log(JSON.stringify({
    result:'PASS',sandbox:true,case:'fleet-driver-owner-master-admin',
    order:driverId,participantCount:4,
    finalClientTotalKopecks:driverCompleted.money.total,
    agreedWorkAmountKopecks:masterCompleted.money.amount,
    ledgerBalanced:true,realMoney:false,
  }));

  console.log(JSON.stringify({
    result:'PASS',sandbox:true,order:id,participants:['client','master','admin'],
    customerTotalKopecks:finished.money.total,baseAmountKopecks:finalMaster.money.amount,
    masterPayoutKopecks:finalMaster.money.payout,ledgerBalanced:true,
    events:history.length,realMoney:false,
  }));
} finally {
  await db.close();
}
