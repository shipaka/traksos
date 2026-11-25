// MEGA-BATCH-CHAT-TRAKBOT-MAP-DEMO-20261124: real API/Postgres safeguards.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, ok } from './helpers.ts';
const phone=(n:number)=>'+7999777'+String(n).padStart(4,'0');

test('TrakBot: parallel answer requests obey same per-user 10/minute limit in PostgreSQL',async()=>{
  const t=await setup();
  try{
    const u=await t.login(phone(4401),'client');
    const texts=Array.from({length:14},(_,i)=>'Привет, это вопрос '+i);
    const results=await Promise.all(texts.map(message=>
      t.api('POST','/api/trakbot/answer',{message,allowAiProcessing:false},u.token)));
    const success=results.filter(r=>r.status===200);
    const limited=results.filter(r=>r.body?.error==='trakbot_rate_limit');
    assert.equal(success.length,10,'exactly 10 concurrent messages may be committed');
    assert.equal(limited.length,4,'concurrent requests must not bypass configured limit');
    const count=await t.db.one<{users:number;bots:number}>(`
      select count(*) filter(where role='user')::int as users,
             count(*) filter(where role='bot')::int as bots
        from trakbot_messages where user_id=$1`,[u.id]);
    assert.equal(count?.users,10);
    assert.equal(count?.bots,10,'each accepted request persists both halves exactly once');
    assert.ok(success.every(r=>r.body.chargeAllowed===false&&r.body.freePilot===true));
  }finally{await t.close();}
});

test('TrakBot: reply, history and deletion are private; no AI is required or charged',async()=>{
  const t=await setup();
  try{
    const a=await t.login(phone(4402),'client');
    const b=await t.login(phone(4403),'client');
    ok(await t.api('POST','/api/trakbot/answer',
      {message:'Привет, подскажи про номер +7 999 123-45-67',allowAiProcessing:false},a.token));
    ok(await t.api('POST','/api/trakbot/answer',
      {message:'Привет от второго аккаунта',allowAiProcessing:false},b.token));
    const first=ok(await t.api('GET','/api/trakbot/messages',undefined,a.token)).messages;
    const second=ok(await t.api('GET','/api/trakbot/messages',undefined,b.token)).messages;
    assert.equal(first.length,2);
    assert.equal(second.length,2);
    assert.ok(first.every((r:any)=>!r.body.includes('123-45-67')),
      'private phone numbers must not be saved in chat');
    assert.ok(second.every((r:any)=>!r.body.includes('подскажи про номер')));
    ok(await t.api('DELETE','/api/trakbot/messages',undefined,a.token));
    assert.equal(ok(await t.api('GET','/api/trakbot/messages',undefined,a.token)).messages.length,0);
    assert.equal(ok(await t.api('GET','/api/trakbot/messages',undefined,b.token)).messages.length,2);
  }finally{await t.close();}
});

test('TrakBot: legacy approved repair notes scrub numbers/VINs before reaching another technician',async()=>{
  const t=await setup();
  try{
    const admin=await t.login('+79990000001');
    const legacyPhone='+7 999 123-45-67';
    const legacyVin='WDB12345678901234';
    await t.db.query(`
      insert into technical_repair_cases
        (author_id,make,model,production_year,ecu,code,symptoms,checks_performed,verified_fix,review_state)
      values ($1,'Scania','R',2018,'EMS','P0087',$2,$3,$4,'approved')`,
      [admin.id,'Ошибка у владельца '+legacyPhone,
        'Сверяли VIN '+legacyVin,'Проверяли давление, номер '+legacyPhone]);
    const reply=ok(await t.api('POST','/api/trakbot/answer',{
      message:'Что означает P0087?',allowAiProcessing:false,
      vehicle:{make:'Scania',model:'R',year:2018,ecu:'EMS'},
    },admin.token));
    assert.ok(reply.message.body.includes('проверенных кейсов коллег'));
    assert.ok(!reply.message.body.includes(legacyPhone),'raw owner phone must not leak');
    assert.ok(!reply.message.body.includes(legacyVin),'raw VIN must not leak');
    assert.ok(reply.message.body.includes('[номер скрыт]'));
    assert.ok(reply.message.body.includes('[VIN скрыт]'));
    assert.equal(reply.aiUsed,false);
    assert.equal(reply.chargeAllowed,false);
  }finally{await t.close();}
});

test('TrakBot expert lookup treats wildcard punctuation literally and restricts access',async()=>{
  const t=await setup();
  try{
    const admin=await t.login('+79990000001');
    const client=await t.login(phone(4404),'client');
    const lookup=async(q:string,token:string)=>
      t.api('GET','/api/tech/codes?q='+encodeURIComponent(q),undefined,token);
    const normal=ok(await lookup('P0087',admin.token));
    assert.ok(normal.items.some((x:any)=>x.code==='P0087'));
    assert.deepEqual(ok(await lookup('%%',admin.token)).items,[],
      'LIKE wildcard must not enumerate protected technical dictionary');
    assert.deepEqual(ok(await lookup('P0%',admin.token)).items,[],
      'partial code search must not treat % as a wildcard');
    assert.deepEqual(ok(await lookup('__',admin.token)).items,[],
      'underscore is a literal character, not arbitrary two-character match');
    assert.equal((await lookup('P0087',client.token)).status,403);
  }finally{await t.close();}
});
