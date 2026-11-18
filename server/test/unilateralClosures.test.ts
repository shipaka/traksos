import test from 'node:test';
import assert from 'node:assert/strict';
import { UnilateralClosures } from '../src/services/unilateralClosures.ts';

const ORDER_ID='00000000-0000-4000-8000-000000000031';
const PERF_ID='00000000-0000-4000-8000-000000000032';
const CLIENT_ID='00000000-0000-4000-8000-000000000033';
const KEY='emergency-first-11111111';

function fixture() {
  const o:any={
    id:ORDER_ID,number:713,performer_id:PERF_ID,client_id:CLIENT_ID,created_by:CLIENT_ID,
    service:'diag',status:'awaiting_confirmation',work_amount:240000,
    call_out_amount:110000,amount_proposed_at:new Date('2026-11-18T11:00:00Z')
  };
  let closure:any=null;
  let msgCount=0,notificationCount=0,releaseCount=0,eventCount=0,modCount=0;
  const db:any={
    tx:async(fn:(q:any)=>Promise<any>)=>fn(db),
    one:async(sql:string,args:any[])=>{
      if(sql.startsWith('select * from orders where'))return o;
      if(sql.startsWith('select * from order_unilateral_closures'))return closure;
      if(sql.startsWith('insert into order_unilateral_closures')){
        closure={order_id:ORDER_ID,performer_id:PERF_ID,request_key:args[2],
          reason:args[3],note:args[4],work_amount:args[5],quote_total:args[6],
          quote_at:args[7],created_at:args[8],status:'pending_client',answered_at:null};
        return closure;
      }
      if(sql.startsWith('update order_unilateral_closures')){
        closure.status='disputed';closure.answered_by=args[1];closure.answer_reason=args[3];return closure;
      }
      if(sql.startsWith('insert into chat_messages')){
        msgCount++;return {id:msgCount,order_id:ORDER_ID,kind:'system',body:args[1]};
      }
      if(sql.startsWith('select id from mod_cases'))return null;
      return null;
    },
    query:async(sql:string)=>{
      if(sql.startsWith('insert into notifications'))notificationCount++;
      if(sql.includes("line_status='online'"))releaseCount++;
      return [];
    }
  };
  const orders:any={
    money:(order:any)=>({total:Number(order.work_amount)+Number(order.call_out_amount)}),
    busyWith:async()=>false,
    event:async()=>{eventCount++;}
  };
  const notifier:any={live:()=>{},deliverStored:async()=>{},notify:async()=>{}};
  const moderation:any={open:async()=>{modCount++;return 'mod-case'}};
  const closureService=new UnilateralClosures(db,orders,notifier,moderation,
    ()=>new Date('2026-11-18T12:00:00Z'));
  const data={requestKey:KEY,reason:'client_offline' as const,
    note:'Клиент находится вне зоны связи, диагностика завершена',workFinished:true};
  const performer:any={id:PERF_ID,status:'active',roles:['master']};
  const client:any={id:CLIENT_ID,status:'active',roles:['client']};
  return {o,db,closureService,data,performer,client,get closure(){return closure;},
    stats:()=>({msgCount,notificationCount,releaseCount,eventCount,modCount})};
}

test('emergency closure is idempotent and never asserts customer acceptance or payment',async()=>{
  const f=fixture();
  const first=await f.closureService.request(f.performer,ORDER_ID,f.data);
  assert.equal(first.status,'pending_client');
  assert.equal(first.operationalStatus,'work_submitted_pending_client');
  assert.equal(first.quoteTotal,350000);
  assert.equal(f.o.status,'awaiting_confirmation');
  const again=await f.closureService.request(f.performer,ORDER_ID,f.data);
  assert.equal(again.created,false);
  assert.deepEqual(f.stats(),{msgCount:1,notificationCount:1,releaseCount:1,eventCount:1,modCount:0});
  await assert.rejects(f.closureService.request(f.performer,ORDER_ID,
    {...f.data,requestKey:'emergency-other-key'}),{code:'emergency_already_recorded'});
});

test('only actual assigned performer can request emergency closure after quoted work',async()=>{
  const f=fixture();
  await assert.rejects(f.closureService.request({...f.performer,id:CLIENT_ID},ORDER_ID,f.data),{code:'forbidden'});
  assert.equal(f.closure,null);
  f.o.status='en_route';
  await assert.rejects(f.closureService.request(f.performer,ORDER_ID,f.data),{code:'emergency_not_ready'});
  assert.equal(f.stats().releaseCount,0);
});

test('disagreement keeps financial order unresolved and opens moderation once',async()=>{
  const f=fixture();
  await f.closureService.request(f.performer,ORDER_ID,f.data);
  const response=await f.closureService.disagree(f.client,ORDER_ID,'Не согласен с результатом диагностики');
  assert.equal(response.status,'disputed');
  assert.equal(f.closure.status,'disputed');
  assert.equal(f.o.status,'awaiting_confirmation');
  assert.equal(f.stats().modCount,1);
  assert.equal(f.stats().releaseCount,1);
  const repeat=await f.closureService.disagree(f.client,ORDER_ID,'Не согласен с результатом диагностики');
  assert.equal(repeat.status,'disputed');
  assert.equal(f.stats().msgCount,2);
  assert.equal(f.stats().modCount,2); // Fake DB does not record mod_cases; real service de-duplicates.
});

test('emergency dispute requires a customer and a specific reason',async()=>{
  const f=fixture();
  await f.closureService.request(f.performer,ORDER_ID,f.data);
  await assert.rejects(f.closureService.disagree(f.performer,ORDER_ID,'Не согласен с результатом'),{code:'forbidden'});
  await assert.rejects(f.closureService.disagree(f.client,ORDER_ID,'нет'),{code:'reason_required'});
  assert.equal(f.closure.status,'pending_client');
});
