// PR #274: real WebSocket Hub and Notifier regression, no external services.
// A failed device must not block other recipients, while the inbox remains
// atomic across all recipients. No SMS, RuStore requests or production data.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Hub, type Socket } from '../src/realtime/hub.ts';
import { Notifier } from '../src/services/notify.ts';
import type { Db } from '../src/db/index.ts';
import type { PushProvider, PushMessage } from '../src/providers/push.ts';

const message: PushMessage = {
  kind: 'normal', title: 'Тест', body: 'Событие', data: { orderId: 'test-order' },
};
const event = { type:'order_updated', orderId:'test-order' };

function createFakeDb(options: { failInsertAt?: number; failTokenLookup?: boolean; tokens?: {provider:string;token:string}[] } = {}) {
  const inbox: {userId:string;kind:string}[] = [];
  let insertCount = 0;
  let transactions = 0;
  let lookups = 0;
  const db = {
    tx: async <T>(fn: (q: {query: (sql:string,params?:unknown[]) => Promise<any[]>}) => Promise<T>): Promise<T> => {
      transactions++;
      const staged: {userId:string;kind:string}[] = [];
      const result = await fn({
        query: async (sql:string,params:unknown[]=[]) => {
          assert.match(sql,/insert into notifications/);
          insertCount++;
          if (insertCount === options.failInsertAt) throw Error('inbox transaction failed');
          staged.push({userId:String(params[0]),kind:String(params[1])});
          return [];
        },
      });
      inbox.push(...staged);
      return result;
    },
    query: async (sql:string) => {
      assert.match(sql,/from push_tokens/);
      lookups++;
      if(options.failTokenLookup)throw Error('device token database unavailable');
      return options.tokens ?? [];
    },
  } as unknown as Db;
  return {db,inbox,counts:()=>({transactions,lookups,insertCount})};
}

function createFakePush(options: {fail?:boolean}={}) {
  const sends:{tokens:string[];kind:string}[]=[];
  const push:PushProvider = {
    name:'test',
    async send(tokens,msg) {
      sends.push({tokens:tokens.map(x=>x.token),kind:msg.kind});
      if(options.fail)throw Error('push transport unavailable');
    },
  };
  return {push,sends};
}

function socket(onSend:(payload:string)=>void,readyState=1):Socket {
  return {send:onSend,readyState};
}

test('Hub isolates a broken socket, delivers to remaining tabs and prunes offline users',()=>{
  const hub=new Hub();
  hub.keepLog=true;
  const delivered:string[]=[];
  const broken=socket(()=>{throw Error('socket closed mid-send');});
  const good=socket(raw=>delivered.push('first:'+raw));
  const other=socket(raw=>delivered.push('second:'+raw));
  hub.add('first',broken);
  hub.add('first',good);
  hub.add('second',other);
  hub.send(['first','first','second',null],event);
  assert.deepEqual(delivered,[
    'first:'+JSON.stringify(event),
    'second:'+JSON.stringify(event),
  ]);
  assert.deepEqual(hub.log.map(x=>x.userId),['first','second']);
  assert.equal(hub.online('first'),true);
  hub.remove('first',good);
  assert.equal(hub.online('first'),false,'broken WebSocket must be removed');
  hub.remove('second',other);
  assert.equal(hub.online('second'),false);
});

test('Hub does not report a disconnected socket as an online performer',()=>{
  const hub=new Hub();
  const old=socket(()=>{},3);
  hub.add('worker',old);
  assert.equal(hub.online('worker'),false);
  let count=0;
  const fresh=socket(()=>count++);
  hub.add('worker',fresh);
  assert.equal(hub.online('worker'),true);
  hub.send(['worker'],event);
  assert.equal(count,1);
  fresh.readyState=3;
  assert.equal(hub.online('worker'),false);
});

test('Notifier stores exactly one inbox record per recipient and then delivers',async()=>{
  const {db,inbox,counts}=createFakeDb({tokens:[{provider:'rustore',token:'device-1'}]});
  const hub=new Hub();hub.keepLog=true;
  const pushed=createFakePush();
  const notifier=new Notifier(db,hub,pushed.push);
  await notifier.notify(['user-1','user-1',null,undefined,'user-2'],event,message);
  assert.deepEqual(inbox,[
    {userId:'user-1',kind:'order_updated'},
    {userId:'user-2',kind:'order_updated'},
  ]);
  assert.deepEqual(hub.log.map(x=>x.userId),['user-1','user-2']);
  assert.deepEqual(pushed.sends,[{tokens:['device-1'],kind:'normal'}]);
  assert.deepEqual(counts(),{transactions:1,lookups:1,insertCount:2});
});

test('a failed recipient INSERT rolls back the entire inbox and skips all live/push fan-out',async()=>{
  const {db,inbox}=createFakeDb({failInsertAt:2});
  const hub=new Hub();hub.keepLog=true;
  const pushed=createFakePush();
  const notifier=new Notifier(db,hub,pushed.push);
  await assert.rejects(notifier.notify(['user-1','user-2'],event,message),/inbox transaction failed/);
  assert.deepEqual(inbox,[]);
  assert.deepEqual(hub.log,[]);
  assert.deepEqual(pushed.sends,[]);
});

test('a failing optional push-token query leaves persisted inbox and WebSocket delivery intact',async()=>{
  const {db,inbox,counts}=createFakeDb({failTokenLookup:true});
  const hub=new Hub();hub.keepLog=true;
  let delivered=0;
  hub.add('user-1',socket(()=>{delivered++}));
  const pushed=createFakePush();
  const notifier=new Notifier(db,hub,pushed.push);
  const warnings:string[]=[];
  const previous=console.warn;
  console.warn=(...args:unknown[])=>{warnings.push(args.map(String).join(' '));};
  try {
    await notifier.notify(['user-1'],event,message);
  } finally {
    console.warn=previous;
  }
  assert.equal(inbox.length,1);
  assert.equal(delivered,1);
  assert.equal(counts().lookups,1);
  assert.deepEqual(pushed.sends,[]);
  assert.match(warnings.join(' '),/device token database unavailable/);
});

test('a push provider failure is reported but cannot make a completed notification look failed',async()=>{
  const {db,inbox}=createFakeDb({tokens:[{provider:'rustore',token:'broken-device'}]});
  const pushed=createFakePush({fail:true});
  const notifier=new Notifier(db,new Hub(),pushed.push);
  const warnings:string[]=[];
  const previous=console.warn;
  console.warn=(...args:unknown[])=>{warnings.push(args.map(String).join(' '));};
  try {
    await notifier.notify(['user-1'],event,message);
  } finally {
    console.warn=previous;
  }
  assert.equal(inbox.length,1);
  assert.equal(pushed.sends.length,1);
  assert.match(warnings.join(' '),/push transport unavailable/);
});

test('incoming call is delivered live but not written into unread inbox',async()=>{
  const {db,inbox,counts}=createFakeDb({tokens:[{provider:'rustore',token:'call-device'}]});
  const hub=new Hub();hub.keepLog=true;
  const pushed=createFakePush();
  const notifier=new Notifier(db,hub,pushed.push);
  await notifier.notify(['user-1','user-1'],{type:'incoming_call'},
    {kind:'call',title:'Вызов',body:'Входящий',data:{orderId:'test-order'}});
  assert.deepEqual(inbox,[]);
  assert.equal(counts().transactions,0);
  assert.deepEqual(hub.log.map(x=>x.userId),['user-1']);
  assert.deepEqual(pushed.sends,[{tokens:['call-device'],kind:'call'}]);
});
