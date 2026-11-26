import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcileCase, moscowDay, reportDay } from '../src/domain/shopAgencyEvidence.ts';
import { parseNormalizedBankCsv } from '../src/domain/shopAgencyBankCsv.ts';

const agent={operation_kind:'client_purchase_agent',mandate_ref:'TEST-MANDATE',mandate_accepted_at:'2026-11-01T12:00:00Z',
  offer_version:'v1',fee_schedule_version:'v1',quantity:1,agreed_customer_total:1365000,
  expected_reimbursement:1000000,procurement_fee:300000,platform_fee:65000,evidence_version:5};
const evidence=[
  {kind:'purchase',source:'manually_checked',quantity:1,amount:1000000,vat_amount:200000,issued_at:'2026-11-02T00:00:00Z'},
  ...['mandate','handover','agent_report'].map(kind=>({kind,source:'manually_checked'})),
  {kind:'payment_proof',source:'manually_checked',reference:'BANK-IN'},
  {kind:'payment_proof',source:'manually_checked',reference:'BANK-OUT'}
];
const events=[
  {kind:'customer_receipt',amount:1365000,source_ref:'BANK-IN',occurred_at:'2026-11-02T00:00:00Z'},
  {kind:'supplier_payment',amount:1000000,source_ref:'BANK-OUT',occurred_at:'2026-11-02T00:00:00Z'},
  {kind:'handover',amount:0},{kind:'agent_report',amount:0}
];
test('evidence-only accounting: missing proof never promotes receipts to tax income',()=>{
  const empty=reconcileCase(agent,[],[]);
  assert.equal(empty.status,'awaiting_docs');
  assert.equal(empty.financial.taxableRevenue,null);
  const checked=reconcileCase(agent,evidence,events,[{kind:'verified',evidence_version:5}]);
  assert.equal(checked.status,'verified');
  assert.equal(checked.financial.feePotential,365000);
  assert.equal(checked.financial.taxableRevenue,null);
  assert.equal(reconcileCase(agent,evidence.filter(x=>x.kind!=='payment_proof'),events).status,'awaiting_docs');
  assert.equal(reconcileCase(agent,evidence,events,[{kind:'accountant_approved',evidence_version:4}]).status,'requires_reconciliation');
  assert.equal(reconcileCase(agent,evidence,events,[{kind:'accountant_approved',evidence_version:5}]).status,'accountant_approved');
});
test('pre-mandate procurement and payments are flagged, never silently backdated',()=>{
  const early=evidence.map(x=>x.kind==='purchase'?{...x,issued_at:'2026-10-31T23:59:59Z'}:x);
  const oldPay=events.map(x=>x.kind==='supplier_payment'?{...x,occurred_at:'2026-10-31T23:59:59Z'}:x);
  const result=reconcileCase(agent,early,oldPay);
  assert.equal(result.status,'requires_reconciliation');
  assert.ok(result.problems.some(x=>x.includes('раньше поручения')));
  assert.ok(result.problems.some(x=>x.includes('предшествует поручению')));
  assert.equal(result.financial.taxableRevenue,null);
});
test('refund totals and own inventory stay separate from potential agency fees',()=>{
  const corrected=reconcileCase(agent,evidence,[...events,{kind:'customer_receipt_reversal',amount:50000,source_ref:'R1'}]);
  assert.equal(corrected.financial.customerReceived,1315000);
  assert.equal(corrected.financial.taxableRevenue,null);
  const own=reconcileCase({...agent,operation_kind:'own_inventory_sale',expected_reimbursement:0,procurement_fee:0,platform_fee:0},evidence,events);
  assert.equal(own.financial.feePotential,0);
  assert.equal(own.financial.grossSalePotential,1365000);
  assert.equal(own.financial.taxableRevenue,null);
});
test('Moscow day boundaries and nonexistent calendar dates',()=>{
  assert.equal(moscowDay('2026-11-30T21:00:00Z'),'2026-12-01');
  assert.equal(moscowDay('2026-11-30T20:59:59Z'),'2026-11-30');
  assert.equal(reportDay('2028-02-29'),'2028-02-29');
  assert.throws(()=>reportDay('2026-02-29'));
});
const header='transaction_ref;occurred_at;direction;amount_kopecks;note';
const row=(ref:string,at='2026-12-01T10:00:00Z',direction='in',amount='1000')=>[ref,at,direction,amount,'test'].join(';');
const bank=(rows:string[])=>[header,...rows].join('\r\n')+'\r\n';
test('normalized bank CSV: 1000 rows, exact integer kopecks, distinct references and quoting',()=>{
  const rows=Array.from({length:1000},(_,i)=>row('TEST-'+i));
  const parsed=parseNormalizedBankCsv(bank(rows));
  assert.equal(parsed.length,1000);
  assert.equal(parsed[999].lineNo,1001);
  assert.equal(parsed[999].amount,1000);
  assert.throws(()=>parseNormalizedBankCsv(bank([...rows,row('TEST-1000')])));
  assert.throws(()=>parseNormalizedBankCsv(bank([rows[0],rows[0]])));
  assert.equal(parseNormalizedBankCsv(bank(['TEST-Q;2026-12-01T13:00:00+03:00;out;500;"test; ""quoted"""']))[0].note,'test; "quoted"');
  assert.equal(parseNormalizedBankCsv(bank(['TEST-Q;2026-12-01T13:00:00+03:00;out;500;test']))[0].occurredAt,'2026-12-01T10:00:00.000Z');
});
test('bank CSV refuses unrecognized format, nonpositive/fractional sums, bad dates and missing timezone',()=>{
  for(const bad of [row('TEST','2026-02-31T10:00:00Z'),row('TEST','2026-12-01T10:00:00'),row('TEST',undefined,'other'),row('TEST',undefined,'in','0'),row('TEST',undefined,'in','1.5'),row('TEST',undefined,'in','-1'),row('TEST',undefined,'in','1000000000000')]){
    assert.throws(()=>parseNormalizedBankCsv(bank([bad])));
  }
  assert.throws(()=>parseNormalizedBankCsv('unknown;format\n1;2'));
  assert.throws(()=>parseNormalizedBankCsv(bank(['TEST-Q;2026-12-01T10:00:00Z;out;500;"broken"extra'])));
});
