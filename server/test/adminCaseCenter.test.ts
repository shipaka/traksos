import test from 'node:test';
import assert from 'node:assert/strict';
import { AdminCaseCenter } from '../src/services/adminCaseCenter.ts';

test('multi-case number is displayed only for two or more linked stages', async () => {
  const fakeDb:any={
    query:async()=>[
      {id:'a',number:123,multi_number:'41',order_count:2,workshop_count:0,has_active:true,moderated:false},
      {id:'b',number:124,multi_number:null,order_count:1,workshop_count:0,has_active:false,moderated:false},
    ]
  };
  const service=new AdminCaseCenter(fakeDb);
  const items=await service.list('');
  assert.equal(items[0].case_number,'М-000041');
  assert.equal(items[0].is_multi,true);
  assert.equal(items[1].case_number,null);
  assert.equal(items[1].is_multi,false);
  assert.equal((await service.list('','active')).length,1);
  assert.equal((await service.list('','closed')).length,1);
});

test('search for an M-number uses its own sequence and does not merge it with order numbers', async () => {
  let params:any[]=[],sql='';
  const fakeDb:any={query:async(s:string,p:any[])=>{sql=s;params=p;return [];}};
  await new AdminCaseCenter(fakeDb).list('М-000041');
  assert.equal(params[0],'');
  assert.equal(params[1],41);
  assert.match(sql,/cr\.multi_number/);
  await new AdminCaseCenter(fakeDb).list('78456');
  assert.equal(params[0],'78456');
  assert.equal(params[1],null);
});

test('admin notes require reasons and use immutable audit entries on root case', async () => {
  let writes=0,submitted:any[]=[],sql='';
  const db:any={
    one:async()=>({id:'stage-2',case_root_id:'root-1'}),
    query:async(s:string,p:any[])=>{writes++;sql=s;submitted=p;return [];}
  };
  const svc=new AdminCaseCenter(db);
  const admin:any={id:'admin-1'};
  await assert.rejects(()=>svc.note(admin,'stage-2','  x  '));
  assert.equal(writes,0);
  const result=await svc.note(admin,'stage-2','  Причина изменения   ');
  assert.equal(result.root_id,'root-1');
  assert.equal(writes,1);
  assert.match(sql,/admin\.case_note/);
  assert.equal(submitted[0],'admin-1');
  assert.equal(submitted[1],'root-1');
  assert.deepEqual(submitted[2],{comment:'Причина изменения',orderId:'stage-2'});
});

test('admin case detail preserves stage numbers and audit-logs sensitive reads', async () => {
  const root='00000000-0000-4000-8000-000000000001';
  const second='00000000-0000-4000-8000-000000000002';
  let audit=0;
  const fakeDb:any={
    one:async(s:string)=>{
      if(s.includes('select id,case_root_id'))return {id:second,case_root_id:root};
      if(s.includes('select multi_number'))return {multi_number:7};
      return null;
    },
    query:async(s:string)=>{
      if(s.includes('from orders o'))return [
        {id:root,number:300,vehicle_id:null,created_at:'2026-11-18T12:00:00Z'},
        {id:second,number:302,vehicle_id:null,created_at:'2026-11-18T13:00:00Z'}
      ];
      if(s.includes('from service_bookings'))return [];
      if(s.includes('insert into audit_log')){audit++;return [];}
      return [];
    }
  };
  const detail=await new AdminCaseCenter(fakeDb).detail({id:'admin'} as any,second);
  assert.equal(detail.root_id,root);
  assert.equal(detail.case_number,'М-000007');
  assert.deepEqual(detail.stages.map(x=>[x.stage_no,x.number]),[[1,300],[2,302]]);
  assert.equal(audit,1);
});
