import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PartnerFinance} from '../src/services/partnerFinance.ts';

const admin={id:'admin',roles:['admin']} as any;
const partner={id:'partner',roles:['insurer']} as any;
const client={id:'client',roles:['client']} as any;

function mock(request={id:'req',kind:'insurance',assigned_to:'partner',status:'completed'},existing=false){
  const queries:{sql:string;params:any[]}[]=[];
  const db:any={
    tx:async(fn:any)=>fn(db),
    one:async(sql:string,params:any[])=>{
      queries.push({sql,params});
      if(sql.startsWith('select id,kind,assigned_to,status'))return request;
      if(sql.startsWith('select id from partner_finance_entries'))return existing?{id:'entry'}:null;
      if(sql.startsWith('insert into partner_finance_entries'))return {id:'entry',partner_id:params[0],amount_kopecks:params[3]};
      return null;
    },
    query:async(sql:string,params:any[])=>{
      queries.push({sql,params});
      return [];
    },
  };
  return {db,queries};
}

test('only admin can register a positive justified accrual',async()=>{
  const {db,queries}=mock();
  await assert.rejects(new PartnerFinance(db).recordAccrual(client,'req',100,'Act 123'));
  await assert.rejects(new PartnerFinance(db).recordAccrual(admin,'req',0,'Act 123'));
  await assert.rejects(new PartnerFinance(db).recordAccrual(admin,'req',100,''));
  const entry=await new PartnerFinance(db).recordAccrual(admin,'req',100,'Act 123');
  assert.equal(entry.partner_id,'partner');
  assert.ok(queries.some(q=>q.sql.includes('partner_finance.accrual')));
});
test('no accrual for unfinished, unassigned or already accrued request',async()=>{
  await assert.rejects(new PartnerFinance(mock({id:'req',kind:'insurance',assigned_to:'partner',status:'submitted'}).db).recordAccrual(admin,'req',100,'Act 123'));
  await assert.rejects(new PartnerFinance(mock({id:'req',kind:'inspection',assigned_to:null,status:'completed'}).db).recordAccrual(admin,'req',100,'Act 123'));
  await assert.rejects(new PartnerFinance(mock(undefined,true).db).recordAccrual(admin,'req',100,'Act 123'));
});
test('partner can see only own ledger',async()=>{
  const {db,queries}=mock();
  await assert.rejects(new PartnerFinance(db).mine(client));
  await new PartnerFinance(db).mine(partner);
  assert.equal(queries.length,2);
  assert.ok(queries.every(q=>q.params[0]==='partner'));
});
