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

test('terminal alert queue stores one inbox row per participant under concurrent workers', async () => {
  const { setup } = await import('./helpers.ts');
  const t=await setup();
  try {
    const owner=await t.login('+79990003563','client');
    const driver=await t.login('+79990003564','driver');
    const order=await t.db.one<{id:string}>(`
      insert into orders(client_id,created_by,service,zone_id,status,estimate)
      values ($1,$2,'hydraulics','spb','searching',$3::jsonb) returning id`,
      [owner.id,driver.id,JSON.stringify({callOut:100000,zoneName:'СПб'})]);
    assert.ok(order);
    // Hold the inbox storage unavailable while the terminal search commits,
    // so multiple drainers really race to claim the same pending intents.
    await t.db.exec(`create function traksos_test_block_no_performer_notice()
      returns trigger language plpgsql as $$
      begin raise exception 'temporary notification storage failure'; end $$;
      create trigger traksos_test_block_no_performer_notice
      before insert on notifications for each statement
      execute function traksos_test_block_no_performer_notice();`);
    try {
      await t.app.auction.start(order.id);
    } finally {
      await t.db.exec(`drop trigger if exists traksos_test_block_no_performer_notice on notifications;
        drop function if exists traksos_test_block_no_performer_notice();`);
    }
    const queued=await t.db.query<{user_id:string}>(
      'select user_id from order_no_performer_alerts where order_id=$1',[order.id]);
    assert.deepEqual(queued.map(r=>r.user_id).sort(),[owner.id,driver.id].sort());
    const handled=await Promise.all([
      t.app.auction.flushPendingNoPerformerAlerts(),
      t.app.auction.flushPendingNoPerformerAlerts(),
    ]);
    assert.equal(handled.reduce((a,b)=>a+b,0),2,
      'FOR UPDATE SKIP LOCKED must not deliver one alert twice');
    const alerts=await t.db.query<{user_id:string}>(
      `select user_id from notifications where data->>'orderId'=$1
       and data ? 'terminalEventId'`,[order.id]);
    assert.deepEqual(alerts.map(r=>r.user_id).sort(),[owner.id,driver.id].sort());
    assert.equal(await t.app.auction.flushPendingNoPerformerAlerts(),0);
  } finally {await t.close();}
});

test('a retry supersedes an old pending no-performer alert', async () => {
  const { setup } = await import('./helpers.ts');
  const t=await setup();
  try {
    const client=await t.login('+79990003565','client');
    const order=await t.db.one<{id:string}>(`
      insert into orders(client_id,created_by,service,zone_id,status,estimate)
      values ($1,$1,'hydraulics','spb','searching',$2::jsonb) returning id`,
      [client.id,JSON.stringify({callOut:100000,zoneName:'СПб'})]);
    assert.ok(order);
    await t.db.exec(`create function traksos_test_block_old_alert()
      returns trigger language plpgsql as $$
      begin raise exception 'temporary notification storage failure'; end $$;
      create trigger traksos_test_block_old_alert
      before insert on notifications for each statement
      execute function traksos_test_block_old_alert();`);
    try {
      await t.app.auction.start(order.id);
    } finally {
      await t.db.exec(`drop trigger if exists traksos_test_block_old_alert on notifications;
        drop function if exists traksos_test_block_old_alert();`);
    }
    await t.db.query(
      `update orders set status='searching' where id=$1 and status='no_performer'`,
      [order.id]);
    assert.equal(await t.app.auction.flushPendingNoPerformerAlerts(),0,
      'do not deliver stale terminal message after a new search starts');
    const obsolete=await t.db.one<{outcome:string}>(
      'select outcome from order_no_performer_alerts where order_id=$1',[order.id]);
    assert.equal(obsolete?.outcome,'obsolete');
    const notifications=await t.db.query(
      `select id from notifications where data->>'orderId'=$1
       and data ? 'terminalEventId'`,[order.id]);
    assert.equal(notifications.length,0);
  } finally {await t.close();}
});

test('real auction: nearby offline specialist reports temporary unavailability; absent GPS stays unknown', async () => {
  const { setup } = await import('./helpers.ts');
  const t = await setup();
  try {
    const client = await t.login('+79990003569', 'client');
    const offline = await t.login('+79990003570', 'master');
    // A real, active specialist is registered for this exact direction.
    // Offline is not the same thing as no connected partners.
    await t.db.query(
      `insert into performer_profiles(user_id,kind,specialties,verification,line_status,lat,lng)
       values ($1,'master',$2::text[],'approved','offline',59.934,30.335)
       on conflict(user_id) do update set
         specialties=excluded.specialties,verification=excluded.verification,
         line_status=excluded.line_status,lat=excluded.lat,lng=excluded.lng`,
      [offline.id,['hydraulics']]);
    for (const [lat,lng,expected] of [
      [59.934,30.335,'temporarily_unavailable'],
      [null,null,'unknown'],
    ] as const) {
      const order=await t.db.one<{id:string}>(
        `insert into orders(client_id,created_by,service,zone_id,status,estimate,lat,lng)
         values ($1,$1,'hydraulics','spb','searching',$2::jsonb,$3,$4)
         returning id`,
        [client.id,JSON.stringify({callOut:100000,zoneName:'СПб'}),lat,lng]);
      assert.ok(order);
      // Test the actual final status, event, and owner-visible API, not only
      // the pure classifier or a mocked response in the browser.
      await t.app.auction.start(order.id);
      const viewed=await t.api('GET',`/api/orders/${order.id}`,undefined,client.token);
      assert.equal(viewed.status,200);
      assert.equal(viewed.body.status,'no_performer');
      assert.equal(viewed.body.absenceReason,expected,
        'a location-free search cannot claim the offline worker is nearby');
      const events=await t.db.query<{reason:string}>(
        `select data->>'absenceReason' as reason from order_events
         where order_id=$1 and type='no_performer' order by id desc`,[order.id]);
      assert.equal(events.length,1);
      assert.equal(events[0].reason,expected);
    }
  } finally { await t.close(); }
});

test('fleet owner and submitting driver can see and retry their exhausted SOS, unrelated client cannot', async () => {
  const { setup } = await import('./helpers.ts');
  const t = await setup();
  try {
    const owner = await t.login('+79990003571', 'client');
    const driver = await t.login('+79990003572', 'driver');
    const stranger = await t.login('+79990003573', 'client');
    // A fleet driver's submitted SOS is owned by the fleet owner, while
    // created_by records the initiating driver. Both must have requester
    // rights; unrelated accounts must not see the terminal reason or retry.
    const order = await t.db.one<{id:string}>(`
      insert into orders(client_id,created_by,service,zone_id,status,estimate)
      values ($1,$2,'hydraulics','spb','searching',$3::jsonb) returning id`,
      [owner.id,driver.id,JSON.stringify({callOut:100000,zoneName:'СПб'})]);
    assert.ok(order);
    await t.app.auction.start(order.id);
    const url = '/api/orders/' + order.id;
    const [ownerView,driverView,foreignView] = await Promise.all([
      t.api('GET',url,undefined,owner.token),
      t.api('GET',url,undefined,driver.token),
      t.api('GET',url,undefined,stranger.token)
    ]);
    assert.equal(ownerView.status,200);
    assert.equal(driverView.status,200);
    assert.equal(foreignView.status,403,'unrelated client cannot learn absence reason');
    assert.equal(ownerView.body.status,'no_performer');
    assert.equal(driverView.body.status,'no_performer');
    assert.equal(ownerView.body.you,'client');
    assert.equal(driverView.body.you,'client',
      'submitting driver sees the same requester-only terminal card');
    assert.equal(driverView.body.absenceReason,ownerView.body.absenceReason);
    assert.ok(['not_connected','temporarily_unavailable','no_response',
      'offers_withdrawn','unknown'].includes(driverView.body.absenceReason));
    const forbiddenRetry = await t.api('POST',url+'/retry',{},stranger.token);
    assert.equal(forbiddenRetry.status,403,'outsider cannot restart someone else\'s SOS');
    const retried = await t.api('POST',url+'/retry',{},driver.token);
    assert.equal(retried.status,200,'submitting driver can retry their own SOS');
    assert.equal(retried.body.you,'client');
    const events = await t.db.query<{type:string;actor_id:string}>(`
      select type,actor_id from order_events
      where order_id=$1 and type='retry'`,[order.id]);
    assert.equal(events.length,1,'retry must not duplicate the transition');
    assert.equal(events[0].actor_id,driver.id);
    const stillForbidden = await t.api('GET',url,undefined,stranger.token);
    assert.equal(stillForbidden.status,403,'retry never expands requester ACL');
  } finally { await t.close(); }
});
