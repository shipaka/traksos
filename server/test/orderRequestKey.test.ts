import {test} from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {newOrderRequestKey} from '../../web/src/orderRequestKey.ts';

test('Android WebView-safe request UUIDs are RFC 4122 v4 and do not rely on randomUUID',()=>{
  const simulatedOldWebView={getRandomValues(bytes:Uint8Array){
    for(let i=0;i<bytes.length;i++)bytes[i]=i;
    return bytes;
  }};
  assert.equal(newOrderRequestKey(simulatedOldWebView),
    '00010203-0405-4607-8809-0a0b0c0d0e0f');
});

test('secure order keys have strong entropy and do not repeat across 512 requests',()=>{
  const keys=new Set<string>();
  for(let n=0;n<512;n++){
    const key=newOrderRequestKey(webcrypto);
    assert.match(key,/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    keys.add(key);
  }
  assert.equal(keys.size,512,'same request key must be reused only intentionally');
});

test('missing secure randomness throws rather than using Math.random',()=>{
  assert.throws(()=>newOrderRequestKey({getRandomValues(){
    throw new Error('secure entropy unavailable');
  }}),/secure entropy unavailable/);
});
