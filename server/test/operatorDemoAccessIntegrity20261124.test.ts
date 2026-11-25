// MEGA-BATCH-CHAT-TRAKBOT-MAP-DEMO-20261124: isolated, no-production demo access.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, ok } from './helpers.ts';
import { demoPinHash } from '../src/services/operatorDemo.ts';

async function provision(t: Awaited<ReturnType<typeof setup>>, pin: string) {
  // Fixture clock matches PostgreSQL time; the project's default fake clock
  // starts in Dec 2026 and intentionally differs from the test DB's now().
  t.clock.set(new Date().toISOString());
  await t.db.query(`
    insert into operator_demo_grant(id,pin_hash,expires_at,attempts,redeemed_at)
    values (1,$1,now()+interval '1 hour',0,null)
    on conflict(id) do update set pin_hash=excluded.pin_hash,expires_at=excluded.expires_at,
      attempts=0,redeemed_at=null`,[demoPinHash(pin)]);
}

test('Operator demo: exactly one redemption survives 12 simultaneous attempts; token grants no user role',async()=>{
  const t=await setup();
  try{
    const pin='2345678910';
    await provision(t,pin);
    const parallel=await Promise.all(Array.from({length:12},()=>
      t.api('POST','/api/public/demo/unlock',{code:pin})));
    const successes=parallel.filter(x=>x.status===200);
    assert.equal(successes.length,1,'single-use code cannot create parallel sessions');
    assert.ok(parallel.every(x=>x.status===200||x.status===401));
    const token=successes[0].body.token as string;
    assert.match(token,/^[A-Za-z0-9_-]{43}$/);
    assert.equal(ok(await t.api('POST','/api/public/demo/check',{token})).ok,true);
    assert.equal((await t.api('GET','/api/me',undefined,token)).status,401,
      'operator demo token must never authenticate a normal user account');
    assert.equal((await t.api('POST','/api/public/demo/unlock',{code:pin})).status,401,
      'redeeming the same code again must fail');
    const sessions=await t.db.one<{n:number}>(
      'select count(*)::int as n from operator_demo_session');
    assert.equal(sessions?.n,1);
  }finally{await t.close();}
});

test('Operator demo: eighth wrong PIN exhausts the grant; token is never emitted',async()=>{
  const t=await setup();
  try{
    await provision(t,'1234567890');
    for(let i=0;i<8;i++){
      const r=await t.api('POST','/api/public/demo/unlock',
        {code:String(1000000000+i)});
      assert.equal(r.status,401);
      assert.ok(!r.body?.token);
    }
    const actual=await t.api('POST','/api/public/demo/unlock',{code:'1234567890'});
    assert.equal(actual.status,401,'correct code after 8 failures must not bypass lockout');
    const grant=await t.db.one<{attempts:number;redeemed_at:string|null}>(
      'select attempts,redeemed_at from operator_demo_grant where id=1');
    assert.equal(grant?.attempts,8);
    assert.equal(grant?.redeemed_at,null);
    assert.equal((await t.db.one<{n:number}>(
      'select count(*)::int as n from operator_demo_session'))?.n,0);
  }finally{await t.close();}
});

test('Operator demo: expired, invalid or explicitly revoked tokens fail closed',async()=>{
  const t=await setup();
  try{
    await provision(t,'9876543210');
    const token=ok(await t.api('POST','/api/public/demo/unlock',
      {code:'9876543210'})).token as string;
    assert.equal((await t.api('POST','/api/public/demo/check',{token:'bad-token'})).status,401);
    assert.equal((await t.api('POST','/api/public/demo/check',
      {token:'A'.repeat(43)})).status,401);
    assert.equal(ok(await t.api('POST','/api/public/demo/check',{token})).ok,true);
    // Explicit server-side revocation (same invariant used when SSH renews PIN).
    await t.db.query('delete from operator_demo_session');
    assert.equal((await t.api('POST','/api/public/demo/check',{token})).status,401);
    await provision(t,'1122334455');
    const newer=ok(await t.api('POST','/api/public/demo/unlock',
      {code:'1122334455'})).token as string;
    await t.db.query(`update operator_demo_session
      set expires_at=now()-interval '1 second' where token_hash is not null`);
    assert.equal((await t.api('POST','/api/public/demo/check',{token:newer})).status,401,
      'DB expiry must invalidate a token without relying on a UI timer');
  }finally{await t.close();}
});
