import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateCheckpoint, sampledSnapshot,
  type CheckpointPlan, type ObservedPosition,
} from '../src/services/checkpointEvidenceCore.ts';
import { CheckpointEvidenceService } from '../src/services/checkpointEvidence.ts';
import { setup, ok } from './helpers.ts';

const now = new Date('2026-12-01T10:00:00Z');
const gate: CheckpointPlan = {
  orderId: 'order', performerId: 'worker',
  lat: 59.9343, lng: 30.3351, radiusM: 200,
  passState: 'not_required', clientApprovedAt: '2026-12-01T09:45:00Z',
};
function gps(secondsAgo: number, extras: Partial<ObservedPosition> = {}): ObservedPosition {
  return {
    lat: gate.lat, lng: gate.lng,
    receivedAt: new Date(now.getTime() - secondsAgo * 1000).toISOString(),
    source: 'gps', accuracyM: 12, accepted: true,
    ...extras,
  };
}
const reasons = (points: ObservedPosition[], current = gate, manual = false) =>
  evaluateCheckpoint(current, points, now, manual).reasons;

test('two recent independent accurate fixes produce a non-billable candidate', () => {
  const result = evaluateCheckpoint(gate, [gps(45), gps(12)], now);
  assert.equal(result.outcome, 'candidate');
  assert.equal(result.qualifiedNearSamples, 2);
  assert.equal(result.startBilling, false);
  assert.deepEqual(result.reasons, []);
});

test('one fix, stale fix, predicted fix or unsupported legacy GPS stays under review', () => {
  assert.ok(reasons([gps(12)]).includes('insufficient_independent_samples'));
  assert.ok(reasons([gps(360),gps(300)]).includes('stale_last_position'));
  assert.ok(reasons([gps(45,{source:'predicted'}),gps(12,{source:'predicted'})])
    .includes('no_recent_samples'));
  assert.ok(reasons([gps(45,{source:'unknown',accuracyM:null}),
    gps(12,{source:'unknown',accuracyM:null})]).includes('untrusted_position_source'));
});

test('gate radius, accuracy, spoof flag, high speed and pass state block auto candidate', () => {
  assert.ok(reasons([gps(45,{lat:gate.lat+0.003}),gps(12,{lat:gate.lat+0.003})])
    .includes('outside_checkpoint'));
  assert.ok(reasons([gps(45,{accuracyM:180}),gps(12,{accuracyM:180})])
    .includes('accuracy_too_low'));
  assert.ok(reasons([gps(45,{lat:gate.lat+0.01}),gps(43),gps(12)])
    .includes('implausible_jump'));
  assert.ok(reasons([gps(45,{mockLocation:true}),gps(12)])
    .includes('mock_location_flagged'));
  assert.ok(reasons([gps(45),gps(12)],{...gate,passState:'pending'})
    .includes('pass_not_cleared'));
  assert.ok(reasons([gps(45),gps(12)],gate,true)
    .includes('manual_review_requested'));
});

test('phone clock does not change server observation time', () => {
  const result=evaluateCheckpoint(gate,[
    gps(45,{deviceAt:'2001-01-01T00:00:00Z'}),
    gps(12,{deviceAt:'2038-01-01T00:00:00Z'}),
  ],now);
  assert.equal(result.outcome,'candidate');
  assert.equal(result.startBilling,false);
});

test('invalid geography and excessive snapshots fail closed', () => {
  assert.throws(()=>evaluateCheckpoint({...gate,lat:100},[],now));
  assert.throws(()=>evaluateCheckpoint({...gate,radiusM:999},[],now));
  assert.throws(()=>evaluateCheckpoint(gate,Array.from({length:201},()=>gps(45)),now));
  assert.equal(evaluateCheckpoint(gate,[],now).outcome,'needs_review');
  const clean=sampledSnapshot([
    gps(700),gps(45,{accepted:false}),gps(30,{source:'predicted'}),gps(12),
  ],now);
  assert.equal(clean.length,1);
});

test('real database: client plan, pass decision, GPS evidence, manual review, privacy', {timeout:90000}, async () => {
  const t=await setup();
  try {
    const admin=await t.login('+79990000001');
    const client=await t.login('+79998886671');
    const worker=await t.login('+79998886672','master');
    const outsider=await t.login('+79998886673');
    const a={id:admin.id,roles:['admin'],owner_id:null} as any;
    const c={id:client.id,roles:['client'],owner_id:null} as any;
    const w={id:worker.id,roles:['master'],owner_id:null} as any;
    const other={id:outsider.id,roles:['client'],owner_id:null} as any;

    ok(await t.api('PUT','/api/performer/profile',{
      kind:'master',name:'Checkpoint worker',specialties:['electric'],
      taxStatus:'self_employed',inn:'780000000557',
    },worker.token));
    ok(await t.api('POST','/api/admin/performers/'+worker.id+'/verify',
      {decision:'approved'},admin.token));
    ok(await t.api('POST','/api/performer/line',{lineStatus:'online'},worker.token));
    const created=ok(await t.api('POST','/api/orders',
      {service:'electric',zoneId:'spb',paymentMethod:'cash'},client.token));
    const id=created.order.id;
    ok(await t.api('POST','/api/orders/'+id+'/offers',{},worker.token));
    const bids=ok(await t.api('GET','/api/orders/'+id+'/offers',undefined,client.token));
    ok(await t.api('POST','/api/orders/'+id+'/offers/'+bids.offers[0].id+'/choose',{},client.token));

    const service=new CheckpointEvidenceService(t.db);
    const input={requestKey:'checkpoint-001',lat:59.9343,lng:30.3351,
      radiusM:200,requiresPass:true,locationDescription:'Западный КПП'};
    await assert.rejects(service.agreePlan(w,id,input),(e:any)=>e.status===403);
    const p=await service.agreePlan(c,id,input);
    assert.equal(p.version,1);
    assert.equal((await service.agreePlan(c,id,input)).reused,true);
    await assert.rejects(service.agreePlan(c,id,{...input,lat:60}),(e:any)=>e.status===409);
    // A grant is mandatory even for direct service calls, not only HTTP.
    const granted=await service.gpsConsent(w,id,{
      eventKey:'direct-consent-grant-001',planId:p.planId,
      action:'granted',durationMinutes:60,
    });
    assert.equal(granted.active,true);
    await assert.rejects(service.gpsConsent(c,id,{
      eventKey:'direct-consent-grant-002',planId:p.planId,
      action:'granted',durationMinutes:60,
    }),(e:any)=>e.status===403);
    await assert.rejects(service.submitAttempt(c,id,{
      requestKey:'arrival-001',planId:p.planId,gpsConsent:true,
    }),(e:any)=>e.status===403);
    await assert.rejects(service.submitAttempt(w,id,{
      requestKey:'arrival-001',planId:p.planId,gpsConsent:false as any,
    }),(e:any)=>e.status===403);

    const first=await service.submitAttempt(w,id,{
      requestKey:'arrival-001',planId:p.planId,gpsConsent:true,
    });
    assert.equal(first.outcome,'needs_review');
    assert.equal(first.startBilling,false);
    assert.ok((first.evaluation.reasons as string[]).includes('pass_not_cleared'));
    assert.equal((await service.submitAttempt(w,id,{
      requestKey:'arrival-001',planId:p.planId,gpsConsent:true,
    })).reused,true);
    await assert.rejects(service.submitAttempt(w,id,{
      requestKey:'arrival-001',planId:p.planId,gpsConsent:true,explanation:'changed',
    }),(e:any)=>e.status===409);

    const pass={
      eventKey:'pass-review-001',outcome:'cleared' as const,
      evidenceRef:'secure-evidence-ref',evidenceHash:'a'.repeat(64),
      explanation:'Проверены документы для въезда и согласие исполнителя вручную.',
    };
    await assert.rejects(service.reviewPass(c,p.planId,pass),(e:any)=>e.status===403);
    assert.equal((await service.reviewPass(a,p.planId,pass)).outcome,'cleared');
    assert.equal((await service.reviewPass(a,p.planId,pass)).reused,true);

    await t.db.query(
      'insert into performer_route_samples '+
      '(order_id,performer_id,lat,lng,received_at,accepted,accuracy_m,gps_source,checkpoint_consent,checkpoint_plan_id,checkpoint_consent_seq) '+
      "values($1,$2,$3,$4,now()-interval '48 seconds',true,12,'gps',true,$5,$6),"+
      "($1,$2,$3,$4,now()-interval '12 seconds',true,12,'gps',true,$5,$6)",
      [id,worker.id,59.9343,30.3351,p.planId,granted.eventId],
    );
    const second=await service.submitAttempt(w,id,{
      requestKey:'arrival-002',planId:p.planId,gpsConsent:true,
    });
    assert.equal(second.outcome,'candidate');
    assert.equal(second.startBilling,false);
    assert.equal((await t.db.query(
      'select * from checkpoint_arrival_sample_snapshots where attempt_id=$1',[second.id])).length,1);
    await assert.rejects(service.inspectSnapshot(c,second.id),(e:any)=>e.status===403);
    const raw=await service.inspectSnapshot(a,second.id);
    assert.equal(raw.samples.length,2);
    assert.equal(raw.sampleCount,2);
    assert.equal(raw.sampleDigest.length,64);
    // Data older than its retention expiry is never returned even if a
    // separate privileged purge job hasn't removed the underlying row yet.
    const afterExpiry=new CheckpointEvidenceService(t.db,
      ()=>new Date('2099-01-01T00:00:00Z'));
    const hidden=await afterExpiry.inspectSnapshot(a,second.id);
    assert.equal(hidden.samples,null);
    assert.equal(hidden.expiresAt,null);
    await assert.rejects(afterExpiry.submitAttempt(w,id,{
      requestKey:'arrival-expired-consent',planId:p.planId,gpsConsent:true,
    }),(e:any)=>e.status===403);

    const visible=await service.inspect(c,id);
    assert.equal(visible.attempts.length,2);
    assert.equal(JSON.stringify(visible).includes('sample_snapshot'),false);
    assert.equal(JSON.stringify(visible).includes('lastDistanceM'),false);
    await assert.rejects(service.inspect(other,id),(e:any)=>e.status===403);
    await assert.rejects(service.decideAttempt(other,second.id,{
      decision:'corroborated',explanation:'Подтверждаю прибытие к пропускному пункту.',
    }),(e:any)=>e.status===403);
    const decision={decision:'corroborated' as const,
      explanation:'Подтверждаю прибытие к пропускному пункту.'};
    assert.equal((await service.decideAttempt(c,second.id,decision)).startBilling,false);
    assert.equal((await service.decideAttempt(c,second.id,decision)).reused,true);
    const order=await t.db.one<any>(
      'select status,arrived_at,wait_started_at from orders where id=$1',[id]);
    assert.equal(order.status,'accepted');
    assert.equal(order.arrived_at,null);
    assert.equal(order.wait_started_at,null);
    assert.equal((await t.db.query('select id from payments where order_id=$1',[id])).length,0);

    // Consent must be independently revocable even after an earlier
    // successful candidate. Old GPS points remain tied to this plan.
    const revoked=await service.gpsConsent(w,id,{
      eventKey:'direct-consent-revoke-001',planId:p.planId,action:'revoked',
    });
    assert.equal(revoked.active,false);
    await assert.rejects(service.submitAttempt(w,id,{
      requestKey:'arrival-after-revocation',planId:p.planId,gpsConsent:true,
    }),(e:any)=>e.status===403);

    // Re-granting under the SAME plan is a NEW consent epoch. The old two
    // GPS points belong to the earlier permission and must not be reused.
    const regranted=await service.gpsConsent(w,id,{
      eventKey:'direct-consent-grant-002',planId:p.planId,
      action:'granted',durationMinutes:60,
    });
    assert.equal(regranted.active,true);
    const regrantAttempt=await service.submitAttempt(w,id,{
      requestKey:'arrival-after-regrant-001',planId:p.planId,gpsConsent:true,
    });
    assert.equal(regrantAttempt.outcome,'needs_review');
    assert.ok((regrantAttempt.evaluation.reasons as string[]).includes('no_recent_samples'));

    const changed=await service.agreePlan(c,id,{
      ...input,requestKey:'checkpoint-002',lat:59.935,
    });
    assert.equal(changed.version,2);
    const newGrant=await service.gpsConsent(w,id,{
      eventKey:'direct-consent-grant-003',planId:changed.planId,
      action:'granted',durationMinutes:60,
    });
    assert.equal(newGrant.active,true);
    // Old consented positions do not belong to the newly approved plan,
    // even when both gates are geographically close to each other.
    const stale=await service.submitAttempt(w,id,{
      requestKey:'arrival-new-plan-001',planId:changed.planId,gpsConsent:true,
    });
    assert.equal(stale.outcome,'needs_review');
    assert.ok((stale.evaluation.reasons as string[]).includes('no_recent_samples'));
    const snap=await service.inspectSnapshot(a,stale.id);
    assert.equal(snap.sampleCount,0);
    await assert.rejects(service.submitAttempt(w,id,{
      requestKey:'arrival-003',planId:p.planId,gpsConsent:true,
    }),(e:any)=>e.status===409);

    // The user can export only their own consent ledger and precise GPS.
    const workerPrivacy=await service.myCheckpointPrivacy(w,0,2);
    assert.equal(workerPrivacy.samples.length,2);
    assert.equal(workerPrivacy.hasMore.consents,true);
    assert.ok(workerPrivacy.consentEvents.every(e=>e.orderId===id));
    assert.equal(workerPrivacy.approvedPlans.length,0);
    const ownerPrivacy=await service.myCheckpointPrivacy(c);
    assert.equal(ownerPrivacy.samples.length,0);
    assert.equal(ownerPrivacy.approvedPlans.length,2);
    const strangerPrivacy=await service.myCheckpointPrivacy(other);
    assert.equal(strangerPrivacy.samples.length,0);
    assert.equal(strangerPrivacy.consentEvents.length,0);
    assert.equal(strangerPrivacy.approvedPlans.length,0);
    await assert.rejects(service.myCheckpointPrivacy(w,-1),(e:any)=>e.status===400);
    await assert.rejects(service.retentionSweep(c,{execute:true,acknowledge:true,
      eventKey:'purge-denied-001'}),(e:any)=>e.status===403);

    // No points or snapshots are due at the real clock. The disposable
    // 2099 clock exercises the actual retention path without sleeping.
    const present=await service.retentionSweep(a);
    assert.equal(present.dryRun,true);
    assert.equal(present.dueSnapshots,0);
    assert.equal(present.dueSamples,0);
    const future=new CheckpointEvidenceService(t.db,()=>new Date('2099-01-01T00:00:00Z'));
    const preview=await future.retentionSweep(a,{limit:2});
    assert.equal(preview.dryRun,true);
    assert.equal(preview.dueSnapshots,4);
    assert.equal(preview.dueSamples,2);
    assert.equal((await t.db.query(
      'select id from checkpoint_arrival_sample_snapshots')).length,4);
    await assert.rejects(future.retentionSweep(a,{
      execute:true,limit:2,eventKey:'purge-gps-001',
    }),(e:any)=>e.status===400);

    const purge=await future.retentionSweep(a,{
      execute:true,acknowledge:true,limit:2,eventKey:'purge-gps-001',
    });
    assert.equal(purge.deletedSnapshots,2);
    assert.equal(purge.deletedSamples,2);
    assert.equal(purge.startBilling,false);
    const repeat=await future.retentionSweep(a,{
      execute:true,acknowledge:true,limit:2,eventKey:'purge-gps-001',
    });
    assert.equal(repeat.reused,true);
    assert.equal(repeat.batchId,purge.batchId);
    await assert.rejects(future.retentionSweep(a,{
      execute:true,acknowledge:true,limit:3,eventKey:'purge-gps-001',
    }),(e:any)=>e.status===409);

    const remaining=await future.retentionSweep(a,{limit:100});
    assert.equal(remaining.dueSnapshots,2);
    assert.equal(remaining.dueSamples,0);
    const finish=await future.retentionSweep(a,{
      execute:true,acknowledge:true,limit:100,eventKey:'purge-gps-002',
    });
    assert.equal(finish.deletedSnapshots,2);
    assert.equal(finish.deletedSamples,0);
    assert.equal((await future.purgeExpiredSnapshots(a)).purged,0);
    await assert.rejects(service.purgeExpiredSnapshots(c),(e:any)=>e.status===403);
    assert.equal((await t.db.query(
      'select id from checkpoint_arrival_attempts where order_id=$1',[id])).length,4);
    assert.equal((await t.db.query(
      'select attempt_id from checkpoint_arrival_sample_snapshots')).length,0);
    assert.equal((await t.db.query(
      'select id from performer_route_samples where order_id=$1',[id])).length,0);
    assert.equal((await t.db.query(
      'select id from checkpoint_gps_purge_batches')).length,2);
    assert.equal((await t.db.query(
      'select id from audit_log where action=$1',['checkpoint.gps_retention_purged'])).length,2);
  } finally {await t.close();}
});
