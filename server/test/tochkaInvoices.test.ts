import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TochkaInvoiceClient } from '../src/payments/tochkaInvoices.ts';
import { TochkaInvoiceWorkflow } from '../src/payments/tochkaInvoiceWorkflow.ts';
import { setup } from './helpers.ts';

const buyer = { type: 'company' as const, taxCode: '7701234567',
  secondSideName: 'ООО Тестовый автопарк', kpp: '770101001' };
const documentId = '1cf95c4f-e794-4407-bac4-0829f19bd2be';
type BankLog = { url: string; method: string; body: any };
function fakeBank(options?: { failCreate?: boolean }) {
  const calls: BankLog[] = [];
  const transport = (async (input: any, init?: RequestInit) => {
    const url = String(input), method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    calls.push({ url, method, body });
    if (method === 'POST' && url.endsWith('/bills')) {
      if (options?.failCreate) throw new Error('connection lost after remote creation');
      return Response.json({ Data: { documentId } });
    }
    if (url.endsWith('/payment-status'))
      return Response.json({ Data: { paymentStatus: 'payment_paid' } });
    if (url.endsWith('/email'))
      return Response.json({ Data: { result: true } });
    if (url.endsWith('/file'))
      return new Response(Buffer.from('%PDF-1.4\n%%EOF'), {
        headers: { 'content-type': 'application/pdf' } });
    throw new Error('Unexpected bank endpoint ' + url);
  }) as typeof fetch;
  return {
    bank: new TochkaInvoiceClient('test-jwt', '300000092',
      '40817810802000000008/044525104', transport), calls,
  };
}

test('Tochka invoice payload: exact kopecks, fee on separate line, no accidental bank transfer', async () => {
  const { bank, calls } = fakeBank();
  const result = await bank.createInvoice({
    number: 'TS-ORDER-001', basedOn: 'Заявка TrakSOS №17', buyer,
    expectedTotalKopecks: 1_050_000,
    lines: [
      { title: 'Работы', kopecks: 1_000_000, vat: 'without_nds' },
      { title: 'Сервисный сбор TrakSOS', kopecks: 50_000, vat: 'without_nds' },
    ],
  });
  assert.equal(result, documentId);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].body.Data.Content.Invoice.totalAmount, '10500.00');
  assert.deepEqual(calls[0].body.Data.Content.Invoice.Positions.map((x: any) => x.price),
    ['10000.00', '500.00']);
  await assert.rejects(bank.createInvoice({
    number: 'BAD', basedOn: 'test', buyer, expectedTotalKopecks: 100,
    lines: [{ title: 'Работа', kopecks: 99, vat: 'without_nds' }],
  }), /balance/);
  assert.equal(calls.length, 1, 'bad amount must never reach bank');
  assert.equal(await bank.getPaymentStatus(documentId), 'payment_paid');
  await bank.emailInvoice(documentId, 'accounting@example.com');
  const pdf = await bank.getInvoicePdf(documentId);
  assert.equal(pdf.subarray(0,5).toString(), '%PDF-');
});

async function pendingPayment(t: Awaited<ReturnType<typeof setup>>) {
  const customer = await t.login('+79996669991');
  const worker = await t.login('+79996669992', 'master');
  const order = await t.db.one<{id:string}>(
    "insert into orders(client_id,created_by,performer_id,service,zone_id,status) values ($1,$1,$2,'electric','spb','completed') returning id",
    [customer.id,worker.id]);
  assert.ok(order);
  const payment = await t.db.one<{id:string}>(
    "insert into payments(order_id,kind,method,amount,client_fee,total,status,provider,idempotency_key) values ($1,'work','invoice',1000000,50000,1050000,'pending','invoice',$2) returning id",
    [order.id,'invoice-test-'+order.id]);
  assert.ok(payment);
  return payment.id;
}

test('Tochka issuance is one bank request even with duplicate admin calls; bank status is NOT settlement',
  { timeout: 60000 }, async () => {
  const t = await setup();
  try {
    const admin = await t.login('+79990000001');
    const id = await pendingPayment(t);
    const { bank, calls } = fakeBank();
    const service = new TochkaInvoiceWorkflow(t.db, bank);
    const a = await service.issue(id, admin.id, buyer, 'without_nds', 'without_nds');
    const b = await service.issue(id, admin.id, buyer, 'without_nds', 'without_nds');
    assert.equal(a.documentId, documentId);
    assert.equal(b.reused, true);
    assert.equal(calls.filter(c => c.method === 'POST' && c.url.endsWith('/bills')).length, 1);
    assert.equal((await service.status(id)).bankStatus, 'payment_paid');
    assert.equal((await t.db.one<{status:string}>(
      'select status from payments where id=$1', [id]))?.status, 'pending',
      'invoice badge cannot confirm settlement');
  } finally { await t.close(); }
});

test('Tochka ambiguous creation is never blindly retried', { timeout: 60000 }, async () => {
  const t = await setup();
  try {
    const admin = await t.login('+79990000001');
    const id = await pendingPayment(t);
    const { bank, calls } = fakeBank({ failCreate: true });
    const service = new TochkaInvoiceWorkflow(t.db, bank);
    await assert.rejects(service.issue(id,admin.id,buyer,'without_nds','without_nds'),
      /неизвестный результат|Неизвестный результат/);
    await assert.rejects(service.issue(id,admin.id,buyer,'without_nds','without_nds'),
      /Банк мог создать счёт/);
    assert.equal(calls.length, 1, 'unknown outcome must not issue a duplicate bank document');
    assert.equal((await service.local(id)).status, 'needs_review');
  } finally { await t.close(); }
});
