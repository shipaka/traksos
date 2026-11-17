import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, ok, type T } from './helpers.ts';

let t:T;
let admin:{token:string;id:string};
let client:{token:string;id:string};
const root='/api/admin/agency';
const pdf=(text:string)=>Buffer.from('%PDF-1.4\n'+text+'\n%%EOF').toString('base64');
const document=(kind:string,ref:string,value=0,qty=0,vat=0)=>({
  kind,supplierName:'Автоконтинент',reference:ref,issuedAt:'2026-11-15T10:00:00.000Z',
  amount:value,quantity:qty,vatAmount:vat,mime:'application/pdf',base64:pdf(ref)
});
before(async()=>{
  t=await setup();admin=await t.login('+79990000001');client=await t.login('+79991112233');
});
after(()=>t.close());

test('агентский заказ: без доказательств и подписанных условий нет подтверждения',async()=>{
  ok(await t.api('PUT','/api/admin/settings/shop',{enabled:true},admin.token));
  const p=ok(await t.api('POST','/api/admin/shop/products',{
    name:'Тестовый датчик EBS',price:1_365_000,stock:3,article:'TEST-13650'
  },admin.token));
  const o=ok(await t.api('POST','/api/shop/orders',{
    items:[{productId:p.id,qty:1}],delivery:'pickup'
  },client.token));
  const input={
    shopOrderId:o.id,lineIndex:0,operationKind:'client_purchase_agent',
    supplierName:'Автоконтинент',article:'TEST-13650',clientName:'ООО Тест',
    clientInn:'7800000000',mandateRef:'MANDATE-1',mandateAcceptedAt:'2026-11-01T12:00:00.000Z',
    offerVersion:'contract-v1',feeScheduleVersion:'agency-v1',
    expectedReimbursement:1_000_000,procurementFee:300_000,platformFee:65_000
  };
  assert.equal((await t.api('POST',root+'/cases',{...input,mandateRef:null},admin.token)).status,400);
  assert.equal((await t.api('POST',root+'/cases',{...input,platformFee:66_000},admin.token)).status,400);
  assert.equal((await t.api('POST',root+'/cases',input,client.token)).status,403);
  const c=ok(await t.api('POST',root+'/cases',input,admin.token));
  (globalThis as any).__agencyCase=c.id;
  assert.equal((await t.api('POST',root+'/cases',input,admin.token)).status,409);
  const state=ok(await t.api('GET',root+'/cases/'+c.id,undefined,admin.token));
  assert.equal(state.status,'awaiting_docs');
  assert.equal(state.financial.feePotential,365_000);
  assert.equal(state.financial.taxableRevenue,null);
  assert.ok(state.missing.some((s:string)=>s.includes('первичного')));
  assert.equal((await t.api('GET',root+'/cases/'+c.id,undefined,client.token)).status,403);
  assert.equal((await t.api('GET',root+'/report?from=2026-12-01&to=2026-12-01',undefined,client.token)).status,403);
});

test('первичка: уникальный файл, распределение, защита от повторов и переполнения',async()=>{
  const c=(globalThis as any).__agencyCase;
  const initial=ok(await t.api('POST',root+'/documents',document('purchase','UPD-TEST',1_000_000,1,200_000),admin.token));
  (globalThis as any).__purchaseDoc=initial.id;
  assert.equal(initial.source,'manual_unverified');
  const dupe=ok(await t.api('POST',root+'/documents',document('purchase','UPD-TEST',1_000_000,1,200_000),admin.token));
  assert.equal(dupe.duplicate,true);assert.equal(dupe.id,initial.id);
  assert.equal((await t.api('POST',root+'/documents',document('purchase','BAD-VAT',1_000,1,2_000),admin.token)).status,400);
  const a={documentId:initial.id,lineKey:'UPD-TEST:1',amount:1_000_000,quantity:1,vatAmount:200_000};
  const allocated=ok(await t.api('POST',root+'/cases/'+c+'/allocations',a,admin.token));
  assert.equal(ok(await t.api('POST',root+'/cases/'+c+'/allocations',a,admin.token)).duplicate,true);
  assert.equal((await t.api('POST',root+'/cases/'+c+'/allocations',{...a,lineKey:'UPD-TEST:2'},admin.token)).status,409);
  const response=ok(await t.api('GET',root+'/cases/'+c,undefined,admin.token));
  assert.equal(response.financial.purchaseRecorded,1_000_000);
  assert.equal(response.financial.purchaseConfirmed,0);
  assert.equal((await t.api('GET',root+'/documents/'+initial.id+'/file',undefined,client.token)).status,403);
  assert.equal((await t.api('POST',root+'/documents/'+initial.id+'/verify',{note:'test verified'},client.token)).status,403);
  ok(await t.api('POST',root+'/documents/'+initial.id+'/verify',{note:'Проверено по оригиналу УПД TEST'},admin.token));
});

test('полная доказательная цепочка, идемпотентность платежей и подтверждение версии',async()=>{
  const c=(globalThis as any).__agencyCase;
  const references:[string,string][]=[['mandate','M-TEST'],['handover','H-TEST'],['agent_report','AR-TEST']];
  for(const [kind,ref] of references){
    const d=ok(await t.api('POST',root+'/documents',document(kind,ref),admin.token));
    ok(await t.api('POST',root+'/cases/'+c+'/allocations',
      {documentId:d.id,lineKey:ref+':1',quantity:0,amount:0,vatAmount:0},admin.token));
    ok(await t.api('POST',root+'/documents/'+d.id+'/verify',
      {note:'Подтверждён оригинал '+ref},admin.token));
  }
  const evt=(kind:string,amt:number,when='2026-12-01T10:00:00.000Z')=>({
    kind,amount:amt,sourceRef:'TEST-'+kind,
    idempotencyKey:'test-key-'+kind,occurredAt:when
  });
  const receipt=evt('customer_receipt',1_365_000,'2026-11-30T21:30:00.000Z');
  const cash=ok(await t.api('POST',root+'/cases/'+c+'/events',receipt,admin.token));
  assert.equal(ok(await t.api('POST',root+'/cases/'+c+'/events',receipt,admin.token)).duplicate,true);
  assert.equal((await t.api('POST',root+'/cases/'+c+'/events',{...receipt,amount:42},admin.token)).status,409);
  ok(await t.api('POST',root+'/cases/'+c+'/events',evt('supplier_payment',1_000_000),admin.token));
  ok(await t.api('POST',root+'/cases/'+c+'/events',evt('handover',0),admin.token));
  ok(await t.api('POST',root+'/cases/'+c+'/events',evt('agent_report',0),admin.token));
  const before=ok(await t.api('GET',root+'/cases/'+c,undefined,admin.token));
  assert.deepEqual(before.missing,[]);assert.deepEqual(before.problems,[]);
  assert.equal(before.status,'requires_reconciliation','проверка не выдумывается автоматически');
  assert.equal((await t.api('POST',root+'/cases/'+c+'/review',
    {kind:'accountant_approved',note:'TEST'},admin.token)).status,409);
  ok(await t.api('POST',root+'/cases/'+c+'/review',{kind:'verified',note:'Документы проверены тестом'},admin.token));
  const r=ok(await t.api('GET',root+'/cases/'+c,undefined,admin.token));
  assert.equal(r.status,'verified');
  assert.equal(r.financial.customerReceived,1_365_000);
  assert.equal(r.financial.inputVatRecorded,200_000);
  const report=ok(await t.api('GET',root+'/report?from=2026-12-01&to=2026-12-01',undefined,admin.token));
  assert.equal(report.summary.customerReceived,1_365_000,'21:30Z попадает в 00:30 МСК следующего дня');
  assert.equal(report.summary.confirmedFeePotential,365_000);
  assert.equal(report.summary.taxableRevenue,null);
  assert.equal(report.companies.find((x:any)=>x.inn==='7800000000').received,1_365_000);
  const csv=await fetch(t.base+root+'/report.csv?from=2026-12-01&to=2026-12-01',{
    headers:{authorization:'Bearer '+admin.token}
  });
  assert.equal(csv.status,200);
  const csvText=await csv.text();assert.match(csvText,/NOT_DETERMINED/);
  assert.doesNotMatch(csvText,/base64/);
  ok(await t.api('POST',root+'/cases/'+c+'/review',
    {kind:'accountant_approved',note:'Внешняя бухгалтерская проверка TEST'},admin.token));
  const approved=ok(await t.api('GET',root+'/cases/'+c,undefined,admin.token));
  assert.equal(approved.status,'accountant_approved');
  const refund=evt('customer_refund',100_000);
  ok(await t.api('POST',root+'/cases/'+c+'/events',refund,admin.token));
  const afterRefund=ok(await t.api('GET',root+'/cases/'+c,undefined,admin.token));
  assert.equal(afterRefund.financial.customerReceived,1_265_000);
  assert.equal(afterRefund.status,'awaiting_docs','любая новая первичка снимает прежнее утверждение');
});

test('собственная перепродажа отдельно от агентских комиссий; роль не видит внутреннюю закупку',async()=>{
  const product=ok(await t.api('POST','/api/admin/shop/products',{
    name:'Складская тестовая деталь',price:10_000,stock:2
  },admin.token));
  const o=ok(await t.api('POST','/api/shop/orders',
    {items:[{productId:product.id,qty:1}],delivery:'pickup'},client.token));
  assert.equal((await t.api('POST',root+'/cases',{
    shopOrderId:o.id,lineIndex:0,operationKind:'own_inventory_sale',supplierName:'Склад',
    article:'OWN-TEST',clientName:'Частный покупатель',expectedReimbursement:1,
    procurementFee:0,platformFee:0
  },admin.token)).status,400);
  const c=ok(await t.api('POST',root+'/cases',{
    shopOrderId:o.id,lineIndex:0,operationKind:'own_inventory_sale',supplierName:'Склад',
    article:'OWN-TEST',clientName:'Частный покупатель',expectedReimbursement:0,
    procurementFee:0,platformFee:0
  },admin.token));
  const data=ok(await t.api('GET',root+'/cases/'+c.id,undefined,admin.token));
  assert.equal(data.financial.feePotential,0);
  assert.equal(data.operation_kind,'own_inventory_sale');
  assert.equal((await t.api('GET',root+'/documents/'+(globalThis as any).__purchaseDoc+'/file',
    undefined,client.token)).status,403);
  assert.equal((await t.api('POST',root+'/cases/'+c.id+'/events',{
    idempotencyKey:'x',kind:'customer_receipt',amount:1000,sourceRef:'X',occurredAt:'bad-date'
  },admin.token)).status,400);
});
