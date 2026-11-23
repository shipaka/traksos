/**
 * Real PostgreSQL injected audit failures: product core, metadata, stock and
 * supplier mapping must NEVER partially commit on the disposable CI DB.
 */
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {setup,ok,type T} from './helpers.ts';

let t:T;
let admin:{id:string;token:string};
let productId:string;
before(async()=>{
  t=await setup();admin=await t.login('+79990000001');
  productId=ok(await t.api('POST','/api/admin/shop/products',{
    category:'engine',name:'Исходный товар CI',price:17000,stock:6,
    brand:'Scania',article:'CI-0001',searchTerms:'original',
  },admin.token)).id;
});
after(async()=>{await t?.close()});

async function triggerBlock(action:string){
  const safeAction=action.replace(/'/g,"''");
  await t.db.exec([
    'CREATE OR REPLACE FUNCTION shop_test_audit_fault() RETURNS trigger',
    'LANGUAGE plpgsql AS $$',
    'BEGIN',
    "  IF NEW.action='"+safeAction+"' THEN",
    "    RAISE EXCEPTION 'synthetic catalog audit failure';",
    '  END IF;',
    '  RETURN NEW;',
    'END; $;',
    'DROP TRIGGER IF EXISTS shop_test_audit_fault_trigger ON audit_log;',
    'CREATE TRIGGER shop_test_audit_fault_trigger BEFORE INSERT ON audit_log',
    'FOR EACH ROW EXECUTE FUNCTION shop_test_audit_fault();',
  ].join('\n'));
}
async function unblock(){
  await t.db.exec('DROP TRIGGER IF EXISTS shop_test_audit_fault_trigger ON audit_log; DROP FUNCTION IF EXISTS shop_test_audit_fault();');
}
async function getProduct(){
  return t.db.one<{
    name:string;price:number;stock:number;brand:string|null;
    article:string|null;search_terms:string|null;active:boolean;
  }>('select name,price,stock,brand,article,search_terms,active from shop_products where id=$1',
    [productId]);
}

test('failed product INSERT audit rolls back entire new inventory row',async()=>{
  await triggerBlock('shop.product_create');
  try{
    const r=await t.api('POST','/api/admin/shop/products',{
      category:'engine',name:'Строка не должна появиться CI',
      price:50000,stock:10,
    },admin.token);
    assert.equal(r.status,500);
    const rows=await t.db.query(
      "select id from shop_products where name='Строка не должна появиться CI'");
    assert.equal(rows.length,0);
  }finally{await unblock()}
});

test('failed audit rolls back price, stock AND supplier-facing metadata',async()=>{
  const before=await getProduct();
  await triggerBlock('shop.product_update');
  try{
    const r=await t.api('PUT','/api/admin/shop/products/'+productId,{
      name:'Частичное обновление CI',price:999999,stock:1,
      brand:'Test brand',article:'CI-9999',searchTerms:'changed',
    },admin.token);
    assert.equal(r.status,500);
    assert.deepEqual(await getProduct(),before);
  }finally{await unblock()}
});

test('failed hide audit cannot disable a visible product',async()=>{
  const before=await getProduct();
  await triggerBlock('shop.product_hide');
  try{
    const r=await t.api('DELETE','/api/admin/shop/products/'+productId,undefined,admin.token);
    assert.equal(r.status,500);
    assert.deepEqual(await getProduct(),before);
  }finally{await unblock()}
});

test('supplier mapping upsert and audit roll back together',async()=>{
  const uri='/api/admin/shop/products/'+productId+'/supplier';
  const before=ok(await t.api('GET',uri,undefined,admin.token));
  assert.equal(before.article,null);
  await triggerBlock('shop.supplier_ref_set');
  try{
    const r=await t.api('PUT',uri,{
      article:'AVTOKONTINENT-CI',brand:'CI',sourceNote:'Синтетический CI источник',
      verified:true,
    },admin.token);
    assert.equal(r.status,500);
    const after=ok(await t.api('GET',uri,undefined,admin.token));
    assert.equal(after.article,null);
  }finally{await unblock()}
  const stored=ok(await t.api('PUT',uri,{
    article:'AVTOKONTINENT-CI',brand:'CI',sourceNote:'Синтетический CI источник',
    verified:true,
  },admin.token));
  assert.equal(stored.article,'AVTOKONTINENT-CI');
  assert.equal(stored.connected,false);
});

test('supplier mapping DELETE rolls back if its audit fails',async()=>{
  const uri='/api/admin/shop/products/'+productId+'/supplier';
  const before=ok(await t.api('GET',uri,undefined,admin.token));
  await triggerBlock('shop.supplier_ref_clear');
  try{
    const r=await t.api('DELETE',uri,undefined,admin.token);
    assert.equal(r.status,500);
    const after=ok(await t.api('GET',uri,undefined,admin.token));
    assert.equal(after.article,before.article);
    assert.equal(after.verified,before.verified);
  }finally{await unblock()}
  ok(await t.api('DELETE',uri,undefined,admin.token));
  assert.equal(ok(await t.api('GET',uri,undefined,admin.token)).article,null);
});
