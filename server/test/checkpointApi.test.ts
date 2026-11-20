import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, ok } from './helpers.ts';
import { checkpointApiEnabled } from '../src/http/checkpointRoutes.ts';

/**
 * The checkpoint API is opt-in and cannot run on production.
 * All assertions exercise real HTTP routes and disposable PostgreSQL,
 * not direct calls to the service.
 */
test('checkpoint API stays absent without an explicit opt-in switch', {timeout:90_000}, async () => {
  const previous = process.env.CHECKPOINT_EVIDENCE_API_ENABLED;
  process.env.CHECKPOINT_EVIDENCE_API_ENABLED = 'false';
  const t = await setup();
  try {
    const client = await t.login('+79998886671');
    const response = await t.api('GET',
      '/api/orders/00000000-0000-0000-0000-000000000000/checkpoint',
      undefined, client.token);
    assert.equal(response.status, 404);
    const badGps = await t.api('POST', '/api/performer/location', {
      lat:59.9343,lng:30.3351,checkpointEvidenceConsent:true,
      checkpointPlanId:'00000000-0000-0000-0000-000000000000',
      accuracyM:10,source:'gps',
    },client.token);
    // Unapproved metadata is not permitted even when the legacy location
    // endpoint is reachable (role checks may independently forbid it).
    assert.ok([403,404].includes(badGps.status));
  } finally {
    await t.close();
    if (previous === undefined) delete process.env.CHECKPOINT_EVIDENCE_API_ENABLED;
    else process.env.CHECKPOINT_EVIDENCE_API_ENABLED = previous;
  }
});

test('checkpoint API: roles, consented GPS, idempotence, pass review, non-billable decision',
  { timeout: 120_000 }, async () => {
    const previous = process.env.CHECKPOINT_EVIDENCE_API_ENABLED;
    process.env.CHECKPOINT_EVIDENCE_API_ENABLED = 'true';
    const t = await setup();
    try {
      const admin = await t.login('+79990000001');
      const client = await t.login('+79998886671');
      const worker = await t.login('+79998886672', 'master');
      const unrelated = await t.login('+79998886673');

      ok(await t.api('PUT','/api/performer/profile',{
        kind:'master',name:'Gateway contractor',specialties:['electric'],
        taxStatus:'self_employed',inn:'780000000557',
      },worker.token));
      ok(await t.api('POST','/api/admin/performers/'+worker.id+'/verify',
        {decision:'approved'},admin.token));
      ok(await t.api('POST','/api/performer/line',{lineStatus:'online'},worker.token));
      const created=ok(await t.api('POST','/api/orders',{
        service:'electric',zoneId:'spb',paymentMethod:'cash',
      },client.token));
      const id=created.order.id;
      ok(await t.api('POST','/api/orders/'+id+'/offers',{},worker.token));
      const offers=ok(await t.api('GET','/api/orders/'+id+'/offers',undefined,client.token));
      ok(await t.api('POST','/api/orders/'+id+'/offers/'+offers.offers[0].id+'/choose',
        {},client.token));

      const plan={
        requestKey:'checkpoint-plan-001',lat:59.9343,lng:30.3351,
        radiusM:200,requiresPass:true,
        locationDescription:'Западный КПП; въезд для грузовой техники',
      };
      assert.equal((await t.api('PUT','/api/orders/'+id+'/checkpoint-plan',
        plan,unrelated.token)).status,403);
      const agreed=ok(await t.api('PUT','/api/orders/'+id+'/checkpoint-plan',plan,client.token));
      assert.equal(agreed.version,1);
      assert.equal(agreed.reused,false);
      assert.equal((await t.api('PUT','/api/orders/'+id+'/checkpoint-plan',
        plan,client.token)).body.reused,true);
      assert.equal((await t.api('PUT','/api/orders/'+id+'/checkpoint-plan',
        {...plan,lat:60.01},client.token)).status,409);

      const pass={
        eventKey:'pass-verified-001',outcome:'cleared',
        evidenceRef:'protected-record-id-001',
        evidenceHash:'f'.repeat(64),
        explanation:'Администратор сверил договорные и пропускные основания; ручная отметка.',
      };
      assert.equal((await t.api('POST',
        '/api/admin/checkpoint-plans/'+agreed.planId+'/pass-review',
        pass,client.token)).status,403);
      assert.equal(ok(await t.api('POST',
        '/api/admin/checkpoint-plans/'+agreed.planId+'/pass-review',
        pass,admin.token)).outcome,'cleared');

      // Metadata is rejected without affirmative per-order GPS consent.
      const gpsData={
        lat:59.9343,lng:30.3351,checkpointPlanId:agreed.planId,
        accuracyM:12,source:'gps',mockLocation:false,
        deviceAt:'2031-01-01T00:00:00Z',
      };
      assert.equal((await t.api('POST','/api/performer/location',
        gpsData,worker.token)).status,400);
      // The assignment must be en-route; accepting an order is not enough.
      assert.equal((await t.api('POST','/api/performer/location',
        {...gpsData,checkpointEvidenceConsent:true},worker.token)).status,409);

      ok(await t.api('POST','/api/orders/'+id+'/step',{action:'depart'},worker.token));

      // A per-message consent boolean without an active scoped grant is not
      // sufficient. The server must explicitly record a reversible permission.
      const ungranted=await t.api('POST','/api/performer/location',
        {...gpsData,checkpointEvidenceConsent:true},worker.token);
      assert.equal(ungranted.status,409);
      const consentUrl='/api/orders/'+id+'/checkpoint/gps-consent';
      const grant={
        eventKey:'scoped-gps-grant-001',planId:agreed.planId,
        action:'granted',durationMinutes:60,
      };
      assert.equal((await t.api('POST',consentUrl,grant,client.token)).status,403);
      const granted=ok(await t.api('POST',consentUrl,grant,worker.token));
      assert.equal(granted.active,true);
      assert.equal(granted.reused,false);
      assert.equal((await t.api('POST',consentUrl,grant,worker.token)).body.reused,true);
      assert.equal((await t.api('POST',consentUrl,
        {...grant,durationMinutes:90},worker.token)).status,409);

      const first=ok(await t.api('POST','/api/performer/location',
        {...gpsData,checkpointEvidenceConsent:true},worker.token));
      assert.notEqual(first.accepted,false);
      const firstRows=await t.db.query<any>(
        'select id,checkpoint_consent,gps_source,accuracy_m,mock_location,device_at '+
        'from performer_route_samples where order_id=$1',[id]);
      assert.equal(firstRows.length,1);
      assert.equal(firstRows[0].checkpoint_consent,true);
      assert.equal(firstRows[0].gps_source,'gps');
      assert.equal(Number(firstRows[0].accuracy_m),12);
      assert.equal(firstRows[0].mock_location,false);
      const scoped=await t.db.one<any>(
        'select checkpoint_plan_id from performer_route_samples where id=$1',[firstRows[0].id]);
      assert.equal(scoped.checkpoint_plan_id,agreed.planId);

      // Move the stored sample backwards in this isolated DB only; no time
      // delays or fake route positions are sent to the live application.
      await t.db.query(
        "update performer_route_samples set received_at=now()-interval '31 seconds' where id=$1",
        [firstRows[0].id]);
      await t.db.query(
        "update performer_profiles set location_at=now()-interval '31 seconds' where user_id=$1",
        [worker.id]);
      const second=ok(await t.api('POST','/api/performer/location',
        {...gpsData,checkpointEvidenceConsent:true},worker.token));
      assert.notEqual(second.accepted,false);
      const counted=await t.db.query('select id from performer_route_samples where order_id=$1',[id]);
      assert.equal(counted.length,2);

      assert.equal((await t.api('POST','/api/orders/'+id+'/checkpoint/arrival',{
        requestKey:'attempt-0001',planId:agreed.planId,gpsConsent:false,
      },worker.token)).status,400);

      const attempt=ok(await t.api('POST','/api/orders/'+id+'/checkpoint/arrival',{
        requestKey:'attempt-0001',planId:agreed.planId,gpsConsent:true,
      },worker.token));
      assert.equal(attempt.outcome,'candidate');
      assert.equal(attempt.startBilling,false);
      const repeated=ok(await t.api('POST','/api/orders/'+id+'/checkpoint/arrival',{
        requestKey:'attempt-0001',planId:agreed.planId,gpsConsent:true,
      },worker.token));
      assert.equal(repeated.id,attempt.id);
      assert.equal(repeated.reused,true);
      const conflicting=await t.api('POST','/api/orders/'+id+'/checkpoint/arrival',{
        requestKey:'attempt-0001',planId:agreed.planId,gpsConsent:true,
        explanation:'Новая попытка с тем же ключом',
      },worker.token);
      assert.equal(conflicting.status,409);
      const clientView=ok(await t.api('GET','/api/orders/'+id+'/checkpoint',
        undefined,client.token));
      assert.equal(clientView.attempts.length,1);
      assert.equal(clientView.gpsConsent.planId,agreed.planId);
      assert.equal(clientView.gpsConsent.active,true);
      assert.equal(JSON.stringify(clientView).includes('lastDistanceM'),false);
      assert.equal(JSON.stringify(clientView).includes('sample_snapshot'),false);
      assert.equal((await t.api('GET','/api/orders/'+id+'/checkpoint',
        undefined,unrelated.token)).status,403);
      assert.equal((await t.api('GET',
        '/api/admin/checkpoint-attempts/'+attempt.id+'/gps',
        undefined,client.token)).status,403);
      const staffGps=ok(await t.api('GET',
        '/api/admin/checkpoint-attempts/'+attempt.id+'/gps',
        undefined,admin.token));
      assert.equal(staffGps.sampleCount,2);
      assert.equal(staffGps.samples.length,2);

      const decision={
        decision:'corroborated',
        explanation:'Подтверждаю, что мастер действительно прибыл к согласованному КПП.',
      };
      assert.equal((await t.api('POST',
        '/api/checkpoint-attempts/'+attempt.id+'/decision',
        decision,unrelated.token)).status,403);
      const reviewed=ok(await t.api('POST',
        '/api/checkpoint-attempts/'+attempt.id+'/decision',
        decision,client.token));
      assert.equal(reviewed.decision,'corroborated');
      assert.equal(reviewed.startBilling,false);
      assert.equal((await t.api('POST',
        '/api/checkpoint-attempts/'+attempt.id+'/decision',
        decision,client.token)).body.reused,true);
      assert.equal((await t.api('POST',
        '/api/checkpoint-attempts/'+attempt.id+'/decision',
        {...decision,decision:'insufficient'},client.token)).status,409);

      // A dedicated order-scoped rate gate prevents unbounded uploads while
      // idempotent retries remain free and return the first immutable event.
      for (let i = 2; i <= 8; i++) {
        const x=ok(await t.api('POST','/api/orders/'+id+'/checkpoint/arrival',{
          requestKey:'attempt-000'+i,planId:agreed.planId,gpsConsent:true,
        },worker.token));
        assert.equal(x.startBilling,false);
      }
      const exceeded=await t.api('POST','/api/orders/'+id+'/checkpoint/arrival',{
        requestKey:'attempt-0009',planId:agreed.planId,gpsConsent:true,
      },worker.token);
      assert.equal(exceeded.status,429);
      const stillReplay=ok(await t.api('POST','/api/orders/'+id+'/checkpoint/arrival',{
        requestKey:'attempt-0001',planId:agreed.planId,gpsConsent:true,
      },worker.token));
      assert.equal(stillReplay.id,attempt.id);

      // Stopping consent must be honored even if an old APK still sends its
      // previous per-position true flag and a valid plan ID.
      const revoke={eventKey:'scoped-gps-revoke-001',
        planId:agreed.planId,action:'revoked'};
      const stopped=ok(await t.api('POST',consentUrl,revoke,worker.token));
      assert.equal(stopped.active,false);
      const blocked=await t.api('POST','/api/performer/location',
        {...gpsData,checkpointEvidenceConsent:true},worker.token);
      assert.equal(blocked.status,409);
      assert.equal((await t.api('POST','/api/orders/'+id+'/checkpoint/arrival',{
        requestKey:'attempt-0010',planId:agreed.planId,gpsConsent:true,
      },worker.token)).status,403);
      assert.equal((await t.api('POST',consentUrl,grant,worker.token)).body.active,false);
      assert.equal((await t.api('GET','/api/orders/'+id+'/checkpoint',
        undefined,worker.token)).body.gpsConsent.active,false);
      const regrant=ok(await t.api('POST',consentUrl,{
        ...grant,eventKey:'scoped-gps-grant-002',
      },worker.token));
      assert.equal(regrant.active,true);
      assert.equal((await t.api('POST','/api/performer/location',
        {...gpsData,checkpointEvidenceConsent:true},worker.token)).status,200);

      // Read-only personal data access must be subject-specific; clients
      // must not see a performer's raw positions merely by owning the order.
      const own=ok(await t.api('GET','/api/me/checkpoint-privacy?limit=1',
        undefined,worker.token));
      assert.equal(own.samples.length,1);
      assert.equal(own.samples[0].planId,agreed.planId);
      assert.equal(own.hasMore.samples,true);
      assert.equal(own.consentEvents.length,1);
      assert.equal(own.hasMore.consents,true);
      const next=ok(await t.api('GET','/api/me/checkpoint-privacy?offset=1&limit=1',
        undefined,worker.token));
      assert.equal(next.samples.length,1);
      assert.notEqual(next.samples[0].receivedAt,own.samples[0].receivedAt);
      const clientPrivacy=ok(await t.api('GET','/api/me/checkpoint-privacy',
        undefined,client.token));
      assert.equal(clientPrivacy.samples.length,0);
      assert.equal(clientPrivacy.approvedPlans.length,1);
      const outsiderPrivacy=ok(await t.api('GET','/api/me/checkpoint-privacy',
        undefined,unrelated.token));
      assert.equal(outsiderPrivacy.samples.length,0);
      assert.equal(outsiderPrivacy.consentEvents.length,0);
      assert.equal((await t.api('GET','/api/me/checkpoint-privacy?offset=-1',
        undefined,worker.token)).status,400);

      // Simulate precisely one 31-day-old OPT-IN checkpoint GPS row.
      // No existing legacy route history or fresh evidence may be deleted.
      await t.db.query(
        'insert into performer_route_samples ' +
        '(order_id,performer_id,lat,lng,received_at,accepted,accuracy_m,' +
        'gps_source,checkpoint_consent,checkpoint_plan_id,checkpoint_consent_seq) ' +
        "values($1,$2,59.9343,30.3351,now()-interval '31 days',true,12," +
        "'gps',true,$3,$4)",
        [id,worker.id,agreed.planId,regrant.eventId],
      );
      const retention='/api/admin/checkpoint-gps/retention';
      assert.equal((await t.api('GET',retention,undefined,worker.token)).status,403);
      const preview=ok(await t.api('GET',retention+'?limit=1',
        undefined,admin.token));
      assert.equal(preview.dryRun,true);
      assert.equal(preview.dueSamples,1);
      assert.equal(preview.dueSnapshots,0);
      const cleanKey='checkpoint-purge-http-001';
      assert.equal((await t.api('POST',retention,
        {eventKey:cleanKey,limit:1},admin.token)).status,400);
      assert.equal((await t.api('POST',retention,
        {eventKey:cleanKey,limit:1,acknowledge:true},worker.token)).status,403);
      const purged=ok(await t.api('POST',retention,
        {eventKey:cleanKey,limit:1,acknowledge:true},admin.token));
      assert.equal(purged.deletedSamples,1);
      assert.equal(purged.deletedSnapshots,0);
      const replay=ok(await t.api('POST',retention,
        {eventKey:cleanKey,limit:1,acknowledge:true},admin.token));
      assert.equal(replay.reused,true);
      assert.equal(replay.batchId,purged.batchId);
      assert.equal((await t.api('POST',retention,
        {eventKey:cleanKey,limit:2,acknowledge:true},admin.token)).status,409);
      const after=ok(await t.api('GET',retention,undefined,admin.token));
      assert.equal(after.dueSamples,0);
      assert.equal((await t.db.query(
        'select id from performer_route_samples where order_id=$1 and received_at>now()-interval ' +
        "'30 days'",[id])).length>=2,true);
      assert.equal((await t.db.query(
        'select id from checkpoint_gps_purge_batches where batch_key=$1',[cleanKey])).length,1);

      const order=await t.db.one<any>(
        'select status,arrived_at,wait_started_at from orders where id=$1',[id]);
      assert.equal(order.status,'en_route');
      assert.equal(order.arrived_at,null);
      assert.equal(order.wait_started_at,null);
      assert.equal((await t.db.query('select id from payments where order_id=$1',[id])).length,0);
      assert.equal((await t.db.query(
        'select id from checkpoint_arrival_attempts where order_id=$1',[id])).length,8);
      assert.equal((await t.db.query(
        'select id from audit_log where action = $1', ['checkpoint.arrival_reviewed'])).length,1);
    } finally {
      await t.close();
      if (previous === undefined) delete process.env.CHECKPOINT_EVIDENCE_API_ENABLED;
      else process.env.CHECKPOINT_EVIDENCE_API_ENABLED = previous;
    }
  });


test('public production cannot enable checkpoint API by toggling only its feature switch', () => {
  const before = {
    flag: process.env.CHECKPOINT_EVIDENCE_API_ENABLED,
    node: process.env.NODE_ENV,
    sandbox: process.env.SANDBOX_INSTANCE,
  };
  try {
    process.env.CHECKPOINT_EVIDENCE_API_ENABLED = 'true';
    process.env.NODE_ENV = 'production';
    process.env.SANDBOX_INSTANCE = 'false';
    assert.equal(checkpointApiEnabled(),false);
    process.env.SANDBOX_INSTANCE = 'true';
    assert.equal(checkpointApiEnabled(),true);
  } finally {
    for(const [key,value] of Object.entries({
      CHECKPOINT_EVIDENCE_API_ENABLED:before.flag,
      NODE_ENV:before.node,
      SANDBOX_INSTANCE:before.sandbox,
    })) {
      if(value === undefined) delete process.env[key];
      else process.env[key]=value;
    }
  }
});
