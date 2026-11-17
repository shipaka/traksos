import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, ok } from './helpers.ts';

test('checkpoint integrity: preflight, explicit validation, and cross-order historic detection',
  { timeout: 120_000 }, async () => {
    const before = process.env.CHECKPOINT_EVIDENCE_API_ENABLED;
    process.env.CHECKPOINT_EVIDENCE_API_ENABLED = 'true';
    const t = await setup();
    try {
      const admin = await t.login('+79990000001');
      const client = await t.login('+79998886671');
      const worker = await t.login('+79998886672', 'master');
      const other = await t.login('+79998886673');

      ok(await t.api('PUT','/api/performer/profile',{
        kind:'master',name:'Integrity worker',specialties:['electric'],
        taxStatus:'self_employed',inn:'780000000557',
      },worker.token));
      ok(await t.api('POST','/api/admin/performers/'+worker.id+'/verify',
        {decision:'approved'},admin.token));
      ok(await t.api('POST','/api/performer/line',{lineStatus:'online'},worker.token));
      const created=ok(await t.api('POST','/api/orders',
        {service:'electric',zoneId:'spb',paymentMethod:'cash'},client.token));
      const id=created.order.id;
      ok(await t.api('POST','/api/orders/'+id+'/offers',{},worker.token));
      const bids=ok(await t.api('GET','/api/orders/'+id+'/offers',
        undefined,client.token));
      ok(await t.api('POST','/api/orders/'+id+'/offers/'+bids.offers[0].id+'/choose',
        {},client.token));

      const plan=ok(await t.api('PUT','/api/orders/'+id+'/checkpoint-plan',{
        requestKey:'integrity-plan-001',lat:59.9343,lng:30.3351,
        radiusM:200,requiresPass:false,
      },client.token));
      const grant=ok(await t.api('POST','/api/orders/'+id+'/checkpoint/gps-consent',{
        eventKey:'integrity-grant-001',planId:plan.planId,
        action:'granted',durationMinutes:60,
      },worker.token));

      const second=ok(await t.api('POST','/api/orders',
        {service:'consult'},client.token)).order.id;
      const url='/api/admin/checkpoint-gps/integrity';
      assert.equal((await t.api('GET',url)).status,401);
      assert.equal((await t.api('GET',url,undefined,worker.token)).status,403);
      assert.equal((await t.api('GET',url,undefined,client.token)).status,403);
      assert.equal((await t.api('POST',url+'/validate',{},other.token)).status,403);

      const report=ok(await t.api('GET',url,undefined,admin.token));
      assert.equal(report.readyToValidate,true);
      assert.equal(report.allValidated,false);
      assert.equal(report.checks.length,7);
      assert.ok(report.checks.every((c: any)=>
        c.exists && c.violatingRows===0 && c.validated===false));
      assert.match(report.snapshotDigest,/^[a-f0-9]{64}$/);
      assert.equal(JSON.stringify(report).includes(worker.id),false);
      assert.equal(JSON.stringify(report).includes('59.9343'),false);
      assert.equal(report.startBilling,false);
      assert.equal((await t.api('POST',url+'/validate',{
        snapshotDigest:report.snapshotDigest,
      },admin.token)).status,400);
      assert.equal((await t.api('POST',url+'/validate',{
        snapshotDigest:'0'.repeat(64),acknowledge:true,
      },admin.token)).status,409);

      const confirmed=ok(await t.api('POST',url+'/validate',{
        snapshotDigest:report.snapshotDigest,acknowledge:true,
      },admin.token));
      assert.equal(confirmed.validatedNow,7);
      assert.equal(confirmed.allValidated,true);
      assert.equal(confirmed.readyToValidate,true);
      assert.ok(confirmed.checks.every((c: any)=>c.validated));
      assert.equal((await t.api('POST',url+'/validate',{
        snapshotDigest:report.snapshotDigest,acknowledge:true,
      },admin.token)).status,409);
      const repeated=ok(await t.api('POST',url+'/validate',{
        snapshotDigest:confirmed.snapshotDigest,acknowledge:true,
      },admin.token));
      assert.equal(repeated.validatedNow,0);

      // The old three-column FK would accept this GPS point: consent_seq,
      // plan_id and performer_id are valid. The NEW four-column FK must
      // reject its attempt to attach the same grant to a different order.
      const wrongSql='insert into performer_route_samples ' +
        '(order_id,performer_id,lat,lng,checkpoint_consent,' +
        'checkpoint_plan_id,checkpoint_consent_seq) ' +
        'values($1,$2,59.9343,30.3351,true,$3,$4)';
      const wrongArgs=[second,worker.id,plan.planId,grant.eventId];
      await assert.rejects(t.db.query(wrongSql,wrongArgs),
        (e:any)=>e.code==='23503');

      // Manufacture an invalid HISTORICAL row in disposable PostgreSQL:
      // drop just the order-scope FK, insert, restore it NOT VALID. This is
      // NEVER run against a real database. No automatic repair is allowed.
      await t.db.query(
        'alter table performer_route_samples drop constraint checkpoint_route_consent_order_scope_fk');
      await t.db.query(wrongSql,wrongArgs);
      await t.db.query(
        'alter table performer_route_samples ' +
        'add constraint checkpoint_route_consent_order_scope_fk ' +
        'foreign key(checkpoint_consent_seq,checkpoint_plan_id,order_id,performer_id) ' +
        'references checkpoint_gps_consent_events(seq,plan_id,order_id,performer_id) not valid');
      const dirty=ok(await t.api('GET',url,undefined,admin.token));
      const cross=dirty.checks.find((c: any)=>
        c.name==='checkpoint_route_consent_order_scope_fk');
      assert.equal(cross.exists,true);
      assert.equal(cross.validated,false);
      assert.equal(cross.violatingRows,1);
      assert.equal(dirty.readyToValidate,false);
      assert.equal(dirty.allValidated,false);
      assert.equal((await t.api('POST',url+'/validate',{
        snapshotDigest:dirty.snapshotDigest,acknowledge:true,
      },admin.token)).status,409);
      assert.equal((await t.db.query(
        'select id from performer_route_samples where order_id=$1',[second])).length,1);
      assert.equal((await t.db.query(
        'select id from audit_log where action=$1',
        ['checkpoint.integrity_validated'])).length,2);
      assert.equal((await t.db.query(
        'select id from payments where order_id=$1',[id])).length,0);
      const order=await t.db.one<any>(
        'select status from orders where id=$1',[id]);
      assert.equal(order.status,'accepted');
    } finally {
      await t.close();
      if (before === undefined) delete process.env.CHECKPOINT_EVIDENCE_API_ENABLED;
      else process.env.CHECKPOINT_EVIDENCE_API_ENABLED=before;
    }
  });
