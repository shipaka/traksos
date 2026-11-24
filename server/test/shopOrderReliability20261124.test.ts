/**
 * Real HTTP/Postgres regression for buying, fleet isolation, stock reservation
 * and post-commit notification failures. Disposable DB, synthetic inventory.
 */
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {setup,ok,type T} from './helpers.ts';
import {ShopService} from '../src/services/shop.ts';

let t:T;
let admin:{id:string;token:string};
let owner:{id:string;token:string};
let driverA:{id:string;token:string};
let driverB:{id:string;token:string};
let outsider:{id:string;token:string};
let productId:string;

before(async()=>{
  t=await setup();
  admin=await t.login('+79990000001');
  owner=await t.login('+79996660011');
  driverA=await t.login('+79996660012','driver');
  driverB=await t.login('+79996660013','driver');
  outsider=await t.login('+79996660014');
  await t.db.query('update users set owner_id=$1 where id=any($2::uuid[])',
    [owner.id,[driverA.id,driverB.id]]);
  ok(await t.api('PUT','/api/admin/settings/shop',{enabled:true},admin.token));
  productId=ok(await t.api('POST','/api/admin/shop/products',{
    category:'engine',name:'Синтетический насос CI',
    price:25000,stock:30,active:true,
  },admin.token)).id;
});
after(async()=>{await t?.close()});
const order=async(token:string,qty=1)=>t.api('POST','/api/shop/orders',{
  items:[{productId,qty}],delivery:'pickup',
},token);
const stock=async()=>(
  await t.db.one<{stock:number}>('select stock from shop_products where id=$1',[productId])
)?.stock;

test('fleet driver cannot cancel another driver purchase by known UUID; owner can',async()=>{
  const first=ok(await order(driverA.token));
  assert.equal(first.status,'new');
  const listB=ok(await t.api('GET','/api/shop/orders',undefined,driverB.token));
  assert.equal(listB.some((v:any)=>v.id===first.id),false);
  const denied=await t.api('POST','/api/shop/orders/'+first.id+'/cancel',{},driverB.token);
  assert.equal(denied.status,404);
  const other=await t.api('POST','/api/shop/orders/'+first.id+'/cancel',{},outsider.token);
  assert.equal(other.status,404);
  assert.equal((await t.db.one<{status:string}>(
    'select status from shop_orders where id=$1',[first.id]))?.status,'new');
  const buyer=await t.api('POST','/api/shop/orders/'+first.id+'/cancel',{},driverA.token);
  assert.equal(buyer.status,200);
  const audit=await t.db.one<{actor_id:string}>(
    "select actor_id from audit_log where target=$1 and action='shop.status' order by id desc limit 1",
    [first.id]);
  assert.equal(audit?.actor_id,driverA.id,'audit must reflect actual canceller');
});

test('simultaneous cancel does not double-restock one reserved item',async()=>{
  const first=ok(await order(driverA.token));
  const before=await stock();
  assert.ok(before!==undefined,'shop product must exist before stock release assertion');
  const results=await Promise.all([
    t.api('POST','/api/shop/orders/'+first.id+'/cancel',{},driverA.token),
    t.api('POST','/api/shop/orders/'+first.id+'/cancel',{},owner.token),
  ]);
  assert.equal(results.filter(x=>x.status===200).length,1);
  assert.equal(results.filter(x=>x.status===409).length,1);
  assert.equal(await stock(),before+1,
    'only one cancellation is allowed to release reserved inventory');
});

test('post-commit notifier failure cannot turn accepted checkout into failed response',async()=>{
  const faulty=new ShopService(t.db,{notify:async()=>{throw Error('Synthetic push outage')}} as any,
    t.app.settings);
  const before=(await t.db.one<{n:number}>(
    'select count(*)::int as n from shop_orders'))!.n;
  const actor={
    id:owner.id,phone:'+79996660011',roles:['client'],owner_id:null,
  } as any;
  const result=await faulty.order(actor,{
    items:[{productId,qty:1}],delivery:'pickup',
  });
  assert.ok(result.id);
  const after=(await t.db.one<{n:number}>(
    'select count(*)::int as n from shop_orders'))!.n;
  assert.equal(after,before+1);
  const saved=await t.db.one<{status:string}>(
    'select status from shop_orders where id=$1',[result.id]);
  assert.equal(saved?.status,'new');
});

test('post-commit status notification fault cannot mask successful admin change',async()=>{
  const first=ok(await order(owner.token));
  const faulty=new ShopService(t.db,{notify:async()=>{throw Error('Synthetic push outage')}} as any,
    t.app.settings);
  const result=await faulty.setStatus({
    id:admin.id,roles:['admin'],owner_id:null,
  } as any,first.id,'confirmed');
  assert.equal(result.status,'confirmed');
  assert.equal((await t.db.one<{status:string}>(
    'select status from shop_orders where id=$1',[first.id]))?.status,'confirmed');
});


test('stale fleet membership is denied inside the stock reservation transaction',async()=>{
  const actor={id:driverA.id,owner_id:owner.id,roles:['driver']} as any;
  const before=await stock();
  // Simulate a driver removed AFTER their browser/session built this request.
  await t.db.query('update users set owner_id=null where id=$1',[driverA.id]);
  try{
    const service=new ShopService(t.db,{notify:async()=>{}} as any,t.app.settings);
    await assert.rejects(
      service.order(actor,{items:[{productId,qty:1}],delivery:'pickup'}),
      (e:any)=>e?.status===403);
    assert.equal(await stock(),before);
  }finally{
    await t.db.query('update users set owner_id=$2 where id=$1',[driverA.id,owner.id]);
  }
});

test('vehicle reassigned between pre-check and transaction cannot be billed to former driver',async()=>{
  const v=ok(await t.api('POST','/api/vehicles',{
    brand:'Scania',model:'R',plate:'А112АА178',year:2017,
  },owner.token));
  await t.db.query('update vehicles set driver_id=$2 where id=$1',[v.id,driverA.id]);
  const before=await stock();
  let revoked=false;
  const racingDb={
    ...t.db,
    tx:async <T>(fn:(q:any)=>Promise<T>):Promise<T>=>{
      if(!revoked){
        revoked=true;
        await t.db.query('update vehicles set driver_id=null where id=$1',[v.id]);
      }
      return t.db.tx(fn);
    },
  };
  const service=new ShopService(racingDb as any,{notify:async()=>{}} as any,t.app.settings);
  await assert.rejects(
    service.order({id:driverA.id,owner_id:owner.id,roles:['driver']} as any,{
      items:[{productId,qty:1}],delivery:'pickup',vehicleId:v.id,
    }),
    (e:any)=>e?.status===403);
  assert.equal(revoked,true);
  assert.equal(await stock(),before,'rejected binding must not reserve any stock');
});


test('confirmed purchases are cancelled only by store, with one inventory restoration',async()=>{
  const first=ok(await order(owner.token));
  const reserved=await stock();
  ok(await t.api('POST','/api/admin/shop/orders/'+first.id+'/status',{status:'confirmed'},admin.token));
  const denied=await t.api('POST','/api/shop/orders/'+first.id+'/cancel',{},owner.token);
  assert.equal(denied.status,409);
  assert.equal(await stock(),reserved);
  assert.equal((await t.db.one<{status:string}>('select status from shop_orders where id=$1',[first.id]))?.status,'confirmed');
  ok(await t.api('POST','/api/admin/shop/orders/'+first.id+'/status',{status:'cancelled'},admin.token));
  assert.equal(await stock(),reserved!+1);
});

test('captured fleet credentials cannot cancel after membership revocation',async()=>{
  const first=ok(await order(driverA.token));
  const reserved=await stock();
  const actor={id:driverA.id,owner_id:owner.id,roles:['driver']} as any;
  const service=new ShopService(t.db,{notify:async()=>{}} as any,t.app.settings);
  await t.db.query('update users set owner_id=null where id=$1',[driverA.id]);
  try{
    await assert.rejects(()=>service.cancelMine(actor,first.id),(e:any)=>e?.status===404);
    assert.equal(await stock(),reserved);
    assert.equal((await t.db.one<{status:string}>('select status from shop_orders where id=$1',[first.id]))?.status,'new');
  }finally{
    await t.db.query('update users set owner_id=$2 where id=$1',[driverA.id,owner.id]);
    ok(await t.api('POST','/api/shop/orders/'+first.id+'/cancel',{},owner.token));
  }
});


test('vehicle reassignment removes private purchases from both fleet lists while owner retains access',async()=>{
  const v=ok(await t.api('POST','/api/vehicles',{
    brand:'DAF',model:'XF',plate:'А113АА178',year:2018,
  },owner.token));
  await t.db.query('update vehicles set driver_id=$2 where id=$1',[v.id,driverA.id]);
  const first=ok(await t.api('POST','/api/shop/orders',{
    items:[{productId,qty:1}],delivery:'pickup',vehicleId:v.id,
  },driverA.token));
  const actor={id:driverA.id,owner_id:owner.id,roles:['driver']} as any;
  const service=new ShopService(t.db,{notify:async()=>{}} as any,t.app.settings);
  assert.ok((await service.myOrders(actor)).some((x:any)=>x.id===first.id));
  assert.ok((await service.history(actor,null)).items.some((x:any)=>x.id===first.id));
  await t.db.query('update vehicles set driver_id=$2 where id=$1',[v.id,driverB.id]);
  assert.ok(!(await service.myOrders(actor)).some((x:any)=>x.id===first.id));
  assert.ok(!(await service.history(actor,null)).items.some((x:any)=>x.id===first.id));
  await assert.rejects(()=>service.history(actor,v.id),(e:any)=>e?.status===403);
  assert.ok(ok(await t.api('GET','/api/shop/orders',undefined,owner.token)).some((x:any)=>x.id===first.id));
  ok(await t.api('POST','/api/shop/orders/'+first.id+'/cancel',{},owner.token));
});

test('revoked fleet membership hides private order history even with captured actor',async()=>{
  const first=ok(await order(driverA.token));
  const actor={id:driverA.id,owner_id:owner.id,roles:['driver']} as any;
  const service=new ShopService(t.db,{notify:async()=>{}} as any,t.app.settings);
  await t.db.query('update users set owner_id=null where id=$1',[driverA.id]);
  try{
    assert.deepEqual(await service.myOrders(actor),[]);
    assert.deepEqual((await service.history(actor,null)).items,[]);
  }finally{
    await t.db.query('update users set owner_id=$2 where id=$1',[driverA.id,owner.id]);
    ok(await t.api('POST','/api/shop/orders/'+first.id+'/cancel',{},owner.token));
  }
});

test('blocked account cannot reserve inventory or read orders with a stale auth snapshot',async()=>{
  const actor={id:owner.id,owner_id:null,roles:['client']} as any;
  const service=new ShopService(t.db,{notify:async()=>{}} as any,t.app.settings);
  const reserved=await stock();
  await t.db.query("update users set status='blocked' where id=$1",[owner.id]);
  try{
    await assert.rejects(()=>service.order(actor,{items:[{productId,qty:1}],delivery:'pickup'}),
      (e:any)=>e?.status===403);
    assert.equal(await stock(),reserved);
    assert.deepEqual(await service.myOrders(actor),[]);
    assert.deepEqual((await service.history(actor,null)).items,[]);
  }finally{await t.db.query("update users set status='active' where id=$1",[owner.id]);}
});
