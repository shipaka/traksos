import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './helpers.ts';
import {
  issueSandboxTicket, exchangeSandboxTicket, switchSandboxRole,
  SANDBOX_USER_PHONE,
} from '../src/services/sandboxTickets.ts';

const SECRET = 'signed-isolated-test-' + 'x'.repeat(48);
const deny = (error:any) => error?.status === 403;
async function seed(t:Awaited<ReturnType<typeof setup>>, role:'client'|'admin'|'courier') {
  const user=await t.db.one<{id:string}>(`insert into users(phone,name,roles)
    values($1,$2,$3::text[]) returning id`,
    [SANDBOX_USER_PHONE[role],'Вымышленный '+role,[role]]);
  assert.ok(user);
  return user.id;
}

test('isolated sandbox return path is pinned to admin test center; credentials, unsafe schemes and misleading URLs rejected',
  {timeout:60000}, async()=>{
  const t=await setup();
  try{
    const at=Date.now();
    await seed(t,'client');
    const good='https://traksos.example/#/admin/test-center';
    const ticket=issueSandboxTicket('client',SECRET,at,good);
    const data=await exchangeSandboxTicket(ticket,SECRET,t.db,at+100);
    assert.equal(data.returnUrl,good);
    for(const url of [
      'http://traksos.example/#/admin/test-center',
      'https://evil.example/#/phishing',
      'https://user:password@traksos.example/#/admin/test-center',
      'https://traksos.example/?token=secret#/admin/test-center',
      'https://traksos.example/#/admin/test-center?next=evil',
      'javascript:alert(1)',
      'https://traksos.example/\u0001#/admin/test-center',
      'https://traksos.example/#/admin/test-center'+'x'.repeat(600),
    ]){
      assert.throws(()=>issueSandboxTicket('client',SECRET,at,url),deny,
        'invalid return location cannot be embedded in signed handoff: '+JSON.stringify(url));
    }
    assert.throws(()=>issueSandboxTicket('client',SECRET,Number.NaN),deny);
    const expiring=issueSandboxTicket('client',SECRET,at);
    await assert.rejects(()=>exchangeSandboxTicket(expiring,SECRET,t.db,at+45_000),deny,
      'the exact expiry millisecond is already invalid');
    await assert.rejects(()=>exchangeSandboxTicket(expiring,SECRET,t.db,Number.NaN),deny);
  }finally{await t.close();}
});

test('12 simultaneous redemption attempts create exactly one sandbox session and one consumed nonce',
  {timeout:60000}, async()=>{
  const t=await setup();
  try{
    await seed(t,'client');
    const at=Date.now();
    const ticket=issueSandboxTicket('client',SECRET,at);
    const contenders=await Promise.allSettled(
      Array.from({length:12},()=>exchangeSandboxTicket(ticket,SECRET,t.db,at+100)));
    const accepted=contenders.filter(x=>x.status==='fulfilled');
    const denied=contenders.filter(x=>x.status==='rejected');
    assert.equal(accepted.length,1,'one-time capability is never redeemed twice');
    assert.equal(denied.length,11);
    assert.ok(denied.every(x=>x.status==='rejected' && deny(x.reason)));
    assert.equal((await t.db.one<{n:number}>(
      'select count(*)::int n from sandbox_ticket_uses'))?.n,1);
    assert.equal((await t.db.one<{n:number}>(
      'select count(*)::int n from sessions'))?.n,1);
    await assert.rejects(()=>exchangeSandboxTicket(ticket,SECRET,t.db,at+200),deny);
  }finally{await t.close();}
});

test('supervisor can switch only while active and target still has assigned role',
  {timeout:60000}, async()=>{
  const t=await setup();
  try{
    const adminId=await seed(t,'admin');
    const courierId=await seed(t,'courier');
    const at=Date.now();
    const supervisor=await exchangeSandboxTicket(
      issueSandboxTicket('admin',SECRET,at),SECRET,t.db,at+100);
    const courier=await switchSandboxRole(t.db,supervisor.token,'courier',at+200);
    assert.equal(courier.role,'courier');
    assert.equal(courier.landing,'#/courier');
    assert.equal((await t.db.one<{device:string}>(
      'select device from sessions where token_hash=$1',
      [(await import('../src/util.ts')).sha256(courier.token)]))?.device,'sandbox-role-switched');
    await assert.rejects(()=>switchSandboxRole(t.db,courier.token,'admin',at+300),deny,
      'role-switch token is never a supervisor');

    await t.db.query("update users set status='blocked' where id=$1",[courierId]);
    await assert.rejects(()=>switchSandboxRole(t.db,supervisor.token,'courier',at+400),deny);
    await t.db.query("update users set status='active',roles=$2::text[] where id=$1",
      [courierId,['client']]);
    await assert.rejects(()=>switchSandboxRole(t.db,supervisor.token,'courier',at+500),deny,
      'changing target role revokes ability to open that cabinet');
    await t.db.query("update users set status='blocked' where id=$1",[adminId]);
    await assert.rejects(()=>switchSandboxRole(t.db,supervisor.token,'admin',at+600),deny);
    await assert.rejects(()=>switchSandboxRole(t.db,supervisor.token,'admin',Number.NaN),deny);
  }finally{await t.close();}
});
