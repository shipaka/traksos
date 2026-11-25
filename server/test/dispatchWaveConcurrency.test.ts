import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setup,ok} from './helpers.ts';

test('concurrent dispatch ticks claim capacity and one auction wave; cancellation rejects late inserts', {timeout:90000},async()=>{
  const t=await setup();
  try{
    const admin=await t.login('+79990000001');
    const client=await t.login('+79995773301');
    const workers=[];
    for(let i=2;i<=5;i++){
      const worker=await t.login('+7999577330'+i,'master');
      workers.push(worker);
      ok(await t.api('PUT','/api/performer/profile',{kind:'master',name:'Тестовый мастер '+i,
        specialties:['electric'],taxStatus:'self_employed',inn:'780000000001'},worker.token));
      ok(await t.api('POST','/api/admin/performers/'+worker.id+'/verify',{decision:'approved'},admin.token));
      ok(await t.api('POST','/api/performer/line',{lineStatus:'online'},worker.token));
    }
    ok(await t.api('PUT','/api/admin/settings/dispatch',{priorityFirst:false,parallel:2},admin.token));
    const id=ok(await t.api('POST','/api/orders',{
      service:'electric',zoneId:'spb',paymentMethod:'cash'
    },client.token)).order.id as string;
    // Reset only this synthetic fixture to an unclaimed search wave.
    const reset=async()=>{
      await t.db.query('delete from order_dispatch where order_id=$1',[id]);
      await t.db.query("update orders set auction_until=null,status='searching' where id=$1",[id]);
    };
    const count=async(type:string)=>Number((await t.db.one<{c:number}>(
      'select count(*)::int c from order_events where order_id=$1 and type=$2',[id,type]))?.c??0);
    const rows=()=>t.db.query<{performer_id:string;status:string}>(
      'select performer_id,status from order_dispatch where order_id=$1 order by rank',[id]);
    await reset();
    for(const [i,worker] of workers.entries())
      await t.db.query("insert into order_dispatch(order_id,performer_id,rank,status) values($1,$2,$3,'queued')",[id,worker.id,i]);
    await t.db.query("update users set status='blocked' where id=$1",[workers[0].id]);
    const ringBefore=await count('ringing');
    await Promise.all(Array.from({length:12},()=>t.app.orders.ringNext(id)));
    const active=(await rows()).filter(x=>x.status==='ringing');
    assert.equal(active.length,2);
    assert.ok(active.every(x=>x.performer_id!==workers[0].id));
    assert.equal(await count('ringing'),ringBefore+2);
    for(const r of active)assert.equal(t.app.hub.log.filter(x=>
      x.userId===r.performer_id&&x.event.type==='incoming_call'&&x.event.orderId===id).length,1);
    await t.db.query("update users set status='active' where id=$1",[workers[0].id]);
    await reset();
    const waveBefore=await count('auction_started');
    await Promise.all(Array.from({length:12},()=>t.app.auction.start(id)));
    assert.equal(await count('auction_started'),waveBefore+1);
    assert.equal((await rows()).filter(x=>x.status==='bidding').length,4);
    await reset();
    const beforeCancel=await count('auction_started');
    let entered!:()=>void,resume!:()=>void;
    const enteredPromise=new Promise<void>(r=>{entered=r;});
    const gate=new Promise<void>(r=>{resume=r;});
    const original=t.app.orders.enlist.bind(t.app.orders);
    let first=true;
    t.app.orders.enlist=async(...args:Parameters<typeof original>)=>{
      if(first){first=false;entered();await gate;}
      return original(...args);
    };
    const inFlight=t.app.auction.start(id);
    try{
      await Promise.race([enteredPromise,inFlight.then(()=>{throw Error('wave did not reach invitation');})]);
      ok(await t.api('POST','/api/orders/'+id+'/cancel',{reason:'Отмена тестового поиска'},client.token));
    }finally{
      resume();
      try{await inFlight;}finally{t.app.orders.enlist=original;}
    }
    assert.equal((await t.db.one<{status:string}>('select status from orders where id=$1',[id]))?.status,'cancelled');
    assert.equal((await rows()).length,0,'cancelled wave must not insert late invitations');
    assert.equal(await count('auction_started'),beforeCancel,'cancelled wave cannot publish a new search event');
  }finally{await t.close();}
});
