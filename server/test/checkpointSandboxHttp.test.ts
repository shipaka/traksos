import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomBytes } from 'node:crypto';
import pg from 'pg';

// Separate Node test worker. Never import helpers.ts: its primary-site
// configuration and destructive schema reset are not suitable for this test.
test('checkpoint HTTP: real isolated sandbox handoffs, consent, review and no billing', {timeout:120000}, async () => {
  const base = new URL(process.env.TEST_DATABASE_URL ?? 'postgres://postgres@127.0.0.1:5432/traksos_test');
  assert.ok(['127.0.0.1','localhost','[::1]'].includes(base.hostname) &&
    /^\/[^/]*test[^/]*$/i.test(base.pathname), 'Requires a LOCAL disposable test PostgreSQL');
  const name='traksos_checkpoint_sandbox_'+randomBytes(8).toString('hex');
  const isolated=new URL(base);
  isolated.pathname='/'+name;
  const adminDb=new pg.Client({connectionString:base.href});
  await adminDb.connect();
  let created=false;
  let db: import('../src/db/index.ts').Db | undefined;
  let server: http.Server | undefined;
  const secret='checkpoint-local-test-'+randomBytes(32).toString('hex');
  const env: Record<string,string> = {
    NODE_ENV:'test', DATABASE_URL:isolated.href, SANDBOX_INSTANCE:'true',
    SANDBOX_URL:'', SANDBOX_SHARED_SECRET:secret,
    ADMIN_PHONES:'+79000000001', MODERATOR_PHONES:'+79000000005',
    SMS_PROVIDER:'log', PUSH_PROVIDER:'log', PAYMENT_PROVIDER:'mock',
    TOCHKA_INVOICE_ENABLED:'false', TRAKBOT_LLM_ENABLED:'false',
    CHECKPOINT_EVIDENCE_API_ENABLED:'true', APP_SECRET:secret,
    TRAKSOS_LEGACY_CASH_FIXTURES:'1', TRAKSOS_PAYMENT_FIXTURES:'1',
    DEVELOPER_REPORT_WEBHOOK_URL:'', DEVELOPER_REPORT_WEBHOOK_SECRET:'',
  };
  const previous=Object.fromEntries(Object.keys(env).map(k=>[k,process.env[k]]));
  try {
    // Only a random, newly created database is migrated or dropped.
    await adminDb.query('create database "'+name+'"');
    created=true;
    Object.assign(process.env,env);
    const { config }=await import('../src/config.ts');
    assert.equal(config.sandboxInstance,true);
    assert.equal(config.databaseUrl,isolated.href);
    const {createDb}=await import('../src/db/index.ts');
    const {migrate}=await import('../src/db/migrate.ts');
    const {createApp}=await import('../src/app.ts');
    const {LogSms}=await import('../src/providers/sms.ts');
    const {LogPush}=await import('../src/providers/push.ts');
    const {MockProvider}=await import('../src/payments/provider.ts');
    const {issueSandboxTicket,SANDBOX_USER_PHONE}=await import('../src/services/sandboxTickets.ts');
    db=await createDb(config.databaseUrl);
    assert.equal(db.driver,'pg');
    await migrate(db);
    const actual=await db.one<{name:string}>('select current_database() as name');
    assert.equal(actual?.name,name);
    const app=createApp({db,sms:new LogSms(),push:new LogPush(),payments:new MockProvider('http://test')});
    server=http.createServer((req,res)=>void app.handle(req,res));
    await new Promise<void>(resolve=>server!.listen(0,'127.0.0.1',resolve));
    const origin='http://127.0.0.1:'+(server.address() as AddressInfo).port;
    async function request(method:string,path:string,body?:unknown,token?:string) {
      const response=await fetch(origin+path,{method,headers:{
        'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{}),
      },body:body===undefined?undefined:JSON.stringify(body)});
      return {status:response.status,body:await response.json()};
    }
    async function ok(method:string,path:string,body?:unknown,token?:string) {
      const r=await request(method,path,body,token);
      assert.equal(r.status,200,method+' '+path+': '+JSON.stringify(r.body));
      return r.body;
    }
    assert.equal((await ok('GET','/api/health')).sandbox,true);
    assert.equal((await request('POST','/api/auth/code',{phone:SANDBOX_USER_PHONE.client})).status,403);
    async function role(role:'client'|'master'|'admin'|'owner',roles:string[]) {
      const user=await db!.one<{id:string}>('insert into users(phone,name,roles) values($1,$2,$3::text[]) returning id',
        [SANDBOX_USER_PHONE[role],'Checkpoint fixture '+role,roles]);
      assert.ok(user);
      const ticket=issueSandboxTicket(role,secret);
      const grant=await ok('POST','/api/sandbox/exchange',{ticket});
      assert.equal(grant.role,role);
      assert.equal((await ok('GET','/api/me',undefined,grant.token)).id,user.id);
      assert.equal((await request('POST','/api/sandbox/exchange',{ticket})).status,403);
      return {id:user.id,token:grant.token as string};
    }
    const client=await role('client',['client']);
    const worker=await role('master',['master']);
    const admin=await role('admin',['admin','client']);
    const outsider=await role('owner',['client']);
    // Accept the current client/privacy documents if the migrations published any.
    const offers=await db.query<{id:string}>(`select distinct on(audience) id from offers
      where audience in ('client','privacy') and effective_at<=now()
      order by audience,effective_at desc,published_at desc`);
    for(const offer of offers) await ok('POST','/api/offers/'+offer.id+'/accept',{},client.token);
    const order=await ok('POST','/api/orders',{
      service:'electric',zoneId:'spb',regionId:'spb',address:'Санкт-Петербург, учебный адрес',
      paymentMethod:'cash',
    },client.token);
    const id=order.order.id as string;
    // Only assignment is a fixture; all checkpoint actions go through real HTTP.
    await db.query("update orders set performer_id=$2,status='accepted' where id=$1",[id,worker.id]);
    const prefix='/api/orders/'+id;
    const plan={requestKey:'http-plan-001',lat:59.9343,lng:30.3351,radiusM:200,
      requiresPass:true,locationDescription:'Учебный КПП'};
    assert.equal((await request('GET',prefix+'/checkpoint')).status,401);
    assert.equal((await request('PUT',prefix+'/checkpoint-plan',plan,outsider.token)).status,403);
    const p=await ok('PUT',prefix+'/checkpoint-plan',plan,client.token);
    assert.equal(p.version,1);
    assert.equal((await ok('PUT',prefix+'/checkpoint-plan',plan,client.token)).reused,true);
    assert.equal((await request('PUT',prefix+'/checkpoint-plan',{...plan,lat:60},client.token)).status,409);
    const grant={eventKey:'http-grant-001',planId:p.planId,action:'granted',durationMinutes:30};
    const attempt={requestKey:'http-attempt-001',planId:p.planId,gpsConsent:true};
    assert.equal((await request('POST',prefix+'/checkpoint/arrival',attempt,worker.token)).status,403);
    assert.equal((await request('POST',prefix+'/checkpoint/gps-consent',grant,client.token)).status,403);
    assert.equal((await ok('POST',prefix+'/checkpoint/gps-consent',grant,worker.token)).active,true);
    const review={eventKey:'http-pass-review-001',outcome:'cleared',
      evidenceRef:'synthetic-local-reference',evidenceHash:'a'.repeat(64),
      explanation:'Учебная ручная проверка допуска на территорию.'};
    const passPath='/api/admin/checkpoint-plans/'+p.planId+'/pass-review';
    assert.equal((await request('POST',passPath,review,client.token)).status,403);
    assert.equal((await ok('POST',passPath,review,admin.token)).outcome,'cleared');
    const first=await ok('POST',prefix+'/checkpoint/arrival',attempt,worker.token);
    assert.equal(first.outcome,'needs_review');
    assert.equal(first.startBilling,false);
    assert.equal((await ok('POST',prefix+'/checkpoint/arrival',attempt,worker.token)).reused,true);
    const gps='/api/admin/checkpoint-attempts/'+first.id+'/gps';
    assert.equal((await request('GET',gps,undefined,client.token)).status,403);
    assert.equal((await ok('GET',gps,undefined,admin.token)).sampleCount,0);
    assert.equal((await request('GET',prefix+'/checkpoint',undefined,outsider.token)).status,403);
    const decision={decision:'insufficient',explanation:'Недостаточно учебных данных для подтверждения.'};
    const decisionPath='/api/checkpoint-attempts/'+first.id+'/decision';
    assert.equal((await request('POST',decisionPath,decision,outsider.token)).status,403);
    assert.equal((await ok('POST',decisionPath,decision,client.token)).startBilling,false);
    assert.equal((await ok('POST',decisionPath,decision,client.token)).reused,true);
    assert.equal((await ok('POST',prefix+'/checkpoint/gps-consent',{
      eventKey:'http-revoke-001',planId:p.planId,action:'revoked',
    },worker.token)).active,false);
    assert.equal((await request('POST',prefix+'/checkpoint/arrival',{
      ...attempt,requestKey:'http-attempt-after-revoke',
    },worker.token)).status,403);
    const state=await ok('GET',prefix+'/checkpoint',undefined,client.token);
    assert.equal(state.gpsConsent.active,false);
    assert.equal(state.startBilling,false);
    const privacy=await ok('GET','/api/me/checkpoint-privacy',undefined,outsider.token);
    assert.deepEqual(privacy.samples,[]);
    assert.deepEqual(privacy.consentEvents,[]);
    assert.deepEqual(privacy.approvedPlans,[]);
    assert.equal((await request('GET','/api/admin/checkpoint-gps/integrity',undefined,worker.token)).status,403);
    assert.equal((await ok('GET','/api/admin/checkpoint-gps/integrity',undefined,admin.token)).checks.length,7);
    const final=await db.one<any>('select status,arrived_at,wait_started_at from orders where id=$1',[id]);
    assert.equal(final.status,'accepted');
    assert.equal(final.arrived_at,null);
    assert.equal(final.wait_started_at,null);
    assert.equal((await db.one<{n:number}>('select count(*)::int as n from payments where order_id=$1',[id]))?.n,0);
  } finally {
    try {
      if(server) await new Promise<void>((resolve,reject)=>server!.close(err=>err?reject(err):resolve()));
    } finally {
      try { await db?.close(); }
      finally {
        try { if(created) await adminDb.query('drop database "'+name+'" with (force)'); }
        finally {
          await adminDb.end();
          for(const [key,value] of Object.entries(previous)){
            if(value===undefined)delete process.env[key]; else process.env[key]=value;
          }
        }
      }
    }
  }
});
