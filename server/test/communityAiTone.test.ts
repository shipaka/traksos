import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {setup,ok,type T} from './helpers.ts';

let t:T, driver:any, owner:any, partner:any;

before(async()=>{
  t=await setup();
  driver=await t.login('+79995830001','driver');
  owner=await t.login('+79995830002','client');
  partner=await t.login('+79995830003','master');
});
after(()=>t.close());

test('AI tone belongs to each driver and persists across profile reloads',async()=>{
  const driverBefore=ok(await t.api('GET','/api/community/me',undefined,driver.token));
  assert.equal(driverBefore.ai_tone,'road');
  assert.equal(ok(await t.api('PUT','/api/community/me/ai-tone',{tone:'straight'},driver.token)).tone,'straight');
  assert.equal(ok(await t.api('GET','/api/community/me',undefined,driver.token)).ai_tone,'straight');
  assert.equal(ok(await t.api('PUT','/api/community/me/ai-tone',{tone:'humor'},driver.token)).tone,'humor');
  assert.equal(ok(await t.api('GET','/api/community/me',undefined,driver.token)).ai_tone,'humor');
  assert.equal((await t.api('PUT','/api/community/me/ai-tone',{tone:'unsafe'},driver.token)).status,400);
  assert.equal(ok(await t.api('GET','/api/community/me',undefined,driver.token)).ai_tone,'humor');
});

test('opted-in owner chooses separately; partner and non-participating owner cannot change settings',async()=>{
  assert.equal((await t.api('PUT','/api/community/me/ai-tone',{tone:'straight'},owner.token)).status,403);
  assert.equal((await t.api('PUT','/api/community/me/ai-tone',{tone:'road'},partner.token)).status,403);
  assert.equal((await t.api('PUT','/api/community/me/ai-tone',{tone:'road'})).status,401);
  ok(await t.api('PUT','/api/community/driver-access',{enabled:true},owner.token));
  assert.equal(ok(await t.api('GET','/api/community/me',undefined,owner.token)).ai_tone,'road');
  assert.equal(ok(await t.api('PUT','/api/community/me/ai-tone',{tone:'straight'},owner.token)).tone,'straight');
  assert.equal(ok(await t.api('GET','/api/community/me',undefined,driver.token)).ai_tone,'humor',
    'owner preference must never override driver preference');
  assert.equal(ok(await t.api('GET','/api/community/me',undefined,owner.token)).ai_tone,'straight');
  ok(await t.api('PUT','/api/community/driver-access',{enabled:false},owner.token));
  assert.equal((await t.api('PUT','/api/community/me/ai-tone',{tone:'humor'},owner.token)).status,403,
    'revoked community access forbids changes');
  ok(await t.api('PUT','/api/community/driver-access',{enabled:true},owner.token));
  assert.equal(ok(await t.api('GET','/api/community/me',undefined,owner.token)).ai_tone,'straight',
    'turning the community back on restores saved preference');
});
