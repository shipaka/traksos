import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {setup,type T} from './helpers.ts';

let t:T;
let owner:{id:string;token:string},a:{id:string;token:string},b:{id:string;token:string};
before(async()=> {
 t=await setup();
 owner=await t.login('+79997809811');
 a=await t.login('+79997809812','master');
 b=await t.login('+79997809813','master');
});
after(()=>t.close());

async function add(performerId:string,startsAt:string,endsAt:string,status='confirmed') {
 const row=await t.db.one<any>(
  `insert into performer_time_reservations
   (performer_id,client_id,starts_at,ends_at,status,decision_at,decided_by)
   values($1,$2,$3,$4,$5,$6,$7) returning *`,
  [performerId,owner.id,startsAt,endsAt,status,
   status==='confirmed'?t.clock.now():null,status==='confirmed'?owner.id:null]);
 return row;
}
test('one confirmed interval blocks overlaps even with different requests, not unrelated masters',async()=>{
 const r=await add(a.id,'2026-12-02T07:30:00Z','2026-12-02T10:00:00Z');
 assert.ok(r.id);
 await assert.rejects(
  add(a.id,'2026-12-02T08:00:00Z','2026-12-02T09:00:00Z'),
  (e:any)=>e.code==='23P01' || /overlap|exclusion|пересеч/i.test(String(e?.message)));
 await add(b.id,'2026-12-02T08:00:00Z','2026-12-02T09:00:00Z');
 await add(a.id,'2026-12-02T10:00:00Z','2026-12-02T11:00:00Z');
 const states=await t.db.query<any>('select status from performer_time_reservations where performer_id=$1',[a.id]);
 assert.equal(states.length,2,'failed reservation must leave no ghost slot');
});
test('proposals do not reserve, cancellation releases only its interval, invalid time is rejected',async()=>{
 const proposal=await add(a.id,'2026-12-03T08:00:00Z','2026-12-03T09:00:00Z','proposed');
 assert.ok(proposal.id);
 const approved=await add(a.id,'2026-12-03T08:00:00Z','2026-12-03T09:00:00Z');
 assert.ok(approved.id,'a proposal does not imply a confirmed booking');
 await t.db.query(
  "update performer_time_reservations set status='cancelled',cancelled_at=$2,cancellation_reason='Клиент согласовал отмену' where id=$1",
  [approved.id,t.clock.now()]);
 const replacement=await add(a.id,'2026-12-03T08:30:00Z','2026-12-03T09:30:00Z');
 assert.ok(replacement.id,'a cancelled confirmed slot is released');
 assert.equal((await t.db.one<any>('select status from performer_time_reservations where id=$1',[proposal.id]))?.status,'proposed');
 await assert.rejects(
  add(a.id,'2026-12-04T09:00:00Z','2026-12-04T08:00:00Z'),
  (e:any)=>e.code==='23514' || /constraint|check|violat|range lower bound must be less than or equal to range upper bound/i.test(String(e?.message)));
});


test('two devices confirming overlapping proposals concurrently leave exactly one confirmed slot',async()=>{
 const x=await add(b.id,'2026-12-06T08:30:00Z','2026-12-06T11:00:00Z','proposed');
 const y=await add(b.id,'2026-12-06T09:00:00Z','2026-12-06T10:00:00Z','proposed');
 const confirm=(id:string)=>t.db.query(
  "update performer_time_reservations set status='confirmed',decision_at=$2,decided_by=$3 where id=$1",
  [id,t.clock.now(),owner.id]);
 const results=await Promise.allSettled([confirm(x.id),confirm(y.id)]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1,
  'the exclusion constraint must reject one of two competing confirmations');
 const rows=await t.db.query<any>(
  "select id from performer_time_reservations where performer_id=$1 and status='confirmed' and starts_at>=$2",
  [b.id,'2026-12-06T00:00:00Z']);
 assert.equal(rows.length,1);
});
