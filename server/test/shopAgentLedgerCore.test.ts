import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AuthUser } from '../src/http/router.ts';
import {
  type LedgerLine, type LedgerEntry, assessLine, buildRegister,
  periodBounds, registerCsv, validateEntry, validateLine,
} from '../src/services/shopAgentLedgerCore.ts';
import { ShopAgentLedger } from '../src/services/shopAgentLedger.ts';

const hash = 'a'.repeat(64);
const admin = { id: 'admin', roles: ['admin'] } as AuthUser;
const client = { id: 'client', roles: ['client'] } as AuthUser;
const line: LedgerLine = {
  id: 'line-1', orderId: 'order-1', lineKey: 'p1', clientOrganizationId: 'company-1',
  supplierRef: 'autokontinent', operationKind: 'client_purchase_agent',
  agreedCustomerTotal: 1_365_000, currency: 'RUB',
  offerVersion: 'offer-v2', offerHash: hash, feeScheduleVersion: 'fee-v1',
  mandateRef: 'mandate-a', mandateAcceptedAt: '2026-11-17T08:00:00Z',
};
let seq = 0;
function e(kind: LedgerEntry['kind'], amount = 0,
  overrides: Partial<LedgerEntry> = {}): LedgerEntry {
  return {
    eventKey: 'event-' + (++seq), lineId: line.id, kind, amountKopecks: amount,
    occurredAt: '2026-11-17T12:00:00Z',
    sourceKind: 'internal_record', sourceRef: 'archive-item',
    evidenceHash: null, compensatesEventKey: null, correctionReason: null,
    ...overrides,
  };
}
function doc(kind: LedgerEntry['kind'], amount = 0, overrides: Partial<LedgerEntry> = {}) {
  return e(kind, amount, {
    sourceKind: 'primary_document_verified', evidenceHash: hash,
    sourceRef: 'protected-document-id', ...overrides,
  });
}
function evidence(): LedgerEntry[] {
  return [
    doc('mandate_evidence', 0, { occurredAt: '2026-11-17T08:00:01Z' }),
    e('supplier_order', 0, { occurredAt: '2026-11-17T09:00:00Z' }),
    doc('procurement_document', 1_000_000),
    e('reimbursement_agreed', 1_000_000),
    e('procurement_fee_agreed', 300_000),
    e('platform_fee_agreed', 65_000),
    e('recognized_revenue', 365_000, { sourceKind: 'accountant_attested' }),
    e('customer_receipt', 1_365_000, { sourceKind: 'payment_confirmed' }),
    e('supplier_payment', 1_000_000, { sourceKind: 'payment_confirmed' }),
    doc('handover'),
    doc('agent_report'),
  ];
}

test('agency 10000 + 3000 + 650 example: own fee income, not full customer price', () => {
  const state = assessLine(line, evidence());
  assert.equal(state.status, 'verified');
  assert.deepEqual(state.findings, []);
  assert.equal(state.totals.procurement_document, 1_000_000);
  assert.equal(state.totals.procurement_fee_agreed, 300_000);
  assert.equal(state.totals.platform_fee_agreed, 65_000);
  assert.equal(state.totals.recognized_revenue, 365_000);
  assert.equal(state.priceDifferenceForAnalytics, 365_000);
});
test('accountant approval is explicit and requires signed evidence', () => {
  const events = evidence();
  assert.equal(assessLine(line, events).status, 'verified');
  events.push(e('accountant_approval', 0, { sourceKind: 'accountant_attested', evidenceHash: hash }));
  assert.equal(assessLine(line, events).status, 'accountant_approved');
  assert.throws(() => validateEntry(e('accountant_approval')));
});
test('API quote is never a supplier primary document', () => {
  const entries = evidence().map((entry) => entry.kind === 'procurement_document'
    ? { ...entry, sourceKind: 'supplier_api_quote' as const, evidenceHash: null } : entry);
  const state = assessLine(line, entries);
  assert.equal(state.status, 'awaiting_docs');
  assert.ok(state.findings.some((f) => f.code === 'supplier_primary_doc'));
});
test('mandate must predate procurement, and missing mandate is not approved', () => {
  const late: LedgerLine = { ...line, mandateAcceptedAt: '2026-11-17T11:00:00Z' };
  const state = assessLine(late, evidence());
  assert.equal(state.status, 'requires_reconciliation');
  assert.ok(state.findings.some((f) => f.code === 'mandate_late'));
  const noEvidence = evidence().filter((entry) => entry.kind !== 'mandate_evidence');
  assert.equal(assessLine(line, noEvidence).status, 'awaiting_docs');
});
test('accounting discrepancy blocks evidence verification', () => {
  const entries = evidence().filter((entry) => entry.kind !== 'platform_fee_agreed');
  const state = assessLine(line, entries);
  assert.equal(state.status, 'requires_reconciliation');
  assert.ok(state.findings.some((f) => f.code === 'fees_vs_agreed_total'));
});
test('own-inventory sale is NOT treated as client-agency fee income', () => {
  const resale: LedgerLine = {
    ...line, operationKind: 'own_inventory_sale',
    mandateAcceptedAt: null, mandateRef: null,
  };
  const entries = [
    doc('sale_document', 1_365_000),
    e('recognized_revenue', 1_365_000),
    e('customer_receipt', 1_365_000),
    doc('handover'),
  ];
  const state = assessLine(resale, entries);
  assert.equal(state.status, 'verified');
  assert.equal(state.totals.recognized_revenue, 1_365_000);
});
test('refund and compensating revenue correction remain separate append-only entries', () => {
  const entries = evidence();
  const original = entries.find((entry) => entry.kind === 'recognized_revenue')!;
  entries.push(e('customer_refund', 100_000));
  entries.push(e('recognized_revenue', -100_000, {
    compensatesEventKey: original.eventKey, correctionReason: 'Partial product refund',
  }));
  const state = assessLine(line, entries);
  assert.equal(state.totals.customer_refund, 100_000);
  assert.equal(state.totals.recognized_revenue, 265_000);
  assert.equal(state.status, 'verified');
});
test('money must be safe integer kopecks and negative changes explain original', () => {
  assert.throws(() => validateLine({ ...line, agreedCustomerTotal: 1.1 }));
  assert.throws(() => validateEntry(e('customer_receipt', 0)));
  assert.throws(() => validateEntry(e('customer_receipt', -100)));
  assert.throws(() => validateEntry(e('customer_receipt', Number.MAX_SAFE_INTEGER + 1)));
  validateEntry(e('customer_receipt', -100, {
    compensatesEventKey: 'original', correctionReason: 'document correction',
  }));
});
test('Moscow daily/week Monday/month cutoffs and invalid date checks', () => {
  assert.deepEqual(periodBounds({ kind: 'day', from: '2026-11-17' }), {
    fromUtc: '2026-11-16T21:00:00.000Z',
    toUtcExclusive: '2026-11-17T21:00:00.000Z',
    label: '2026-11-17..2026-11-17 Europe/Moscow',
  });
  const week = periodBounds({ kind: 'week', from: '2026-11-17' });
  assert.equal(week.label, '2026-11-16..2026-11-22 Europe/Moscow');
  const month = periodBounds({ kind: 'month', from: '2026-11-17' });
  assert.equal(month.label, '2026-11-01..2026-11-30 Europe/Moscow');
  assert.throws(() => periodBounds({ kind: 'day', from: '2026-02-30' }));
  assert.throws(() => periodBounds({ kind: 'range', from: '2026-11-20', through: '2026-11-17' }));
  assert.throws(() => periodBounds({ kind: 'range', from: '2025-01-01', through: '2026-11-17' }));
});
test('day/week/month totals aggregate events, not order lifetime balances', () => {
  const entries = evidence();
  entries.push(e('customer_receipt', 200_000, { occurredAt: '2026-11-18T12:00:00Z' }));
  const day = buildRegister([line], entries, { kind: 'day', from: '2026-11-17' });
  const week = buildRegister([line], entries, { kind: 'week', from: '2026-11-17' });
  assert.equal(day.totals.customer_receipt, 1_365_000);
  assert.equal(week.totals.customer_receipt, 1_565_000);
  assert.equal(day.confirmedTaxableRevenue, 365_000);
  assert.equal(week.rows[0].status, 'requires_reconciliation');
  assert.equal(week.unverifiedTaxableRevenue, 365_000);
  assert.equal(week.blockedForTaxPackage, true);
});
test('multi-company breakdown equals sum of report rows', () => {
  const second: LedgerLine = { ...line, id: 'line-2', orderId: 'order-2',
    clientOrganizationId: 'company-2' };
  const firstEvents = evidence();
  const secondEvents = evidence().map((entry) => ({
    ...entry, lineId: second.id, eventKey: entry.eventKey + '-2',
  }));
  const report = buildRegister([line, second], [...firstEvents, ...secondEvents],
    { kind: 'month', from: '2026-11-17' });
  assert.equal(report.rows.length, 2);
  assert.equal(report.totals.recognized_revenue, 730_000);
  assert.equal(report.byOrganization.length, 2);
  assert.equal(report.byOrganization.reduce((n, group) =>
    n + group.totals.customer_receipt, 0), report.totals.customer_receipt);
});
test('CSV neutralizes spreadsheet formulas from organization identifiers', () => {
  const malicious: LedgerLine = { ...line, clientOrganizationId: '=HYPERLINK("evil")' };
  const report = buildRegister([malicious], evidence(), { kind: 'day', from: '2026-11-17' });
  const csv = registerCsv(report);
  assert.ok(csv.startsWith('\uFEFF'));
  assert.ok(csv.includes("'=HYPERLINK"));
  assert.ok(csv.includes('"365000"'));
});
test('no public role can read or write ledger through service', async () => {
  const service = new ShopAgentLedger({} as any);
  await assert.rejects(service.getRegister(client, { kind: 'day', from: '2026-11-17' }),
    (err: any) => err.status === 403);
  await assert.rejects(service.inspectLine(client, line.id),
    (err: any) => err.status === 403);
  await assert.rejects(service.appendEvent(client, e('customer_receipt', 20)),
    (err: any) => err.status === 403);
  const { id: _unused, ...input } = line;
  await assert.rejects(service.registerLine(client, input),
    (err: any) => err.status === 403);
});
test('duplicate import key is idempotent, conflicting payload rejected', async () => {
  let inserted: any = null;
  let writes = 0;
  const mock: any = {
    tx: async (fn: any) => fn(mock),
    one: async (sql: string, params: any[]) => {
      if (sql.includes('shop_agent_ledger_lines') && sql.includes('for update')) return { id: line.id };
      if (sql.startsWith('select * from shop_agent_ledger_events where event_key=')) return inserted;
      if (sql.startsWith('insert into shop_agent_ledger_events')) {
        writes++;
        inserted = {
          id: 'db-event', line_id: params[0], event_key: params[1],
          event_kind: params[2], amount_kopecks: params[3],
          occurred_at: params[4], source_kind: params[5], source_ref: params[6],
          evidence_hash: params[7], compensates_event_key: params[8],
          correction_reason: params[9], payload_hash: params[10],
        };
        return inserted;
      }
      return null;
    },
    query: async () => [],
  };
  const svc = new ShopAgentLedger(mock);
  const event = e('customer_receipt', 5000, { sourceKind: 'payment_confirmed' });
  const a = await svc.appendEvent(admin, event);
  const b = await svc.appendEvent(admin, event);
  assert.equal(a.eventKey, b.eventKey);
  assert.equal(writes, 1);
  await assert.rejects(svc.appendEvent(admin, { ...event, amountKopecks: 6000 }),
    (err: any) => err.status === 409 && err.code === 'ledger_idempotency_conflict');
});

test('a later correction invalidates an accountant approval even if backdated', () => {
  const entries = evidence();
  entries.push(e('accountant_approval', 0, {
    sourceKind: 'accountant_attested', evidenceHash: hash,
    occurredAt: '2026-11-18T12:00:00Z',
  }));
  assert.equal(assessLine(line, entries).status, 'accountant_approved');
  entries.push(e('customer_refund', 100, { occurredAt: '2026-11-17T10:00:00Z' }));
  assert.equal(assessLine(line, entries).status, 'verified');
});
test('empty register can never masquerade as a signed tax package', () => {
  const report = buildRegister([], [], { kind: 'month', from: '2026-11-17' });
  assert.equal(report.rows.length, 0);
  assert.equal(report.blockedForTaxPackage, true);
});
