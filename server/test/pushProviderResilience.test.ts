// PR #274: RuStore transport reliability; all network responses are synthetic.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RuStorePush, type PushMessage } from '../src/providers/push.ts';

const normal:PushMessage = {
  kind:'normal',title:'Тест',body:'Событие',data:{orderId:'synthetic-order'},
};
const devices=(...tokens:string[])=>tokens.map(token=>({provider:'rustore',token}));

test('RuStore sends one bounded data message per unique matching device only',async()=>{
  const sent:{url:string;init:RequestInit}[]=[];
  const original=globalThis.fetch;
  globalThis.fetch=(async(url:URL|string|Request,init?:RequestInit)=>{
    assert.ok(init);
    sent.push({url:String(url),init});
    return new Response(null,{status:204});
  }) as typeof fetch;
  try {
    await new RuStorePush('project-fixture','secret-test').send([
      ...devices('phone-a','phone-a','phone-b'),
      {provider:'other',token:'ignored-phone'},
    ],normal);
  } finally {
    globalThis.fetch=original;
  }
  assert.equal(sent.length,2,'duplicate token must not produce duplicate delivery');
  assert.ok(sent.every(({url})=>url.endsWith('/projects/project-fixture/messages:send')));
  assert.deepEqual(sent.map(({init})=>JSON.parse(String(init.body)).message.token),['phone-a','phone-b']);
  for(const {init} of sent) {
    assert.equal(init.method,'POST');
    assert.equal(init.redirect,'error','never forward private message data to a redirect');
    assert.equal((init.headers as Record<string,string>).authorization,'Bearer secret-test');
    assert.ok(init.signal instanceof AbortSignal,'push request must have a real timeout signal');
    const body=JSON.parse(String(init.body)).message;
    assert.deepEqual(body.data,{orderId:'synthetic-order',kind:'normal',title:'Тест',body:'Событие'});
    assert.deepEqual(body.android,{priority:'NORMAL',ttl:'3600s'});
  }
});

test('one HTTP reject and one network failure do not skip healthy recipients or expose response contents',async()=>{
  const attempted:string[]=[];
  const original=globalThis.fetch;
  globalThis.fetch=(async(_url:URL|string|Request,init?:RequestInit)=>{
    const token=JSON.parse(String(init?.body)).message.token;
    attempted.push(token);
    if(token==='http-error')return new Response('SECRET_TOKEN_FROM_PROVIDER',{status:403});
    if(token==='network-error')throw Error('PRIVATE_NETWORK_DETAILS');
    return new Response(null,{status:204});
  }) as typeof fetch;
  let outcome='';
  try {
    await new RuStorePush('project-fixture','secret-test')
      .send(devices('http-error','ok-device','network-error'),normal);
  } catch(error) {
    outcome=String(error);
  } finally {
    globalThis.fetch=original;
  }
  assert.deepEqual(attempted,['http-error','ok-device','network-error']);
  assert.match(outcome,/failed for 2 of 3 devices/);
  assert.doesNotMatch(outcome,/SECRET_TOKEN_FROM_PROVIDER|PRIVATE_NETWORK_DETAILS|http-error|network-error/);
});

test('incoming call preserves HIGH priority and supplied TTL without saving to inbox',async()=>{
  const requests:Record<string,any>[]=[];
  const original=globalThis.fetch;
  globalThis.fetch=(async(_url:URL|string|Request,init?:RequestInit)=>{
    requests.push(JSON.parse(String(init?.body)));
    return new Response(null,{status:200});
  }) as typeof fetch;
  try {
    await new RuStorePush('test','test').send(devices('call-device'),{
      kind:'call',title:'Вызов',body:'Входящий',data:{orderId:'synthetic'},ttlSeconds:20,
    });
  } finally {
    globalThis.fetch=original;
  }
  assert.equal(requests.length,1);
  assert.deepEqual(requests[0].message.android,{priority:'HIGH',ttl:'20s'});
  assert.equal(requests[0].message.data.kind,'call');
});

test('empty list or non-RuStore tokens return without making external requests',async()=>{
  const original=globalThis.fetch;
  globalThis.fetch=(async()=>{throw Error('should not fetch');}) as typeof fetch;
  try {
    await new RuStorePush('project','token').send([],normal);
    await new RuStorePush('project','token').send([{provider:'fcm',token:'other'}],normal);
  } finally {
    globalThis.fetch=original;
  }
});

test('RuStore discards untrusted provider bodies and refuses redirect responses',async()=>{
 const original=globalThis.fetch;
 let cancelled=0;
 globalThis.fetch=(async(_url:URL|string|Request,init?:RequestInit)=>{
  assert.equal(init?.redirect,'error');
  return new Response(new ReadableStream({cancel(){cancelled++;}}),{
   status:307,headers:{location:'https://example.invalid/redirect'},
  });
 }) as typeof fetch;
 try{
  await assert.rejects(new RuStorePush('project','secret').send(devices('test-device'),normal),
   /failed for 1 of 1 devices/);
  assert.equal(cancelled,1);
 }finally{globalThis.fetch=original;}
});
