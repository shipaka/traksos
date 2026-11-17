// Dedicated 1000-driver public-room load: ephemeral PostgreSQL, never production.
// Usage: node --import tsx scripts/load-community-1000.mjs
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir,writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';

const {setup,ok}=await import('../server/test/helpers.ts');
const t=await setup();
const COUNT=1000;
const started=performance.now();
const measurements=[];
const errors=[];

const pct=(values,p)=> {
  if(!values.length)return null;
  const sorted=[...values].sort((a,b)=>a-b);
  return Math.round(sorted[Math.min(sorted.length-1,Math.ceil(sorted.length*p)-1)]*10)/10;
};
async function request(user,method,path,body,label=method+' '+path.split('?')[0]){
  const start=performance.now();
  const r=await t.api(method,path,body,user?.token);
  measurements.push({label,ms:performance.now()-start,status:r.status});
  if(r.status!==1000){
    errors.push({label,status:r.status,error:r.body?.error??'http_error'});
    assert.equal(r.status,1000,label+': HTTP '+r.status);
  }
  return r.body;
}
async function run(){
  const admin=await t.login('+79990000001');
  const room=await request(admin,'POST','/api/admin/community/rooms',{
    slug:'air-1000-parallel-load',title:'Проверка 1000 водителей',kind:'route',audience:'driver'
  });
  const endpoint='/api/community/rooms/'+room.id;
  const drivers=[];
  for(let i=0;i<COUNT;i++){
    drivers.push(await t.login('+7999470'+String(i).padStart(4,'0'),'driver'));
  }
  assert.equal(drivers.length,COUNT);

  const joinStart=performance.now();
  await Promise.all(drivers.map(u=>request(u,'POST',endpoint+'/join',{},'room_join')));
  const joinWallMs=Math.round(performance.now()-joinStart);

  const items=drivers.map((u,i)=>({
    user:u,nonce:randomUUID(),text:'Проверка Эфира, водитель '+String(i+1)
  }));
  const sendStart=performance.now();
  const sent=[];
  for(let first=0;first<items.length;first+=100){
    // All 1000 drivers participate, with bounded 100-request bursts. This
    // tests sustainable throughput without overwhelming the 10-connection pool.
    sent.push(...await Promise.all(items.slice(first,first+100).map(x=>request(
      x.user,'POST',endpoint+'/messages',{text:x.text,clientNonce:x.nonce},
      'message_send_1000'))));
  }
  const sendWallMs=Math.round(performance.now()-sendStart);
  assert.equal(new Set(sent.map(x=>x.id)).size,COUNT);
  assert.ok(sent.every(x=>x.status==='published'));
  // Simulate a phone retrying after it did not receive the first HTTP reply.
  const replayStart=performance.now();
  const replay=[];
  for(let first=0;first<items.length;first+=100){
    replay.push(...await Promise.all(items.slice(first,first+100).map(x=>request(
      x.user,'POST',endpoint+'/messages',{text:x.text,clientNonce:x.nonce},
      'message_retry_1000'))));
  }
  const replayWallMs=Math.round(performance.now()-replayStart);
  for(let i=0;i<sent.length;i++)assert.equal(replay[i].id,sent[i].id);

  const saved=await t.db.query(
    'select count(*)::int as n from community_messages where room_id=$1',[room.id]);
  const events=await t.db.query(
    'select count(*)::int as n from community_room_moderation_events where room_id=$1',[room.id]);
  assert.equal(saved[0].n,COUNT,'each driver persisted exactly one message');
  assert.equal(events[0].n,COUNT,'each public message produced exactly one event');
  const eventIds=new Set(),messageIds=new Set();
  let after='0',pages=0,lastRevision=0n;
  const first=await request(drivers[0],'GET',endpoint+'/messages?recent=1&limit=50',undefined,'initial_recent');
  assert.equal(first.messages.length,50);
  while(true){
    pages++;
    assert.ok(pages<=Math.ceil(COUNT/100)+1,'1000 publications should fit in ten pages');
    const feed=await request(drivers[0],'GET',
      endpoint+'/moderation-events?after='+after+'&limit=100',undefined,'event_page');
    for(const e of feed.changes){
      const revision=BigInt(e.revision);
      assert.ok(revision>lastRevision,'event stream cursor must be strictly ascending');
      lastRevision=revision;
      assert.ok(!eventIds.has(e.revision),'event delivered twice');
      assert.ok(!messageIds.has(e.id),'duplicate message in event stream');
      eventIds.add(e.revision);messageIds.add(e.id);
      assert.equal(e.moderation_state,'published');
      assert.ok(!('sender_id' in e.message));
      assert.ok(!('phone' in e.message));
    }
    if(!feed.hasMore)break;
    after=feed.nextCursor;
  }
  assert.equal(eventIds.size,COUNT);
  assert.equal(messageIds.size,COUNT);
  assert.equal(pages,Math.ceil(COUNT/100));

  const metrics={};
  for(const label of new Set(measurements.map(x=>x.label))){
    const samples=measurements.filter(x=>x.label===label).map(x=>x.ms);
    metrics[label]={calls:samples.length,p50_ms:pct(samples,.5),
      p95_ms:pct(samples,.95),p99_ms:pct(samples,.99),max_ms:pct(samples,1)};
  }
  const report={scenario:'1000_driver_same_room',accounts:drivers.length,
    messages:saved[0].n,events:events[0].n,duplicateMessages:0,
    joinWallMs,sendWallMs,replayWallMs,eventPages:pages,
    metrics,errors,durationMs:Math.round(performance.now()-started)};
  await mkdir('test-results',{recursive:true});
  await writeFile('test-results/community-load-1000.json',JSON.stringify(report,null,2));
  // A generous threshold detects pathological deadlocks without making a
  // slow shared runner a benchmark of production SLA. Publish p95 report.
  assert.ok(sendWallMs<300_000,'1000 publication requests unexpectedly exceeded 300 seconds');
  console.log('1000 REAL DRIVERS / SAME ROOM / NO LOST EVENTS / NO DUPLICATE RETRIES: PASS');
  console.log(JSON.stringify(report,null,2));
}
try{await run()}catch(e){console.error('[community-1000-load]',e);process.exitCode=1}
finally{await t.close()}
