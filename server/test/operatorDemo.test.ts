import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, type T } from './helpers.ts';
import { demoPinHash } from '../src/services/operatorDemo.ts';

test('operator demo: single-use access stays outside real authentication',async()=>{
  const t:T=await setup();
  try{
    const pin='9271048356';
    await t.db.query(
      `insert into operator_demo_grant(id,pin_hash,expires_at)
       values (1,$1,now()+interval '4 hours')`,[demoPinHash(pin)],
    );
    assert.equal((await t.api('POST','/api/public/demo/unlock',{code:'1111111111'})).status,401);
    const success=await t.api('POST','/api/public/demo/unlock',{code:pin});
    assert.equal(success.status,200);
    assert.ok(success.body.token && success.body.expiresAt);
    assert.equal((await t.api('POST','/api/public/demo/unlock',{code:pin})).status,401,
      'a redeemed code must never be reusable');
    assert.equal((await t.api('POST','/api/public/demo/check',{token:success.body.token})).status,200);
    assert.equal((await t.api('GET','/api/me',undefined,success.body.token)).status,401,
      'demo token cannot authenticate as a user');
    assert.equal((await t.db.one<{n:number}>('select count(*)::int as n from users'))?.n,0);
    assert.equal((await t.db.one<{n:number}>('select count(*)::int as n from sessions'))?.n,0);
    await t.db.query("update operator_demo_session set expires_at=now()-interval '1 second'");
    assert.equal((await t.api('POST','/api/public/demo/check',{token:success.body.token})).status,401);
  }finally{await t.close();}
});

test('operator demo: eight guesses lock code and expired grants fail closed',async()=>{
  const t:T=await setup();
  try{
    const pin='8930154672';
    await t.db.query(
      `insert into operator_demo_grant(id,pin_hash,expires_at)
       values(1,$1,now()+interval '4 hours')`,[demoPinHash(pin)],
    );
    for(let n=0;n<8;n++)
      assert.equal((await t.api('POST','/api/public/demo/unlock',{code:'0000000000'})).status,401);
    assert.equal((await t.api('POST','/api/public/demo/unlock',{code:pin})).status,401,
      'correct code must fail after reaching rate limit');
    await t.db.query('update operator_demo_grant set attempts=0,expires_at=now()-interval \'1 second\'');
    assert.equal((await t.api('POST','/api/public/demo/unlock',{code:pin})).status,401);
    assert.equal((await t.api('POST','/api/public/demo/check',{token:'not-a-demo-token'})).status,401);
  }finally{await t.close();}
});
