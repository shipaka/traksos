import test from 'node:test';
import assert from 'node:assert/strict';
import {setup,ok} from './helpers.ts';

async function account(t:Awaited<ReturnType<typeof setup>>,phone:string,password='Memorable truck route 2026'){
  const response=ok(await t.api('POST','/api/auth/code',{phone,purpose:'register'}));
  return ok(await t.api('POST','/api/auth/verify',{
    phone,code:response.devCode,accountType:'owner',password
  }));
}

test('authenticated password change needs previous password, keeps current session, revokes other devices',async()=>{
  const t=await setup();
  try{
    const phone='+79999172341',oldPass='Memorable truck route 2026';
    const user=await account(t,phone,oldPass);
    const second=ok(await t.api('POST','/api/auth/login',{phone,password:oldPass}));
    const smsBefore=t.sms.sent.length;
    assert.equal((await t.api('POST','/api/auth/change-password',{
      currentPassword:oldPass,newPassword:'A different strong phrase 2026'
    })).status,401,'anonymous change must fail');
    assert.equal((await t.api('POST','/api/auth/change-password',{
      currentPassword:'wrong',newPassword:'A different strong phrase 2026'
    },user.token)).body.error,'bad_current_password');
    assert.equal((await t.api('POST','/api/auth/change-password',{
      currentPassword:oldPass,newPassword:oldPass
    },user.token)).body.error,'same_password');
    assert.equal((await t.api('POST','/api/auth/change-password',{
      currentPassword:oldPass,newPassword:'1234567890'
    },user.token)).body.error,'weak_password');

    const result=ok(await t.api('POST','/api/auth/change-password',{
      currentPassword:oldPass,newPassword:'A different strong phrase 2026'
    },user.token));
    assert.deepEqual(result,{ok:true,otherSessionsRevoked:true});
    assert.equal(t.sms.sent.length,smsBefore,'password rotation must not send SMS or call');
    assert.equal((await t.api('GET','/api/me',undefined,user.token)).status,200);
    assert.equal((await t.api('GET','/api/me',undefined,second.token)).status,401);
    assert.equal((await t.api('POST','/api/auth/login',{phone,password:oldPass})).status,401);
    assert.equal((await t.api('POST','/api/auth/login',{
      phone,password:'A different strong phrase 2026'
    })).status,200);
    const dbUser=await t.db.one<any>('select password_hash from users where id=$1',[user.user.id]);
    assert.match(dbUser.password_hash,/^scrypt:/);
    assert.ok(!dbUser.password_hash.includes('A different strong phrase'));
  }finally{await t.close();}
});

test('ten wrong in-session old-password attempts block further guesses across sessions',async()=>{
  const t=await setup();
  try{
    const phone='+79999172342',oldPass='Memorable truck route 2026';
    const user=await account(t,phone,oldPass);
    const calls=await Promise.all(Array.from({length:12},()=>t.api('POST','/api/auth/change-password',{
      currentPassword:'wrong',newPassword:'A different strong phrase 2026'
    },user.token)));
    assert.equal(calls.filter(x=>x.status===403&&x.body.error==='bad_current_password').length,10);
    assert.equal(calls.filter(x=>x.status===429&&x.body.error==='too_many_attempts').length,2);
    const attempt=await t.db.one<any>(
      "select attempts from auth_login_attempts where scope='phone' and identity=$1",[phone]);
    assert.equal(attempt.attempts,10);
    assert.equal((await t.api('POST','/api/auth/change-password',{
      currentPassword:oldPass,newPassword:'A different strong phrase 2026'
    },user.token)).status,429,'correct current password cannot bypass lockout');
    // Existing session remains valid; a throttled change does not sign the user out.
    assert.equal((await t.api('GET','/api/me',undefined,user.token)).status,200);
  }finally{await t.close();}
});

test('concurrent password rotations of one account cannot both succeed using stale credentials',async()=>{
  const t=await setup();
  try{
    const phone='+79999172343',oldPass='Memorable truck route 2026';
    const first=await account(t,phone,oldPass);
    const second=ok(await t.api('POST','/api/auth/login',{phone,password:oldPass}));
    const results=await Promise.all([
      t.api('POST','/api/auth/change-password',{
        currentPassword:oldPass,newPassword:'First updated password 2026'
      },first.token),
      t.api('POST','/api/auth/change-password',{
        currentPassword:oldPass,newPassword:'Second updated password 2026'
      },second.token),
    ]);
    assert.equal(results.filter(x=>x.status===200).length,1);
    assert.equal(results.filter(x=>x.status===403||x.status===401).length,1);
    const allowed=await t.db.query<any>('select token_hash from sessions where user_id=$1',[first.user.id]);
    assert.equal(allowed.length,1,'only the victorious session survives rotation');
  }finally{await t.close();}
});
