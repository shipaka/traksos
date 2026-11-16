import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {setup,ok,type T} from './helpers.ts';

let t:T,admin:any,petersburg:any,region:any,productId:string,paidOrderId:string;
before(async()=>{
 t=await setup();
 admin=await t.login('+79990000001');
 petersburg=await t.login('+79994445511');
 region=await t.login('+79994445512');
 productId=ok(await t.api('POST','/api/admin/shop/products',{
   category:'sensors',name:'Тестовый датчик каталога регионов',price:135000,stock:5,
 },admin.token)).id;
 ok(await t.api('PUT','/api/admin/settings/shop',{enabled:true},admin.token));
});
after(()=>t.close());

test('fail closed before a city is chosen; unsupported cities see no products/prices',async()=>{
 const data=ok(await t.api('GET','/api/shop',undefined,region.token));
 assert.equal(data.enabled,false);
 assert.equal(data.products.length,0);
 assert.equal(data.region.selected,false);
 assert.equal(data.region.available,false);
 assert.match(data.closedTitle,/недоступен в вашем регионе/);
 assert.equal((await t.api('GET','/api/shop/search?q=датчик',undefined,region.token)).status,409);
 assert.equal((await t.api('GET','/api/shop/selection?ids='+productId,undefined,region.token)).status,409);
 assert.equal((await t.api('GET','/api/shop/index/manifest',undefined,region.token)).status,409);
 assert.equal((await t.api('GET','/api/shop/index/page?limit=10',undefined,region.token)).status,409);
 assert.equal((await t.api('POST','/api/shop/orders',{
   items:[{productId,qty:1}],delivery:'pickup'},region.token)).status,409);
 const chosen=ok(await t.api('PUT','/api/shop/region',{city:'Ижевск'},region.token));
 assert.equal(chosen.available,false);
 assert.equal(chosen.city,'Ижевск');
 assert.equal(ok(await t.api('GET','/api/shop',undefined,region.token)).region.city,'Ижевск');
 assert.equal((await t.api('PUT','/api/shop/region',{city:'улица Пушкина 12'},region.token)).status,400);
 assert.equal((await t.api('PUT','/api/shop/region',{city:'  '},region.token)).status,400);
});

test('SPb selection grants shop; delivery elsewhere is denied even with SPb choice',async()=>{
 const chosen=ok(await t.api('PUT','/api/shop/region',{city:'Санкт-Петербург'},petersburg.token));
 assert.equal(chosen.available,true);
 const shop=ok(await t.api('GET','/api/shop',undefined,petersburg.token));
 assert.equal(shop.enabled,true);
 assert.ok(shop.products.some((x:any)=>x.id===productId));
 assert.equal(ok(await t.api('GET','/api/shop/region',undefined,region.token)).city,'Ижевск',
   'city choice must be isolated to its owner');
 assert.equal((await t.api('POST','/api/shop/orders',{
   items:[{productId,qty:1}],delivery:'delivery',address:'Москва, Тверская улица 10'
 },petersburg.token)).status,409);
 assert.equal((await t.api('POST','/api/shop/orders',{
   items:[{productId,qty:1}],delivery:'delivery',address:'Московская область, Санкт-Петербургское шоссе 10'
 },petersburg.token)).status,409);
 assert.equal((await t.api('POST','/api/shop/orders',{
   items:[{productId,qty:1}],delivery:'delivery',address:'Санкт-Петербург, улица Тестовая 10'
 },region.token)).status,409,'recipient address alone is not enough without selecting shop city');
 const placed=ok(await t.api('POST','/api/shop/orders',{
   items:[{productId,qty:1}],delivery:'delivery',address:'Санкт-Петербург, улица Тестовая 10'
 },petersburg.token));
 paidOrderId=placed.id;
 assert.equal(placed.status,'new','manual address still requires independent operator review');
});

test('moving away prevents further buying but preserves previous purchases and supplier history',async()=>{
 const changed=ok(await t.api('PUT','/api/shop/region',{city:'Москва'},petersburg.token));
 assert.equal(changed.available,false);
 assert.equal(ok(await t.api('GET','/api/shop',undefined,petersburg.token)).enabled,false);
 assert.equal((await t.api('GET','/api/shop/products/'+productId+'/analogs',undefined,petersburg.token)).status,409);
 assert.equal((await t.api('GET','/api/shop/index/changes?after=0',undefined,petersburg.token)).status,409);
 assert.equal((await t.api('POST','/api/shop/orders',{
   items:[{productId,qty:1}],delivery:'pickup'},petersburg.token)).status,409);
 assert.ok(ok(await t.api('GET','/api/shop/orders',undefined,petersburg.token)).some((x:any)=>x.id===paidOrderId));
 assert.ok(ok(await t.api('GET','/api/shop/history',undefined,petersburg.token)).items.some((x:any)=>x.id===paidOrderId));
});
