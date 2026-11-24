import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, ok } from './helpers.ts';

const phone=(n:number)=>'+7999775'+String(n).padStart(4,'0');

test('revoked fleet claimant cannot reopen, read, appeal or approve historical warranty; owner and workers retain access', {timeout:60000},async()=>{
  const t=await setup();
  try{
    const admin=await t.login('+79990000001');
    const owner=await t.login(phone(1201));
    const formerDriver=await t.login(phone(1202),'driver');
    const replacement=await t.login(phone(1203),'driver');
    const performer=await t.login(phone(1204),'master');
    ok(await t.api('PUT','/api/performer/profile',{
      kind:'master',name:'Мастер гарантийного выезда',specialties:['electric'],
      taxStatus:'self_employed',inn:'780000001201',
    },performer.token));
    ok(await t.api('POST',`/api/admin/performers/${performer.id}/verify`,
      {decision:'approved'},admin.token));
    ok(await t.api('POST','/api/performer/line',{lineStatus:'online'},performer.token));

    const car=ok(await t.api('POST','/api/vehicles',{
      brand:'Scania',model:'R',year:2018,plate:'А321АА178',
    },owner.token));
    const otherCar=ok(await t.api('POST','/api/vehicles',{
      brand:'Scania',model:'G',year:2017,plate:'А322АА178',
    },owner.token));
    const fleet=ok(await t.api('GET','/api/fleet',undefined,owner.token));
    const qr=fleet.cars.find((v:any)=>v.id===car.id)?.qrCode;
    assert.ok(qr,'new vehicle has a QR code');
    ok(await t.api('POST',`/api/qr/${qr}/join`,{},formerDriver.token));

    const order=ok(await t.api('POST','/api/orders',{
      service:'electric',isSos:true,paymentMethod:'cash',problem:'no_start',
      description:'После остановки не заряжает генератор',zoneId:'spb',regionId:'spb',
      address:'Санкт-Петербург, тестовая стоянка',lat:59.95,lng:30.35,vehicleId:car.id,
    },formerDriver.token)).order;
    ok(await t.api('POST',`/api/orders/${order.id}/offers`,{},performer.token));
    const offers=ok(await t.api('GET',`/api/orders/${order.id}/offers`,undefined,formerDriver.token));
    assert.ok(offers.offers?.length);
    ok(await t.api('POST',`/api/orders/${order.id}/offers/${offers.offers[0].id}/choose`,
      {},formerDriver.token));
    ok(await t.api('POST',`/api/orders/${order.id}/step`,{action:'arrive'},performer.token));
    ok(await t.api('POST',`/api/orders/${order.id}/amount`,{
      extras:[{name:'Диагностика генератора',amount:40000}],result:'solved',
    },performer.token));
    ok(await t.api('POST',`/api/orders/${order.id}/confirm`,{},formerDriver.token));

    const details={defect:'После ремонта повторно пропала зарядка генератора и загорелась лампа',
      requestedRemedy:'rework'};
    const claim=ok(await t.api('POST',`/api/orders/${order.id}/warranty-claims`,
      details,formerDriver.token));
    assert.equal((await t.api('GET',`/api/warranty-claims/${claim.id}`,
      undefined,formerDriver.token)).status,200);
    assert.ok(ok(await t.api('GET','/api/warranty-claims',undefined,
      formerDriver.token)).some((x:any)=>x.id===claim.id));
    assert.equal((await t.api('GET',`/api/warranty-claims/${claim.id}`,undefined,owner.token)).status,200);
    assert.equal((await t.api('GET',`/api/warranty-claims/${claim.id}`,undefined,performer.token)).status,200);

    // Changing to ANOTHER car in the same fleet must revoke the old car's
    // access even though users.owner_id and the historical filed_by stay equal.
    ok(await t.api('POST',`/api/vehicles/${otherCar.id}/driver`,
      {phone:phone(1202)},owner.token));
    const assigned=await t.db.one<{driver_id:string|null}>(
      'select driver_id from vehicles where id=$1',[car.id]);
    assert.equal(assigned?.driver_id,null);
    assert.equal((await t.db.one<{owner_id:string|null}>(
      'select owner_id from users where id=$1',[formerDriver.id]))?.owner_id,owner.id);

    assert.equal((await t.api('POST',`/api/orders/${order.id}/warranty-claims`,
      details,formerDriver.token)).status,403,'historical created_by cannot open');
    assert.equal((await t.api('GET',`/api/warranty-claims/${claim.id}`,
      undefined,formerDriver.token)).status,403,'historical filed_by cannot view');
    assert.equal(ok(await t.api('GET','/api/warranty-claims',undefined,
      formerDriver.token)).some((x:any)=>x.id===claim.id),false);
    assert.equal((await t.api('POST',`/api/warranty-claims/${claim.id}/evidence`,
      {note:'Бывший водитель пишет в чужую гарантию'},formerDriver.token)).status,403);
    assert.equal((await t.api('GET',`/api/warranty-claims/${claim.id}`,
      undefined,replacement.token)).status,403,'another driver is not the filer');
    assert.equal((await t.api('GET',`/api/warranty-claims/${claim.id}`,
      undefined,owner.token)).status,200,'vehicle owner keeps the claim');

    const oldAlerts=await t.db.one<{n:number}>(
      "select count(*)::int as n from notifications where user_id=$1 and kind='warranty'",
      [formerDriver.id]);
    ok(await t.api('POST',`/api/admin/warranty-claims/${claim.id}/decide`,{
      decision:'repair_by_original',
      note:'Контрольная проверка подтвердила необходимость бесплатного исправления ремонта',
    },admin.token));
    const latestAlerts=await t.db.one<{n:number}>(
      "select count(*)::int as n from notifications where user_id=$1 and kind='warranty'",
      [formerDriver.id]);
    assert.equal(latestAlerts?.n,oldAlerts?.n,'revoked driver must not receive a verdict inbox alert');
    assert.equal((await t.api('POST',`/api/warranty-claims/${claim.id}/appeal`,{
      reason:'Бывший водитель пробует возобновить доступ по старому UUID',
    },formerDriver.token)).status,403);

    const remedyPayload={performerId:performer.id,budgetKopecks:0,
      task:'Бесплатно повторить проверку проводки и генератора с актом исправления'};
    const offerPath=`/api/admin/warranty-claims/${claim.id}/remedies`;
    // A failure inserting the offer inbox must roll back the entire offer,
    // including its event and audit. A retry can then create it normally.
    await t.db.exec(`create function fail_warranty_remedy_inbox() returns trigger language plpgsql as $
      begin
        if new.kind='warranty' and new.data->>'jobId' is not null then
          raise exception 'warranty remedy inbox fault';
        end if;
        return new;
      end; $;
      create trigger fail_warranty_remedy_inbox before insert on notifications
      for each row execute function fail_warranty_remedy_inbox();`);
    try {
      const failed=await t.api('POST',offerPath,remedyPayload,admin.token);
      assert.ok(failed.status>=400,'inbox fault must not return success');
      assert.equal((await t.db.one<{n:number}>(
        'select count(*)::int as n from warranty_rework_jobs where claim_id=$1',[claim.id]))?.n,0);
    } finally {
      await t.db.exec('drop trigger fail_warranty_remedy_inbox on notifications; drop function fail_warranty_remedy_inbox();');
    }
    const first=ok(await t.api('POST',offerPath,remedyPayload,admin.token));
    const repeated=ok(await t.api('POST',offerPath,remedyPayload,admin.token));
    assert.equal(repeated.id,first.id);
    assert.equal((await t.db.one<{n:number}>(
      "select count(*)::int as n from notifications where kind='warranty' and data->>'jobId'=$1",[first.id]))?.n,2,
      'one durable inbox per recipient, no duplicate on retry');
    const respondPath=`/api/warranty-remedies/${first.id}/respond`;
    for(let i=0;i<2;i++){
      const declined=ok(await t.api('POST',respondPath,{accept:false},performer.token));
      assert.equal(declined.status,'declined');
    }
    const declinedRow=await t.db.one<{accepted_at:Date|null;updated_at:Date|null}>(
      'select accepted_at,updated_at from warranty_rework_jobs where id=$1',[first.id]);
    assert.ok(declinedRow?.updated_at,'declining never clears updated_at');
    assert.equal(declinedRow?.accepted_at,null);
    assert.equal((await t.db.one<{n:number}>(
      "select count(*)::int as n from warranty_rework_events where job_id=$1 and event='declined'",[first.id]))?.n,1);
    const remedied=ok(await t.api('POST',offerPath,remedyPayload,admin.token));
    assert.notEqual(remedied.id,first.id,'declined offer can be replaced');
    assert.equal((await t.api('GET',`/api/warranty-remedies/${remedied.id}`,
      undefined,formerDriver.token)).status,403);
    assert.equal((await t.api('GET',`/api/warranty-claims/${claim.id}/remedies`,
      undefined,formerDriver.token)).status,403);
    assert.equal((await t.api('POST',`/api/warranty-remedies/${remedied.id}/client-approval`,
      {approve:true},formerDriver.token)).status,403);
    assert.equal((await t.api('POST',`/api/warranty-remedies/${remedied.id}/confirm`,
      {},formerDriver.token)).status,403);
    assert.equal((await t.api('GET',`/api/warranty-remedies/${remedied.id}`,
      undefined,owner.token)).status,200);
    assert.equal((await t.api('GET',`/api/warranty-remedies/${remedied.id}`,
      undefined,performer.token)).status,200);

    ok(await t.api('POST',`/api/warranty-remedies/${remedied.id}/client-approval`,
      {approve:true},owner.token));
    ok(await t.api('POST',`/api/warranty-remedies/${remedied.id}/respond`,
      {accept:true},performer.token));
    ok(await t.api('POST',`/api/warranty-remedies/${remedied.id}/report`,{
      report:'Заново проверена электросистема, результат устойчивый, зарядка восстановлена',
    },performer.token));
    assert.equal((await t.api('POST',`/api/warranty-remedies/${remedied.id}/confirm`,
      {},formerDriver.token)).status,403);
    const final=ok(await t.api('POST',`/api/warranty-remedies/${remedied.id}/confirm`,
      {},owner.token));
    assert.equal(final.status,'client_confirmed');
    assert.equal((await t.db.query('select id from warranty_platform_expenses')).length,0,
      'rework does not trigger a cash expense or new payment');
  }finally{await t.close();}
});
