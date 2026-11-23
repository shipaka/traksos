// PR #274: real HTTP/Postgres race protection for SMS registration and reset.
// The disposable CI DB is created by setup(). No live SMS provider is contacted.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, ok, type T } from './helpers.ts';

let t:T;
before(async()=>{ t=await setup(); });
after(async()=>{ await t?.close(); });

const correctPhone=(n:string)=>'+7999666'+n;
async function code(phone:string,purpose:'register'|'reset'='register',accountType?:string) {
  const c=ok(await t.api('POST','/api/auth/code',{phone,purpose, ...(accountType?{accountType}:{})}));
  assert.equal(c.sent,true);
  assert.match(c.devCode,/^\d{4,6}$/);
  return c.devCode as string;
}
const register=(phone:string,codeValue:string,password='NeverReuseCode123')=>
  t.api('POST','/api/auth/verify',{phone,code:codeValue,password,purpose:'register',accountType:'owner'});
const sessionRows=async(userId:string)=>t.db.query<{token_hash:string}>(
  'select token_hash from sessions where user_id=$1',[userId]);

test('one-time SMS: 12 parallel successful redemption attempts create exactly one session',async()=>{
  const phone=correctPhone('0011');
  const once=await code(phone);
  const results=await Promise.all(Array.from({length:12},()=>register(phone,once)));
  const accepted=results.filter(r=>r.status===200);
  assert.equal(accepted.length,1,'the same SMS must never authorize more than one session');
  assert.equal(results.filter(r=>r.status!==200).length,11);
  assert.ok(results.filter(r=>r.status!==200).every(r=>
    r.body.error==='code_expired' || r.body.error==='too_many_attempts'));
  const u=await t.db.one<{id:string}>('select id from users where phone=$1',[phone]);
  assert.ok(u?.id);
  assert.equal((await sessionRows(u.id)).length,1);
  assert.equal((await t.db.query('select phone from auth_codes where phone=$1',[phone])).length,0);
});

test('invalid role combination does not consume verified SMS or register any account',async()=>{
  const phone=correctPhone('0012');
  const once=await code(phone);
  const forged=await t.api('POST','/api/auth/verify',{
    phone,code:once,password:'NeverReuseCode123',accountType:'owner',role:'tow',purpose:'register',
  });
  assert.equal(forged.status,400);
  assert.equal(forged.body.error,'invalid_role');
  assert.equal((await t.db.query('select id from users where phone=$1',[phone])).length,0);
  assert.equal((await t.db.query('select phone from auth_codes where phone=$1',[phone])).length,1);
  const success=ok(await register(phone,once));
  assert.equal(success.user.phone,phone);
});

test('simultaneous wrong guesses consume at most five attempts; even the correct code is then locked',async()=>{
  const phone=correctPhone('0013');
  const once=await code(phone);
  const wrong=once==='0000'?'1111':'0000';
  const results=await Promise.all(Array.from({length:14},()=>register(phone,wrong)));
  assert.ok(results.every(r=>r.status===400 || r.status===429));
  const row=await t.db.one<{attempts:number}>('select attempts from auth_codes where phone=$1',[phone]);
  assert.equal(row?.attempts,5,'attempt counter must not bypass its cap under parallel HTTP requests');
  const locked=await register(phone,once);
  assert.equal(locked.status,429);
  assert.equal(locked.body.error,'too_many_attempts');
  assert.equal((await t.db.query('select id from users where phone=$1',[phone])).length,0);
});

test('database failure after valid code rolls back account, code and session atomically',async()=>{
  const phone=correctPhone('0014');
  const once=await code(phone);
  await t.db.exec(`
    CREATE FUNCTION auth_test_fail_insert() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.phone = '+79996660014' THEN
        RAISE EXCEPTION 'synthetic registration storage fault';
      END IF;
      RETURN NEW;
    END $$;
    CREATE TRIGGER auth_test_fail_insert BEFORE INSERT ON users
      FOR EACH ROW EXECUTE FUNCTION auth_test_fail_insert();
  `);
  try {
    const failed=await register(phone,once);
    assert.equal(failed.status,500,'the synthetic storage error must fail');
    assert.equal((await t.db.query('select id from users where phone=$1',[phone])).length,0);
    assert.equal((await t.db.query('select phone from auth_codes where phone=$1',[phone])).length,1,
      'code must remain redeemable when account creation cannot commit');
  } finally {
    await t.db.exec('DROP TRIGGER IF EXISTS auth_test_fail_insert ON users; DROP FUNCTION IF EXISTS auth_test_fail_insert();');
  }
  const retried=ok(await register(phone,once));
  assert.ok(retried.token);
  assert.equal((await sessionRows(retried.user.id)).length,1);
});

test('failed session INSERT rolls back the already-created account and preserves the exact SMS',async()=>{
  const phone=correctPhone('0017');
  const once=await code(phone);
  await t.db.exec(`
    CREATE FUNCTION auth_test_fail_session() RETURNS trigger LANGUAGE plpgsql AS $
    BEGIN
      IF (SELECT phone FROM users WHERE id=NEW.user_id) = '+79996660017' THEN
        RAISE EXCEPTION 'synthetic session insertion fault';
      END IF;
      RETURN NEW;
    END $;
    CREATE TRIGGER auth_test_fail_session BEFORE INSERT ON sessions
      FOR EACH ROW EXECUTE FUNCTION auth_test_fail_session();
  `);
  try {
    const failed=await register(phone,once);
    assert.equal(failed.status,500);
    assert.equal((await t.db.query('select id from users where phone=$1',[phone])).length,0,
      'account must not survive a failed session creation');
    assert.equal((await t.db.query('select code_hash from auth_codes where phone=$1',[phone])).length,1,
      'SMS must remain usable when server cannot create a session');
  }finally{
    await t.db.exec('DROP TRIGGER IF EXISTS auth_test_fail_session ON sessions; DROP FUNCTION IF EXISTS auth_test_fail_session();');
  }
  const retried=ok(await register(phone,once));
  assert.equal((await sessionRows(retried.user.id)).length,1);
});

test('SMS password reset revokes all previous sessions and push registration with new token atomically',async()=>{
  const phone=correctPhone('0015');
  const first=ok(await register(phone,await code(phone),'FirstPassword123'));
  const login=ok(await t.api('POST','/api/auth/login',{phone,password:'FirstPassword123'}));
  assert.notEqual(first.token,login.token);
  assert.equal((await sessionRows(first.user.id)).length,2);
  // Session-linked push token from a formerly logged-in device.
  await t.db.query('insert into push_tokens(user_id,provider,token) values ($1,$2,$3)',[
    first.user.id,'rustore','test-device-token-atomic-reset']);
  const reset=ok(await t.api('POST','/api/auth/verify',{
    phone,code:await code(phone,'reset'),password:'SecondPassword123',purpose:'reset',
  }));
  assert.equal(reset.user.id,first.user.id);
  assert.equal((await sessionRows(first.user.id)).length,1);
  assert.equal((await t.db.query('select id from push_tokens where user_id=$1',[first.user.id])).length,0);
  assert.equal((await t.api('GET','/api/me',undefined,first.token)).status,401);
  assert.equal((await t.api('GET','/api/me',undefined,login.token)).status,401);
  assert.equal((await t.api('GET','/api/me',undefined,reset.token)).status,200);
  assert.equal((await t.api('POST','/api/auth/login',{phone,password:'FirstPassword123'})).status,401);
  assert.equal((await t.api('POST','/api/auth/login',{phone,password:'SecondPassword123'})).status,200);
});

test('blocked account SMS proof cannot rewrite password/roles or issue a new session',async()=>{
  const phone=correctPhone('0016');
  const registered=ok(await register(phone,await code(phone),'BlockedPassword123'));
  const old=await t.db.one<{password_hash:string;roles:string[]}>(
    'select password_hash,roles from users where id=$1',[registered.user.id]);
  await t.db.query("update users set status='blocked' where id=$1",[registered.user.id]);
  const rejected=await t.api('POST','/api/auth/verify',{
    phone,code:await code(phone,'reset'),password:'TakeoverPassword123',purpose:'reset',
  });
  assert.equal(rejected.status,403);
  assert.equal(rejected.body.error,'blocked');
  assert.ok(rejected.body.data?.appealToken);
  const current=await t.db.one<{password_hash:string;roles:string[]}>(
    'select password_hash,roles from users where id=$1',[registered.user.id]);
  assert.deepEqual(current,old,'blocked identity must remain unchanged');
  assert.equal((await sessionRows(registered.user.id)).length,1);
  assert.equal((await t.db.query('select phone from auth_codes where phone=$1',[phone])).length,0);
});

test('corrupted non-hex stored password is treated as bad credentials, not a 500 or new session',async()=>{
  const phone=correctPhone('0018');
  const registered=ok(await register(phone,await code(phone),'AValidPassword123'));
  await t.db.query('update users set password_hash=$2 where id=$1',[
    registered.user.id,'scrypt:'+'f'.repeat(32)+':'+'z'.repeat(128),
  ]);
  const before=(await sessionRows(registered.user.id)).length;
  const response=await t.api('POST','/api/auth/login',{phone,password:'AValidPassword123'});
  assert.equal(response.status,401);
  assert.equal(response.body.error,'bad_credentials');
  assert.equal((await sessionRows(registered.user.id)).length,before);
});
