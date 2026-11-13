import assert from 'node:assert/strict';
import test from 'node:test';
import { AuthService } from '../src/services/auth.ts';
import { SmsRejectedError, SmsRu, type SmsProvider } from '../src/providers/sms.ts';
import type { Db } from '../src/db/index.ts';

function dbFixture() {
  let pending: { phone: string; hash: string; at: Date } | null = null;
  let deleted = 0;
  const db = {
    one: async (sql: string) => {
      if (sql.includes('from users')) return null;
      throw Error('Unexpected db.one: '+sql);
    },
    query: async (sql: string, params: unknown[]) => {
      if (sql.startsWith('delete from auth_codes')) {
        if (pending && pending.phone === params[0] && pending.hash === params[1]) {
          pending = null;
          deleted++;
        }
        return [];
      }
      throw Error('Unexpected db.query: '+sql);
    },
    tx: async (fn: (q: unknown) => unknown) => fn({
      query: async (sql: string, params: unknown[]) => {
        if (sql.includes('pg_advisory_xact_lock')) return [];
        if (sql.startsWith('insert into auth_codes')) {
          pending = {phone:String(params[0]),hash:String(params[1]),at:params[3] as Date};
          return [];
        }
        throw Error('Unexpected tx.query: '+sql);
      },
      one: async (sql: string) => {
        if (sql.includes('from auth_codes')) return pending && {sent_at:pending.at};
        if (sql.includes('auth_sms_limits')) return {used:1};
        throw Error('Unexpected tx.one: '+sql);
      }
    }),
  } as unknown as Db;
  return {db,hasPending:()=>pending!==null,deleted:()=>deleted};
}
test('Explicit SMS.ru refusal removes only the pending code and allows immediate retry', async () => {
  const fake = dbFixture();
  let calls = 0;
  const sms: SmsProvider = {
    name:'smsru', exposesCode:false,
    send:async()=> {calls++;throw new SmsRejectedError('provider refused');}
  };
  const auth = new AuthService(fake.db,sms);
  for (let i=0;i<2;i++) {
    await assert.rejects(auth.requestCode('+79990000555'),(e: any) => e.status===502 && e.code==='sms_rejected');
    assert.equal(fake.hasPending(),false);
  }
  assert.equal(calls,2);
  assert.equal(fake.deleted(),2);
});
test('Unknown SMS delivery error retains cooldown, preventing duplicate sends', async () => {
  const fake = dbFixture();
  let calls=0;
  const sms: SmsProvider = {
    name:'smsru', exposesCode:false,
    send:async()=> {calls++;throw new Error('connection lost');}
  };
  const auth = new AuthService(fake.db,sms);
  await assert.rejects(auth.requestCode('+79990000556'),/connection lost/);
  assert.equal(fake.hasPending(),true);
  await assert.rejects(auth.requestCode('+79990000556'),(e: any)=>e.status===429 && e.code==='too_often');
  assert.equal(calls,1);
});
test('SMS.ru response refusals are distinct from ambiguous connection failures',async()=>{
  const previous=globalThis.fetch;
  try {
    globalThis.fetch=async()=>new Response(JSON.stringify({status:'OK',sms:{'79990000557':{status:'ERROR',status_text:'Refused'}}}),{status:200});
    await assert.rejects(new SmsRu('ci-test-secret').send('+79990000557','test'),SmsRejectedError);
    globalThis.fetch=async()=>new Response('not json',{status:200});
    await assert.rejects(new SmsRu('ci-test-secret').send('+79990000557','test'),(e: any)=>!(e instanceof SmsRejectedError));
    globalThis.fetch=async()=>{throw new Error('connection lost');};
    await assert.rejects(new SmsRu('ci-test-secret').send('+79990000557','test'),(e: any)=>!(e instanceof SmsRejectedError));
  } finally {globalThis.fetch=previous;}
});
