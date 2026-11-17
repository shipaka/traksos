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
    const a={id:admin.id,roles:['admin'],owner_id:null} as any;
    const c={id:client.id,roles:['client'],owner_id:null} as any;
    const w={id:worker.id,roles:['master'],owner_id:null} as any;
    const other={id:'00000000-0000-0000-0000-000000000000',roles:['client'],owner_id:null} as any;

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
      '(order_id,performer_id,lat,lng,received_at,accepted,accuracy_m,gps_source,checkpoint_consent) '+
      "values($1,$2,$3,$4,now()-interval '48 seconds',true,12,'gps',true),"+
      "($1,$2,$3,$4,now()-interval '12 seconds',true,12,'gps',true)",
      [id,worker.id,59.9343,30.3351],
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

    const changed=await service.agreePlan(c,id,{
      ...input,requestKey:'checkpoint-002',lat:59.935,
    });
    assert.equal(changed.version,2);
    await assert.rejects(service.submitAttempt(w,id,{
      requestKey:'arrival-003',planId:p.planId,gpsConsent:true,
    }),(e:any)=>e.status===409);

    assert.equal((await service.purgeExpiredSnapshots(a)).purged,0);
    await assert.rejects(service.purgeExpiredSnapshots(c),(e:any)=>e.status===403);
    const future=new CheckpointEvidenceService(t.db,()=>new Date('2099-01-01T00:00:00Z'));
    assert.equal((await future.purgeExpiredSnapshots(a)).purged,2);
    assert.equal((await t.db.query(
      'select id from checkpoint_arrival_attempts where order_id=$1',[id])).length,2);
    assert.equal((await t.db.query(
      'select attempt_id from checkpoint_arrival_sample_snapshots')).length,0);
  } finally {await t.close();}
});
