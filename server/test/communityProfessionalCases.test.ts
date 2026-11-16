import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {setup,ok,type T} from './helpers.ts';

let t:T,admin:any,writer:any,peer:any,outsider:any,client:any,roomId:string;
before(async()=>{
 t=await setup();
 admin=await t.login('+79990000001');
 client=await t.login('+79995671100','client');
 writer=await t.login('+79995671101','master');
 peer=await t.login('+79995671102','master');
 outsider=await t.login('+79995671103','driver');
 for(const [i,u] of [writer,peer].entries()){
   ok(await t.api('PUT','/api/performer/profile',{
    kind:'master',name:'Исполнитель клуба '+i,
    specialties:['electric','diag'],taxStatus:'self_employed',inn:'7800000012'+String(i).padStart(2,'0')
   },u.token));
   ok(await t.api('POST','/api/admin/performers/'+u.id+'/verify',{decision:'approved'},admin.token));
 }
 const rooms=ok(await t.api('GET','/api/community/rooms',undefined,writer.token));
 roomId=rooms.rooms.find((x:any)=>x.slug==='electric-pro').id;
 ok(await t.api('POST','/api/community/rooms/'+roomId+'/join',{},writer.token));
 ok(await t.api('POST','/api/community/rooms/'+roomId+'/join',{},peer.token));
});
after(()=>t.close());

const symptoms='В EBS появляется ошибка при прогреве двигателя, теряется связь с блоком и загорается индикатор неисправности.';
const newCase=(extra:Record<string,unknown>={})=>({
 roomId,clientNonce:randomUUID(),make:'Renault',model:'Premium',
 modelYear:2010,subsystem:'EBS',symptoms,dtcCodes:['P0401'],
 diagnosticContext:'Проверили напряжение и соединение массы, причина не установлена.',...extra
});

test('structured case visibility, search and idempotency',async()=>{
 const api='/api/community/pro-cases';
 assert.equal((await t.api('GET',api+'/rooms/'+roomId,undefined,client.token)).status,404);
 assert.equal((await t.api('GET',api+'/rooms/'+roomId,undefined,outsider.token)).status,404);
 assert.equal((await t.api('POST',api,newCase(),client.token)).status,404);
 const draft=newCase();
 const made=ok(await t.api('POST',api,draft,writer.token));
 assert.equal(made.created,true);
 assert.equal(made.case.status,'open');
 assert.equal(made.case.model_year,2010);
 assert.deepEqual(made.case.dtc_codes,['P0401']);
 for(const k of ['author_id','client_nonce','phone','orderId','vin','plate','address','lat','lng'])
   assert.equal(k in made.case,false,'private field: '+k);
 const replay=ok(await t.api('POST',api,draft,writer.token));
 assert.equal(replay.created,false);
 assert.equal(replay.case.id,made.case.id);
 assert.equal((await t.api('POST',api,{...draft,symptoms:symptoms+' снова'},writer.token)).status,409);
 const found=ok(await t.api('GET',api+'/rooms/'+roomId+'?q=P0401',undefined,peer.token));
 assert.ok(found.cases.some((x:any)=>x.id===made.case.id));
 assert.equal((await t.api('GET',api+'/'+made.case.id,undefined,outsider.token)).status,404);
 assert.equal((await t.api('GET',api+'/rooms/'+roomId+'?page=99999',undefined,writer.token)).status,400);
});

test('reject phone/VIN/precise coordinates/license plates and external links',async()=>{
 const endpoint='/api/community/pro-cases';
 for(const extra of [
   {symptoms:symptoms+' Телефон +7 (921) 111-22-33'},
   {symptoms:symptoms+' VIN VF611A1X000000001'},
   {symptoms:symptoms+' GPS 59.123456,30.123456'},
   {symptoms:symptoms+' госномер А123ВС78'},
   {diagnosticContext:'Данные https://example.org/private'}
 ]){
   const result=await t.api('POST',endpoint,newCase(extra),writer.token);
   assert.equal(result.status,400,'reject sensitive context '+JSON.stringify(extra));
 }
});

test('work order preview exposes only assigned vehicle make, model and year',async()=>{
 const vehicle=await t.db.one<{id:string}>(
   "insert into vehicles(owner_id,brand,model,year,plate) values ($1,'Renault','Premium',2010,'А444АА78') returning id",
   [client.id]);
 const order=await t.db.one<{id:string}>(
   "insert into orders(client_id,created_by,vehicle_id,service,status,performer_id,address,lat,lng,description) "+
   "values($1,$1,$2,'electric','accepted',$3,'Private customer address',59.9,30.3,'Private customer details') returning id",
   [client.id,vehicle!.id,writer.id]);
 const url='/api/community/pro-cases/order-preview/'+order!.id;
 const preview=ok(await t.api('GET',url,undefined,writer.token));
 assert.equal(preview.make,'Renault');
 assert.equal(preview.model,'Premium');
 assert.equal(preview.modelYear,2010);
 for(const secret of ['address','orderId','phone','lat','lng','vin','plate'])
   assert.equal(secret in preview,false);
 assert.equal((await t.api('GET',url,undefined,peer.token)).status,404);
 assert.equal((await t.api('GET',url,undefined,client.token)).status,403);
 const posted=ok(await t.api('POST','/api/community/pro-cases',
   newCase({orderId:order!.id,make:null,model:null}),writer.token));
 assert.equal(posted.case.origin,'order_preview');
 assert.equal(posted.case.make,'Renault');
 assert.equal('order_id' in posted.case,false);
 await t.db.query("update orders set status='completed' where id=$1",[order!.id]);
 assert.equal((await t.api('GET',url,undefined,writer.token)).status,404);
});

test('colleague reply, chosen solution and author-only double-review proposal',async()=>{
 const endpoint='/api/community/pro-cases';
 const made=ok(await t.api('POST',endpoint,newCase(),writer.token));
 const id=made.case.id;
 const reply={clientNonce:randomUUID(),body:'Проверьте питание EBS, разъёмы, массу и диагностику по заводской схеме без догадок о распиновке.'};
 const replyUrl=endpoint+'/'+id+'/replies';
 const sent=ok(await t.api('POST',replyUrl,reply,peer.token));
 assert.equal(sent.created,true);
 assert.equal(ok(await t.api('POST',replyUrl,reply,peer.token)).id,sent.id);
 assert.equal((await t.api('POST',replyUrl,reply,outsider.token)).status,404);
 const messages=ok(await t.api('GET',replyUrl,undefined,writer.token));
 assert.equal(messages.replies.length,1);
 assert.equal('author_id' in messages.replies[0],false);
 assert.equal((await t.api('POST',endpoint+'/'+id+'/resolve',{replyId:sent.id},peer.token)).status,403);
 const solution=ok(await t.api('POST',endpoint+'/'+id+'/resolve',{replyId:sent.id},writer.token));
 assert.equal(solution.status,'resolved');
 assert.equal(solution.accepted_reply_id,sent.id);
 assert.equal((await t.api('POST',replyUrl,{clientNonce:randomUUID(),
   body:'Нельзя добавить ответ после закрытия вопроса'},peer.token)).status,409);
 assert.equal(ok(await t.api('POST',replyUrl,reply,peer.token)).id,sent.id);
 const propose=endpoint+'/'+id+'/propose-knowledge';
 const draft={
   title:'Проверка EBS Renault Premium по симптомам',
   authorNotes:'Собственная методика проверки питания и ошибок по официальной документации без заимствования советов коллег.',
   rightsConfirmation:true
 };
 assert.equal((await t.api('POST',propose,draft,peer.token)).status,403);
 const saved=ok(await t.api('POST',propose,draft,writer.token));
 assert.equal(saved.created,true);
 assert.equal(ok(await t.api('POST',propose,draft,writer.token)).id,saved.id);
 const row=await t.db.one<{description:string;rights_review:string;technical_review:string}>(
   'select description,rights_review,technical_review from community_knowledge where id=$1',[saved.id]);
 assert.equal(row?.rights_review,'pending');
 assert.equal(row?.technical_review,'pending');
 assert.ok(row?.description.includes(draft.authorNotes));
 assert.ok(!row?.description.includes(reply.body),'never copy a colleague answer without permission');
 assert.equal((await t.api('GET','/api/community/knowledge/'+saved.id,
   undefined,writer.token)).status,404);
});

test('privacy export covers professional questions, and erasure removes accepted peer replies',async()=>{
 const own=ok(await t.api('POST','/api/community/pro-cases',newCase(),writer.token));
 const written=ok(await t.api('POST','/api/community/pro-cases/'+own.case.id+'/replies',{
   clientNonce:randomUUID(),body:'Авторская диагностическая гипотеза без VIN, контактов или сторонних источников.'
 },peer.token));
 ok(await t.api('POST','/api/community/pro-cases/'+own.case.id+'/resolve',
   {replyId:written.id},writer.token));
 const peerIdentity={id:peer.id,phone:'+79995671102',roles:['master'],status:'active',
   name:null,owner_id:null};
 const before=await t.app.privacy.export(peerIdentity);
 assert.ok(before.professionalTechnicalReplies.some((m:any)=>m.body.includes('Авторская диагностическая')));
 await t.app.privacy.requestDelete(peerIdentity);
 t.clock.advance(31*86400);
 assert.equal(await t.app.privacy.processDeletions(),1);
 const linked=await t.db.one<{accepted_reply_id:string|null}>(
   'select accepted_reply_id from community_technical_cases where id=$1',[own.case.id]);
 assert.equal(linked?.accepted_reply_id,null,
   'accepted peer reply is unlinked, not kept as retained personal information');
 assert.equal((await t.db.query(
   'select 1 from community_technical_case_replies where author_id=$1',[peer.id])).length,0);
 const writerIdentity={id:writer.id,phone:'+79995671101',roles:['master'],status:'active',
   name:null,owner_id:null};
 const authorArchive=await t.app.privacy.export(writerIdentity);
 assert.ok(authorArchive.professionalTechnicalCases.some((x:any)=>x.symptoms===symptoms));
 await t.app.privacy.requestDelete(writerIdentity);
 t.clock.advance(31*86400);
 assert.equal(await t.app.privacy.processDeletions(),1);
 assert.equal((await t.db.query('select 1 from community_technical_cases where author_id=$1',
   [writer.id])).length,0);
});
