// 200 real WebSocket clients against the SAME gateway as production.
// Disposable test database only: no live phones, GPS, partners or orders.
// Run: node --import tsx scripts/load-community-ws-200.mjs
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {mkdir,writeFile} from 'node:fs/promises';
import WebSocket from 'ws';

const {setup,ok}=await import('../server/test/helpers.ts');
const {attachRealtimeGateway}=await import('../server/src/realtime/gateway.ts');
const t=await setup();
const gateway=attachRealtimeGateway(t.server,t.app,t.db,{reauthEveryMs:1500});
const started=performance.now();
const sockets=[],received=Array.from({length:200},()=>0);
const violations=[];
const sleep=(ms)=>new Promise(resolve=>setTimeout(resolve,ms));
async function waitFor(predicate,message,maxMs=15000){
  const until=performance.now()+maxMs;
  while(!predicate()&&performance.now()<until)await sleep(50);
  assert.ok(predicate(),message);
}
async function run(){
  const admin=await t.login('+79990000001');
  const room=ok(await t.api('POST','/api/admin/community/rooms',{
    slug:'ws-200-driver-hints',title:'Испытание водительского Эфира',
    kind:'route',audience:'driver'
  },admin.token));
  const route='/api/community/rooms/'+room.id;
  const drivers=[];
  for(let i=0;i<200;i++){
    drivers.push(await t.login('+7999480'+String(i).padStart(4,'0'),'driver'));
  }
  await Promise.all(drivers.map(u=>t.api('POST',route+'/join',{},u.token).then(ok)));
  const wsOrigin=t.base.replace(/^http/,'ws');
  const open=async(index)=>{
    const ws=new WebSocket(wsOrigin+'/ws?token='+encodeURIComponent(drivers[index].token));
    sockets.push(ws);
    let hello=false;
    ws.on('message',(data)=>{
      let event;
      try{event=JSON.parse(String(data));}catch{violations.push('invalid_json');return;}
      if(event.type==='hello'){
        if(event.userId!==drivers[index].id)violations.push('wrong_hello_identity');
        hello=true;
      }else if(event.type==='community_message'){
        if(event.roomId!==room.id||typeof event.id!=='string'||
          'body' in event||'phone' in event||'sender_id' in event)
          violations.push('private_message_or_wrong_room');
        received[index]++;
      }
    });
    await new Promise((resolve,reject)=>{
      ws.once('open',resolve);
      ws.once('error',reject);
    });
    await waitFor(()=>hello,'missing authenticated hello',5000);
  };
  const startOpen=performance.now();
  // Distinct TCP/WebSocket handshakes, not just simulated Hub recipients.
  for(let start=0;start<200;start+=50){
    await Promise.all(Array.from({length:Math.min(50,200-start)},
      (_,j)=>open(start+j)));
  }
  const openWallMs=Math.round(performance.now()-startOpen);
  assert.equal(t.app.hub.log.length,0,'opening sockets must not send room hints');
  const sendStart=performance.now();
  const inputs=drivers.slice(0,20).map((u,i)=>({
    user:u,index:i,nonce:randomUUID(),text:'Проверка WebSocket на трассе '+i
  }));
  const sent=await Promise.all(inputs.map(x=>t.api('POST',route+'/messages',{
    text:x.text,clientNonce:x.nonce
  },x.user.token).then(ok)));
  assert.ok(sent.every(x=>x.status==='published'));
  const sendWallMs=Math.round(performance.now()-sendStart);
  await waitFor(()=>received.reduce((a,b)=>a+b,0)===20*199,
    'some of the 3,980 authenticated realtime room hints were lost',20000);
  const afterFirst=received.reduce((a,b)=>a+b,0);
  for(let i=0;i<200;i++){
    const expected=i<20?19:20; // no notification of your own publication
    assert.equal(received[i],expected,'wrong live hint count for driver '+i);
  }
  // Dropped HTTP response retry must not produce a second live notification.
  const retries=await Promise.all(inputs.map(x=>t.api('POST',route+'/messages',{
    text:x.text,clientNonce:x.nonce
  },x.user.token).then(ok)));
  for(let i=0;i<20;i++)assert.equal(retries[i].id,sent[i].id);
  await sleep(250);
  assert.equal(received.reduce((a,b)=>a+b,0),afterFirst,
    'duplicate retry generated another live notification');

  // One revoked driver keeps an open TCP connection. The periodic auth
  // recheck must forcibly close it even if the application did not reload.
  const revoked=199;
  const closed=new Promise(resolve=>sockets[revoked].once('close',(code)=>resolve(code)));
  await t.db.query("update users set roles=ARRAY['client']::text[] where id=$1",
    [drivers[revoked].id]);
  const closeCode=await Promise.race([closed,sleep(8000).then(()=>0)]);
  assert.equal(closeCode,1008,'driver role revocation did not close the socket');

  assert.deepEqual(violations,[]);
  const report={scenario:'200_authenticated_websockets_one_room',
    liveConnections:200,publishedMessages:20,expectedHints:3980,receivedHints:afterFirst,
    duplicateHints:0,roleRevocationCloseCode:closeCode,
    openWallMs,sendWallMs,durationMs:Math.round(performance.now()-started),
    violations};
  await mkdir('test-results',{recursive:true});
  await writeFile('test-results/community-ws-200.json',JSON.stringify(report,null,2));
  console.log('200 REAL WEBSOCKETS / 3,980 HINTS / ZERO DUPLICATE RETRIES / REVOCATION: PASS');
  console.log(JSON.stringify(report,null,2));
}
try{await run()}catch(e){console.error('[community-ws-load]',e);process.exitCode=1}
finally{
  for(const ws of sockets)ws.terminate();
  await new Promise(resolve=>gateway.close(resolve));
  await t.close();
}
