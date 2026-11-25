import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, ok } from './helpers.ts';

test('request settings: profile matching and extra conditions save together, with existing APIs preserved',
  {timeout:60000}, async () => {
  const t=await setup();
  try {
    const master=await t.login('+79997103501','master');
    const client=await t.login('+79997103502');
    ok(await t.api('PUT','/api/performer/profile', {
      kind:'master',name:'Мастер настройки',specialties:['electric'],
      brands:{Scania:'good'}, tier:'eco',
    }, master.token));

    const profile={kind:'master',specialties:['electric','diag'],
      brands:{Scania:'excellent',MAN:'refuse'},tier:'comfort',
      callOutPrice:250_000,hourPrice:250_000,acceptsGroup:false};
    const extras={stock:['Сканер под марку','Клеммы АКБ'],prepay:'low'};

    const result=ok(await t.api('PUT','/api/performer/request-settings',{profile,extras},master.token));
    assert.deepEqual(result.specialties,['electric','diag']);
    assert.equal(result.brands.Scania,'excellent');
    assert.equal(result.brands.MAN,'refuse');
    assert.equal(result.tier,'comfort');
    assert.equal(result.accepts_group,false);
    assert.deepEqual(result.extras.stock,extras.stock);
    assert.equal(result.extras.prepay,'low');

    const later=ok(await t.api('GET','/api/performer/profile',undefined,master.token));
    assert.deepEqual(later.specialties,result.specialties);
    assert.deepEqual(later.extras.stock,extras.stock);

    // The existing single-section endpoint must keep working for other
    // profile screens, without losing the new extras.
    ok(await t.api('PUT','/api/performer/profile',{kind:'master',brands:{Scania:'good'}},master.token));
    const retained=ok(await t.api('GET','/api/performer/profile',undefined,master.token));
    assert.equal(retained.brands.Scania,'good');
    assert.deepEqual(retained.extras.stock,extras.stock);

    const denied=await t.api('PUT','/api/performer/request-settings',{profile,extras},client.token);
    assert.equal(denied.status,403,'client cannot modify performer request settings');
    const wrongRole=await t.api('PUT','/api/performer/request-settings',{
      profile:{kind:'tow'},extras,
    },master.token);
    assert.equal(wrongRole.status,400,'a master must not switch role through a filter screen');
    const still=ok(await t.api('GET','/api/performer/profile',undefined,master.token));
    assert.equal(still.kind,'master');

    const invalid=await t.api('PUT','/api/performer/request-settings',{
      profile:{...profile,tier:'premium'},
      extras:{stock:['Не должно сохраниться']},
    },master.token);
    assert.equal(invalid.status,400);
    assert.deepEqual((await t.db.one<any>('select extras from performer_profiles where user_id=$1',[master.id]))?.extras.stock,
      extras.stock,'invalid profile payload does not modify extras');
  } finally {await t.close();}
});

test('request settings: database failure on extras rolls back changes to profile and user name',
  {timeout:60000}, async () => {
  const t=await setup();
  try {
    const master=await t.login('+79997103511','master');
    ok(await t.api('PUT','/api/performer/profile',{
      kind:'master',name:'Имя до',specialties:['electric'],brands:{Scania:'good'},tier:'eco',
    },master.token));
    ok(await t.api('PUT','/api/performer/extras',{stock:['Предохранители']},master.token));
    const before=await t.db.one<any>('select name from users where id=$1',[master.id]);

    // Simulate a database failure AFTER the performer profile update and
    // BEFORE the request has committed; changes must be atomic.
    await t.db.exec(`
      create function fail_request_extras() returns trigger language plpgsql as $$
      begin
        if new.extras->'stock' ? 'CI_ATOMIC_FAIL' then
          raise exception 'test rollback of request settings';
        end if;
        return new;
      end
      $$;
      create trigger test_request_atomic before update of extras on performer_profiles
        for each row execute function fail_request_extras();
    `);
    const result=await t.api('PUT','/api/performer/request-settings',{
      profile:{kind:'master',name:'Имя после',tier:'pro',brands:{Scania:'excellent'}},
      extras:{stock:['CI_ATOMIC_FAIL']},
    },master.token);
    assert.ok(result.status >= 400,'simulated SQL failure must reject combined save');
    const after=ok(await t.api('GET','/api/performer/profile',undefined,master.token));
    assert.equal(after.tier,'eco','tier rollback');
    assert.equal(after.brands.Scania,'good','brand rollback');
    assert.deepEqual(after.extras.stock,['Предохранители'],'extras rollback');
    assert.equal((await t.db.one<any>('select name from users where id=$1',[master.id]))?.name,
      before?.name,'user name rollback');
  } finally {await t.close();}
});

test('request settings: tow operator must explicitly acknowledge assembly time',
  {timeout:60000}, async () => {
  const t=await setup();
  try {
    const tow=await t.login('+79997103521','tow');
    ok(await t.api('PUT','/api/performer/profile',{
      kind:'tow',name:'Эвакуация',prepMinutes:15,
    },tow.token));
    const rejected=await t.api('PUT','/api/performer/request-settings',{
      profile:{kind:'tow',prepMinutes:60},
      extras:{takes:['tractor'],prepAck:false},
    },tow.token);
    assert.equal(rejected.status,400);
    let p=ok(await t.api('GET','/api/performer/profile',undefined,tow.token));
    assert.equal(p.prep_minutes,15);
    assert.ok(!p.extras.takes,'no half-saved allowed cargo on failed acknowledgement');

    const accepted=ok(await t.api('PUT','/api/performer/request-settings',{
      profile:{kind:'tow',prepMinutes:45,kmRate:11_000},
      extras:{takes:['tractor','semitrailer'],prepAck:true,towType:'partial',maxMass:20},
    },tow.token));
    assert.equal(accepted.prep_minutes,45);
    assert.deepEqual(accepted.extras.takes,['tractor','semitrailer']);
    assert.equal(accepted.extras.maxMass,20);
    p=ok(await t.api('GET','/api/performer/profile',undefined,tow.token));
    assert.equal(p.prep_minutes,45);
  } finally {await t.close();}
});
