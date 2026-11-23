// Disposable, REAL backend exercise for the approved #3 "no performer" card.
// No fake order status, mocked response, production traffic, SMS or real money.
// Creates owner + fleet driver incidents via the normal API and sandbox checkout.
// The absent specialization is a deliberate fact of the isolated demo seed.
import { config } from '../config.ts';
import { createDb } from '../db/index.ts';
import { issueSandboxTicket, SANDBOX_USER_PHONE, type SandboxRole } from '../services/sandboxTickets.ts';

if (!config.sandboxInstance || process.env.TRAKSOS_RUN_DISPOSABLE_SCENARIO !== 'true')
  throw Error('No-performer exercise is restricted to disposable isolated sandbox');
const origin='http://127.0.0.1:'+config.port;
const marker='TRAKSOS_QA_NO_PERFORMER_20261123_';
const assert=(value:unknown,message:string):asserts value=>{
  if(!value)throw Error('NO PERFORMER SANDBOX: '+message);
};
async function api(method:string,path:string,token?:string,body?:unknown):Promise<any>{
  const response=await fetch(origin+path,{method,
    headers:{...(token?{authorization:'Bearer '+token}:{}),
      ...(body===undefined?{}:{'content-type':'application/json'})},
    ...(body===undefined?{}:{body:JSON.stringify(body)}),
    signal:AbortSignal.timeout(20_000)});
  const output=await response.text();
  if(!response.ok)throw Error(method+' '+path+' -> '+response.status+' '+output.slice(0,420));
  return response.headers.get('content-type')?.includes('json')?JSON.parse(output):output;
}
async function token(role:SandboxRole):Promise<string>{
  const data=await api('POST','/api/sandbox/exchange',undefined,{
    ticket:issueSandboxTicket(role,config.sandboxSharedSecret)});
  assert(data?.sandbox===true && data.role===role && data.token,
    'signed ticket failed for '+role);
  return data.token;
}
async function consent(userToken:string){
  for(const audience of ['client','privacy']){
    const offer=await api('GET','/api/offers/current/'+audience);
    if(offer?.id)await api('POST','/api/offers/'+offer.id+'/accept',userToken,{});
  }
}
async function virtualHold(url:string){
  const path=new URL(url).pathname;
  assert(/^\/api\/dev\/mock-pay\/sandbox_mock_[0-9a-f-]{36}$/.test(path),
    'non-sandbox payment destination');
  await api('POST',path);
}
async function eventualOrder(userToken:string,id:string){
  for(let retry=0;retry<40;retry++){
    const v=await api('GET','/api/orders/'+id,userToken);
    if(v.status==='no_performer')return v;
    if(v.status!=='searching'&&v.status!=='pending_payment')
      throw Error('Unexpected terminal state '+v.status);
    await new Promise(r=>setTimeout(r,250));
  }
  throw Error('No performer order did not finish real search: '+id);
}

const db=await createDb(config.databaseUrl);
try{
  // Confirm the absence is true in the CURRENT isolated seed, not a guess or
  // a radius-only claim: if somebody adds an hydraulics master, fail the fixture.
  const matches=await db.one<{count:string}>(`select count(*)::text as count
    from performer_profiles p join users u on u.id=p.user_id
   where p.kind='master' and u.status='active' and p.specialties @> array['hydraulics']::text[]`);
  assert(matches?.count==='0','fixture unexpectedly has connected hydraulics partners');

  const [owner,driver,admin]=await Promise.all([token('owner'),token('driver'),token('admin')]);
  await consent(owner);
  await consent(driver);
  const fleetVehicle=await db.one<{id:string}>(`select id from vehicles
     where driver_id=(select id from users where phone=$1) limit 1`,
     [SANDBOX_USER_PHONE.driver]);
  assert(fleetVehicle?.id,'driver has no assigned real fleet vehicle');

  for(const [role,who] of [['owner',owner],['driver',driver]] as const){
    const description=marker+role.toUpperCase();
    const payload={
      service:'hydraulics',isSos:false,description,
      address:'Санкт-Петербург, учебная стоянка',regionId:'spb',zoneId:'spb',
      city:'Санкт-Петербург',lat:59.93,lng:30.36,tier:'eco',
      night:false,paymentMethod:'online',
      ...(role==='driver'?{vehicleId:fleetVehicle.id}:{brand:'Scania',model:'R440',year:2012}),
    };
    const created=await api('POST','/api/orders',who,payload);
    const id=created?.order?.id;
    assert(typeof id==='string','order not created via actual customer route for '+role);
    // Owner-controlled fleet policy may require a real owner decision before
    // the driver can proceed; do not bypass it by editing status in PostgreSQL.
    if(created.order.status==='awaiting_owner'){
      assert(role==='driver','only driver can be awaiting owner');
      await api('POST','/api/orders/'+id+'/owner-decision',owner,{approve:true});
    }
    const hold=created.confirmationUrl || (await api('GET','/api/orders/'+id+'/payments',who))
      .find((p:any)=>p.kind==='call_out' && p.confirmation_url)?.confirmation_url;
    assert(typeof hold==='string','missing sandbox mock payment hold for '+role);
    await virtualHold(hold);
    const finished=await eventualOrder(who,id);
    assert(finished.absenceReason==='not_connected',
      'absent hydraulics specialists must produce a proved reason: '+role+' '+finished.absenceReason);
    assert(finished.events?.some((e:any)=>e.type==='auction_started' &&
      Number(e.data?.candidates)===0),'no final empty auction event for '+role);
    assert(finished.events?.some((e:any)=>e.type==='no_performer' &&
      e.data?.absenceReason==='not_connected'),'missing immutable no-performer event for '+role);
    const adminView=await api('GET','/api/orders/'+id,admin);
    assert(adminView.absenceReason===undefined,'requester-only reason leaked to admin');
    console.log('NO PERFORMER REAL BACKEND PASS '+JSON.stringify({
      role,id,status:finished.status,reason:finished.absenceReason,
      description,payment:'sandbox_mock_only'}));
  }
}finally{await db.close();}
