import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, ok, type T } from './helpers.ts';

const pdfBytes=Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n'+'% synthetic test policy\n'.repeat(10)+'%%EOF\n');

async function fixture(t:T, suffix:string) {
  const client=await t.login('+7999888'+suffix+'1');
  const agent=await t.login('+7999888'+suffix+'2','insurer');
  const outsider=await t.login('+7999888'+suffix+'3','insurer');
  const vehicle=ok(await t.api('POST','/api/vehicles',{
    brand:'Scania',model:'R',year:2011,plate:'А111АА78',
    vin:'YS2R4X20001234567',
  },client.token));
  const request=ok(await t.api('POST','/api/vehicle-service-requests',{
    vehicleId:vehicle.id,kind:'insurance',comment:'Синтетическая заявка, не реальный полис',
    insurance:{
      agentId:agent.id,consentToPartner:true,
      details:{
        applicant:{firstName:'Иван',lastName:'Тестов'},
        vehicle:{
          brand:'Scania',model:'R',year:'2011',vin:'YS2R4X20001234567',
          plate:'А111АА78',category:'N3',bodyType:'Тягач',
          enginePower:'380',maximumMass:'18000',emptyMass:'7000',
          chassisNumber:'',registrationCertificate:'',engineNumber:'',
          trailerPlate:'',registrationRegion:'78',usage:'Коммерческое',
        },
      },
    },
  },client.token));
  assert.equal(request.insurance_stage,'received');
  return {client,agent,outsider,vehicle,request};
}
const quotes=[
  {company:'Компания А',product:'ОСАГО',premiumKopecks:1250000,description:'Проверка',coverage:'Грузовой транспорт'},
  {company:'Компания Б',product:'КАСКО',premiumKopecks:9500000,description:'Проверка',coverage:'Грузовой транспорт'},
];
async function statuses(t:T,id:string) {
  return t.db.query<{kind:string;body:string}>('select kind,body from insurance_thread_messages where request_id=$1 order by id',[id]);
}
async function results(t:T,id:string) {
  return t.db.query<{id:string;premium_kopecks:number}>('select id,premium_kopecks from insurance_proposals where request_id=$1 order by premium_kopecks',[id]);
}
const race=async<T>(count:number, action:()=>Promise<T>)=>Promise.all(Array.from({length:count},action));
function exactlyOneResponse(responses:{status:number;body:any}[], stage:string) {
  const accepted=responses.filter(r=>r.status===200);
  assert.equal(accepted.length,1,JSON.stringify(responses.map(r=>({status:r.status,error:r.body?.error}))));
  assert.equal(accepted[0].body.stage,stage);
  assert.ok(responses.filter(r=>r.status!==200).every(r=>r.status===400&&['invalid_stage','closed'].includes(r.body?.error)),
    'losing requests must not pass the old state');
}

test('a real insurance case serializes concurrent agent accept, quotes, customer choice, PDF and chat',
  {timeout:120000},async()=>{
  const t=await setup();
  try {
    const {client,agent,outsider,request}=await fixture(t,'771');
    const id=request.id;
    let copies=await race(6,()=>t.api('POST',`/api/insurance/requests/${id}/accept`,{},agent.token));
    exactlyOneResponse(copies,'preparing');
    assert.equal((await statuses(t,id)).filter(m=>m.body.includes('подготовка предложений')).length,1);

    copies=await race(5,()=>t.api('POST',`/api/insurance/requests/${id}/offers`,{offers:quotes},agent.token));
    exactlyOneResponse(copies,'offers_sent');
    const available=await results(t,id);
    assert.equal(available.length,2,'only the winning request may insert 2 offers');
    assert.equal((await statuses(t,id)).filter(m=>m.kind==='offers').length,1);

    copies=await Promise.all([
      t.api('POST',`/api/insurance/requests/${id}/choose`,{proposalId:available[0].id},client.token),
      t.api('POST',`/api/insurance/requests/${id}/choose`,{proposalId:available[1].id},client.token),
      ...Array.from({length:4},()=>t.api('POST',`/api/insurance/requests/${id}/choose`,{proposalId:available[0].id},client.token)),
    ]);
    exactlyOneResponse(copies,'selected');
    assert.equal((await statuses(t,id)).filter(m=>m.kind==='selection').length,1);
    const selected=await t.db.one<{insurance_choice_id:string}>(
      'select insurance_choice_id from vehicle_service_requests where id=$1',[id]);
    assert.ok(available.some(x=>x.id===selected?.insurance_choice_id));

    copies=await race(4,()=>t.api('POST',`/api/insurance/requests/${id}/accept`,{},agent.token));
    exactlyOneResponse(copies,'processing');
    assert.equal((await statuses(t,id)).filter(m=>m.body.includes('оформление выбранного полиса')).length,1);

    const policy={dataUrl:'data:application/pdf;base64,'+pdfBytes.toString('base64'),
      fileName:'test-policy.pdf',expiresOn:'2028-12-31'};
    copies=await race(5,()=>t.api('POST',`/api/insurance/requests/${id}/policy`,policy,agent.token));
    exactlyOneResponse(copies,'policy_sent');
    const files=await t.db.query<{id:string}>(
      'select id from insurance_policy_files where request_id=$1',[id]);
    assert.equal(files.length,1,'duplicate PDF storage forbidden');
    assert.equal((await statuses(t,id)).filter(m=>m.kind==='policy').length,1);
    const state=await t.db.one<{status:string;insurance_stage:string}>(
      'select status,insurance_stage from vehicle_service_requests where id=$1',[id]);
    assert.equal(state?.status,'completed');
    assert.equal(state?.insurance_stage,'policy_sent');
    const ownerPdf=await fetch(t.base+`/api/insurance/requests/${id}/policy`,{
      headers:{authorization:`Bearer ${client.token}`}});
    assert.equal(ownerPdf.status,200);
    assert.deepEqual(Buffer.from(await ownerPdf.arrayBuffer()),pdfBytes);
    assert.equal((await t.api('GET',`/api/insurance/requests/${id}`,undefined,outsider.token)).status,403);
    const strangerPdf=await fetch(t.base+`/api/insurance/requests/${id}/policy`,{
      headers:{authorization:`Bearer ${outsider.token}`}});
    assert.equal(strangerPdf.status,403);

    // A staff-side reassignment/correction must immediately revoke the former
    // agent's PDF read privileges. Existing issued PDF belongs to the vehicle
    // and current permitted parties, not the agent who originally uploaded it.
    await t.db.query('update vehicle_service_requests set assigned_to=$2 where id=$1',
      [id,outsider.id]);
    const oldAgentPdf=await fetch(t.base+`/api/insurance/requests/${id}/policy`,{
      headers:{authorization:`Bearer ${agent.token}`}});
    assert.equal(oldAgentPdf.status,403,'former agent cannot read the buyer\'s PDF');
    const newAgentPdf=await fetch(t.base+`/api/insurance/requests/${id}/policy`,{
      headers:{authorization:`Bearer ${outsider.token}`}});
    assert.equal(newAgentPdf.status,200);
    assert.deepEqual(Buffer.from(await newAgentPdf.arrayBuffer()),pdfBytes);
  }finally{await t.close();}
});

test('reassigned agent loses quote, message and policy rights; message cannot follow rejection',
  {timeout:90000},async()=>{
  const t=await setup();
  try {
    const admin=await t.login('+79990000001');
    const {client,agent,outsider,request}=await fixture(t,'772');
    const id=request.id;
    const moved=ok(await t.api('POST',`/api/admin/vehicle-service-requests/${id}/assign-insurer`,
      {insurerId:outsider.id},admin.token));
    assert.equal(moved.assigned_to,outsider.id);
    for(const path of ['accept','offers','messages']) {
      const body=path==='offers'?{offers:quotes}:path==='messages'?{message:'Проверка старого агента'}:{};
      const response=await t.api('POST',`/api/insurance/requests/${id}/${path}`,body,agent.token);
      assert.equal(response.status,403,`reassigned agent must be rejected for ${path}`);
    }
    const next=ok(await t.api('POST',`/api/insurance/requests/${id}/accept`,{},outsider.token));
    assert.equal(next.stage,'preparing');
    ok(await t.api('POST',`/api/insurance/requests/${id}/offers`,{offers:quotes},outsider.token));
    const available=await results(t,id);
    ok(await t.api('POST',`/api/insurance/requests/${id}/choose`,{proposalId:available[0].id},client.token));
    ok(await t.api('POST',`/api/insurance/requests/${id}/accept`,{},outsider.token));

    const expiredAgentPdf=await t.api('POST',`/api/insurance/requests/${id}/policy`,{
      dataUrl:'data:application/pdf;base64,'+pdfBytes.toString('base64'),
      fileName:'test.pdf',expiresOn:'2028-12-31',
    },agent.token);
    assert.equal(expiredAgentPdf.status,403);
    const response=ok(await t.api('POST',`/api/insurance/requests/${id}/messages`,
      {message:'Сообщение действующего партнёра'},outsider.token));
    assert.ok(response.id);

    // A cancelled/rejected case cannot accept a late message, even when the
    // sender already fetched it in the browser before the status changed.
    const rejected=ok(await t.api('PATCH',`/api/admin/vehicle-service-requests/${id}`,
      {status:'rejected',note:'Отказ для проверки закрытия'},admin.token));
    assert.equal(rejected.status,'rejected');
    const message=await t.api('POST',`/api/insurance/requests/${id}/messages`,
      {message:'После закрытия'},outsider.token);
    assert.equal(message.status,400);
    assert.equal(message.body.error,'closed');
    assert.equal((await statuses(t,id)).filter(m=>m.body==='После закрытия').length,0);
  }finally{await t.close();}
});
