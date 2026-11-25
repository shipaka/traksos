import {test} from 'node:test';
import assert from 'node:assert/strict';
import {VehicleServiceRequests} from '../src/services/vehicleServiceRequests.ts';

const staff={id:'admin',roles:['admin']} as any;
const partner={id:'partner',roles:['insurer']} as any;
const outsider={id:'outsider',roles:['client']} as any;

function fixture(kind='inspection',assigned_to='partner',status='sent_to_partner'){
  const calls:{sql:string;params:any[]}[]=[];
  const db:any={
    tx:async(fn:any)=>fn(db),
    one:async(sql:string,params:any[])=>{
      calls.push({sql,params});
      if(sql.startsWith('select * from vehicle_service_requests')) return {id:params[0],kind,assigned_to,status};
      if(sql.startsWith('select id from users'))return {id:params[0]};
      if(sql.startsWith('update vehicle_service_requests'))return {id:params[0],kind,status:sql.includes("status='sent_to_partner'")?'sent_to_partner':params[1]};
      return null;
    },
    query:async(sql:string,params:any[])=>{calls.push({sql,params});return [];},
  };
  return {db,calls};
}

test('inspection queue is restricted to partner and kind',async()=>{
  const {db,calls}=fixture();
  await new VehicleServiceRequests(db).inspectionQueue(partner);
  assert.match(calls[0].sql,/kind='inspection'/);
  assert.match(calls[0].sql,/assigned_to=\$1/);
  await assert.rejects(new VehicleServiceRequests(db).inspectionQueue(outsider));
});
test('inspection assignment is restricted to staff and kind',async()=>{
  const {db,calls}=fixture();
  await new VehicleServiceRequests(db).assignInspection(staff,'request','partner');
  assert.match(calls.find(c=>c.sql.startsWith('update vehicle_service_requests'))!.sql,/kind='inspection'/);
  await assert.rejects(new VehicleServiceRequests(db).assignInspection(outsider,'request','partner'));
});
test('only assigned inspection partner can close an inspection',async()=>{
  const {db}=fixture();
  const result=await new VehicleServiceRequests(db).updateInspection(partner,'request','completed','Осмотр выполнен');
  assert.equal(result.status,'completed');
  await assert.rejects(new VehicleServiceRequests(db).updateInspection(outsider,'request','completed'));
  const wrong=fixture('insurance');
  await assert.rejects(new VehicleServiceRequests(wrong.db).updateInspection(partner,'request','completed'));
  const assignedElsewhere=fixture('inspection','another');
  await assert.rejects(new VehicleServiceRequests(assignedElsewhere.db).updateInspection(partner,'request','completed'));
});
test('rejection requires reason and terminal state cannot be changed',async()=>{
  const {db}=fixture();
  await assert.rejects(new VehicleServiceRequests(db).updateInspection(partner,'request','rejected'),'missing reason');
  const done=fixture('inspection','partner','completed');
  await assert.rejects(new VehicleServiceRequests(done.db).updateInspection(partner,'request','completed'));
});

test('inspection-only operator can access assigned inspection queue and decision',async()=>{
  const operator={id:'partner',roles:['inspection_operator']} as any;
  const {db,calls}=fixture();
  await new VehicleServiceRequests(db).inspectionQueue(operator);
  assert.ok(calls.some(c=>c.sql.includes("kind='inspection'")));
  const result=await new VehicleServiceRequests(db).updateInspection(operator,'request','completed','Осмотр выполнен');
  assert.equal(result.status,'completed');
});


test('assigned inspection partner must provide a new meaningful result before completion',async()=>{
  for(const note of [undefined,'','   ','  итог  ']){
    const {db,calls}=fixture();
    await assert.rejects(new VehicleServiceRequests(db).updateInspection(partner,'request','completed',note),/фактический результат осмотра/);
    assert.equal(calls.some(c=>c.sql.startsWith('update vehicle_service_requests')),false);
    assert.equal(calls.some(c=>c.sql.startsWith('insert into audit_log')),false);
  }
  const {db,calls}=fixture();
  const result=await new VehicleServiceRequests(db).updateInspection(partner,'request','completed','  Осмотр выполнен  ');
  assert.equal(result.status,'completed');
  assert.equal(calls.find(c=>c.sql.startsWith('update vehicle_service_requests'))?.params[2],'Осмотр выполнен');
});


test('inspection pages and direct details are assigned-only and keep old active work visible', {timeout:60000}, async()=>{
  const {setup,ok}=await import('./helpers.ts');
  const t=await setup();
  try {
    const owner=await t.login('+79997763121');
    const a=await t.login('+79997763122');
    const b=await t.login('+79997763123');
    await t.db.query("update users set roles=array['inspection_operator']::text[] where id=any($1::uuid[])",[[a.id,b.id]]);
    const car=ok(await t.api('POST','/api/vehicles',{brand:'Scania',model:'R',year:2018,plate:'А921АА178'},owner.token));
    await t.db.query("update vehicles set vin='YS2R4X20001234567' where id=$1",[car.id]);
    const old=await t.db.one<{id:string}>(`insert into vehicle_service_requests
      (owner_id,requested_by,vehicle_id,kind,status,assigned_to,created_at)
      values($1,$1,$2,'inspection','sent_to_partner',$3,now()-interval '1 year') returning id`,[owner.id,car.id,a.id]);
    assert.ok(old);
    await t.db.query(`insert into vehicle_service_requests
      (owner_id,requested_by,vehicle_id,kind,status,assigned_to,created_at)
      select $1,$1,$2,'inspection','completed',$3,now()-n*interval '1 minute'
      from generate_series(1,105) n`,[owner.id,car.id,a.id]);
    const path='/api/insurer/inspections';
    const active=ok(await t.api('GET',path+'/page?view=active&page=1',undefined,a.token));
    assert.equal(active.active,1);assert.equal(active.history,105);
    assert.deepEqual(active.items.map((x:any)=>x.id),[old.id]);
    const pages:string[]=[];
    for(let i=1;i<=4;i++){
      const result=ok(await t.api('GET',path+'/page?view=history&page='+i,undefined,a.token));
      assert.equal(result.items.length,i===4?15:30);
      pages.push(...result.items.map((x:any)=>x.id));
    }
    assert.equal(new Set(pages).size,105);
    const detail=ok(await t.api('GET',path+'/'+old.id,undefined,a.token));
    assert.equal(detail.id,old.id);assert.equal(detail.year,2018);
    assert.equal(detail.vin,'YS2R4X20001234567');
    assert.equal(detail.owner_id,undefined);
    assert.equal((await t.api('GET',path+'/'+old.id,undefined,b.token)).status,404);
    assert.equal((await t.api('GET',path+'/'+old.id,undefined,owner.token)).status,403);
    assert.equal((await t.api('GET',path+'/page?page=0',undefined,a.token)).status,400);
    assert.equal((await t.api('GET',path+'/page?view=other',undefined,a.token)).status,400);
    assert.equal((await t.api('GET',path+'/not-a-uuid',undefined,a.token)).status,400);
    await t.db.query('update vehicle_service_requests set assigned_to=$2 where id=$1',[old.id,b.id]);
    assert.equal((await t.api('GET',path+'/'+old.id,undefined,a.token)).status,404);
    assert.equal(ok(await t.api('GET',path+'/'+old.id,undefined,b.token)).id,old.id);
  } finally {await t.close();}
});
