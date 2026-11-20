import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, ok, type T } from './helpers.ts';
import { parseNormalizedBankCsv } from '../src/services/shopAgencyBankReconciliation.ts';

const root='/api/admin/agency';
const head='transaction_ref;occurred_at;direction;amount_kopecks;note';
const csv=(lines:string[])=>[head,...lines].join('\r\n')+'\r\n';
const importBody=(text:string,accountRef='BANK-TEST-ACC-1',filename='test-normalized.csv')=>({
  bankName:'Тестовый банк',accountRef,filename,base64:Buffer.from(text).toString('base64'),
});
const source=(ref:string,dir:'in'|'out',amt:number,date='2026-12-01T10:00:00Z')=>
  [ref,date,dir,amt,'Контрольная операция'].join(';');
const pdf=(text:string)=>Buffer.from('%PDF-1.4\n'+text+'\n%%EOF').toString('base64');
let t:T,admin:{token:string;id:string},client:{token:string;id:string};

before(async()=>{
  t=await setup();admin=await t.login('+79990000001');
  client=await t.login('+79991112233');
});
after(()=>t.close());

test('CSV: strict normalized bank export, 1000 rows, duplicates and malformed values',()=>{
  const rows=Array.from({length:1000},(_,i)=>source('TRX-'+i,'in',1_000+i));
  const parsed=parseNormalizedBankCsv(csv(rows));
  assert.equal(parsed.length,1000);
  assert.equal(parsed[999].lineNo,1001);
  assert.equal(parsed[999].amount,1999);
  assert.throws(()=>parseNormalizedBankCsv(csv([...rows,source('TRX-1001','in',1)])),/1000/);
  assert.throws(()=>parseNormalizedBankCsv(csv([rows[0],rows[0]])),/Повтор ID/);
  assert.throws(()=>parseNormalizedBankCsv(csv([source('BAD-1','in',0)])),/сумм/);
  assert.throws(()=>parseNormalizedBankCsv(csv([source('BAD-1','out',100,'2026-02-31T10:00:00Z')])),
    /недействительна/);
  assert.throws(()=>parseNormalizedBankCsv(csv(['BAD-2;2026-12-01T10:00:00Z;in;100;"неправильно"в кавычках'])),
    /экранирование/);
  assert.deepEqual(parseNormalizedBankCsv(csv([
    'BANK-Q;2026-12-01T10:00:00Z;out;500;"Оплата; счёт ""Ромашка"""',
  ]))[0].note,'Оплата; счёт "Ромашка"');
});

test('банковский импорт: реальный PostgreSQL, запрет чужих ролей, дубликаты и неизменяемость',async()=>{
  const body=importBody(csv([
    source('BANK-1','in',1_365_000),source('BANK-2','out',1_000_000),
  ]));
  assert.equal((await t.api('POST',root+'/bank/statements',body,client.token)).status,403);
  const added=ok(await t.api('POST',root+'/bank/statements',body,admin.token));
  (globalThis as any).__agencyBankStatement=added.id;
  assert.equal(added.duplicate,false);assert.equal(added.rows,2);
  const repeated=ok(await t.api('POST',root+'/bank/statements',body,admin.token));
  assert.equal(repeated.duplicate,true);assert.equal(repeated.id,added.id);
  assert.equal((await t.api('POST',root+'/bank/statements',{
    ...body,accountRef:'BANK-DIFFERENT'
  },admin.token)).status,409,'один SHA нельзя импортировать под другим счётом');
  assert.equal((await t.api('POST',root+'/bank/statements',
    importBody(csv([source('BANK-1','in',1_365_001)]),'BANK-TEST-ACC-1','other.csv'),
    admin.token)).status,409,'один ID банковской операции не задваивается между файлами');
  const all=ok(await t.api('GET',root+'/bank/statements',undefined,admin.token));
  assert.equal(all.length,1);
  assert.equal((await t.api('GET',root+'/bank/statements',undefined,client.token)).status,403);
  const detail=ok(await t.api('GET',root+'/bank/statements/'+added.id+'/rows',undefined,admin.token));
  assert.equal(detail.unmatched,2);assert.equal(detail.rows.length,2);
  assert.equal(detail.statement.content_sha256,added.sha256);
  (globalThis as any).__agencyBankRows=detail.rows;
  await assert.rejects(
    t.db.query('update shop_agency_bank_statements set bank_name=$2 where id=$1',
      [added.id,'Подмена банка']),/immutable/i);
  await assert.rejects(
    t.db.query('delete from shop_agency_bank_rows where id=$1',[detail.rows[0].id]),
    /immutable/i);
});

test('сопоставление: только проверенная первичка, копейки, направление, реквизит, исправление через отзыв',async()=>{
  ok(await t.api('PUT','/api/admin/settings/shop',{enabled:true},admin.token));
  const product=ok(await t.api('POST','/api/admin/shop/products',{
    name:'Банковский тест: компонент EBS',price:1_365_000,stock:3,article:'BANK-EBS-TEST'
  },admin.token));
  const order=ok(await t.api('POST','/api/shop/orders',{
    items:[{productId:product.id,qty:1}],delivery:'pickup'
  },client.token));
  const c=ok(await t.api('POST',root+'/cases',{
    shopOrderId:order.id,lineIndex:0,operationKind:'client_purchase_agent',
    supplierName:'Автоконтинент',article:'BANK-EBS-TEST',clientName:'ООО Тест',
    clientInn:'7800000000',mandateRef:'BANK-MANDATE-1',
    mandateAcceptedAt:'2026-11-01T12:00:00.000Z',
    offerVersion:'contract-bank-1',feeScheduleVersion:'agency-bank-1',
    expectedReimbursement:1_000_000,procurementFee:300_000,platformFee:65_000,
  },admin.token));
  const event=async (kind:string,amt:number,ref:string,key:string)=>ok(await t.api('POST',
    root+'/cases/'+c.id+'/events',{
      idempotencyKey:key,kind,amount:amt,sourceRef:ref,
      occurredAt:'2026-12-01T10:00:00Z',
    },admin.token));
  const receipt=await event('customer_receipt',1_365_000,'BANK-1','BANK-RECEIPT-KEY');
  const payment=await event('supplier_payment',1_000_000,'BANK-2','BANK-SUPPLIER-KEY');
  const rows=(globalThis as any).__agencyBankRows as any[];
  const row1=rows.find(r=>r.transaction_ref==='BANK-1');
  const row2=rows.find(r=>r.transaction_ref==='BANK-2');
  const match=(rowId:string,eventId:string,note='Проверил выписку и оригинал платёжного документа')=>
    t.api('POST',root+'/bank/matches',{rowId,eventId,note},admin.token);
  assert.equal((await match(row1.id,receipt.id)).status,409,
    'одного номера банка недостаточно до проверки оригинала');
  assert.equal((await match(row2.id,receipt.id)).status,409,
    'несовпадающие направления и суммы нельзя сопоставить');
  assert.equal((await t.api('POST',root+'/bank/matches',{
    rowId:row1.id,eventId:receipt.id,note:'Проверено по банку',
  },client.token)).status,403);
  for(const [reference] of [['BANK-1'],['BANK-2']]){
    const proof=ok(await t.api('POST',root+'/documents',{
      kind:'payment_proof',supplierName:'Автоконтинент',
      reference,issuedAt:'2026-12-01T10:00:00Z',
      amount:0,quantity:0,vatAmount:0,mime:'application/pdf',base64:pdf(reference),
    },admin.token));
    ok(await t.api('POST',root+'/cases/'+c.id+'/allocations',{
      documentId:proof.id,lineKey:reference+':proof',
      quantity:0,amount:0,vatAmount:0,
    },admin.token));
    ok(await t.api('POST',root+'/documents/'+proof.id+'/verify',{
      note:'Документ сверен с оригиналом платежа '+reference,
    },admin.token));
  }
  const matched=ok(await match(row1.id,receipt.id));
  assert.equal(matched.duplicate,false);
  assert.equal(ok(await match(row1.id,receipt.id)).duplicate,true);
  assert.equal((await match(row1.id,payment.id)).status,409);
  const second=ok(await match(row2.id,payment.id));
  assert.equal(second.duplicate,false);
  const caseView=ok(await t.api('GET',root+'/cases/'+c.id+'/bank',undefined,admin.token));
  assert.equal(caseView.matched,2);assert.equal(caseView.unmatched,0);
  assert.equal((await t.api('GET',root+'/cases/'+c.id+'/bank',undefined,client.token)).status,403);
  assert.equal((await t.api('POST',root+'/bank/matches/'+matched.id+'/retract',{
    note:'Оригинал сопоставлен ошибочно, отмена связи',},client.token)).status,403);
  const retract=ok(await t.api('POST',root+'/bank/matches/'+matched.id+'/retract',{
    note:'Оригинал сопоставлен ошибочно, отмена связи',
  },admin.token));
  assert.equal(retract.duplicate,false);
  assert.equal(ok(await t.api('POST',root+'/bank/matches/'+matched.id+'/retract',{
    note:'Оригинал сопоставлен ошибочно, отмена связи',
  },admin.token)).duplicate,true);
  assert.equal((await t.api('POST',root+'/bank/matches/'+matched.id+'/retract',{
    note:'Иная причина отмены',
  },admin.token)).status,409);
  const newMatch=ok(await match(row1.id,receipt.id,'Повторно сверено с оригиналом и выпиской банка'));
  assert.notEqual(newMatch.id,matched.id,'неизменяемую отменённую связь нельзя оживлять');
  assert.equal(ok(await t.api('GET',root+'/cases/'+c.id+'/bank',undefined,admin.token)).matched,2);
  const after=ok(await t.api('GET',root+'/bank/statements/'+
    (globalThis as any).__agencyBankStatement+'/rows',undefined,admin.token));
  assert.equal(after.matched,2);assert.equal(after.unmatched,0);
  await assert.rejects(t.db.query('delete from shop_agency_bank_matches where id=$1',[matched.id]),
    /immutable/i);
  await assert.rejects(t.db.query(
    'update shop_agency_bank_match_retractions set note=$2 where id=$1',
    [retract.id,'Подмена']),/immutable/i);
});

test('массовый нормализованный импорт 1000 строк без генерации платежей',async()=>{
  const body=importBody(csv(Array.from({length:1000},(_,i)=>
    source('MASS-'+String(i).padStart(4,'0'),'in',100+i))),
    'BANK-LOAD-ACC-1000','normalized-1000.csv');
  const data=ok(await t.api('POST',root+'/bank/statements',body,admin.token));
  assert.equal(data.rows,1000);
  const rows=ok(await t.api('GET',root+'/bank/statements/'+data.id+'/rows',undefined,admin.token));
  assert.equal(rows.rows.length,1000);
  assert.equal(rows.matched,0);
  const n=(await t.db.one<{n:number}>(
    "select count(*)::int as n from shop_agency_events where id is not null"))!.n;
  assert.equal(n,2,'импорт CSV не создаёт ни одной банковской или товарной проводки');
});
