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
