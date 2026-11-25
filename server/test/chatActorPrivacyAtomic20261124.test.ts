// MEGA-BATCH-CHAT-TRAKBOT-MAP-DEMO-20261124
// Real HTTP + disposable PostgreSQL. No production data or customer communications.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, ok } from './helpers.ts';

const phone=(n:number)=>'+7999777'+String(n).padStart(4,'0');
const vehicleBody=(n:number)=>({brand:'Scania',model:'R',year:2018,plate:'А'+String(n).padStart(3,'0')+'АА178'});
const orderBody=(vehicleId:string)=>({
  service:'electric',isSos:true,problem:'no_start',
  description:'Проверка электрики и стартера после остановки',
  zoneId:'spb',regionId:'spb',address:'Санкт-Петербург, тестовая стоянка',
  lat:59.95,lng:30.35,vehicleId,
});

test('Chat: invited but NOT selected performer sees limited order preview, never private chat or history',async()=>{
  const t=await setup();
  try{
    const owner=await t.login(phone(4201));
    const candidate=await t.login(phone(4202),'master');
    const v=ok(await t.api('POST','/api/vehicles',vehicleBody(451),owner.token));
    const order=ok(await t.api('POST','/api/orders',orderBody(v.id),owner.token)).order;
    assert.ok(order.id);
    // In the standalone test there is no online master, so dispatch normally
    // ends in no_performer. Explicitly retain an OPEN status to test chat ACL.
    await t.db.query("update orders set status='searching' where id=$1",[order.id]);
    ok(await t.api('POST',`/api/orders/${order.id}/messages`,
      {body:'Private owner-chat content 452'},owner.token));
    await t.db.query(`
      insert into order_dispatch(order_id,performer_id,rank,status)
      values ($1,$2,1,'ringing')
      on conflict (order_id,performer_id) do update set status='ringing'`,[order.id,candidate.id]);
    const limited=await t.api('GET',`/api/orders/${order.id}`,undefined,candidate.token);
    assert.equal(limited.status,200,'invited candidate retains redacted order preview');
    const chat=await t.api('GET',`/api/orders/${order.id}/messages`,undefined,candidate.token);
    assert.equal(chat.status,403,'invitation is not authority to read customer chat');
    const posting=await t.api('POST',`/api/orders/${order.id}/messages`,
      {body:'Candidate tries to write before winning'},candidate.token);
    assert.ok(posting.status===400||posting.status===403,'invitation is not authority to write');
    const ownerChat=ok(await t.api('GET',`/api/orders/${order.id}/messages`,undefined,owner.token));
    assert.ok(ownerChat.messages.some((m:any)=>m.body.includes('Private owner-chat')));
    await t.db.query("update orders set status='no_performer' where id=$1",[order.id]);
    assert.equal((await t.api('POST',`/api/orders/${order.id}/messages`,
      {body:'A terminal order must not reopen chat'},owner.token)).status,409,
      'real terminal chat state remains a business constraint');
    for(const cursor of ['-1','Infinity','NaN','2.5','9007199254740992']){
      assert.equal((await t.api('GET',`/api/orders/${order.id}/messages?after=${cursor}`,
        undefined,owner.token)).status,400,'invalid pagination cursor must not query DB');
    }
  }finally{await t.close();}
});

test('Chat: revoked fleet driver loses read/write rights, owner retains records',async()=>{
  const t=await setup();
  try{
    const owner=await t.login(phone(4203));
    const driver=await t.login(phone(4204),'driver');
    const v=ok(await t.api('POST','/api/vehicles',vehicleBody(452),owner.token));
    const fleet=ok(await t.api('GET','/api/fleet',undefined,owner.token));
    const qr=fleet.cars.find((x:any)=>x.id===v.id)?.qrCode;
    assert.ok(qr);
    ok(await t.api('POST',`/api/qr/${qr}/join`,{},driver.token));
    const order=ok(await t.api('POST','/api/orders',orderBody(v.id),driver.token)).order;
    await t.db.query("update orders set status='searching' where id=$1",[order.id]);
    ok(await t.api('POST',`/api/orders/${order.id}/messages`,
      {body:'Private driver incident details'},driver.token));
    const before=ok(await t.api('GET',`/api/orders/${order.id}/messages`,undefined,driver.token));
    assert.ok(before.messages.some((m:any)=>m.body.includes('Private driver incident')));
    ok(await t.api('POST',`/api/fleet/vehicles/${v.id}/new-qr`,{},owner.token));
    assert.equal((await t.api('GET',`/api/orders/${order.id}/messages`,undefined,driver.token)).status,403);
    assert.equal((await t.api('POST',`/api/orders/${order.id}/messages`,
      {body:'After fleet reassignment'},driver.token)).status,403);
    const ownerChat=ok(await t.api('GET',`/api/orders/${order.id}/messages`,undefined,owner.token));
    assert.ok(ownerChat.messages.some((m:any)=>m.body.includes('Private driver incident')));
    assert.ok(ownerChat.participants.every((x:any)=>x.who!=='driver'),
      'historical creator must not be shown as active driver participant');
  }finally{await t.close();}
});

test('Chat: failure of optional notification must NOT make committed user message fail and invite duplicates',async()=>{
  const t=await setup();
  try{
    const owner=await t.login(phone(4205));
    const driver=await t.login(phone(4206),'driver');
    const v=ok(await t.api('POST','/api/vehicles',vehicleBody(453),owner.token));
    const fleet=ok(await t.api('GET','/api/fleet',undefined,owner.token));
    const qr=fleet.cars.find((x:any)=>x.id===v.id)?.qrCode;
    assert.ok(qr);
    ok(await t.api('POST',`/api/qr/${qr}/join`,{},driver.token));
    // A currently linked driver is an actual recipient; failure of that
    // recipient's inbox will be injected below.
    const order=ok(await t.api('POST','/api/orders',orderBody(v.id),driver.token)).order;
    await t.db.query("update orders set status='searching' where id=$1",[order.id]);
    await t.db.exec(`
      create function reject_chat_push_20261124() returns trigger
      language plpgsql as $$ begin
        if new.kind='chat_push' then raise exception 'synthetic notification outage'; end if;
        return new;
      end; $$;
      create trigger reject_chat_push_20261124 before insert on notifications
        for each row execute function reject_chat_push_20261124();
    `);
    const posted=ok(await t.api('POST',`/api/orders/${order.id}/messages`,
      {body:'One final committed message despite optional push outage'},owner.token));
    assert.ok(posted.id);
    const count=await t.db.one<{n:number}>(
      'select count(*)::int as n from chat_messages where order_id=$1 and sender_id=$2 and body=$3',
      [order.id,owner.id,'One final committed message despite optional push outage']);
    assert.equal(count?.n,1);
    const received=await t.db.one<{n:number}>(
      `select count(*)::int as n from notifications
        where user_id=$1 and kind='chat_push' and data->>'orderId'=$2`,
      [driver.id,order.id]);
    assert.equal(received?.n,0,'injected durable inbox failure was actually exercised');
    await t.db.exec(`
      drop trigger reject_chat_push_20261124 on notifications;
      drop function reject_chat_push_20261124();
    `);
  }finally{await t.close();}
});


test('Chat: captured staff permissions are revoked and a failed recipient lookup cannot undo a committed post',
  {timeout:60000},async()=>{
  const t=await setup();
  try{
    const admin=await t.login('+79990000001');
    const owner=await t.login(phone(4207));
    const vehicle=ok(await t.api('POST','/api/vehicles',vehicleBody(454),owner.token));
    const order=ok(await t.api('POST','/api/orders',orderBody(vehicle.id),owner.token)).order;
    await t.db.query("update orders set status='searching' where id=$1",[order.id]);
    const capturedAdmin=await t.db.one<any>('select * from users where id=$1',[admin.id]);
    const capturedOwner=await t.db.one<any>('select * from users where id=$1',[owner.id]);
    const {ChatService}=await import('../src/services/chat.ts');
    let lookups=0;
    const svc=new ChatService(t.db,t.app.settings,{} as any,{
      mustSee:async()=>({id:order.id}),
      participants:async()=>{lookups++;throw Error('synthetic recipient lookup failure');},
    } as any);
    await t.db.query("update users set roles=array['client']::text[] where id=$1",[admin.id]);
    await assert.rejects(svc.list(capturedAdmin,order.id),/только участникам/);
    await assert.rejects(svc.post(capturedAdmin,order.id,'Former staff message'),/только участникам/);
    assert.equal(lookups,0);
    const posted=await svc.post(capturedOwner,order.id,'Committed despite recipient lookup failure');
    assert.ok(posted.id);
    assert.equal(lookups,1);
    const history=await svc.list(capturedOwner,order.id);
    assert.equal(history.messages.filter((m:any)=>m.body==='Committed despite recipient lookup failure').length,1);
    assert.equal(history.messages.some((m:any)=>m.body==='Former staff message'),false);
  }finally{await t.close();}
});
