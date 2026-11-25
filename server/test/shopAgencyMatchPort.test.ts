import test from 'node:test';
import assert from 'node:assert/strict';
import type { AuthUser } from '../src/http/router.ts';
import { setup, ok } from './helpers.ts';
import { ShopAgencyLedger } from '../src/services/shopAgencyLedger.ts';
import { ShopAgencyBankReconciliation } from '../src/services/shopAgencyBankReconciliation.ts';

// Archived bank-match acceptance, adapted to the explicit activity gate.
// Uses only disposable PostgreSQL and the existing mock shop test fixtures.
test('agency bank: classification, checked proof, exact match, concurrent replay and immutable retraction', {timeout:90000}, async()=>{
  const t=await setup();
  try {
    const a=await t.login('+79990000001');
    const c=await t.login('+79990000592');
    const actor=async(id:string)=>{
      const row=await t.db.one<AuthUser>('select id,phone,name,roles,status,owner_id from users where id=$1',[id]);
      assert.ok(row);return row;
    };
    const admin=await actor(a.id),client=await actor(c.id);
    const ledger=new ShopAgencyLedger(t.db),bank=new ShopAgencyBankReconciliation(t.db);
    const denied=(code:string)=>(e:any)=>e?.status===403||e?.code===code;
    const conflict=(code:string)=>(e:any)=>e?.status===409&&e?.code===code;
    await assert.rejects(bank.statements(client),denied('forbidden'));
    ok(await t.api('PUT','/api/admin/settings/shop',{enabled:true},a.token));
    const product=ok(await t.api('POST','/api/admin/shop/products',{
      category:'brakes',name:'Synthetic EBS part',price:1365000,stock:3,article:'BANK-EBS-TEST'
    },a.token));
    const order=ok(await t.api('POST','/api/shop/orders',{
      items:[{productId:product.id,qty:1}],delivery:'pickup'
    },c.token));
    const entry=await ledger.createCase(admin,{
      shopOrderId:order.id,lineIndex:0,operationKind:'client_purchase_agent',
      supplierName:'Synthetic supplier',article:'BANK-EBS-TEST',clientName:'Synthetic customer',
      mandateRef:'BANK-MANDATE-1',mandateAcceptedAt:'2026-11-01T12:00:00Z',
      offerVersion:'contract-test-1',feeScheduleVersion:'agency-test-1',
      expectedReimbursement:1000000,procurementFee:300000,platformFee:65000,
    });
    const event=async(kind:string,amount:number,sourceRef:string,idempotencyKey:string)=>
      ledger.addEvent(admin,entry.id,{kind,amount,sourceRef,idempotencyKey,occurredAt:'2026-12-01T10:00:00Z'});
    const receipt=await event('customer_receipt',1365000,'BANK-1','BANK-RECEIPT-KEY');
    const payment=await event('supplier_payment',1000000,'BANK-2','BANK-PAYMENT-KEY');
    const header='transaction_ref;occurred_at;direction;amount_kopecks;note';
    const line=(ref:string,dir:string,amount:number,date='2026-12-01T10:00:00Z')=>
      [ref,date,dir,amount,'synthetic'].join(';');
    const csv=[header,line('BANK-1','in',1365000),line('BANK-2','out',1000000),
      line('BANK-OTHER','in',1365000),line('BANK-WRONG-AMOUNT','in',1365001)].join('\n')+'\n';
    const statement=await bank.importStatement(admin,{bankName:'Synthetic bank',
      accountRef:'BANK-TEST-ACC',filename:'normalized.csv',base64:Buffer.from(csv).toString('base64')});
    const original=await bank.statementRows(admin,statement.id);
    assert.equal(original.unclassified,4);
    const row=(ref:string)=>{const found=original.rows.find(r=>r.transaction_ref===ref);assert.ok(found);return found.id as string;};
    const row1=row('BANK-1'),row2=row('BANK-2');
    const note='Проверены выписка и оригинал документа';
    const match=(rowId:string,eventId:string)=>bank.match(admin,rowId,eventId,note);
    const classify=(id:string,activity:'traksos_shop'|'ip_primary',key:string)=>
      bank.classify(admin,id,{activity,note:'Учебная ручная классификация',requestKey:key});
    await assert.rejects(match(row1,receipt.id),conflict('bank_activity_mismatch'));
    await classify(row1,'ip_primary','classify-main-ip');
    await assert.rejects(match(row1,receipt.id),conflict('bank_activity_mismatch'));
    await classify(row1,'traksos_shop','classify-shop-1');
    await classify(row2,'traksos_shop','classify-shop-2');
    await classify(row('BANK-OTHER'),'traksos_shop','classify-shop-3');
    await classify(row('BANK-WRONG-AMOUNT'),'traksos_shop','classify-shop-4');
    await assert.rejects(match(row1,receipt.id),conflict('bank_proof_missing'));
    await assert.rejects(match(row2,receipt.id),conflict('bank_direction_mismatch'));
    await assert.rejects(match(row('BANK-OTHER'),receipt.id),conflict('bank_reference_mismatch'));
    await assert.rejects(match(row('BANK-WRONG-AMOUNT'),receipt.id),conflict('bank_amount_mismatch'));
    await assert.rejects(bank.match(client,row1,receipt.id,note),denied('forbidden'));
    const proof=async(reference:string)=>{
      const document=await ledger.addDocument(admin,{
        kind:'payment_proof',supplierName:'Synthetic supplier',reference,
        issuedAt:'2026-12-01T10:00:00Z',amount:0,vatAmount:0,quantity:0,
        mime:'application/pdf',base64:Buffer.from('%PDF-1.4\n'+reference+'\n%%EOF').toString('base64'),
      });
      await ledger.allocate(admin,entry.id,{documentId:document.id,lineKey:reference+':proof',
        quantity:0,amount:0,vatAmount:0});
      return document;
    };
    const proof1=await proof('BANK-1');
    await assert.rejects(match(row1,receipt.id),conflict('bank_proof_missing'));
    await ledger.reviewDocument(admin,proof1.id,'Оригинал проверен вручную');
    const proof2=await proof('BANK-2');
    await ledger.reviewDocument(admin,proof2.id,'Оригинал проверен вручную');
    const paired=await Promise.all([match(row1,receipt.id),match(row1,receipt.id)]);
    assert.equal(paired[0].id,paired[1].id);
    assert.equal(paired.filter(r=>!r.duplicate).length,1);
    const first=paired[0];
    await assert.rejects(classify(row1,'ip_primary','classify-active'),conflict('bank_classification_matched'));
    await assert.rejects(match(row1,payment.id),conflict('bank_match_conflict'));
    const second=await match(row2,payment.id);
    assert.equal(second.duplicate,false);
    assert.equal((await bank.caseMatches(admin,entry.id)).matched,2);
    await assert.rejects(bank.caseMatches(client,entry.id),denied('forbidden'));
    const reason='Учебный отзыв ошибочной связи с документом';
    await assert.rejects(bank.retract(client,first.id,reason),denied('forbidden'));
    const removed=await bank.retract(admin,first.id,reason);
    assert.equal(removed.duplicate,false);
    assert.equal((await bank.retract(admin,first.id,reason)).duplicate,true);
    await assert.rejects(bank.retract(admin,first.id,'Другая причина изменения'),conflict('bank_retraction_conflict'));
    await classify(row1,'ip_primary','classify-after-retract');
    await assert.rejects(match(row1,receipt.id),conflict('bank_activity_mismatch'));
    await classify(row1,'traksos_shop','classify-return-shop');
    const rematched=await match(row1,receipt.id);
    assert.notEqual(rematched.id,first.id);
    assert.equal((await bank.caseMatches(admin,entry.id)).matched,2);
    const result=await bank.statementRows(admin,statement.id);
    assert.equal(result.matched,2);
    assert.equal(result.unmatched,2);
    await assert.rejects(t.db.query('delete from shop_agency_bank_matches where id=$1',[first.id]),/immutable/i);
    await assert.rejects(t.db.query('update shop_agency_bank_match_retractions set note=$2 where id=$1',[removed.id,'Подмена']),/immutable/i);
    assert.equal((await t.db.one<{n:number}>('select count(*)::int as n from shop_agency_events where case_id=$1',[entry.id]))?.n,2);
  }finally{await t.close();}
});
