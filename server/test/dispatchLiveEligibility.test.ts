import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setup,ok} from './helpers.ts';

test('live dispatch eligibility is rechecked at call acceptance, bid submission and manual/automatic choice', {timeout:90000},async()=>{
  const t=await setup();
  try{
    const admin=await t.login('+79990000001');
    const client=await t.login('+79995773201');
    const a=await t.login('+79995773202','master');
    const b=await t.login('+79995773203','master');
    for(const [worker,name] of [[a,'Мастер А'],[b,'Мастер Б']] as const){
      ok(await t.api('PUT','/api/performer/profile',{kind:'master',name,specialties:['electric'],
        taxStatus:'self_employed',inn:'780000000001'},worker.token));
      ok(await t.api('POST','/api/admin/performers/'+worker.id+'/verify',{decision:'approved'},admin.token));
      ok(await t.api('POST','/api/performer/line',{lineStatus:'online'},worker.token));
    }
    ok(await t.api('POST','/api/admin/performers/'+a.id+'/priority',{isPriority:true},admin.token));
    const order=async(sos=false)=>ok(await t.api('POST','/api/orders',{
      service:'electric',zoneId:'spb',paymentMethod:'cash',verifiedOnly:true,isSos:sos
    },client.token)).order.id as string;
    const state=(id:string)=>t.db.one<{status:string;performer_id:string|null}>(
      'select status,performer_id from orders where id=$1',[id]);
    const unchanged=async(id:string)=>assert.deepEqual(await state(id),{status:'searching',performer_id:null});
    const call=await order();
    assert.equal((await t.db.one<{status:string}>(
      'select status from order_dispatch where order_id=$1 and performer_id=$2',[call,a.id]))?.status,'ringing');
    await t.db.query("update performer_profiles set paused=true where user_id=$1",[a.id]);
    assert.equal((await t.api('POST','/api/orders/'+call+'/accept',{},a.token)).status,409);
    await unchanged(call);
    await t.db.query("update performer_profiles set paused=false where user_id=$1",[a.id]);
    ok(await t.api('POST','/api/orders/'+call+'/cancel',{reason:'Учебная отмена'},client.token));

    ok(await t.api('PUT','/api/admin/settings/dispatch',{priorityFirst:false},admin.token));
    const manual=await order();
    const offer=(id:string,worker:typeof a)=>t.api('POST','/api/orders/'+id+'/offers',{},worker.token);
    const bid=async(id:string,worker:typeof a)=>
      (await t.db.one<{id:string;status:string}>('select id,status from bids where order_id=$1 and performer_id=$2',[id,worker.id]))!;
    await t.db.query("update performer_profiles set specialties='{}' where user_id=$1",[a.id]);
    assert.equal((await offer(manual,a)).status,409);
    await t.db.query("update performer_profiles set specialties='{electric}' where user_id=$1",[a.id]);
    ok(await offer(manual,a));ok(await offer(manual,b));
    const chosen=await bid(manual,a);
    await t.db.query("update performer_profiles set verification='pending' where user_id=$1",[a.id]);
    assert.equal((await t.api('POST','/api/orders/'+manual+'/offers/'+chosen.id+'/choose',{},client.token)).status,409);
    assert.equal((await bid(manual,a)).status,'withdrawn');
    await unchanged(manual);
    await t.db.query("update performer_profiles set verification='approved' where user_id=$1",[a.id]);
    ok(await offer(manual,a));
    await t.db.query("insert into client_prefs(client_id,performer_id,pref) values($1,$2,'hide')",[client.id,a.id]);
    assert.equal((await t.api('POST','/api/orders/'+manual+'/offers/'+chosen.id+'/choose',{},client.token)).status,409);
    assert.equal((await bid(manual,a)).status,'withdrawn');
    await unchanged(manual);
    await t.db.query('delete from client_prefs where client_id=$1 and performer_id=$2',[client.id,a.id]);
    ok(await offer(manual,a));
    await t.db.query("update users set roles='{client}' where id=$1",[a.id]);
    assert.equal((await t.api('POST','/api/orders/'+manual+'/offers/'+chosen.id+'/choose',{},client.token)).status,409);
    assert.equal((await bid(manual,a)).status,'withdrawn');
    await unchanged(manual);
    await t.db.query("update users set roles='{master}' where id=$1",[a.id]);
    ok(await t.api('POST','/api/orders/'+manual+'/cancel',{reason:'Учебная отмена'},client.token));

    const automatic=await order(true);
    ok(await offer(automatic,a));ok(await offer(automatic,b));
    const aBid=await bid(automatic,a);
    await t.db.query("update users set status='blocked' where id=$1",[a.id]);
    await assert.rejects(t.app.auction.choose(null,automatic,aBid.id),{status:409});
    assert.equal((await bid(automatic,a)).status,'withdrawn');
    await unchanged(automatic);
    await t.app.auction.choose(null,automatic,(await bid(automatic,b)).id);
    assert.deepEqual(await state(automatic),{status:'accepted',performer_id:b.id});
  }finally{await t.close();}
});
