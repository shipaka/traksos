import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sendInsuranceReminders } from '../src/services/insuranceReminders.ts';
import type { Db } from '../src/db/index.ts';
import type { Notifier } from '../src/services/notify.ts';

const due = [
  { id:'policy30', owner_id:'owner', plate:'A123AA', policy_expires_on:'2026-12-11', days:30 },
  { id:'policy7', owner_id:'owner', plate:'A123AA', policy_expires_on:'2026-11-18', days:7 },
  { id:'policy1', owner_id:'owner', plate:'A123AA', policy_expires_on:'2026-11-12', days:1 },
];

function fixture(items=due) {
  const claimed=new Set<string>();
  const inbox:unknown[][]=[];
  const sent:Array<{ids:string[];days:number}>=[];
  let failInbox=false;
  let failDelivery=false;
  let skipClaim=false;
  const db={
    async query(_sql:string,params:unknown[]) {
      return items.filter(x=>x.days===params[0]&&!claimed.has(x.id));
    },
    async tx(fn:(q:any)=>Promise<unknown>) {
      // Stage both writes locally: a failed inbox insert must not commit a
      // reminder marker. Real concurrent transactions are covered in the PG suite.
      const pendingClaims:string[]=[];
      const pendingInbox:unknown[][]=[];
      const result=await fn({
        async one(sql:string,params:unknown[]) {
          assert.match(sql,/for update of r for share of v,u/);
          return skipClaim?null:items.find(x=>x.id===params[0]&&x.days===params[1]&&x.owner_id===params[2]&&!claimed.has(x.id))??null;
        },
        async query(sql:string,params:unknown[]) {
          if(sql.startsWith('update vehicle_service_requests'))pendingClaims.push(String(params[0]));
          else if(sql.startsWith('insert into notifications')){
            if(failInbox)throw Error('notification store unavailable');
            pendingInbox.push(params);
          }else throw Error('unexpected transaction query');
        },
      });
      pendingClaims.forEach(id=>claimed.add(id));
      inbox.push(...pendingInbox);
      return result;
    },
  } as unknown as Db;
  const notifier={
    async deliverStored(ids:string[],event:{days:number}) {
      if(failDelivery)throw Error('optional delivery unavailable');
      sent.push({ids,days:event.days});
    },
  } as unknown as Notifier;
  return {db,notifier,claimed,inbox,sent,
    failInbox:(value:boolean)=>{failInbox=value;},
    failDelivery:(value:boolean)=>{failDelivery=value;},
    skipClaim:()=>{skipClaim=true;},
  };
}

test('insurance reminders: 30/7/1 days, no duplicates and owner only',async()=>{
  const f=fixture();
  await sendInsuranceReminders(f.db,f.notifier);
  await sendInsuranceReminders(f.db,f.notifier);
  assert.deepEqual(f.sent,[30,7,1].map(days=>({ids:['owner'],days})));
  assert.equal(f.inbox.length,3);
  assert.ok(f.inbox.every(row=>row[0]==='owner'&&row[1]==='insurance_expiry'));
});

test('insurance reminders: opted-out owners have no due records',async()=>{
  const f=fixture([]);
  await sendInsuranceReminders(f.db,f.notifier);
  assert.equal(f.inbox.length,0);
  assert.equal(f.sent.length,0);
});

test('failed insurance inbox rolls back its own marker and permits retry',async()=>{
  const f=fixture([due[0]]);
  f.failInbox(true);
  await assert.rejects(sendInsuranceReminders(f.db,f.notifier),/notification store unavailable/);
  assert.equal(f.claimed.size,0);
  assert.equal(f.inbox.length,0);
  assert.equal(f.sent.length,0);
  f.failInbox(false);
  await sendInsuranceReminders(f.db,f.notifier);
  assert.equal(f.claimed.size,1);
  assert.equal(f.inbox.length,1);
  assert.equal(f.sent.length,1);
});

test('concurrently claimed insurance reminder does not send duplicate notifications',async()=>{
  const f=fixture([due[0]]);
  f.skipClaim();
  await sendInsuranceReminders(f.db,f.notifier);
  assert.equal(f.inbox.length,0);
  assert.equal(f.sent.length,0);
});

test('optional delivery failure after commit preserves marker and inbox',async()=>{
  const f=fixture([due[0]]);
  f.failDelivery(true);
  await sendInsuranceReminders(f.db,f.notifier);
  assert.equal(f.claimed.size,1);
  assert.equal(f.inbox.length,1);
  f.failDelivery(false);
  await sendInsuranceReminders(f.db,f.notifier);
  assert.equal(f.inbox.length,1);
  assert.equal(f.sent.length,0);
});
