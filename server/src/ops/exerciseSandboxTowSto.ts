// Real sandbox-only handoff: client -> tow -> workshop -> customer -> admin.
// Business actions go through the same HTTP endpoints as production.
// Participants are fictitious; payment confirmation and receipts are virtual.
// Executable only on a disposable CI runner with an isolated PostgreSQL database.
import { randomUUID } from 'node:crypto';
import { config } from '../config.ts';
import { createDb } from '../db/index.ts';
import { issueSandboxTicket, type SandboxRole, SANDBOX_USER_PHONE } from '../services/sandboxTickets.ts';

if (!config.sandboxInstance || process.env.TRAKSOS_RUN_DISPOSABLE_SCENARIO !== 'true')
  throw new Error('Tow/STO exercise requires a disposable isolated sandbox');
function ensure(cond:unknown,msg:string): asserts cond {
  if(!cond)throw new Error('TOW/STO SANDBOX: '+msg);
}
async function call(method:string,url:string,token?:string,body?:unknown):Promise<any>{
  const response=await fetch('http://127.0.0.1:'+config.port+url,{
    method,headers:{...(token?{authorization:'Bearer '+token}:{}),
      ...(body===undefined?{}:{'content-type':'application/json'})},
    ...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(20_000),
  });
  const output=await response.text();
  if(!response.ok)throw new Error(method+' '+url+' -> '+response.status+' '+output.slice(0,500));
  return response.headers.get('content-type')?.includes('json')?JSON.parse(output):output;
}
async function token(role:SandboxRole):Promise<string>{
  const response=await call('POST','/api/sandbox/exchange',undefined,{
    ticket:issueSandboxTicket(role,config.sandboxSharedSecret),
  });
  ensure(response.role===role && response.token,'role ticket failed for '+role);
  return response.token;
}
async function consent(auth:string,audiences:string[]){
  for(const audience of audiences){
    const offer=await call('GET','/api/offers/current/'+audience);
    if(offer?.id)await call('POST','/api/offers/'+offer.id+'/accept',auth,{});
  }
}
async function virtualPay(url:string){
  const paymentPath=new URL(url).pathname;
  ensure(/^\/api\/dev\/mock-pay\/sandbox_mock_[0-9a-f-]{36}$/.test(paymentPath),
    'non-sandbox payment URL blocked');
  await call('POST',paymentPath);
}
async function eventually<T>(title:string,fn:()=>Promise<T|null>,timeout=20_000):Promise<T>{
  const stop=Date.now()+timeout;let last:unknown;
  while(Date.now()<stop){try{const x=await fn();if(x)return x;}catch(e){last=e;}
    await new Promise(resolve=>setTimeout(resolve,300));}
  throw new Error(title+' not achieved: '+String(last??'no result'));
}
const db=await createDb(config.databaseUrl);
try{
  const [client,tow,service,admin]=await Promise.all([
    token('client'),token('tow'),token('service'),token('admin'),
  ]);
  await consent(client,['client','privacy']);
  await consent(tow,['performer','privacy']);
  const car=await db.one<{id:string}>(
    'select id from vehicles where owner_id=(select id from users where phone=$1) limit 1',
    [SANDBOX_USER_PHONE.client]);
  ensure(car?.id,'sample customer truck is not seeded');

  const created=await call('POST','/api/orders',client,{
    service:'tow',isSos:false,description:'Учебная эвакуация '+randomUUID().slice(0,8),
    vehicleId:car.id,regionId:'spb',zoneId:'spb',address:'Санкт-Петербург, учебная стоянка',
    lat:59.93,lng:30.36,city:'Санкт-Петербург',
    destination:'Санкт-Петербург, Учебное СТО',
    cargo:'tractor',loaded:'empty',driverOnSite:true,night:false,paymentMethod:'online',
  });
  const id=created?.order?.id;
  ensure(id&&created.confirmationUrl,'real tow order did not create sandbox payment hold');
  await virtualPay(created.confirmationUrl);
  await eventually('tow incoming invitation',async()=>{
    const incoming=await call('GET','/api/performer/incoming',tow);
    return Array.isArray(incoming)&&incoming.some((x:any)=>x.order_id===id)?true:null;
  });
  const accepted=await call('POST','/api/orders/'+id+'/accept',tow,{});
  ensure(accepted.status==='accepted','tow driver did not accept order');
  for(const action of ['depart','arrive','start_work'])
    await call('POST','/api/orders/'+id+'/step',tow,{action});
  await call('POST','/api/orders/'+id+'/amount',tow,{
    extras:[{name:'Учебный такелаж',amount:25_000}],result:'solved',
    note:'Учебная эвакуация до СТО завершена',
  });
  const [towClient,towWorker,towAdmin]=await Promise.all([
    call('GET','/api/orders/'+id,client),
    call('GET','/api/orders/'+id,tow),
    call('GET','/api/orders/'+id,admin),
  ]);
  ensure([towClient,towWorker,towAdmin].every(x=>x.number===towClient.number&&
    x.status==='awaiting_confirmation'),'tow status or number diverged by role');
  ensure(towClient.money.total===towAdmin.money.total &&
    towClient.money.amount===towWorker.money.amount &&
    towClient.money.total===towClient.money.amount+towClient.money.clientFee-towClient.money.discount &&
    towWorker.money.total===towClient.money.amount,'tow client/provider amounts inconsistent');
  await call('POST','/api/orders/'+id+'/confirm',client,{total:towClient.money.total,points:0});
  const towPayment=await eventually('tow work settlement',async()=>{
    const ps=await call('GET','/api/orders/'+id+'/payments',client);
    return Array.isArray(ps)?ps.find((p:any)=>p.kind==='work'&&p.status==='pending'&&p.confirmation_url):null;
  });
  await virtualPay(towPayment.confirmation_url);
  const completed=await eventually('tow completion',async()=>{
    const x=await call('GET','/api/orders/'+id,client);
    return x.status==='completed'?x:null;
  });
  ensure(completed.money.total===towClient.money.total,
    'tow payment changed accepted amount');

  // A workshop booking is a subsequent linked stage in the same vehicle case.
  const center=await db.one<{id:string}>(
    'select id from service_centers where owner_id=(select id from users where phone=$1) limit 1',
    [SANDBOX_USER_PHONE.service]);
  ensure(center?.id,'sample STO is not seeded');
  const tomorrow=new Date(Date.now()+72*3600_000).toISOString().slice(0,10);
  const booked=await call('POST','/api/services/'+center.id+'/book',client,{
    vehicleId:car.id,need:'electric',day:tomorrow,time:'12:00',
    arrival:'tow',comment:'Учебное продолжение после эвакуации',caseOrderId:id,
  });
  const bookingId=booked?.id;
  ensure(bookingId&&booked.status==='new'&&booked.caseRootId===id,
    'linked workshop stage did not inherit the towing case');
  const stoIncoming=await call('GET','/api/base',service);
  ensure(stoIncoming?.groups?.requests?.some((x:any)=>x.id===bookingId),
    'service did not receive the client booking');
  await call('POST','/api/base/bookings/'+bookingId+'/respond',service,{
    action:'accept',time:'12:00',
  });
  for(const status of ['arrived','diagnostics','in_work'])
    await call('POST','/api/base/bookings/'+bookingId+'/status',service,{status});
  await call('POST','/api/base/bookings/'+bookingId+'/ready',service,{
    works:['Диагностика','Электрика'],
  });
  await call('POST','/api/base/bookings/'+bookingId+'/invoice',service,{
    amount:250_000,partsAmount:50_000,points:0,
  });
  const [clientInvoice,serviceInvoice,adminFinance]=await Promise.all([
    call('GET','/api/bookings/'+bookingId,client),
    call('GET','/api/bookings/'+bookingId,service),
    call('GET','/api/admin/bookings/'+bookingId+'/payment-events',admin),
  ]);
  ensure(clientInvoice.number===serviceInvoice.number&&
    clientInvoice.status==='invoiced'&&serviceInvoice.status==='invoiced',
    'STO invoice or status inconsistent');
  ensure(clientInvoice.amount===serviceInvoice.amount &&
    clientInvoice.toPay===adminFinance.invoice.amount+
      adminFinance.invoice.clientFee-adminFinance.invoice.discount &&
    clientInvoice.amount+clientInvoice.clientFee-clientInvoice.discount===clientInvoice.toPay,
    'STO visible amount differs from admin invoice');
  ensure(serviceInvoice.payout===serviceInvoice.amount-serviceInvoice.commission &&
    serviceInvoice.clientFee===undefined,
    'STO payout or privacy of client surcharge failed');

  await call('POST','/api/bookings/'+bookingId+'/confirm',client,{
    agree:true,stars:5,text:'Учебная проверка ремонта',
  });
  const closed=await call('GET','/api/bookings/'+bookingId,client);
  ensure(closed.status==='closed','real client did not close workshop booking');
  // This is NOT a real bank receipt: in the isolated CI only, imitate the
  // administrator's existing manual acknowledgement with a fictional reference.
  await call('POST','/api/admin/bookings/'+bookingId+'/payment-events',admin,{
    kind:'receipt',amount:closed.toPay,method:'invoice',
    reference:'SANDBOX-'+randomUUID(),
  });
  const received=await call('GET','/api/admin/bookings/'+bookingId+'/payment-events',admin);
  ensure(received.invoice.paymentStatus==='received'&&received.invoice.outstanding===0,
    'STO virtual receipt does not equal the amount due');
  const status=await call('GET','/api/bookings/'+bookingId,client);
  ensure(status.paymentConfirmed===true,'STO client still sees an unpaid invoice');

  const towLedger=await db.one<{total:string}>(
    'select coalesce(sum(amount),0)::text as total from ledger_entries where order_id=$1',[id]);
  ensure(towLedger?.total==='0','tow ledger not balanced');
  const linked=await db.one<{case_root_id:string;vehicle_id:string}>(
    'select case_root_id::text,vehicle_id::text from service_bookings where id=$1',[bookingId]);
  ensure(linked?.case_root_id===id&&linked?.vehicle_id===car.id,
    'truck or towing incident lost its case link');
  console.log(JSON.stringify({
    result:'PASS',sandbox:true,case:'client-tow-STO-admin',
    towOrderId:id,workshopBookingId:bookingId,actors:4,
    towClientTotalKopecks:completed.money.total,
    workshopClientTotalKopecks:closed.toPay,
    workshopPayoutKopecks:serviceInvoice.payout,
    ledgerBalanced:true,virtualReceipts:true,realMoney:false,
  }));
}finally{await db.close();}
