import test from 'node:test';
import assert from 'node:assert/strict';
import { AdminCaseCenter, recordedStageLines } from '../src/services/adminCaseCenter.ts';

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

test('mechanic extras and spare parts remain separate itemized lines, never a fabricated receipt',()=>{
  const recorded=recordedStageLines(
    {id:'work-1',status:'awaiting_confirmation',call_out_amount:150000,work_amount:250000},
    [{order_id:'work-1',type:'amount_proposed',data:{bill:{
      time:200000,wait:10000,extras:[{name:'Запчасть',amount:40000}],total:250000
    }}}]
  );
  assert.equal(recorded.lines.length,4);
  assert.deepEqual(recorded.lines.map(x=>x.amount),[150000,200000,10000,40000]);
  assert.equal(recorded.workVerified,true);
  assert.equal(recorded.quoteOnly,true);
});

test('operational CSV is audited and protects against spreadsheet formula injection',async()=>{
  const logs:any[]=[];
  const db:any={query:async(_sql:string,params:any[])=>{logs.push(params);return [];}};
  const svc=new AdminCaseCenter(db);
  (svc as any).detail=async()=>({
    root_id:'root-1',case_number:'М-000010',
    stages:[{stage_no:1,number:456,status:'completed',recorded_items:{
      lines:[{kind:'extra',description:'=unsafe()',amount:40000,source:'order_events.amount_proposed'}],
      workVerified:true
    }}],bookings:[]
  });
  const result=await svc.exportOperationalCsv({id:'admin-1'} as any,'root-1');
  assert.ok(result.csv.includes("'=unsafe()"));
  assert.ok(result.csv.includes('40000'));
  assert.match(result.notice,/Не является/);
  assert.equal(logs[0][1],'root-1');
});

test('mixed order/СТО stage ordinals never change when stage types interleave',async()=>{
  const root='00000000-0000-4000-8000-000000000001';
  const second='00000000-0000-4000-8000-000000000002';
  const booking='00000000-0000-4000-8000-000000000003';
  const db:any={
    one:async(sql:string)=>sql.includes('select id,case_root_id')
      ?{id:root,case_root_id:null}
      :sql.includes('select multi_number')?{multi_number:9}:null,
    query:async(sql:string)=>{
      if(sql.includes('from orders o'))return [
        {id:root,number:15,vehicle_id:null},
        {id:second,number:17,vehicle_id:null}
      ];
      if(sql.includes('from service_bookings b join service_centers'))
        return [{id:booking,number:16,center_name:'СТО'}];
      if(sql.includes('from case_stage_index'))return [
        {source_kind:'order',source_id:root,ordinal:1},
        {source_kind:'booking',source_id:booking,ordinal:2},
        {source_kind:'order',source_id:second,ordinal:3}
      ];
      return [];
    }
  };
  const detail=await new AdminCaseCenter(db).detail({id:'admin'} as any,root);
  assert.deepEqual(detail.stages.map(x=>x.stage_no),[1,3]);
  assert.equal(detail.bookings[0].stage_no,2);
  assert.equal(detail.case_number,'М-000009');
});


test('operational CSV separates actual payout and platform commission from client itemization',async()=>{
  const audit:any[]=[];
  const svc=new AdminCaseCenter({query:async(_sql:string,params:any[])=>{audit.push(params);return [];}} as any);
  (svc as any).detail=async()=>({
    root_id:'root-paid',case_number:'М-000042',
    stages:[{id:'paid-stage',stage_no:2,number:777,status:'completed',recorded_items:{lines:[],workVerified:false}}],
    bookings:[],
    payouts:[{order_id:'paid-stage',amount:180000,commission:10000,status:'paid'}]
  });
  const exported=await svc.exportOperationalCsv({id:'admin'} as any,'root-paid');
  assert.match(exported.csv,/Реестр выплат \(не клиентский счёт\)/);
  assert.match(exported.csv,/Реестр комиссий \(не налоговая база\)/);
  assert.ok(exported.csv.includes('180000'));
  assert.ok(exported.csv.includes('10000'));
  assert.equal(audit.length,1);
  assert.equal(audit[0][1],'root-paid');
  assert.match(exported.notice,/Не является/);
});


test('a journal note does not incorrectly label an unchanged case as moderated',async()=>{
  let sql='';
  const db:any={query:async(q:string)=>{sql=q;return [];}};
  await new AdminCaseCenter(db).list('','moderated');
  assert.match(sql,/from mod_cases/);
  assert.match(sql,/order\.resolve/);
  assert.match(sql,/order\.discount/);
  assert.doesNotMatch(sql,/admin\.case_note/);
});


test('moderated filter includes commented cases without moving them out of general register',async()=>{
  let sql='';
  const svc=new AdminCaseCenter({
    query:async(q:string)=>{sql=q;return [
      {id:'root',number:11,multi_number:null,order_count:1,workshop_count:0,has_active:true,moderated:true},
      {id:'normal',number:12,multi_number:null,order_count:1,workshop_count:0,has_active:true,moderated:false}
    ];}
  } as any);
  assert.equal((await svc.list('','all')).length,2);
  assert.deepEqual((await svc.list('','moderated')).map((x:any)=>x.number),[11]);
  assert.match(sql,/admin\.case_note/);
});

test('admin case details resolve the linked vehicle and its previous workshop history',async()=>{
  const root='00000000-0000-4000-8000-000000000100';
  const vehicleId='00000000-0000-4000-8000-000000000200';
  const calls:any[]=[];
  const db:any={
    one:async(sql:string,params:any[])=>{
      if(sql.includes('select id,case_root_id'))return {id:root,case_root_id:null};
      if(sql.includes('from vehicles where id='))return {id:vehicleId,brand:'R',model:'Грузовик',plate:'А100АА'};
      if(sql.includes('select multi_number'))return null;
      return null;
    },
    query:async(sql:string,params:any[])=>{
      calls.push({sql,params});
      if(sql.includes('from orders o left join users'))return [{id:root,vehicle_id:vehicleId,number:15,created_at:'2026-11-18'}];
      if(sql.includes('from service_bookings b join service_centers') && sql.includes('where b.case_root_id'))return [];
      if(sql.includes('from service_bookings b') && sql.includes('b.vehicle_id='))return [
        {id:'previous-booking',number:8,center_name:'СТО',created_at:'2026-11-16'}
      ];
      if(sql.includes('from orders o where o.vehicle_id'))return [{id:'previous-order',number:7}];
      return [];
    }
  };
  const d=await new AdminCaseCenter(db).detail({id:'admin'} as any,root);
  assert.equal(d.vehicle.id,vehicleId);
  assert.equal(d.vehicle_history[0].number,7);
  assert.equal(d.vehicle_history_bookings[0].number,8);
  const bookingQuery=calls.find(c=>c.sql.includes('b.vehicle_id='));
  assert.deepEqual(bookingQuery.params,[vehicleId,[]]);
  assert.ok(calls.some(c=>c.sql.includes('admin.case_view')));
});
