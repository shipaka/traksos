import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PartnerFinance} from '../src/services/partnerFinance.ts';

const admin={id:'admin',roles:['admin']} as any;
const partner={id:'partner',roles:['insurer']} as any;
const client={id:'client',roles:['client']} as any;

function mock(request:{id:string;kind:string;assigned_to:string|null;status:string}={id:'req',kind:'insurance',assigned_to:'partner',status:'completed'},existing=false){
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

test('confirmed payout cannot exceed the request balance',async()=>{
  const calls:{sql:string;params:any[]}[]=[];
  const db:any={
    tx:async(fn:any)=>fn(db),
    one:async(sql:string,params:any[])=>{
      calls.push({sql,params});
      if(sql.startsWith('select id,kind,assigned_to from'))return {id:'req',kind:'inspection',assigned_to:'partner'};
      if(sql.includes('as balance'))return {balance:'2500'};
      if(sql.startsWith('select id from partner_finance_entries'))return null;
      if(sql.startsWith('insert into partner_finance_entries'))return {id:'payout',amount_kopecks:params[3]};
      return null;
    },
    query:async(sql:string,params:any[])=>{calls.push({sql,params});return [];},
  };
  const finance=new PartnerFinance(db);
  await assert.rejects(finance.recordPayout(client,'req',500,'transfer-001'));
  await assert.rejects(finance.recordPayout(admin,'req',2600,'transfer-001'));
  await assert.rejects(finance.recordPayout(admin,'req',100,''));
  const result=await finance.recordPayout(admin,'req',2500,'transfer-001');
  assert.equal(result.amount_kopecks,2500);
  assert.ok(calls.some(c=>c.sql.includes('partner_finance.payout')));
  assert.ok(calls.some(c=>c.sql.includes('for update')));
});

test('reversal cannot reduce a paid or absent balance',async()=>{
  const calls:{sql:string;params:any[]}[]=[];
  const db:any={
    tx:async(fn:any)=>fn(db),
    one:async(sql:string,params:any[])=>{
      calls.push({sql,params});
      if(sql.startsWith('select id,kind,assigned_to from'))return {id:'req',kind:'insurance',assigned_to:'partner'};
      if(sql.includes('as balance'))return {balance:'300'};
      if(sql.startsWith('insert into partner_finance_entries'))return {id:'reversal',amount_kopecks:params[3]};
      return null;
    },
    query:async(sql:string,params:any[])=>{calls.push({sql,params});return [];},
  };
  const finance=new PartnerFinance(db);
  await assert.rejects(finance.recordReversal(client,'req',100,'Correction'));
  await assert.rejects(finance.recordReversal(admin,'req',400,'Correction'));
  await assert.rejects(finance.recordReversal(admin,'req',100,''));
  const entry=await finance.recordReversal(admin,'req',300,'Correction');
  assert.equal(entry.amount_kopecks,300);
  assert.ok(calls.some(c=>c.sql.includes('partner_finance.reversal')));
});

test('inspection-only finance access never includes insurance entries',async()=>{
  const {db,queries}=mock();
  const operator={id:'operator',roles:['inspection_operator']} as any;
  await new PartnerFinance(db).mine(operator);
  assert.equal(queries.length,2);
  assert.ok(queries.every(q=>q.sql.includes("kind='inspection'")));
  assert.ok(queries.every(q=>q.params[0]==='operator'&&q.params[1]===false));
});
