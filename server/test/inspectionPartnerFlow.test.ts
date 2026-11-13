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
  const result=await new VehicleServiceRequests(db).updateInspection(partner,'request','completed');
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
