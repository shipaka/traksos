import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { setup, ok } from './helpers.ts';

const image=()=> 'data:image/jpeg;base64,'+
  Buffer.concat([Buffer.from([0xff,0xd8,0xff]),randomBytes(11000)]).toString('base64');

test('document review cannot approve a superseded photo; verification follows latest photograph',
 {timeout:120000},async()=>{
  const t=await setup();
  try{
    await t.app.settings.set('verification',{requireDocs:true},null);
    const admin=await t.login('+79990000001');
    const master=await t.login('+79998892011','master');
    ok(await t.api('PUT','/api/performer/profile',
      {kind:'master',name:'Тестовый мастер',specialties:['electric']},master.token));
    const docs:Record<string,string>={};
    for(const kind of ['passport','selfie','car_front']){
      docs[kind]=ok(await t.api('POST','/api/performer/documents',
        {kind,dataUrl:image()},master.token)).id;
    }
    const submits=await Promise.all(Array.from({length:4},
      ()=>t.api('POST','/api/performer/documents/submit',{},master.token)));
    assert.ok(submits.every(x=>x.status===200),JSON.stringify(submits));
    assert.equal((await t.db.one<{n:number}>(`
       select count(*)::int as n from notifications
        where user_id=$1 and kind='verification_queue'`,[admin.id]))?.n,1,
      'one submit notification despite four network retries');
    const reviewed=await Promise.all(Array.from({length:5},
      ()=>t.api('POST',`/api/admin/documents/${docs.passport}`,
        {status:'approved'},admin.token)));
    assert.equal(reviewed.filter(x=>x.status===200).length,1);
    assert.ok(reviewed.filter(x=>x.status!==200)
      .every(x=>x.status===409&&x.body?.error==='document_outdated'));
    assert.equal((await t.db.one<{n:number}>(
      "select count(*)::int as n from audit_log where action='document.review' and target=$1",
      [docs.passport]))?.n,1);

    for(const kind of ['selfie','car_front']){
      ok(await t.api('POST',`/api/admin/documents/${docs[kind]}`,
        {status:'approved'},admin.token));
    }
    ok(await t.api('POST',`/api/admin/performers/${master.id}/verify`,
      {decision:'approved'},admin.token));
    const pre=await t.db.one<{verification:string}>(
      'select verification from performer_profiles where user_id=$1',[master.id]);
    assert.equal(pre?.verification,'approved');
    ok(await t.api('POST','/api/performer/line',{lineStatus:'online'},master.token));

    // Replacing an approved photo must not silently inherit its approved status.
    const newer=ok(await t.api('POST','/api/performer/documents',
      {kind:'car_front',dataUrl:image()},master.token));
    const mine=ok(await t.api('GET','/api/performer/documents',undefined,master.token));
    assert.equal(mine.required.find((d:any)=>d.kind==='car_front')?.doc?.id,newer.id);
    assert.equal(mine.required.find((d:any)=>d.kind==='car_front')?.doc?.status,'pending');
    assert.equal(mine.submittedAt,null);
    const premature=await t.api('POST',`/api/admin/performers/${master.id}/verify`,
      {decision:'approved'},admin.token);
    assert.equal(premature.status,409);
    assert.equal(premature.body.error,'docs_missing');

    // Old approved picture cannot be re-reviewed or authorize a newly
    // submitted replacement; the newest pending picture can be approved once.
    const old=await t.api('POST',`/api/admin/documents/${docs.car_front}`,
      {status:'approved'},admin.token);
    assert.equal(old.status,409);
    ok(await t.api('POST','/api/performer/documents/submit',{},master.token));
    const staffQueue=ok(await t.api('GET','/api/admin/verification',undefined,admin.token));
    const queued=staffQueue.find((p:any)=>p.id===master.id);
    assert.ok(queued,'new submission must reappear in verification queue');
    const currentPhotos=queued.docs.filter((d:any)=>d.kind==='car_front');
    assert.equal(currentPhotos.length,1,'staff must see only the newest car photo');
    assert.equal(currentPhotos[0].id,newer.id);
    ok(await t.api('POST',`/api/admin/documents/${newer.id}`,
      {status:'approved'},admin.token));
    ok(await t.api('POST',`/api/admin/performers/${master.id}/verify`,
      {decision:'approved'},admin.token));
    ok(await t.api('POST',`/api/admin/performers/${master.id}/verify`,
      {decision:'approved'},admin.token));
    const decisions=await t.db.one<{n:number}>(`
      select count(*)::int as n from audit_log
       where target=$1 and action='performer.verify' and data->>'decision'='approved'`,
      [master.id]);
    assert.equal(decisions?.n,2,'first approval + renewed approval, no redundant third audit');

    // Verification is voluntary: rejecting a new document must not silently
    // force a currently available master offline.
    const rejected=ok(await t.api('POST',`/api/admin/performers/${master.id}/verify`,
      {decision:'rejected',note:'Проверка фото отклонена'},admin.token));
    assert.equal(rejected.ok,true);
    const still=await t.db.one<{line_status:string}>(
      'select line_status from performer_profiles where user_id=$1',[master.id]);
    assert.equal(still?.line_status,'online');
    const erased=ok(await t.api('DELETE','/api/performer/documents/confidential',undefined,master.token));
    assert.equal(erased.ok,true);
    assert.equal((await t.db.one<{n:number}>(
      'select count(*)::int as n from documents where user_id=$1',[master.id]))?.n,0);
    assert.equal((await t.db.one<{line_status:string}>(
      'select line_status from performer_profiles where user_id=$1',[master.id]))?.line_status,
      'online','voluntary removal of verification photos does not remove work-line availability');
  }finally{await t.close();}
});

test('two simultaneous uploads of the same kind do not delete both photos',
 {timeout:90000},async()=>{
  const t=await setup();
  try{
    const user=await t.login('+79998892012','master');
    ok(await t.api('PUT','/api/performer/profile',
      {kind:'master',name:'Тестовый мастер',specialties:['electric']},user.token));
    const copies=await Promise.all(Array.from({length:4},
      ()=>t.api('POST','/api/performer/documents',
        {kind:'passport',dataUrl:image()},user.token)));
    assert.ok(copies.every(x=>x.status===200),JSON.stringify(copies));
    const stored=await t.db.query<{id:string;status:string}>(
      'select id,status from documents where user_id=$1 and kind=$2',
      [user.id,'passport']);
    assert.equal(stored.length,1,'one surviving current photo after concurrent replacements');
    assert.equal(stored[0].status,'pending');
    const mine=ok(await t.api('GET','/api/performer/documents',undefined,user.token));
    assert.equal(mine.required.find((r:any)=>r.kind==='passport')?.doc?.id,stored[0].id);
    const badPhoto=await t.api('POST','/api/performer/documents',
      {kind:'passport',dataUrl:'data:image/jpeg;base64,AAAA'},user.token);
    assert.equal(badPhoto.status,400);
    assert.equal((await t.db.one<{n:number}>(
      'select count(*)::int as n from documents where user_id=$1',[user.id]))?.n,1);
  }finally{await t.close();}
});


test('confidential file and verification decisions reject captured staff permissions after revocation',
 {timeout:90000},async()=>{
  const t=await setup();
  try{
    const admin=await t.login('+79990000001');
    const master=await t.login('+79998892013','master');
    const former=await t.login('+79998892014');
    await t.db.query("update users set roles=array['moderator']::text[] where id=$1",[former.id]);
    const actor=await t.app.auth.authenticate(former.token);
    const owner=await t.app.auth.authenticate(master.token);
    assert.ok(actor&&owner);
    ok(await t.api('PUT','/api/performer/profile',
      {kind:'master',name:'Тестовый мастер',specialties:['electric']},master.token));
    const doc=ok(await t.api('POST','/api/performer/documents',
      {kind:'passport',dataUrl:image()},master.token));
    const denied=(e:unknown)=>(e as {status?:number}).status===403;
    assert.equal((await t.app.documents.file(actor,doc.id)).mime,'image/jpeg');
    const views=async()=> (await t.db.one<{n:number}>(
      "select count(*)::int as n from audit_log where action='document.view' and target=$1",[doc.id]))?.n;
    assert.equal(await views(),1);
    await t.db.query("update users set roles=array['client']::text[] where id=$1",[former.id]);
    await assert.rejects(t.app.documents.file(actor,doc.id),denied);
    await assert.rejects(t.app.documents.review(actor,doc.id,{status:'approved'}),denied);
    await assert.rejects(t.app.documents.decide(actor,master.id,'approved'),denied);
    assert.equal(await views(),1,'denied private read must not create a successful access audit');
    assert.equal((await t.db.one<{status:string}>('select status from documents where id=$1',[doc.id]))?.status,'pending');
    assert.equal((await t.app.documents.file(owner,doc.id)).mime,'image/jpeg');
    await t.db.query("update users set roles=array['moderator']::text[],status='blocked' where id=$1",[former.id]);
    await assert.rejects(t.app.documents.file(actor,doc.id),denied);
    for(const kind of ['selfie','car_front']){
      ok(await t.api('POST','/api/performer/documents',{kind,dataUrl:image()},master.token));
    }
    ok(await t.api('POST','/api/performer/documents/submit',{},master.token));
    assert.equal((await t.db.one<{n:number}>(
      "select count(*)::int as n from notifications where user_id=$1 and kind='verification_queue'",[former.id]))?.n,0);
    assert.equal((await t.db.one<{n:number}>(
      "select count(*)::int as n from notifications where user_id=$1 and kind='verification_queue'",[admin.id]))?.n,1);
    await t.db.query("update users set status='active' where id=$1",[former.id]);
    assert.equal((await t.app.documents.file(actor,doc.id)).mime,'image/jpeg');
    assert.equal(await views(),2);
    await t.db.query("update users set status='blocked' where id=$1",[master.id]);
    await assert.rejects(t.app.documents.mine(owner),denied);
    await assert.rejects(t.app.documents.file(owner,doc.id),denied);
    await assert.rejects(t.app.documents.upload(owner,{kind:'passport',dataUrl:image()}),denied);
    await assert.rejects(t.app.documents.submit(owner),denied);
    await assert.rejects(t.app.documents.deleteConfidential(owner),denied);
    assert.equal((await t.db.one<{n:number}>(
      'select count(*)::int as n from documents where user_id=$1',[master.id]))?.n,3);
  }finally{await t.close();}
});
