import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyNoPerformerReason, type PartnerPresence } from '../src/domain/noPerformerReason.ts';

const partner = (patch: Partial<PartnerPresence> = {}): PartnerPresence => ({
  kind: 'master', specialties: ['electric'], user_status: 'active',
  verification: 'approved', line_status: 'online', paused: false,
  extras: null, lat: 59.934, lng: 30.335, ...patch,
});
const snapshot = (patch: Partial<Parameters<typeof classifyNoPerformerReason>[0]> = {}) => ({
  service: 'electric', verifiedOnly: false,
  lat: 59.934, lng: 30.335, radiusKm: 50, invited: false,
  profiles: [] as PartnerPresence[], ...patch,
});

test('no partner claim requires proven absence of matching active profiles anywhere', () => {
  assert.equal(classifyNoPerformerReason(snapshot()), 'not_connected');
  assert.equal(classifyNoPerformerReason(snapshot({
    profiles: [partner({specialties:['tyre']})],
  })), 'not_connected');
  assert.equal(classifyNoPerformerReason(snapshot({
    profiles: [partner({user_status:'blocked'})],
  })), 'not_connected');
  assert.equal(classifyNoPerformerReason(snapshot({
    profiles: [partner({verification:'pending'})], verifiedOnly:true,
  })), 'unknown', 'pending badge is not proof the specialty is unconnected');
});

test('actual invited calls take precedence and become no_response', () => {
  assert.equal(classifyNoPerformerReason(snapshot({invited:true})), 'no_response');
  assert.equal(classifyNoPerformerReason(snapshot({
    profiles:[partner({line_status:'offline'})], invited:true,
  })), 'no_response');
});

test('real offer outranks invitation-only no_response when all bids are withdrawn', () => {
  assert.equal(classifyNoPerformerReason(snapshot({
    invited: true, hadOffer: true, profiles: [partner()],
  })), 'offers_withdrawn');
  assert.equal(classifyNoPerformerReason(snapshot({
    invited: false, hadOffer: true, profiles: [],
  })), 'offers_withdrawn', 'do not erase a proven bid when the worker profile is deleted');
  assert.equal(classifyNoPerformerReason(snapshot({
    invited: true, hadOffer: false, profiles: [partner()],
  })), 'no_response', 'bidding invitations with zero bids remain no_response');
});

test('nearby offline, paused and vacation partners can be temporarily unavailable', () => {
  for (const patch of [
    {line_status:'offline'},
    {paused:true},
    {extras:{vacation:true}},
  ]) {
    assert.equal(classifyNoPerformerReason(snapshot({profiles:[partner(patch)]})),
      'temporarily_unavailable');
  }
});

test('unknown GPS, distant/unknown locations and active workers never prove no partner', () => {
  for (const options of [
    {lat:null, lng:null},
    {lat:0, lng:0}, // Null Island is not a proven GPS fix
    {profiles:[partner({lat:null,lng:null})]},
    {lat:0.01, lng:0.01,profiles:[partner({lat:0,lng:0,line_status:'offline'})]},
    // A longitude one full rotation outside bounds can produce an
    // artificially tiny haversine distance to the real order.
    {profiles:[partner({lat:59.934,lng:390.335,line_status:'offline'})]},
    {profiles:[partner({lat:55.75,lng:37.62})]},
    {profiles:[partner()]},
    {verifiedOnly:true,profiles:[partner({verification:'pending',line_status:'offline'})]},
  ]) {
    assert.equal(classifyNoPerformerReason(snapshot({
      profiles:[partner({line_status:'offline'})],...options,
    })), 'unknown');
  }
});


test('terminal replacement search does not reuse offers or invitations from before performer drop', async () => {
  const { setup } = await import('./helpers.ts');
  const t = await setup();
  try {
    const customer = await t.login('+79990003561', 'client');
    for (const [afterDropInvitation, afterDropOffer, expected] of [
      [false, false, 'not_connected'],
      [true, false, 'no_response'],
      [true, true, 'offers_withdrawn'],
    ] as const) {
      // The old accepted dispatch had both an invite and an offer. A later
      // performer_dropped event marks the new search boundary.
      const order = await t.db.one<{ id: string }>(
        `insert into orders(client_id,created_by,service,zone_id,status,estimate)
           values ($1,$1,'hydraulics','spb','searching',$2::jsonb) returning id`,
        [customer.id, JSON.stringify({callOut:100000,zoneName:'СПб'})],
      );
      assert.ok(order);
      await t.db.query(
        `insert into order_events(order_id,actor_id,type,data)
          values ($1,null,'ringing','{}'::jsonb),
                 ($1,null,'offer','{}'::jsonb),
                 ($1,null,'performer_dropped','{}'::jsonb)`,
        [order.id],
      );
      if (afterDropInvitation) {
        await t.db.query(
          `insert into order_events(order_id,actor_id,type,data)
            values ($1,null,'ringing','{}'::jsonb)`,
          [order.id],
        );
      }
      if (afterDropOffer) {
        await t.db.query(
          `insert into order_events(order_id,actor_id,type,data)
            values ($1,null,'offer','{}'::jsonb)`,
          [order.id],
        );
      }
      // This disposable fixture has no hydraulics partners. Complete a real
      // auction/terminal transition, not an artificial no_performer status.
      await t.app.auction.start(order.id);
      const status = await t.db.one<{status:string}>(
        'select status from orders where id=$1', [order.id]);
      assert.equal(status?.status, 'no_performer');
      const event = await t.db.one<{reason:string}>(
        `select data->>'absenceReason' as reason from order_events
          where order_id=$1 and type='no_performer' order by id desc limit 1`,
        [order.id],
      );
      assert.equal(event?.reason, expected,
        'the final explanation must reflect only the replacement search');
    }
  } finally { await t.close(); }
});


test('terminal no-performer result survives notification write outage', async () => {
  const { setup } = await import('./helpers.ts');
  const t = await setup();
  try {
    const customer = await t.login('+79990003562','client');
    const order = await t.db.one<{id:string}>(
      `insert into orders(client_id,created_by,service,zone_id,status,estimate)
        values ($1,$1,'hydraulics','spb','searching',$2::jsonb) returning id`,
      [customer.id, JSON.stringify({callOut:100000,zoneName:'СПб'})]);
    assert.ok(order);
    await t.db.exec(`create function traksos_test_fail_absence_notice()
      returns trigger language plpgsql as $$
      begin raise exception 'injected notification outage'; end $$;
      create trigger traksos_test_fail_absence_notice
      before insert on notifications for each statement
      execute function traksos_test_fail_absence_notice();`);
    try {
      // Real auction termination must commit even when downstream storage
      // for an informational notification fails. Never fake a status change.
      await t.app.auction.start(order.id);
      const state = await t.db.one<{status:string}>(
        'select status from orders where id=$1',[order.id]);
      assert.equal(state?.status,'no_performer');
      const events = await t.db.query<{id:number}>(
        "select id from order_events where order_id=$1 and type='no_performer'",[order.id]);
      assert.equal(events.length,1,'exactly one immutable terminal event is kept');
      const response = await t.api('GET','/api/orders/'+order.id,undefined,customer.token);
      assert.equal(response.status,200,'customer must still see the true terminal state');
      assert.equal(response.body.status,'no_performer');
      const queued=await t.db.query<{event_id:string;user_id:string}>(
        'select event_id::text,user_id from order_no_performer_alerts where order_id=$1 and handled_at is null',
        [order.id]);
      assert.equal(queued.length,1,
        'outage must leave one durable alert intent for the actual customer');
    }finally{
      await t.db.exec(`drop trigger if exists traksos_test_fail_absence_notice on notifications;
        drop function if exists traksos_test_fail_absence_notice();`);
    }
    // A later DB recovery (or service restart) must drain that old intent
    // without creating a new order event or a duplicate inbox message.
    const recovered=await t.app.auction.flushPendingNoPerformerAlerts();
    assert.equal(recovered,1);
    const stored=await t.db.query<{user_id:string;title:string;data:any}>(
      `select user_id,title,data from notifications where data->>'orderId'=$1
         and data ? 'terminalEventId'`,[order.id]);
    assert.equal(stored.length,1);
    assert.equal(stored[0].user_id,customer.id);
    assert.equal(stored[0].title,'Поиск исполнителя завершён');
    assert.equal(await t.app.auction.flushPendingNoPerformerAlerts(),0,
      'second delivery must not duplicate an already committed inbox message');
    const again=await t.db.query(
      `select id from notifications where data->>'orderId'=$1
         and data ? 'terminalEventId'`,[order.id]);
    assert.equal(again.length,1);
  }finally{await t.close();}
});
