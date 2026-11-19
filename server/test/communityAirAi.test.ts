import {before,after,beforeEach,test} from 'node:test';
import assert from 'node:assert/strict';
import {setup,ok,type T} from './helpers.ts';

let t:T;
let driver:{id:string;token:string},owner:{id:string;token:string},other:{id:string;token:string};
let room:string;
let calls:{question:string;tone:string}[]=[];
before(async()=>{
 t=await setup({airAiResponder:async(question,tone)=>{
  calls.push({question,tone});
  return 'По данным вопроса сначала проверьте коды ошибок. Напишите о симптомах, не отправляйте личные данные.';
 }});
 driver=await t.login('+79995896001','driver');
 owner=await t.login('+79995896002','client');
 other=await t.login('+79995896003','master');
 const list=ok(await t.api('GET','/api/community/rooms',undefined,driver.token));
 room=list.rooms.find((r:any)=>r.slug==='drivers-russia').id;
 ok(await t.api('POST','/api/community/rooms/'+room+'/join',{},driver.token));
});
after(()=>t.close());
beforeEach(async()=>{
 // Community human-post spam quotas use DB wall-clock time, unlike the
 // injected AI clock. Preserve the limiter while preventing unrelated cases
 // within this multi-scenario integration test from exhausting it.
 if(t && driver) await t.db.query(
  "update community_messages set created_at=now()- interval '40 seconds' where sender_id=$1",
  [driver.id]);
});

const send=(text:string,token:string)=>t.api('POST','/api/community/rooms/'+room+'/messages',
 {text,clientNonce:crypto.randomUUID()},token);
const ask=(sourceMessageId:string,token:string,consent:any=true)=>
 t.api('POST','/api/community/rooms/'+room+'/ai/ask',{sourceMessageId,consent},token);

test('driver room AI: requires own published @mention, explicit consent and live membership',async()=>{
 assert.equal(ok(await t.api('GET','/api/community/ai/status',undefined,driver.token)).enabled,true);
 assert.equal((await t.api('PUT','/api/community/me',
  {nickname:'ТраксБот',shareCity:false},driver.token)).status,400,
  'a human must not impersonate the visibly marked AI bot');
 assert.equal((await t.api('PUT','/api/community/me',
  {nickname:'TraksBot',shareCity:false},driver.token)).status,400);

 assert.equal((await t.api('GET','/api/community/ai/status',undefined,other.token)).status,403);
 assert.equal((await t.api('POST','/api/community/rooms/'+room+'/ai/ask',{
  sourceMessageId:'1',consent:true
 },other.token)).status,403);
 const plain=ok(await send('Как живёт сцепление на Scania?',driver.token));
 assert.equal((await ask(plain.id,driver.token)).status,400);
 const input=ok(await send('@ТраксБот Подскажи, что проверить в первую очередь, если Scania не запускается?',driver.token));
 assert.equal((await ask(input.id,driver.token,false)).status,400,'consent is a strict server-side requirement');
 assert.equal((await ask(input.id,driver.token)).status,200);
 assert.equal(calls.length,1);
 assert.equal(calls[0].tone,'road','personal character defaults to Михалыч');
 assert.equal((await ask(input.id,driver.token)).body.status,'published');
 assert.equal(calls.length,1,'retries cannot bill the model a second time');
 const timeline=ok(await t.api('GET','/api/community/rooms/'+room+'/messages?recent=1',undefined,driver.token));
 const bot=timeline.messages.find((m:any)=>m.is_bot===true);
 assert.ok(bot,'AI answer appears in the same public message stream');
 assert.equal(bot.nickname,'ИИ · ТраксБот');
 assert.equal(bot.isMine,false);
 assert.equal(bot.public_city,null);
 const sourceRow=await t.db.one<any>('select * from community_messages where id=$1',[bot.id]);
 assert.equal(sourceRow.sender_id,null,'bot never impersonates a user');
 assert.equal(String(sourceRow.ai_source_message_id),input.id);
 const moderation=ok(await t.api('GET','/api/community/rooms/'+room+'/moderation-events?after=0',undefined,driver.token));
 assert.equal(moderation.changes.some((e:any)=>e.message?.is_bot===true),true,'late clients also receive bot replies');
 assert.equal((await ask(input.id,owner.token)).status,403,'owner has not opted into driver community');
 assert.equal((await ask(input.id,other.token)).status,403);
});

test('tone from caller profile; redaction of VIN, contact and GPS; unsafe EBS answer stays serious',async()=>{
 ok(await t.api('PUT','/api/community/me/ai-tone',{tone:'straight'},driver.token));
 const msg=ok(await send('@ТраксБот Что делать, если диагностика не видит электронный блок WMA06XZZXHW123456, координаты 59.857321, 30.347812?',driver.token));
 ok(await ask(msg.id,driver.token));
 assert.equal(calls.at(-1)?.tone,'straight');
 assert.ok(!calls.at(-1)?.question.includes('WMA06XZZXHW123456'),'VIN must not reach provider');
 assert.ok(!calls.at(-1)?.question.includes('59.857321'),'GPS must not reach provider');
 t.clock.advance(61);
 const before=calls.length;
 const brakes=ok(await send('@ТраксБот Горит EBS, тормоза пропадают, можно ехать дальше?',driver.token));
 ok(await ask(brakes.id,driver.token));
 assert.equal(calls.length,before,'dangerous scenarios bypass the model');
 const result=ok(await t.api('GET','/api/community/rooms/'+room+'/messages?recent=1',undefined,driver.token));
 const recentId=await t.db.one<{response_message_id:string}>(
  'select response_message_id from community_ai_requests where source_message_id=$1',[brakes.id]);
 const emergency=result.messages.find((m:any)=>String(m.id)===String(recentId?.response_message_id));
 assert.ok(emergency);
 assert.match(emergency.body,/остановитесь|не продолжайте/i);
 assert.doesNotMatch(emergency.body,/ха-ха|шут|прикол/i);
});

test('same question delete cascades AI response and request; quota prevents floods',async()=>{
 t.clock.advance(61);
 const a=ok(await send('@ТраксБот Первый тестовый вопрос по датчику ABS?',driver.token));
 ok(await ask(a.id,driver.token));
 const b=ok(await send('@ТраксБот Второй тестовый вопрос по датчику скорости?',driver.token));
 ok(await ask(b.id,driver.token));
 const c=ok(await send('@ТраксБот Третий тестовый вопрос про диагностический сканер?',driver.token));
 assert.equal((await ask(c.id,driver.token)).status,429,'2 messages per minute per user');
 const response=await t.db.one<{response_message_id:string}>(
  'select response_message_id from community_ai_requests where source_message_id=$1',[a.id]);
 assert.ok(response?.response_message_id);
 await t.db.query('delete from community_messages where id=$1',[a.id]);
 assert.equal((await t.db.query('select id from community_ai_requests where source_message_id=$1',[a.id])).length,0);
 assert.equal((await t.db.query('select id from community_messages where id=$1',[response!.response_message_id])).length,0);
});

test('revoke membership: non-member cannot ask AI about already posted public text',async()=>{
 const m=ok(await send('@ТраксБот Почему бывает плохой контакт массы?',driver.token));
 ok(await t.api('POST','/api/community/rooms/'+room+'/leave',{},driver.token));
 assert.equal((await ask(m.id,driver.token)).status,403);
 ok(await t.api('POST','/api/community/rooms/'+room+'/join',{},driver.token));
});
