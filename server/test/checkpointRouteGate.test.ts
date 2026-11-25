import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Router } from '../src/http/router.ts';
import { checkpointApiEnabled, registerCheckpointRoutes } from '../src/http/checkpointRoutes.ts';
import type { CheckpointEvidenceService } from '../src/services/checkpointEvidence.ts';
import type { CheckpointIntegrityService } from '../src/services/checkpointIntegrity.ts';

test('checkpoint routes require both validated sandbox isolation and explicit opt-in',()=>{
  const cases = [[false,false],[false,true],[true,false],[true,true]] as const;
  for(const [sandbox,optIn] of cases){
    const router=new Router();
    const service={} as CheckpointEvidenceService;
    const integrity={} as CheckpointIntegrityService;
    const enabled=sandbox&&optIn;
    assert.equal(checkpointApiEnabled(sandbox,optIn),enabled);
    assert.equal(registerCheckpointRoutes(router,service,integrity,sandbox,optIn),enabled);
    for(const [method,path] of [
      ['GET','/api/orders/test/checkpoint'],
      ['PUT','/api/orders/test/checkpoint-plan'],
      ['POST','/api/orders/test/checkpoint/gps-consent'],
      ['POST','/api/orders/test/checkpoint/arrival'],
      ['GET','/api/me/checkpoint-privacy'],
      ['GET','/api/admin/checkpoint-gps/retention'],
      ['POST','/api/admin/checkpoint-gps/retention'],
      ['GET','/api/admin/checkpoint-gps/integrity'],
      ['POST','/api/admin/checkpoint-gps/integrity/validate'],
      ['GET','/api/admin/checkpoint-attempts/test/gps'],
    ])assert.equal(!!router.match(method,path),enabled,method+' '+path);
  }
});

test('checkpoint route contract preserves ACL and rejects malformed permission requests before service calls',async()=>{
  const router=new Router();
  let grants=0;
  const service={gpsConsent:async()=>{grants++;return {active:true}}} as unknown as CheckpointEvidenceService;
  registerCheckpointRoutes(router,service,{} as CheckpointIntegrityService,true,true);
  const grant=router.match('POST','/api/orders/order/checkpoint/gps-consent')!;
  assert.deepEqual(grant.route.auth,['master','tow','service']);
  const raw=router.match('GET','/api/admin/checkpoint-attempts/attempt/gps')!;
  assert.deepEqual(raw.route.auth,['admin']);
  assert.deepEqual(router.match('POST','/api/admin/checkpoint-gps/retention')!.route.auth,['admin']);
  assert.equal(router.match('GET','/api/me/checkpoint-privacy')!.route.auth,true);
  const input={eventKey:'synthetic-grant-001',planId:'00000000-0000-4000-8000-000000000001',action:'granted',durationMinutes:60};
  const ctx={params:grant.params,body:input,user:{id:'synthetic',roles:['master']}};
  for(const body of [{...input,durationMinutes:181},{...input,planId:'invalid'},{...input,unknownField:true}]){
    await assert.rejects(async()=>grant.route.handler({...ctx,body}),(error:any)=>error.status===400);
  }
  assert.equal(grants,0);
  assert.deepEqual(await grant.route.handler(ctx),{active:true});
  assert.equal(grants,1);
});
