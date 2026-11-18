import test from 'node:test';
import assert from 'node:assert/strict';
import { setup, ok } from './helpers.ts';
import { AuthService, passwordValid } from '../src/services/auth.ts';
import { SmsRu, SmsRejectedError, type SmsProvider } from '../src/providers/sms.ts';
import { hmac } from '../src/util.ts';

test('passphrases stay memorable while obvious weak passwords are rejected',()=>{
  for(const p of ['1234567890','0000000000','aaaaaaaaaa','qwertyuiop','Пароль12345','password123']){
    assert.equal(passwordValid(p),false,p);
  }
  for(const p of ['Большой грузовик едет домой', 'Дорога длинная, свет горит', 'Nice long truck passphrase 2026', 'a1b2c3d4e5f6g7h8']){
    assert.equal(passwordValid(p),true,p);
  }
  assert.equal(passwordValid('short'),false);
  assert.equal(passwordValid('Z'.repeat(129)),false);
});

test('SMS.ru calls the customer, validates response, and keeps API ID out of error text', async () => {
  const original=globalThis.fetch;
  let requests=0;
  try {
    globalThis.fetch=async (req:any, options:any)=>{
      requests++;
      assert.equal(String(req),'https://sms.ru/code/call');
      const params=new URLSearchParams(options.body);
      assert.equal(params.get('phone'),'79991234567');
      assert.equal(params.get('ip'),'198.51.100.71');
      assert.equal(params.get('api_id'),'fake-secret-for-unit-test');
      return new Response(JSON.stringify({status:'OK',code:'0049',call_id:'synthetic'}),{status:200});
    };
    assert.equal(await new SmsRu('fake-secret-for-unit-test').verificationCall('+79991234567','198.51.100.71'),'0049');
    assert.equal(requests,1);
    globalThis.fetch=async()=>new Response(JSON.stringify({status:'ERROR',status_text:'fake-secret-for-unit-test'}),{status:200});
    await assert.rejects(
      () => new SmsRu('fake-secret-for-unit-test').verificationCall('+79991234567','-1'),
      (e:any) => e instanceof SmsRejectedError && !e.message.includes('fake-secret-for-unit-test'),
    );
    globalThis.fetch=async()=>new Response(JSON.stringify({status:'OK',code:'001X'}),{status:200});
    await assert.rejects(
      () => new SmsRu('fake-secret-for-unit-test').verificationCall('+79991234567','-1'),
      /Не удалось подтвердить/,
    );
  } finally {globalThis.fetch=original;}
});

test('Flash Call OTP is hashed, never disclosed, one-use and limited to registration/reset',async()=>{
  const t=await setup();
  try{
    const calls:{phone:string;ip:string}[]=[];
    const mock:SmsProvider={
      name:'synthetic-inbound-call',exposesCode:true,
      send:async()=>{throw Error('Flash Call must not send SMS')},
      verificationCall:async(phone,ip)=>{calls.push({phone,ip});return '0097';},
    };
    const auth=new AuthService(t.db,mock,t.clock.now,undefined,'call');
    const phone='+79996221177';
    const started=await auth.requestCode(phone,'198.51.100.18','register','owner');
    assert.equal(started.channel,'call');
    assert.equal(started.sent,true);
    assert.ok(!('devCode' in started) || started.devCode === undefined);
    assert.deepEqual(calls,[{phone,ip:'198.51.100.18'}]);
    const saved=await t.db.one<any>('select code_hash,attempts,purpose from auth_codes where phone=$1',[phone]);
    assert.equal(saved.code_hash,hmac(phone+':0097'));
    assert.equal(saved.purpose,'register');
    assert.equal(saved.attempts,0);
    assert.ok(!JSON.stringify(started).includes('0097'));

    const first=ok(await t.api('POST','/api/auth/verify',{
      phone,code:'0097',accountType:'owner',password:'A memorable long passphrase 2026'
    }));
    assert.deepEqual(first.user.roles,['client']);
    const replay=await t.api('POST','/api/auth/verify',{
      phone,code:'0097',accountType:'owner',password:'A memorable long passphrase 2026'
    });
    assert.equal(replay.status,400);
    assert.equal(replay.body.error,'code_expired');

    t.clock.advance(61);
    const pending=await auth.requestCode(phone,'198.51.100.18','reset');
    assert.equal(pending.channel,'call');
    const [a,b]=await Promise.all([t.api('POST','/api/auth/verify',{
      phone,code:'0097',purpose:'reset',password:'Longer passphrase after recovery 2026'
    }),t.api('POST','/api/auth/verify',{
      phone,code:'0097',purpose:'reset',password:'Longer passphrase after recovery 2026'
    })]);
    assert.deepEqual([a.status,b.status].sort(),[200,400],
      'two concurrent requests cannot consume one phone code twice');
    assert.equal((await t.api('GET','/api/me',undefined,first.token)).status,401,
      'password recovery revokes old bearer sessions');
    const signed=ok(await t.api('POST','/api/auth/login',{
      phone,password:'Longer passphrase after recovery 2026'
    }));
    assert.equal(signed.user.id,first.user.id);
    assert.equal(calls.length,2,'login must not trigger phone verification');
  } finally{await t.close();}
});

test('five parallel wrong codes consume durable attempt budget; valid code is locked out',async()=>{
  const t=await setup();
  try{
    const phone='+79996221178';
    const mock:SmsProvider={
      name:'synthetic-inbound-call',exposesCode:false,
      send:async()=>{throw Error('Do not send SMS')},
      verificationCall:async()=> '8642',
    };
    const auth=new AuthService(t.db,mock,t.clock.now,undefined,'call');
    await auth.requestCode(phone,'198.51.100.19');
    const checks=await Promise.all(Array.from({length:12},(_,i)=>
      t.api('POST','/api/auth/verify',{phone,code:String(1000+i),accountType:'owner'})));
    assert.equal(checks.filter(x=>x.status===400&&x.body.error==='wrong_code').length,5);
    assert.equal(checks.filter(x=>x.status===429&&x.body.error==='too_many_attempts').length,7);
    const record=await t.db.one<any>('select attempts from auth_codes where phone=$1',[phone]);
    assert.equal(record.attempts,5);
    const correct=await t.api('POST','/api/auth/verify',{phone,code:'8642',accountType:'owner'});
    assert.equal(correct.status,429);
    assert.equal(correct.body.error,'too_many_attempts');
  }finally{await t.close();}
});
