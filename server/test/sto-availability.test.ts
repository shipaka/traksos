import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setup,ok} from './helpers.ts';

test('station admission is independent of current repairs, hours and other stations',async()=>{
  const t=await setup();
  try{
    const admin=await t.login('+79990000001');
    const station=await t.login('+79995556677','service');
    const other=await t.login('+79995556678','service');
    const client=await t.login('+79991112233');
    const a=ok(await t.api('PUT','/api/base',{name:'Учебная СТО',address:'Учебная улица 1',hours:'08:00–20:00',staff:{electric:'own'}},station.token));
    const b=ok(await t.api('PUT','/api/base',{name:'Другая СТО',address:'Учебная улица 2'},other.token));
    const id=a.center.id;
    ok(await t.api('POST','/api/admin/services/'+id+'/verify',{decision:'approved'},admin.token));
    const day=new Date(t.clock.now().getTime()+3*3600000).toISOString().slice(0,10);
    const book={need:'electric',day,arrival:'self'};
    const booking=ok(await t.api('POST','/api/services/'+id+'/book',book,client.token));
    const events:any[]=[],foreign:any[]=[];
    const socket=(list:any[])=>({readyState:1,send:(data:string)=>list.push(JSON.parse(data))});
    t.app.hub.add(station.id,socket(events));t.app.hub.add(other.id,socket(foreign));
    const hints=(list:any[])=>list.filter(e=>e.type==='service_availability_changed');
    const read=()=>t.api('GET','/api/base/availability',undefined,station.token);
    assert.equal(ok(await read()).paused,false);
    assert.equal(ok(await t.api('PUT','/api/base/availability',{paused:true},station.token)).paused,true);
    assert.deepEqual(hints(events),[{type:'service_availability_changed'}]);
    assert.deepEqual(hints(foreign),[]);
    assert.equal(ok(await read()).hours,'08:00–20:00');
    assert.equal(ok(await t.api('GET','/api/base/availability',undefined,other.token)).paused,false);
    assert.equal((await t.api('POST','/api/services/'+id+'/book',book,client.token)).status,404);
    assert.equal(ok(await t.api('GET','/api/bookings/'+booking.id,undefined,client.token)).status,'new');
    assert.ok((await t.api('PUT','/api/base/availability',{paused:false,id:b.center.id},station.token)).status>=400);
    assert.ok((await t.api('PUT','/api/base/availability',{paused:false},client.token)).status>=400);
    assert.equal(hints(events).length,1);
    ok(await t.api('PUT','/api/base/availability',{paused:false},station.token));
    assert.equal(ok(await read()).paused,false);
    assert.equal(hints(events).length,2);
    await t.db.query("update users set roles=array['client']::text[] where id=$1",[station.id]);
    assert.ok((await t.api('PUT','/api/base/availability',{paused:true},station.token)).status>=400);
    assert.equal(hints(events).length,2);
  }finally{await t.close();}
});
