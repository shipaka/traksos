import assert from 'node:assert/strict';
import {test} from 'node:test';
import {setup,ok} from './helpers.ts';

test('manual insurance: owner -> assigned agent -> <=20 offers -> choice -> PDF in same thread',async()=>{
  const t=await setup();
  try{
    const client=await t.login('+79990008301','client');
    const agent=await t.login('+79990008302','client');
    const other=await t.login('+79990008303','client');
    await t.db.query(`update users set roles=array_append(roles,'insurer'),
      company_name='Страховой партнёр тест',status='active' where id=$1`,[agent.id]);
    const vehicle=ok(await t.api('POST','/api/vehicles',{
      brand:'Scania',model:'R520',year:2019,plate:'А555АА78',trailerPlate:'В888ВВ78'},client.token));
    assert.ok(vehicle.id);
    const agents=ok(await t.api('GET','/api/insurance/agents',undefined,client.token));
    assert.ok(agents.some((a:any)=>a.id===agent.id));
    const v={brand:'Scania',model:'R520',year:'2019',plate:'А555АА78',vin:'YS2R4X20001234567',
      category:'N3',bodyType:'седельный тягач',chassisNumber:'CH-12345',engineNumber:'D1234',
      enginePower:'500',maximumMass:'19000',emptyMass:'8600',registrationCertificate:'78AB012345',
      registrationRegion:'Санкт-Петербург',trailerPlate:'В888ВВ78',usage:'Грузоперевозки'};
    const request=ok(await t.api('POST','/api/vehicle-service-requests',{
      vehicleId:vehicle.id,kind:'insurance',comment:'Проверить варианты',
      insurance:{agentId:agent.id,consentToPartner:true,details:{applicant:{firstName:'Иван',lastName:'Иванов',middleName:'Иванович'},vehicle:v}}
    },client.token));
    assert.equal(request.insurance_stage,'received');
    assert.equal(request.assigned_to,agent.id);
    const id=request.id;
    assert.equal((await t.api('GET','/api/insurance/requests/'+id,undefined,other.token)).status,403);
    assert.equal((await t.api('POST','/api/insurance/requests/'+id+'/accept',{},other.token)).status,403);
    const dossier=ok(await t.api('GET','/api/insurance/requests/'+id,undefined,agent.token));
    assert.equal(dossier.request.insurance_details.vehicle.vin,v.vin);
    assert.equal(dossier.request.insurance_details.applicant.lastName,'Иванов');
    assert.equal((await t.api('POST','/api/insurance/requests/'+id+'/choose',{
      proposalId:'00000000-0000-0000-0000-000000000001'},client.token)).status,400);
    ok(await t.api('POST','/api/insurance/requests/'+id+'/accept',{},agent.token));
    assert.equal((await t.api('POST','/api/insurance/requests/'+id+'/accept',{},agent.token)).status,400);
    const offer={company:'Страховая А',product:'Грузовой транспорт',premiumKopecks:1200000,
      description:'Условия теста',coverage:'Гражданская ответственность'};
    assert.equal((await t.api('POST','/api/insurance/requests/'+id+'/offers',
      {offers:Array(21).fill(offer)},agent.token)).status,400);
    ok(await t.api('POST','/api/insurance/requests/'+id+'/offers',{
      offers:[offer,{...offer,company:'Страховая Б',premiumKopecks:1300000}]},agent.token));
    let d=ok(await t.api('GET','/api/insurance/requests/'+id,undefined,client.token));
    assert.equal(d.request.insurance_stage,'offers_sent');
    assert.equal(d.proposals.length,2);
    assert.equal(d.proposals[0].premium_kopecks,1200000);
    assert.equal((await t.api('POST','/api/insurance/requests/'+id+'/choose',{
      proposalId:d.proposals[0].id},other.token)).status,403);
    ok(await t.api('POST','/api/insurance/requests/'+id+'/choose',{proposalId:d.proposals[0].id},client.token));
    assert.equal((await t.api('POST','/api/insurance/requests/'+id+'/choose',
      {proposalId:d.proposals[1].id},client.token)).status,400);
    ok(await t.api('POST','/api/insurance/requests/'+id+'/accept',{},agent.token));
    ok(await t.api('POST','/api/insurance/requests/'+id+'/messages',{message:'Документы проверены'},agent.token));
    ok(await t.api('POST','/api/insurance/requests/'+id+'/messages',{message:'Спасибо'},client.token));
    assert.equal((await t.api('POST','/api/insurance/requests/'+id+'/messages',{
      message:'Перехват'},other.token)).status,403);
    const bytes=Buffer.from('%PDF-1.4\n'+'test pdf content '.repeat(10));
    const dataUrl='data:application/pdf;base64,'+bytes.toString('base64');
    assert.equal((await t.api('POST','/api/insurance/requests/'+id+'/policy',{
      dataUrl,fileName:'test.pdf',expiresOn:'2027-12-01'},client.token)).status,403);
    ok(await t.api('POST','/api/insurance/requests/'+id+'/policy',{
      dataUrl,fileName:'test.pdf',expiresOn:'2027-12-01'},agent.token));
    d=ok(await t.api('GET','/api/insurance/requests/'+id,undefined,client.token));
    assert.equal(d.request.insurance_stage,'policy_sent');
    assert.equal(d.request.status,'completed');
    assert.equal(d.hasPolicy,true);
    assert.ok(d.messages.some((m:any)=>m.kind==='policy'));
    const raw=await fetch(t.base+'/api/insurance/requests/'+id+'/policy',
      {headers:{authorization:'Bearer '+client.token}});
    assert.equal(raw.status,200);
    assert.match(raw.headers.get('content-type')||'',/application\/pdf/);
    assert.equal(Buffer.compare(Buffer.from(await raw.arrayBuffer()),bytes),0);
    const denied=await fetch(t.base+'/api/insurance/requests/'+id+'/policy',
      {headers:{authorization:'Bearer '+other.token}});
    assert.equal(denied.status,403);
    assert.equal((await t.api('POST','/api/insurance/requests/'+id+'/offers',
      {offers:[offer]},agent.token)).status,400);
  }finally{await t.close();}
});
