/**
 * Isolated, deterministic regression for per-account shop-cart persistence.
 * Runs Node + the actual TypeScript module (compiled via esbuild), without
 * production data, API requests or SMS.
 *
 * node e2e/shop-cart-isolation-20261124.mjs
 */
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {transform} from 'esbuild';

const source=await readFile(new URL('../web/src/shopCartStore.ts',import.meta.url),'utf8');
const compiled=await transform(source,{loader:'ts',format:'esm',target:'es2022'});
const {cartStorageKey,normalizeCart,readCartFor,writeCartFor}=
  await import('data:text/javascript;base64,'+Buffer.from(compiled.code).toString('base64'));

const backing=new Map();
globalThis.localStorage={
  getItem:key=>backing.get(String(key))??null,
  setItem:(key,value)=>{backing.set(String(key),String(value));},
  removeItem:key=>{backing.delete(String(key));},
  clear:()=>backing.clear(),
};
const A='ci-user-A',B='ci-user-B',sku='product-0123456';
const keyA=cartStorageKey(A),keyB=cartStorageKey(B);
assert.notEqual(keyA,keyB,'Different accounts must have distinct storage keys');
assert.equal(cartStorageKey(null),null,'Anonymous users cannot own a saved cart');

// The historic non-owner-scoped key must not be assigned to whichever user logs in next.
backing.set('traksos.cart',JSON.stringify({[sku]:8}));
assert.deepEqual(readCartFor(A),{},'Legacy shared cart must not migrate to A');
assert.equal(backing.has('traksos.cart'),false,'Ambiguous legacy cart must be discarded');

// Fleet owner and driver use one tablet: no cross-account inventory bleed.
assert.deepEqual(writeCartFor(A,{[sku]:3}),{[sku]:3});
assert.deepEqual(readCartFor(B),{},'User B must never see A cart');
assert.deepEqual(writeCartFor(B,{[sku]:2,'second-product':1}),{[sku]:2,'second-product':1});
assert.deepEqual(readCartFor(A),{[sku]:3},'User A cart survives B session');
assert.deepEqual(readCartFor(B),{[sku]:2,'second-product':1});

// Cross-tab writes are scoped to the same user; other account keys stay untouched.
backing.set(keyA,JSON.stringify({'new-SKU':99}));
assert.deepEqual(readCartFor(A),{'new-SKU':99});
assert.deepEqual(readCartFor(B),{[sku]:2,'second-product':1});

// Corrupt JSON and hostile values must never reach cart maths or an order POST.
backing.set(keyA,'{malformed-json');
assert.deepEqual(readCartFor(A),{});
const hostile=JSON.parse('{"good-ID":999,"zero":0,"negative":-1,"fraction":1.1,"text":"5","__proto__":2,"constructor":4}');
assert.deepEqual(normalizeCart(hostile),{'good-ID':99});
assert.deepEqual(normalizeCart(null),{});
assert.deepEqual(normalizeCart(['not','a','cart']),{});
assert.deepEqual(normalizeCart({'valid':Infinity,qty:NaN,okay:1}),{okay:1});
assert.deepEqual(writeCartFor(null,{[sku]:9}),{},'Anonymous cart writes must not persist');
assert.deepEqual(readCartFor(B),{[sku]:2,'second-product':1});

// Storage disabled by browser privacy mode still degrades safely.
globalThis.localStorage={
  getItem(){throw Error('disabled')},
  setItem(){throw Error('disabled')},
  removeItem(){throw Error('disabled')},
};
assert.deepEqual(readCartFor(A),{});
assert.deepEqual(writeCartFor(A,{[sku]:2}),{[sku]:2},'Temporary in-memory cart should remain usable');
console.log('PASS: 12 shop cart identity, legacy, corruption and storage-mode checks');
