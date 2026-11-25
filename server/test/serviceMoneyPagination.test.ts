import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setup,ok} from './helpers.ts';

test('STO full totals and monthly history include invoices older than 300; pages remain private', {timeout:90000},async()=>{
  const t=await setup();
  try {
    const admin=await t.login('+79990000001');
    const client=await t.login('+79994000951');
    const service=await t.login('+79994000952','service');
    const stranger=await t.login('+79994000953','service');
    const own=ok(await t.api('PUT','/api/base',{name:'Сводка СТО',address:'Тестовый адрес 1'},service.token));
    const other=ok(await t.api('PUT','/api/base',{name:'Чужая СТО',address:'Тестовый адрес 2'},stranger.token));
    await t.api('POST','/api/admin/services/'+own.center.id+'/verify',{decision:'approved'},admin.token);
    const day=new Date(t.clock.now().getTime()+3*3600_000).toISOString().slice(0,10);
    const booking=ok(await t.api('POST','/api/services/'+own.center.id+'/book',
      {need:'electric',day,arrival:'self'},client.token));
    // Disposable DB only: retained invoice history, not actual receipts or payouts.
    await t.db.query(`update service_bookings set status='closed',amount=20000,
      commission=1000,discount=0,points=0,payment_required=true,client_fee=1000,
      received_amount=0,refunded_amount=0,invoiced_at='2025-01-01T00:00:00Z',
      closed_at='2025-01-02T00:00:00Z' where id=$1`,[booking.id]);
    const paid=await t.db.one<{id:string}>(`insert into service_bookings
      (center_id,client_id,created_by,vehicle,need,when_day,when_time,arrival,comment,
       status,amount,commission,discount,points,invoiced_at,closed_at,paid_out_at)
      select center_id,client_id,created_by,vehicle,need,when_day,when_time,arrival,comment,
       'closed',30000,1500,0,100,'2025-02-01T00:00:00Z','2025-02-28T22:00:00Z','2025-03-02T00:00:00Z'
      from service_bookings where id=$1 returning id`,[booking.id]);
    await t.db.query(`insert into service_bookings
      (center_id,client_id,created_by,vehicle,need,when_day,when_time,arrival,comment,
       status,amount,commission,discount,points,invoiced_at)
      select center_id,client_id,created_by,vehicle,need,when_day,when_time,arrival,comment,
       'invoiced',10000,500,0,0,'2026-10-01T00:00:00Z'
      from service_bookings cross join generate_series(1,300) where id=$1`,[booking.id]);
    const foreign=await t.db.one<{id:string}>(`insert into service_bookings
      (center_id,client_id,created_by,vehicle,need,when_day,when_time,arrival,comment,
       status,amount,commission,discount,points,invoiced_at)
      select $2,client_id,created_by,vehicle,need,when_day,when_time,arrival,comment,
       'invoiced',999999,0,0,0,'2026-10-01T00:00:00Z'
      from service_bookings where id=$1 returning id`,[booking.id,other.center.id]);
    const route='/api/base/money';
    const first=ok(await t.api('GET',route,undefined,service.token));
    assert.equal(first.totalCount,302);
    assert.equal(first.items.length,300);
    assert.equal(first.hasMore,true);
    assert.equal(first.summary.awaiting,300*9500);
    assert.equal(first.summary.unpaid,19000);
    assert.equal(first.summary.paid,28500);
    assert.equal(first.summary.points,100);
    assert.equal(first.monthTimezone,'Europe/Moscow');
    assert.equal(first.months.find((m:any)=>m.month==='2025-03')?.payout,28500);
    assert.equal(first.months.some((m:any)=>m.month==='2025-01'),false);
    assert.ok(first.nextBefore);
    const second=ok(await t.api('GET',route+'?before='+first.nextBefore,undefined,service.token));
    assert.deepEqual(second.summary,first.summary);
    assert.deepEqual(second.months,first.months);
    assert.equal(second.hasMore,false);
    assert.equal(second.nextBefore,null);
    assert.deepEqual(second.items.map((x:any)=>x.id),[paid!.id,booking.id]);
    assert.equal(new Set([...first.items,...second.items].map(x=>x.id)).size,302);
    assert.equal(first.items.some((x:any)=>'clientFee' in x||'received_amount' in x),false);
    assert.equal((await t.api('GET',route+'?before='+foreign!.id,undefined,service.token)).status,400);
    assert.equal((await t.api('GET',route+'?before=invalid',undefined,service.token)).status,400);
    assert.equal((await t.api('GET',route,undefined,client.token)).status,403);
    const outsider=ok(await t.api('GET',route,undefined,stranger.token));
    assert.equal(outsider.totalCount,1);
    assert.equal(outsider.summary.awaiting,999999);
  }finally{await t.close();}
});
