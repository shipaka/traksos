import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setup,ok} from './helpers.ts';

test('availability changes refresh both devices of the performer, never unrelated users',async()=>{
  const t=await setup();
  try {
    const master=await t.login('+79992223344','master');
    const second=await t.login('+79992223344','master');
    const other=await t.login('+79991112233');
    assert.equal(second.id,master.id);
    ok(await t.api('PUT','/api/performer/profile',{
      kind:'master',name:'Тестовый мастер',specialties:['electric'],
    },master.token));
    const firstEvents:any[]=[],secondEvents:any[]=[],foreignEvents:any[]=[];
    const socket=(events:any[])=>({readyState:1,send:(data:string)=>events.push(JSON.parse(data))});
    t.app.hub.add(master.id,socket(firstEvents));
    t.app.hub.add(second.id,socket(secondEvents));
    t.app.hub.add(other.id,socket(foreignEvents));
    const hints=(events:any[])=>events.filter(e=>e.type==='performer_availability_changed');
    const expected={type:'performer_availability_changed'};
    const check=(count:number)=>{
      assert.deepEqual(hints(firstEvents),Array.from({length:count},()=>expected));
      assert.deepEqual(hints(secondEvents),hints(firstEvents));
      assert.deepEqual(hints(foreignEvents),[]);
    };
    const read=async()=>ok(await t.api('GET','/api/me',undefined,second.token)).performer;
    ok(await t.api('POST','/api/performer/line',{lineStatus:'offline'},master.token));
    check(1);
    assert.equal((await read()).line_status,'offline');
    const until=new Date(t.clock.now().getTime()+30*60000).toISOString();
    ok(await t.api('POST','/api/performer/line',{lineStatus:'busy',busyUntil:until},master.token));
    check(2);
    assert.equal((await read()).line_status,'busy');
    assert.equal(new Date((await read()).busy_until).toISOString(),until);
    ok(await t.api('POST','/api/performer/line',{paused:true},master.token));
    check(3);
    assert.equal((await read()).paused,true);
    assert.equal(new Date((await read()).busy_until).toISOString(),until);
    ok(await t.api('POST','/api/performer/line',{paused:false},master.token));
    check(4);
    assert.equal((await read()).paused,false);
    assert.equal(new Date((await read()).busy_until).toISOString(),until);
    t.clock.advance(31*60);
    await t.app.orders.tick();
    assert.equal((await read()).line_status,'online');
    ok(await t.api('PUT','/api/performer/extras',{vacation:true},master.token));
    check(5);
    assert.equal((await read()).extras.vacation,true);
    ok(await t.api('PUT','/api/performer/extras',{weekendPct:20},master.token));
    check(5);
    const profile={kind:'master',name:'Тестовый мастер',specialties:['electric']};
    ok(await t.api('PUT','/api/performer/request-settings',{profile,extras:{vacation:false}},master.token));
    check(6);
    assert.equal((await read()).extras.vacation,false);
    ok(await t.api('PUT','/api/performer/request-settings',{profile,extras:{vacation:true}},master.token));
    check(7);
    assert.equal((await read()).extras.vacation,true);
    ok(await t.api('PUT','/api/performer/extras',{vacation:false},master.token));
    check(8);
    assert.equal((await read()).extras.vacation,false);
    const days={mon:true,tue:true,wed:true,thu:true,fri:true,sat:false,sun:false};
    ok(await t.api('PUT','/api/performer/schedule',{on:true,days,from:'09:00',to:'18:00',phoneTo:'20:00'},master.token));
    check(9);
    assert.equal((await read()).schedule.on,true);
    const invalid=await t.api('POST','/api/performer/line',{lineStatus:'busy'},master.token);
    assert.ok(invalid.status>=400);
    check(9);
    const denied=await t.api('POST','/api/performer/line',{lineStatus:'offline'},other.token);
    assert.ok(denied.status>=400);
    check(9);
  } finally {await t.close();}
});
