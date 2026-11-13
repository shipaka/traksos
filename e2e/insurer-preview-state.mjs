// Insurance sandbox state-machine security check. No account login or real HTTP calls.
import assert from 'node:assert/strict';
globalThis.window={TRAKSOS_API:'',addEventListener(){},dispatchEvent(){}};
globalThis.location={hash:'#/admin/test-center/insurer'};
globalThis.localStorage={getItem(){return null},setItem(){},removeItem(){}};
globalThis.CustomEvent=class {constructor(type,options){this.type=type;this.detail=options?.detail}};
const api=await import('../web/src/demo/insurerPreviewApi.ts');
const agent=(path,body)=>api.previewInsurerApi('POST',path,body);
const read=(path)=>api.previewInsurerApi('GET',path);
const clientView=()=>{location.hash='#/admin/test-center/insurer/client';};
const agentView=()=>{location.hash='#/admin/test-center/insurer';};
const vehicle={brand:'Scania',model:'R520',year:'2019',vin:'YS2R4X20001234567',
  plate:'А123АА78',category:'N3',bodyType:'Седельный тягач',enginePower:'520',
  maximumMass:'19000',emptyMass:'8600',chassisNumber:'R520-1212',
  engineNumber:'DC13',registrationCertificate:'78АВ123456',
  trailerPlate:'В111ВВ78',registrationRegion:'Санкт-Петербург',usage:'Грузоперевозки'};
const applicant={lastName:'Петров',firstName:'Иван',middleName:'Иванович'};
clientView();
const created=await agent('/api/vehicle-service-requests',{
  kind:'insurance',vehicleId:api.demoVehicleId,
  insurance:{agentId:'demo-agent',consentToPartner:true,details:{applicant,vehicle}}
});
const id=created.id;
assert.equal((await read('/api/insurance/requests/'+id)).request.insurance_stage,'received');
assert.equal(api.demoTotal(1_000_000).platformFeeKopecks,50_000);
assert.equal(api.demoTotal(1_000_000).totalKopecks,1_050_000);
await assert.rejects(agent('/api/insurance/requests/'+id+'/accept'),/соответствующий вид/i);
agentView();
await agent('/api/insurance/requests/'+id+'/accept');
const offer=(n)=>({company:'Тестовая страховая '+n,product:'ОСАГО грузовика',
  premiumKopecks:1_000_000+n*5000,description:'Учебный расчёт',coverage:'Условия примера'});
await assert.rejects(agent('/api/insurance/requests/'+id+'/offers',{offers:Array.from({length:21},(_,i)=>offer(i))}),/20/);
await agent('/api/insurance/requests/'+id+'/offers',{offers:Array.from({length:20},(_,i)=>offer(i))});
clientView();
let doc=await read('/api/insurance/requests/'+id);
assert.equal(doc.request.insurance_stage,'offers_sent');
assert.equal(doc.proposals.length,20);
await agent('/api/insurance/requests/'+id+'/choose',{proposalId:doc.proposals[0].id});
doc=await read('/api/insurance/requests/'+id);
assert.equal(doc.request.insurance_stage,'awaiting_payment');
await assert.rejects(agent('/api/insurance/requests/'+id+'/choose',{proposalId:doc.proposals[1].id}),/предложен/i);
await agent('/api/insurance/requests/'+id+'/pay');
doc=await read('/api/insurance/requests/'+id);
assert.equal(doc.request.insurance_stage,'paid');
agentView();
await agent('/api/insurance/requests/'+id+'/accept');
const bytes=new TextEncoder().encode('%PDF-1.4\n'+'Demo PDF test '.repeat(30));
const dataUrl='data:application/pdf;base64,'+Buffer.from(bytes).toString('base64');
await agent('/api/insurance/requests/'+id+'/policy',{
  dataUrl,fileName:'demo.pdf',expiresOn:'2030-12-31'});
clientView();
doc=await read('/api/insurance/requests/'+id);
assert.equal(doc.request.status,'completed');
assert.equal(doc.request.insurance_stage,'policy_sent');
assert.equal(doc.hasPolicy,true);
assert.equal((await api.insurerPreviewPdf(id)).size,bytes.length);
assert.ok(doc.messages.some(x=>x.kind==='policy'));
api.resetInsurerPreview();
assert.equal((await read('/api/insurer/requests/client')).length,1);
console.log('Insurance sandbox: 20 offers, actor permissions, 5% fee, mock payment, PDF, reset: OK');
