import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, ok } from './helpers.ts';
import { config } from '../src/config.ts';

test('order idempotency header is permitted on allowed cross-origin preflight',async()=>{
  const t=await setup();
  try {
    const origin=config.corsOrigins.includes('*')?'https://traksos-client.example':config.corsOrigins[0];
    const response=await fetch(t.base+'/api/orders',{
      method:'OPTIONS',
      headers:{
        Origin:origin,
        'Access-Control-Request-Method':'POST',
        'Access-Control-Request-Headers':'authorization, content-type, idempotency-key',
      },
    });
    assert.equal(response.status,204);
    assert.equal(response.headers.get('access-control-allow-origin'),origin);
    assert.match(response.headers.get('access-control-allow-headers')??'',/(^|,\s*)idempotency-key($|,)/);
  } finally { await t.close(); }
});

test('order SLA date window is bounded and never accepts NaN or Infinity',async()=>{
  const t=await setup();
  try {
    const admin=await t.login('+79990000001');
    assert.equal((await t.api('GET','/api/admin/order-sla?days=NaN',undefined,admin.token)).status,400);
    assert.equal((await t.api('GET','/api/admin/order-sla?days=Infinity',undefined,admin.token)).status,400);
    assert.equal((await t.api('GET','/api/admin/order-sla?days=-1',undefined,admin.token)).status,400);
    const result=ok(await t.api('GET','/api/admin/order-sla?days=30',undefined,admin.token));
    assert.equal(result.days,30);
  }finally { await t.close(); }
});
