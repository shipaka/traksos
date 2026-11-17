import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {setup,ok} from './helpers.ts';

test('one technical case survives a lost response when its repair has finished',async()=>{
  const t=await setup();
  try{
    const admin=await t.login('+79990000001');
    const owner=await t.login('+79997845001','client');
    const worker=await t.login('+79997845002','master');
    ok(await t.api('PUT','/api/performer/profile',{
      kind:'ecu',name:'Инженер блоков управления',specialties:['diag','electric']
    },worker.token));
    ok(await t.api('POST','/api/admin/performers/'+worker.id+'/verify',
      {decision:'approved'},admin.token));
    const rooms=ok(await t.api('GET','/api/community/rooms',undefined,worker.token)).rooms;
    const ecu=rooms.find((room:any)=>room.slug==='ecu-pro');
    assert.ok(ecu,'verified ECU professional room must be available');
    ok(await t.api('POST','/api/community/rooms/'+ecu.id+'/join',{},worker.token));
    const parent=await t.db.one<{id:string}>(`
      insert into orders(client_id,created_by,service,status,performer_id,
        brand,model,year,description)
      values($1,$1,'ecu','accepted',$2,'Renault','Premium',2010,
        'Проверка электронного блока EBS') returning id
    `,[owner.id,worker.id]);
    assert.ok(parent);
    const request={
      roomId:ecu.id,clientNonce:randomUUID(),orderId:parent!.id,
      subsystem:'EBS',dtcCodes:['P0401'],
      symptoms:'После прогрева пропадает связь с блоком EBS, напряжение питания и массу проверили, проблема остаётся.',
      diagnosticContext:'Проверено питание блока, причина потери CAN связи ещё не найдена'
    };
    const endpoint='/api/community/pro-cases';
    const first=ok(await t.api('POST',endpoint,request,worker.token));
    assert.equal(first.created,true);
    assert.ok(first.case.id);
    assert.equal(first.case.origin,'order_preview');
    await t.db.query("update orders set status='completed' where id=$1",[parent!.id]);
    assert.equal((await t.api('GET','/api/community/pro-cases/order-preview/'+parent!.id,
      undefined,worker.token)).status,404,
      'completed repair cannot be used as a source for another new question');

    const replay=ok(await t.api('POST',endpoint,request,worker.token));
    assert.equal(replay.created,false,'lost-response retry must not create another case');
    assert.equal(replay.case.id,first.case.id);
    assert.equal((await t.api('POST',endpoint,{
      ...request,dtcCodes:['P0402']
    },worker.token)).status,409,'changed fault code must not reuse a case nonce');
    assert.equal((await t.api('POST',endpoint,{
      ...request,diagnosticContext:'Диагностический текст теперь изменён после проверки'
    },worker.token)).status,409,'changed context must not reuse a case nonce');
    const rows=await t.db.query<{id:string}>(`
      select id from community_technical_cases
      where author_id=$1 and client_nonce=$2
    `,[worker.id,request.clientNonce]);
    assert.deepEqual(rows.map(row=>row.id),[first.case.id]);
    const privateLink=await t.db.query<{order_id:string}>(`
      select order_id from community_technical_case_order_links
      where case_id=$1
    `,[first.case.id]);
    assert.deepEqual(privateLink.map(row=>row.order_id),[parent!.id]);
    for(const field of ['orderId','order_id','address','plate','vin','phone','payment'])
      assert.equal(field in replay.case,false,'club response must not leak '+field);
  }finally{await t.close()}
});
