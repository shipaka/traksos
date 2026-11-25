import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ReviewsService } from '../src/services/reviews.ts';
import type { Db } from '../src/db/index.ts';
import type { SettingsService } from '../src/services/settings.ts';
import type { OrdersService } from '../src/services/orders.ts';
import type { AuthUser } from '../src/http/router.ts';

function fixture({rollback=false,brokenSignal=false}={}){
  const events:string[]=[];
  let committed=false;
  const order={id:'order',status:'completed',client_id:'customer',created_by:'customer',performer_id:'master',vehicle_id:null};
  const q={
    async one(sql:string,args:unknown[]){
      if(sql.includes('select status,client_id'))return order;
      if(sql.includes('select roles,rating,rating_count'))return {roles:args[0]==='staff'?['admin']:['client'],rating:null,rating_count:0};
      if(sql.includes('select target_id from reviews')||sql.includes('returning target_id'))return {target_id:'master'};
      if(sql.includes('select id from users'))return {id:args[0]};
      throw Error('Unexpected query: '+sql);
    },
    async query(sql:string){
      if(sql.includes('select stars,weight'))return [{stars:5,weight:'0.3',disputed:false,hidden:false}];
      return [];
    },
  };
  const db={async tx(fn:(q:any)=>Promise<any>){
    committed=false;
    const result=await fn(q);
    if(rollback)throw Error('commit failed');
    committed=true;
    return result;
  }} as unknown as Db;
  const settings={get:async()=>({newbieWeight:0.3,newbieMinRatings:3,minWeight:0.1,maxWeight:1})} as unknown as SettingsService;
  const orders={mustSee:async()=>order,actorOf:()=> 'client',event:async()=>{}} as unknown as OrdersService;
  const service=new ReviewsService(db,settings,orders,id=>{
    assert.equal(committed,true,'Refresh signal must follow commit');
    events.push(id);
    if(brokenSignal)throw Error('socket unavailable');
  });
  const customer={id:'customer',roles:['client']} as AuthUser;
  const staff={id:'staff',roles:['admin']} as AuthUser;
  return {service,events,customer,staff};
}

test('review and moderation invalidate only the target after commit; API responses remain compatible',async()=>{
  const {service,events,customer,staff}=fixture();
  assert.deepEqual(await service.leave(customer,'order',{stars:5}),{ok:true,weight:0.3});
  assert.deepEqual(events,['master']);
  assert.deepEqual(await service.moderate(staff,'review',{hidden:true}),{rating:5,count:1});
  assert.deepEqual(events,['master','master']);
});

test('failed transaction does not signal any account',async()=>{
  const {service,events,customer,staff}=fixture({rollback:true});
  await assert.rejects(service.leave(customer,'order',{stars:5}),/commit failed/);
  await assert.rejects(service.moderate(staff,'review',{hidden:true}),/commit failed/);
  assert.deepEqual(events,[]);
});

test('best effort signal failure cannot change committed review response',async()=>{
  const {service,events,customer}=fixture({brokenSignal:true});
  assert.deepEqual(await service.leave(customer,'order',{stars:5}),{ok:true,weight:0.3});
  assert.deepEqual(events,['master']);
});
