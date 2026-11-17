import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  digest, moscowPeriod, reviewEvidenceLine, safeCsvCell, validateEvidenceEvent,
  type EvidenceEvent, type EvidenceLine,
} from '../src/domain/shopAgentEvidence.ts';
import { ShopAgentEvidenceLedger } from '../src/services/shopAgentLedger.ts';

const admin = { id: 'a0', roles: ['admin'] } as any;
const client = { id: 'c0', roles: ['client'] } as any;
const docHash = 'b'.repeat(64);
const date = '2026-11-03T12:00:00.000Z';

function line(overrides: Partial<EvidenceLine> = {}): EvidenceLine {
  return {
    id: 'L', external_line_key: 'ORD-1-ITEM-1', operation_kind: 'client_purchase_agent',
    supplier_key: 'autokontinent', article: 'A-001', quantity_ordered: 1,
    agreed_customer_total_kopecks: 1365000,
    agent_fee_agreed_kopecks: 300000, platform_fee_agreed_kopecks: 65000,
    mandate_reference: 'mandate-001', mandate_accepted_at: '2026-11-02T10:00:00.000Z',
    supplier_contract_reference: null, offer_version: '2026-11-01', offer_hash: 'a'.repeat(64),
    fee_schedule_version: 'experimental-2026-11',
    customer_name: 'ООО Тест', customer_inn: '7800000000', snapshot_hash: 'c'.repeat(64),
    ...overrides,
  };
}
function event(key: string, kind: EvidenceEvent['kind'], changes: Partial<EvidenceEvent> = {}): EvidenceEvent {
  return {
    line_id: 'L', external_key: key, kind, component: null, amount_kopecks: 0,
    vat_kopecks: 0, quantity: 0, source: 'accountant_verified',
    reference: null, document_hash: null, document_total_kopecks: null,
    occurred_at: date, metadata: {}, payload_hash: digest([key, kind]),
    ...changes,
  };
}
function happy() {
  return [
    event('mandate', 'mandate_accepted', { reference: 'mandate-001', occurred_at: '2026-11-02T10:00:00.000Z' }),
    event('purchase', 'supplier_document', {
      reference: 'UPD-101', document_hash: docHash,
      document_total_kopecks: 1000000, amount_kopecks: 1000000, quantity: 1, vat_kopecks: 0,
    }),
    event('receipt-cost', 'customer_receipt', { component: 'reimbursement', amount_kopecks: 1000000 }),
    event('receipt-agent', 'customer_receipt', { component: 'agent_fee', amount_kopecks: 300000 }),
    event('receipt-service', 'customer_receipt', { component: 'platform_fee', amount_kopecks: 65000 }),
    event('supplier-paid', 'supplier_payment', { amount_kopecks: 1000000 }),
    event('handover', 'handover', { quantity: 1 }),
    event('report', 'agent_report', { reference: 'report-101' }),
  ];
}
test('agent arithmetic 10000 + 3000 + 650 -> agent revenue 3650, provisional USN 219', () => {
  const result = reviewEvidenceLine(line(), happy(), { [docHash]: 1000000 });
  assert.equal(result.status, 'verified');
  assert.deepEqual(result.findings, []);
  assert.equal(result.customerReceivedNetKopecks, 1365000);
  assert.equal(result.purchaseConfirmedKopecks, 1000000);
  assert.equal(result.reimbursedCostKopecks, 1000000);
  assert.equal(result.agentFeeReceivedKopecks, 300000);
  assert.equal(result.platformFeeReceivedKopecks, 65000);
  assert.equal(result.potentialTaxRevenueKopecks, 365000);
  assert.equal(result.illustrationUsn6Kopecks, 21900);
});
test('own inventory sale is a different revenue category, not treated as agent fees', () => {
  const own = line({
    operation_kind: 'own_inventory_sale', agent_fee_agreed_kopecks: 0,
    platform_fee_agreed_kopecks: 0, mandate_reference: null, mandate_accepted_at: null,
    offer_version: null, offer_hash: null,
  });
  const ev = [
    happy()[1], event('sale', 'customer_receipt', { component: 'own_sale', amount_kopecks: 1365000 }),
    event('handover', 'handover', { quantity: 1 }),
  ];
  const r = reviewEvidenceLine(own, ev, { [docHash]: 1000000 });
  assert.equal(r.status, 'verified');
  assert.equal(r.potentialTaxRevenueKopecks, 1365000);
  assert.equal(r.illustrationUsn6Kopecks, 81900);
});
test('quotation and unverified paperwork never grant verified/taxable status', () => {
  const ev = happy().map((e) => e.kind === 'supplier_document'
    ? { ...e, source: 'manual_unverified' as const } : e);
  ev.push(event('quote', 'supplier_quote', { source: 'system' }));
  const r = reviewEvidenceLine(line(), ev, { [docHash]: 1000000 });
  assert.equal(r.status, 'requires_reconciliation');
  assert.equal(r.potentialTaxRevenueKopecks, null);
  assert.ok(r.findings.includes('missing_verified_supplier_primary_document'));
  assert.ok(r.findings.includes('unverified_supplier_document'));
});
test('mandate must predate supplier purchase', () => {
  const r = reviewEvidenceLine(line({
    mandate_accepted_at: '2026-11-04T12:00:00Z',
  }), happy(), { [docHash]: 1000000 });
  assert.ok(r.findings.includes('mandate_after_procurement'));
  assert.equal(r.status, 'requires_reconciliation');
});
test('partial delivery, over-delivery, supplier invoice mismatch and extra fees are flagged', () => {
  const r1 = reviewEvidenceLine(line({ quantity_ordered: 2 }), happy(), { [docHash]: 1000000 });
  assert.ok(r1.findings.includes('partial_or_missing_supplier_quantity'));
  const r2 = reviewEvidenceLine(line(), happy().map((e) =>
    e.kind === 'supplier_document' ? { ...e, quantity: 2 } : e), { [docHash]: 1000000 });
  assert.ok(r2.findings.includes('supplier_quantity_exceeds_order'));
  const r3 = reviewEvidenceLine(line(), happy(), { [docHash]: 999999 });
  assert.ok(r3.findings.includes('supplier_document_allocation_mismatch'));
  const r4 = reviewEvidenceLine(line(), [...happy(),
    event('extra', 'customer_receipt', { component: 'agent_fee', amount_kopecks: 1 })], { [docHash]: 1000000 });
  assert.ok(r4.findings.includes('agent_fee_exceeds_agreement'));
  assert.ok(r4.findings.includes('customer_payment_exceeds_agreed_total'));
});
test('one supplier original can be allocated across two lines only if exact total matches', () => {
  const multi = happy().map((e) =>
    e.kind === 'supplier_document' ? { ...e, document_total_kopecks: 2000000 } : e);
  const good = reviewEvidenceLine(line(), multi, { [docHash]: 2000000 });
  const bad = reviewEvidenceLine(line(), multi, { [docHash]: 1000000 });
  assert.ok(!good.findings.includes('supplier_document_allocation_mismatch'));
  assert.ok(bad.findings.includes('supplier_document_allocation_mismatch'));
});
test('cash refunds are split by component, no hidden recategorization', () => {
  const ev = [...happy(),
    event('return-agent', 'customer_refund', { component: 'agent_fee', amount_kopecks: 100000 }),
    event('return-cost', 'customer_refund', { component: 'reimbursement', amount_kopecks: 200000 }),
  ];
  const r = reviewEvidenceLine(line(), ev, { [docHash]: 1000000 });
  assert.equal(r.customerRefundedKopecks, 300000);
  assert.equal(r.reimbursedCostKopecks, 800000);
  assert.equal(r.agentFeeReceivedKopecks, 200000);
  assert.equal(r.potentialTaxRevenueKopecks, 265000);
  const bad = reviewEvidenceLine(line(), [...happy(),
    event('excess-refund', 'customer_refund', { component: 'agent_fee', amount_kopecks: 400000 })],
    { [docHash]: 1000000 });
  assert.ok(bad.findings.includes('refund_exceeds_receipts_agent_fee'));
  assert.equal(bad.potentialTaxRevenueKopecks, null);
});
test('previous approval becomes stale as soon as evidence changes; only matching digest counts', () => {
  const base = happy();
  const initial = reviewEvidenceLine(line(), base, { [docHash]: 1000000 });
  const approval = event('approve', 'accountant_approval', {
    metadata: { review_digest: initial.eventDigest },
  });
  assert.equal(reviewEvidenceLine(line(), [...base, approval], { [docHash]: 1000000 }).status,
    'accountant_approved');
  const after = reviewEvidenceLine(line(), [...base, approval,
    event('new-note', 'supplier_quote', { source: 'system' })], { [docHash]: 1000000 });
  assert.equal(after.status, 'verified');
});
test('supplier-side agency without contract evidence remains unverified', () => {
  const r = reviewEvidenceLine(line({
    operation_kind: 'supplier_sales_agent', supplier_contract_reference: 'AGT-123',
  }), happy(), { [docHash]: 1000000 });
  assert.ok(r.findings.includes('missing_supplier_agency_contract'));
});
test('event validation rejects quantity, VAT and receipt classification mistakes', () => {
  const correct = event('x1', 'supplier_document', {
    reference: 'UPD-101', document_hash: docHash, document_total_kopecks: 500,
    amount_kopecks: 500, quantity: 1, vat_kopecks: 100,
  });
  const payload: any = { ...correct };
  delete payload.line_id; delete payload.payload_hash;
  assert.doesNotThrow(() => validateEvidenceEvent(payload));
  assert.throws(() => validateEvidenceEvent({ ...payload, vat_kopecks: 600 }));
  assert.throws(() => validateEvidenceEvent({ ...payload, quantity: 0 }));
  assert.throws(() => validateEvidenceEvent({ ...payload, amount_kopecks: -2 }));
  assert.throws(() => validateEvidenceEvent({ ...payload, kind: 'customer_receipt' }));
});
test('day/week/month/custom reports respect Monday start and Moscow midnight UTC+3', () => {
  assert.deepEqual(moscowPeriod('day', '2026-11-17'), {
    fromUtc: '2026-11-16T21:00:00.000Z',
    toUtc: '2026-11-17T21:00:00.000Z',
    label: '2026-11-17 – 2026-11-17 МСК',
  });
  assert.equal(moscowPeriod('week', '2026-11-17').fromUtc, '2026-11-15T21:00:00.000Z');
  assert.equal(moscowPeriod('month', '2026-11-17').toUtc, '2026-11-30T21:00:00.000Z');
  assert.equal(moscowPeriod('custom', '2026-11-16', '2026-11-17').toUtc, '2026-11-17T21:00:00.000Z');
  assert.throws(() => moscowPeriod('day', '2026-02-30'));
  assert.throws(() => moscowPeriod('custom', '2026-11-20', '2026-11-19'));
});
test('CSV protects from formula injection, quotes and semicolons', () => {
  assert.equal(safeCsvCell('=1+1'), '"\'=1+1"');
  assert.equal(safeCsvCell('ООО "Тест";'), '"ООО ""Тест"";"');
});

test('service rejects non-admin before touching DB or accepting line/event/export', async () => {
  const db: any = { tx: () => { throw new Error('must not access DB'); }, query: () => { throw new Error('db'); } };
  const service = new ShopAgentEvidenceLedger(db);
  const data: any = {
    externalLineKey: 'key-01', customerName: 'ООО Тест',
    operationKind: 'client_purchase_agent', supplierKey: 'autokontinent', article: 'ABC',
    quantityOrdered: 1, agreedCustomerTotalKopecks: 1365000,
    agentFeeAgreedKopecks: 300000, platformFeeAgreedKopecks: 65000,
    feeScheduleVersion: 'v1',
  };
  await assert.rejects(service.createLine(client, data), /Только администратор/);
  await assert.rejects(service.appendEvent(client, 'key-01', { externalKey: 'event-key', kind: 'supplier_quote', source: 'system', occurredAt: date }), /Только администратор/);
  await assert.rejects(service.periodReport(client, 'day', '2026-11-17'), /Только администратор/);
  await assert.rejects(service.exportCsv(client, 'day', '2026-11-17'), /Только администратор/);
});
test('line import is idempotent by key and rejects different snapshots', async () => {
  let stored: any = null;
  const audit: any[] = [];
  const q: any = {
    one: async (sql: string, p: any[]) => {
      if (sql.startsWith('insert into shop_agent_evidence_lines')) {
        if (stored) return null;
        stored = {
          id: 'L', external_line_key: p[0], shop_order_id: p[1],
          customer_name: p[3], customer_inn: p[4], operation_kind: p[5],
          supplier_key: p[6], article: p[7], quantity_ordered: p[8],
          agreed_customer_total_kopecks: p[9], agent_fee_agreed_kopecks: p[10],
          platform_fee_agreed_kopecks: p[11], mandate_reference: p[12],
          mandate_accepted_at: p[13], supplier_contract_reference: p[14],
          offer_version: p[15], offer_hash: p[16], fee_schedule_version: p[17],
          snapshot_hash: p[18],
        };
        return stored;
      }
      if (sql.startsWith('select * from shop_agent_evidence_lines')) return stored;
      return null;
    },
    query: async (sql: string, p: any[]) => { audit.push({ sql, p }); return []; },
  };
  const db: any = { tx: async (fn: any) => fn(q) };
  const service = new ShopAgentEvidenceLedger(db);
  const params: any = {
    externalLineKey: 'ORD-1-ITEM-1', customerName: 'ООО Тест',
    operationKind: 'client_purchase_agent', supplierKey: 'autokontinent', article: 'ABC',
    quantityOrdered: 1, agreedCustomerTotalKopecks: 1365000,
    agentFeeAgreedKopecks: 300000, platformFeeAgreedKopecks: 65000,
    feeScheduleVersion: 'v1',
  };
  await service.createLine(admin, params);
  await service.createLine(admin, params);
  assert.equal(audit.filter((a) => a.p[1] === 'shop.agent_line_created').length, 1);
  await assert.rejects(service.createLine(admin, { ...params, article: 'XYZ' }), /Этот ключ уже используется/);
});
