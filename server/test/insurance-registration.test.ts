import assert from 'node:assert/strict';
import test from 'node:test';
import {
  insuranceRegistrationError,
  insuranceRegistrationMessage,
} from '../src/domain/insuranceRegistration.ts';

const primary = '+79990000652';
const someoneElse = '+79990000888';

test('reserved insurance phone is denied every other account category, including no choice', () => {
  for (const choice of [undefined,'owner','driver','master','tow','service','master_service'] as const) {
    assert.equal(insuranceRegistrationError(primary,choice,primary,false),'insurer_only');
    assert.equal(insuranceRegistrationError(primary,choice,primary,true),'insurer_only');
  }
  assert.match(insuranceRegistrationMessage('insurer_only'),/страхов/);
});
test('initial insurer can register while open registration is disabled', () => {
  assert.equal(insuranceRegistrationError(primary,'insurer',primary,false),null);
});
test('other insurer registration is admin-controlled, closed by default', () => {
  assert.equal(insuranceRegistrationError(someoneElse,'insurer',primary,false),'insurer_registration_closed');
  assert.equal(insuranceRegistrationError(someoneElse,'insurer',primary,true),null);
  assert.equal(insuranceRegistrationError(someoneElse,'master',primary,false),null);
});
test('without a configured primary insurance number, insurer signup fails closed', () => {
  assert.equal(insuranceRegistrationError(someoneElse,'insurer','',false),'insurer_number_missing');
  assert.equal(insuranceRegistrationError(someoneElse,'insurer','',true),'insurer_number_missing');
});

// Run in a dedicated Node test worker. Config is loaded after setting a synthetic
// primary number; never touches real phones or production.
process.env.INSURER_PRIMARY_PHONE = primary;
const { AuthService } = await import('../src/services/auth.ts');
const providerCalls: string[] = [];
const codes = new Map<string,{ sent_at: Date }>();
const db: any = {
  one: async (sql: string) => {
    if (sql.includes('from users')) return null;
    if (sql.includes('from auth_codes')) throw Error('Verification reached SMS store unexpectedly');
    throw Error('Unexpected DB query: '+sql);
  },
  tx: async (fn: any) => fn({
    one: async (sql: string, args: unknown[]) => {
      if (sql.includes('from auth_codes')) return codes.get(String(args[0])) ?? null;
      if (sql.includes('auth_sms_limits')) return {used:1};
      throw Error('Unexpected tx query: '+sql);
    },
    query: async (sql: string, args: unknown[]) => {
      if (sql.startsWith('insert into auth_codes')) codes.set(String(args[0]),{sent_at:new Date(args[3] as string)});
      return [];
    }
  }),
};
let open = false;
const settings: any = {get: async (key: string) => {
  assert.equal(key,'insurancePartners');
  return {registrationOpen:open};
}};
const auth = new AuthService(db,{
  name:'log',exposesCode:true,send:async (phone: string)=>{providerCalls.push(phone);}
},()=>new Date(),settings);

test('insurance-only rejection happens BEFORE sending SMS or consuming a code',async()=>{
  await assert.rejects(auth.requestCode(primary,'','register','owner'),(err:any)=>err.code==='insurer_only'&&err.status===403);
  await assert.rejects(auth.verify(primary,'1234','master',undefined,'master','demo-password-123','register'),
    (err:any)=>err.code==='insurer_only'&&err.status===403);
  assert.equal(providerCalls.length,0);
});
test('only primary insurer receives registration SMS while registration is closed',async()=>{
  await assert.rejects(auth.requestCode(someoneElse,'','register','insurer'),(err:any)=>err.code==='insurer_registration_closed');
  await auth.requestCode(primary,'','register','insurer');
  assert.deepEqual(providerCalls,[primary]);
  open=true;
  await auth.requestCode(someoneElse,'','register','insurer');
  assert.deepEqual(providerCalls,[primary,someoneElse]);
});
