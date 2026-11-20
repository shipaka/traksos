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

test('closed professional club seed grants only matching specializations',async()=>{
 const writerRooms=ok(await t.api('GET','/api/community/rooms',undefined,writer.token)).rooms;
 assert.ok(writerRooms.some((x:any)=>x.slug==='electric-pro'));
 assert.ok(writerRooms.some((x:any)=>x.slug==='diag-pro'));
 assert.ok(!writerRooms.some((x:any)=>x.slug==='tow-pro'));
 assert.ok(!writerRooms.some((x:any)=>x.slug==='service-pro'));
 const driverRooms=ok(await t.api('GET','/api/community/rooms',undefined,outsider.token)).rooms;
 for(const slug of ['diag-pro','pneumatic-pro','engine-pro','autonomy-pro','tow-pro','service-pro']){
   assert.ok(!driverRooms.some((x:any)=>x.slug===slug),
     'drivers must not enumerate specialist-only club '+slug);
 }
 assert.ok(driverRooms.some((x:any)=>x.slug==='drivers-russia'));
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
 const hint=t.app.hub.log.find((e:any)=>e.userId===peer.id&&
   e.event.type==='community_technical_case'&&e.event.caseId===id);
 assert.ok(hint,'active verified club members get a live case hint');
 for(const secret of ['symptoms','body','phone','lat','lng','orderId','vin'])
   assert.equal(secret in hint.event,false);
 assert.ok(!t.app.hub.log.some((e:any)=>e.userId===outsider.id&&
   e.event.type==='community_technical_case'&&e.event.caseId===id));
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
 assert.equal(ok(await t.api('POST',endpoint+'/'+id+'/resolve',
   {replyId:sent.id},writer.token)).accepted_reply_id,sent.id);
 assert.equal((await t.api('POST',endpoint+'/'+id+'/resolve',
   {replyId:null},writer.token)).status,409,'author cannot silently change an accepted answer');
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

test('moderator hides unsafe advice, revokes accepted solution and audits restoration',async()=>{
 const endpoint='/api/community/pro-cases';
 const created=ok(await t.api('POST',endpoint,newCase(),writer.token));
 const id=created.case.id;
 const answer=ok(await t.api('POST',endpoint+'/'+id+'/replies',{
   clientNonce:randomUUID(),body:'Гипотетический технический ответ, который позже оказался небезопасным.'
 },peer.token));
 const reportUrl=endpoint+'/'+id+'/report';
 assert.equal((await t.api('POST',reportUrl,{replyId:answer.id,
   reason:'Данный совет может повредить тормозную систему'},outsider.token)).status,404);
 assert.equal((await t.api('POST',reportUrl,{
   replyId:'99999999',reason:'Ответ не существует в этом клубе'
 },writer.token)).status,404);
 assert.equal((await t.api('POST',reportUrl,{
   replyId:answer.id,reason:'Сам автор не вправе жаловаться на собственный совет'
 },peer.token)).status,400);
 assert.equal(ok(await t.api('POST',reportUrl,{
   replyId:answer.id,reason:'Опасная рекомендация по ремонту EBS'
 },writer.token)).reported,true);
 assert.equal(ok(await t.api('POST',reportUrl,{
   replyId:answer.id,reason:'Опасная рекомендация по ремонту EBS'
 },writer.token)).duplicate,true);
 // A different verified mechanic submits the second report that later
 // supports a separate restoration review. The staff account never enters the club.
 const third=await t.login('+79995671124','master');
 ok(await t.api('PUT','/api/performer/profile',{
   kind:'master',name:'Второй проверяющий',specialties:['electric'],
   taxStatus:'self_employed',inn:'780000001224'
 },third.token));
 ok(await t.api('POST','/api/admin/performers/'+third.id+'/verify',
   {decision:'approved'},admin.token));
 assert.equal(ok(await t.api('POST',reportUrl,{
   replyId:answer.id,reason:'Повторная независимая проверка опасного ответа'
 },third.token)).reported,true);
 assert.equal((await t.api('POST',reportUrl,{
   replyId:answer.id,reason:'Администратор не участвует в закрытом клубе'
 },admin.token)).status,404);
 ok(await t.api('POST',endpoint+'/'+id+'/resolve',{replyId:answer.id},writer.token));
 const moderation='/api/admin/community/pro-cases/reports';
 assert.equal((await t.api('GET',moderation,undefined,writer.token)).status,403);
 const reports=ok(await t.api('GET',moderation,undefined,admin.token)).reports;
 assert.ok(!reports.some((x:any)=>'reporter_id' in x ||'author_id' in x));
 const first=reports.find((x:any)=>x.case_id===id&&x.reply_id===answer.id);
 assert.ok(first);
 const reviewed=ok(await t.api('POST',moderation+'/'+first.id+'/review',{
   decision:'hide',note:'Проверено модератором: совет может быть опасен для тормозов'
 },admin.token));
 assert.equal(reviewed.reviewed,true);
 assert.equal((await t.api('POST',moderation+'/'+first.id+'/review',{
   decision:'dismiss',note:'Повторное решение на рассмотренную жалобу запрещено'
 },admin.token)).status,409);
 assert.equal(ok(await t.api('GET',endpoint+'/'+id+'/replies',undefined,writer.token))
   .replies.length,0,'hidden technical answer must disappear');
 assert.equal(ok(await t.api('GET',endpoint+'/'+id,undefined,writer.token))
   .accepted_reply_id,null,'accepted solution is revoked upon hiding');
 const remaining=ok(await t.api('GET',moderation,undefined,admin.token)).reports;
 const second=remaining.find((x:any)=>x.case_id===id&&x.reply_id===answer.id);
 assert.ok(second);
 ok(await t.api('POST',moderation+'/'+second.id+'/review',{
   decision:'restore',note:'Повторная ручная экспертиза подтверждает право вернуть совет в закрытый клуб'
 },admin.token));
 assert.equal(ok(await t.api('GET',endpoint+'/'+id+'/replies',undefined,writer.token))
   .replies.length,1,'restored answer is visible after review');
 assert.equal(ok(await t.api('GET',endpoint+'/'+id,undefined,writer.token))
   .accepted_reply_id,null,'restoration cannot silently reinstate a previously withdrawn solution');
 const audits=await t.db.query<{action:string}>(
   "select action from audit_log where action='community.technical_report_review'");
 assert.ok(audits.length>=2);
});

test('hiding a reported case removes it from discovery and resets linked knowledge approval',async()=>{
 const endpoint='/api/community/pro-cases';
 const created=ok(await t.api('POST',endpoint,newCase(),writer.token));
 const id=created.case.id;
 ok(await t.api('POST',endpoint+'/'+id+'/resolve',{replyId:null},writer.token));
 const draft=ok(await t.api('POST',endpoint+'/'+id+'/propose-knowledge',{
   title:'Условное решение для диагностической карты',
   authorNotes:'Мой технический анализ по официальному руководству, требует проверки на правомерность и применимость.',
   rightsConfirmation:true
 },writer.token));
 await t.db.query(
   "update community_knowledge set rights_review='approved',technical_review='approved' where id=$1",
   [draft.id]);
 ok(await t.api('POST',endpoint+'/'+id+'/report',{
   reason:'Проверить безопасность инструкций по тормозной системе'
 },peer.token));
 const reports=ok(await t.api('GET','/api/admin/community/pro-cases/reports',
   undefined,admin.token)).reports;
 const report=reports.find((x:any)=>x.case_id===id&&x.reply_id===null);
 assert.ok(report);
 ok(await t.api('POST','/api/admin/community/pro-cases/reports/'+report.id+'/review',{
   decision:'hide',note:'Техническая экспертиза выявила риск применения неподтверждённой схемы'
 },admin.token));
 assert.equal((await t.api('GET',endpoint+'/'+id,undefined,writer.token)).status,404);
 const list=ok(await t.api('GET',endpoint+'/rooms/'+roomId,undefined,writer.token));
 assert.ok(!list.cases.some((x:any)=>x.id===id));
 const checked=await t.db.one<{technical_review:string}>(
   'select technical_review from community_knowledge where id=$1',[draft.id]);
 assert.equal(checked?.technical_review,'pending',
   'an unsafe case cannot leave its derived TechBase material approved');
});
test('privacy export covers professional questions, and erasure removes accepted peer replies',async()=>{
 // Earlier cases belong to the same shared fixture: move their timestamps
 // outside the per-hour quota before exercising privacy deletion itself.
 await t.db.query("update community_technical_cases set created_at=now()-interval '2 hours' where author_id=$1",[writer.id]);
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
