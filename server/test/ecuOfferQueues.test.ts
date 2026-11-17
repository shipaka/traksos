import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setup,ok} from './helpers.ts';

test('ECU performer sees separate bidding queues by boolean only, never the earlier contract ID',async()=>{
  const t=await setup();
  try{
    const admin=await t.login('+79990000001');
    const client=await t.login('+79998223001','client');
    const expert=await t.login('+79998223002','master');
    const stranger=await t.login('+79998223003','master');
    ok(await t.api('PUT','/api/performer/profile',{
      kind:'ecu',name:'Электронные блоки грузовиков',specialties:['diag','electric'],
      taxStatus:'self_employed',inn:'780008223002'
    },expert.token));
    ok(await t.api('POST','/api/admin/performers/'+expert.id+'/verify',
      {decision:'approved'},admin.token));
    const source=await t.db.one<{id:string}>(`
      insert into orders(client_id,created_by,service,status,brand,description)
      values($1,$1,'electric','accepted','Renault','Приватные пояснения первого мастера')
      returning id`,[client.id]);
    const direct=await t.db.one<{id:string}>(`
      insert into orders(client_id,created_by,service,status,brand,estimate,auction_until)
      values($1,$1,'ecu','searching','Renault',$2,'2027-01-01T00:00:00Z')
      returning id`,[client.id,{callOut:600000,hour:100000}]);
    const linked=await t.db.one<{id:string}>(`
      insert into orders(client_id,created_by,service,status,brand,
        estimate,auction_until,additional_to,case_root_id)
      values($1,$1,'ecu','searching','Renault',
        $2,'2027-01-01T00:00:00Z',$3,$3)
      returning id`,[client.id,{callOut:600000,hour:100000},source!.id]);
    for(const order of [direct,linked]){
      await t.db.query(`
        insert into order_dispatch(order_id,performer_id,rank,status)
        values($1,$2,1,'bidding')`,[order!.id,expert.id]);
    }
    const offers=ok(await t.api('GET','/api/performer/auctions',undefined,expert.token));
    const directOffer=offers.find((x:any)=>x.order_id===direct!.id);
    const linkedOffer=offers.find((x:any)=>x.order_id===linked!.id);
    assert.ok(directOffer&&linkedOffer,'both kinds of work reach one real professional account');
    assert.equal(directOffer.is_linked_stage,false);
    assert.equal(linkedOffer.is_linked_stage,true);
    for(const offer of [directOffer,linkedOffer]){
      for(const forbidden of ['additional_to','case_root_id','parent_number','parentOrderId','sourceOrderId'])
        assert.equal(forbidden in offer,false,forbidden);
      assert.ok(!JSON.stringify(offer).includes(source!.id),
        'auction candidate must never learn the other contractor order identifier');
    }
    assert.deepEqual(ok(await t.api('GET','/api/performer/auctions',undefined,stranger.token)),[],
      'only the dispatched ECU worker sees these invitations');
    assert.equal((await t.api('GET','/api/performer/auctions',undefined,client.token)).status,403);
  }finally{await t.close()}
});
