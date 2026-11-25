import test from 'node:test';
import assert from 'node:assert/strict';
const phone = '+79990000652';
process.env.INSURER_PRIMARY_PHONE = phone;
const {setup,ok} = await import('./helpers.ts');

test('primary insurer invitation requires admin, is single-use and rotates before issuing a session',async()=>{
  const t=await setup();
  try {
    const admin=await t.login('+79990000001');
    const client=await t.login('+79990000941');
    const path='/api/admin/users/primary-insurer-invite';
    const body={phone,reason:'Личность проверена лично'};
    assert.equal((await t.api('POST',path,body)).status,401);
    assert.equal((await t.api('POST',path,body,client.token)).status,403);
    assert.equal((await t.api('POST',path,{...body,phone:'+79990000942'},admin.token)).status,403);
    const sms=t.sms.sent.length;
    const first=ok(await t.api('POST',path,body,admin.token));
    assert.deepEqual(first.user.roles,['insurer']);
    const invite=ok(await t.api('POST',path,body,admin.token));
    assert.notEqual(first.temporaryPassword,invite.temporaryPassword);
    const login='/api/auth/login';
    assert.equal((await t.api('POST',login,{phone,password:first.temporaryPassword})).status,401);
    const pending=await t.api('POST',login,{phone,password:invite.temporaryPassword});
    assert.equal(pending.body.error,'insurer_password_change_required');
    assert.equal(pending.body.token,undefined);
    assert.equal((await t.db.query('select * from sessions where user_id=$1',[invite.user.id])).length,0);
    assert.equal((await t.api('POST',login,{phone,password:invite.temporaryPassword,newPassword:invite.temporaryPassword})).body.error,'same_password');
    assert.equal((await t.api('POST',login,{phone,password:invite.temporaryPassword,newPassword:'1234567890'})).body.error,'weak_password');
    const next='Private long insurance password 2026';
    const results=await Promise.all([t.api('POST',login,{phone,password:invite.temporaryPassword,newPassword:next}),t.api('POST',login,{phone,password:invite.temporaryPassword,newPassword:'Another private password 2026'})]);
    assert.equal(results.filter(x=>x.status===200).length,1);
    assert.equal((await t.api('POST',login,{phone,password:invite.temporaryPassword})).status,401);
    assert.equal((await t.api('POST',path,body,admin.token)).status,409);
    const row=await t.db.one<any>('select password_hash from users where id=$1',[invite.user.id]);
    assert.match(row.password_hash,/^scrypt:/);
    assert.equal(t.sms.sent.length,sms);
    const audit=await t.db.query<any>('select data from audit_log where target=$1',[invite.user.id]);
    assert.ok(!JSON.stringify(audit).includes(invite.temporaryPassword));
  }finally{await t.close();}
});

test('expired invitation cannot issue a session and can be reissued by admin',async()=>{
  const t=await setup();
  try{
    const admin=await t.login('+79990000001');
    const path='/api/admin/users/primary-insurer-invite';
    const body={phone,reason:'Личность проверена лично'};
    const invite=ok(await t.api('POST',path,body,admin.token));
    t.clock.advance(86401);
    assert.equal((await t.api('POST','/api/auth/login',{phone,password:invite.temporaryPassword,newPassword:'Private password phrase 2026'})).status,401);
    assert.equal((await t.db.query('select * from sessions where user_id=$1',[invite.user.id])).length,0);
    const renewed=ok(await t.api('POST',path,body,admin.token));
    assert.equal(renewed.user.id,invite.user.id);
    assert.notEqual(renewed.temporaryPassword,invite.temporaryPassword);
  }finally{await t.close();}
});
