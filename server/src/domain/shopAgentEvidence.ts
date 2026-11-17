import { createHash } from 'node:crypto';

// Private admin-only evidence ledger. Does not alter the shop checkout or payment ledger.
// Values are integer kopecks; all event instants are UTC timestamps.
export type OperationKind = 'client_purchase_agent' | 'supplier_sales_agent' | 'own_inventory_sale';
export type MoneyComponent = 'reimbursement' | 'agent_fee' | 'platform_fee' | 'own_sale';
export type EvidenceEventKind =
  | 'mandate_accepted' | 'supplier_contract_verified' | 'supplier_quote'
  | 'supplier_document' | 'customer_receipt' | 'customer_refund'
  | 'supplier_payment' | 'supplier_refund' | 'handover'
  | 'agent_report' | 'output_vat_assessed' | 'accountant_approval';

export interface EvidenceLine {
  id: string;
  external_line_key: string;
  operation_kind: OperationKind;
  supplier_key: string;
  article: string;
  quantity_ordered: number;
  agreed_customer_total_kopecks: number;
  agent_fee_agreed_kopecks: number;
  platform_fee_agreed_kopecks: number;
  mandate_reference: string | null;
  mandate_accepted_at: string | null;
  supplier_contract_reference: string | null;
  offer_version: string | null;
  offer_hash: string | null;
  fee_schedule_version: string;
  customer_name: string;
  customer_inn: string | null;
  snapshot_hash: string;
}

export interface EvidenceEvent {
  id?: string | number;
  line_id: string;
  external_key: string;
  kind: EvidenceEventKind;
  component: MoneyComponent | null;
  amount_kopecks: number;
  vat_kopecks: number;
  quantity: number;
  source: 'manual_unverified' | 'accountant_verified' | 'system';
  reference: string | null;
  document_hash: string | null;
  document_total_kopecks: number | null;
  occurred_at: string;
  recorded_at?: string;
  metadata?: Record<string, unknown>;
  payload_hash: string;
}

export type EvidenceStatus = 'awaiting_docs' | 'requires_reconciliation' | 'verified' | 'accountant_approved';

export interface EvidenceReview {
  lineKey: string;
  status: EvidenceStatus;
  findings: string[];
  purchaseConfirmedKopecks: number;
  inputVatKopecks: number;
  supplierPaidKopecks: number;
  reimbursedCostKopecks: number;
  agentFeeReceivedKopecks: number;
  platformFeeReceivedKopecks: number;
  customerReceivedNetKopecks: number;
  customerRefundedKopecks: number;
  outputVatAssessedKopecks: number;
  potentialTaxRevenueKopecks: number | null;
  illustrationUsn6Kopecks: number | null;
  eventDigest: string;
}

export function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

const monetary: EvidenceEventKind[] = [
  'supplier_document', 'customer_receipt', 'customer_refund',
  'supplier_payment', 'supplier_refund', 'output_vat_assessed',
];

export function validateEvidenceEvent(event: Omit<EvidenceEvent, 'line_id' | 'payload_hash'>): void {
  if (!Number.isSafeInteger(event.amount_kopecks) || event.amount_kopecks < 0 ||
      !Number.isSafeInteger(event.vat_kopecks) || event.vat_kopecks < 0 ||
      !Number.isSafeInteger(event.quantity) || event.quantity < 0)
    throw new Error('amount_quantity_invalid');
  if (event.document_total_kopecks != null &&
      (!Number.isSafeInteger(event.document_total_kopecks) || event.document_total_kopecks < 0))
    throw new Error('document_total_invalid');
  if (Number.isNaN(Date.parse(event.occurred_at))) throw new Error('event_date_invalid');
  if (event.amount_kopecks === 0 && monetary.includes(event.kind) && event.kind !== 'output_vat_assessed')
    throw new Error('amount_required');
  if (event.kind === 'supplier_document') {
    if (event.quantity < 1 || !event.reference || !event.document_hash ||
        !event.document_total_kopecks || event.document_total_kopecks < event.amount_kopecks ||
        event.vat_kopecks > event.amount_kopecks)
      throw new Error('supplier_document_incomplete');
  } else if (event.document_total_kopecks != null || event.document_hash != null) {
    throw new Error('unexpected_supplier_document');
  }
  if (event.kind === 'customer_receipt' || event.kind === 'customer_refund') {
    if (!event.component) throw new Error('money_component_required');
  } else if (event.component) throw new Error('unexpected_money_component');
  if (event.kind === 'accountant_approval' &&
      (typeof event.metadata?.review_digest !== 'string' || !/^[0-9a-f]{64}$/.test(event.metadata.review_digest)))
    throw new Error('approval_digest_required');
}

const sum = (ev: EvidenceEvent[], kind: EvidenceEventKind, component?: MoneyComponent) =>
  ev.reduce((a, e) => a + (e.kind === kind && (component === undefined || e.component === component) ? e.amount_kopecks : 0), 0);
const nonApproval = (ev: EvidenceEvent[]) => ev.filter((e) => e.kind !== 'accountant_approval');

export function reviewEvidenceLine(
  line: EvidenceLine,
  events: EvidenceEvent[],
  documentAllocatedTotals: Readonly<Record<string, number>> = {},
): EvidenceReview {
  if (events.some((e) => e.line_id !== line.id)) throw new Error('foreign_line_event');
  const timeline = [...events].sort((a, b) =>
    Date.parse(a.occurred_at) - Date.parse(b.occurred_at) || a.external_key.localeCompare(b.external_key));
  const facts = nonApproval(timeline);
  const eventDigest = digest([line.snapshot_hash, ...facts.map((e) => e.payload_hash).sort()]);
  const findings: string[] = [];
  // A manually typed receipt is not a verified bank movement. A verified source
  // also needs an external primary reference before accountant approval.
  const cashKinds: EvidenceEventKind[] = ['customer_receipt', 'customer_refund', 'supplier_payment', 'supplier_refund'];
  if (facts.some((e) => cashKinds.includes(e.kind) && e.source !== 'accountant_verified'))
    findings.push('unverified_money_event');
  if (facts.some((e) => cashKinds.includes(e.kind) && !e.reference?.trim()))
    findings.push('money_event_missing_external_reference');
  const docs = facts.filter((e) => e.kind === 'supplier_document');
  const verifiedDocs = docs.filter((e) => e.source === 'accountant_verified' && e.reference && e.document_hash);
  const purchasedQty = verifiedDocs.reduce((a, e) => a + e.quantity, 0);
  const actualPurchase = sum(verifiedDocs, 'supplier_document');
  const inputVat = verifiedDocs.reduce((a, e) => a + e.vat_kopecks, 0);
  const received = sum(facts, 'customer_receipt');
  const refunded = sum(facts, 'customer_refund');
  const byComponent = (component: MoneyComponent) =>
    sum(facts, 'customer_receipt', component) - sum(facts, 'customer_refund', component);

  const mandate = facts.find((e) => e.kind === 'mandate_accepted' && e.source === 'accountant_verified');
  const firstPurchase = docs.length
    ? Math.min(...docs.map((e) => Date.parse(e.occurred_at))) : null;
  if (line.operation_kind === 'client_purchase_agent') {
    if (!line.mandate_reference || !line.mandate_accepted_at || !line.offer_hash ||
        !line.offer_version || !mandate || mandate.reference !== line.mandate_reference)
      findings.push('missing_accepted_client_mandate');
    else if (firstPurchase != null &&
      (Date.parse(line.mandate_accepted_at) > firstPurchase ||
       Date.parse(mandate.occurred_at) > firstPurchase))
      findings.push('mandate_after_procurement');
  }
  if (line.operation_kind === 'supplier_sales_agent' &&
      (!line.supplier_contract_reference || !facts.some((e) =>
        e.kind === 'supplier_contract_verified' && e.source === 'accountant_verified' &&
        e.reference === line.supplier_contract_reference)))
    findings.push('missing_supplier_agency_contract');
  if (line.operation_kind === 'own_inventory_sale' &&
      (line.agent_fee_agreed_kopecks !== 0 || line.platform_fee_agreed_kopecks !== 0))
    findings.push('inventory_sale_has_agent_fees');

  if (!verifiedDocs.length) findings.push('missing_verified_supplier_primary_document');
  if (docs.length !== verifiedDocs.length) findings.push('unverified_supplier_document');
  if (purchasedQty < line.quantity_ordered) findings.push('partial_or_missing_supplier_quantity');
  if (purchasedQty > line.quantity_ordered) findings.push('supplier_quantity_exceeds_order');
  for (const doc of docs) {
    if (!doc.document_hash) continue;
    if (!(doc.document_hash in documentAllocatedTotals)) {
      findings.push('document_allocation_not_checked');
    } else if (documentAllocatedTotals[doc.document_hash] !== doc.document_total_kopecks) {
      findings.push('supplier_document_allocation_mismatch');
    }
  }
  if (line.operation_kind !== 'own_inventory_sale' && byComponent('own_sale') !== 0)
    findings.push('agent_line_contains_own_sale');
  if (line.operation_kind === 'own_inventory_sale' &&
      (byComponent('reimbursement') !== 0 || byComponent('agent_fee') !== 0 || byComponent('platform_fee') !== 0))
    findings.push('own_sale_contains_agent_components');

  for (const component of ['reimbursement', 'agent_fee', 'platform_fee', 'own_sale'] as const)
    if (byComponent(component) < 0) findings.push('refund_exceeds_receipts_' + component);

  if (line.operation_kind !== 'own_inventory_sale') {
    if (byComponent('agent_fee') > line.agent_fee_agreed_kopecks) findings.push('agent_fee_exceeds_agreement');
    if (byComponent('platform_fee') > line.platform_fee_agreed_kopecks) findings.push('platform_fee_exceeds_agreement');
    if (byComponent('reimbursement') > actualPurchase) findings.push('reimbursement_exceeds_confirmed_cost');
  }
  if (received - refunded > line.agreed_customer_total_kopecks)
    findings.push('customer_payment_exceeds_agreed_total');
  if (sum(facts, 'supplier_payment') - sum(facts, 'supplier_refund') > actualPurchase)
    findings.push('supplier_payment_exceeds_confirmed_cost');

  const handoverQty = facts.filter((e) => e.kind === 'handover' && e.source === 'accountant_verified')
    .reduce((a, e) => a + e.quantity, 0);
  if (handoverQty !== line.quantity_ordered) findings.push('handover_quantity_missing_or_mismatch');
  if (!facts.some((e) => e.kind === 'agent_report' && e.source === 'accountant_verified') &&
      line.operation_kind !== 'own_inventory_sale')
    findings.push('missing_verified_agent_report');

  const uniqueFindings = [...new Set(findings)];
  const complete = !!verifiedDocs.length && uniqueFindings.length === 0;
  const latestApproval = [...timeline].reverse().find((e) => e.kind === 'accountant_approval');
  const approved = complete && latestApproval?.metadata?.review_digest === eventDigest &&
    latestApproval.source === 'accountant_verified';
  const status: EvidenceStatus = approved ? 'accountant_approved'
    : complete ? 'verified' : docs.length || received ? 'requires_reconciliation' : 'awaiting_docs';
  const candidate = line.operation_kind === 'own_inventory_sale'
    ? byComponent('own_sale')
    : byComponent('agent_fee') + byComponent('platform_fee');

  // Not a tax declaration: conditional arithmetic illustration only. Actual USN
  // cash method, VAT, returns, agency qualification and dates require accountant sign-off.
  return {
    lineKey: line.external_line_key, status, findings: uniqueFindings,
    purchaseConfirmedKopecks: actualPurchase,
    inputVatKopecks: inputVat,
    supplierPaidKopecks: sum(facts, 'supplier_payment') - sum(facts, 'supplier_refund'),
    reimbursedCostKopecks: byComponent('reimbursement'),
    agentFeeReceivedKopecks: byComponent('agent_fee'),
    platformFeeReceivedKopecks: byComponent('platform_fee'),
    customerReceivedNetKopecks: received - refunded,
    customerRefundedKopecks: refunded,
    outputVatAssessedKopecks: sum(facts, 'output_vat_assessed'),
    potentialTaxRevenueKopecks: complete ? candidate : null,
    illustrationUsn6Kopecks: complete ? Math.round(candidate * 6 / 100) : null,
    eventDigest,
  };
}

const MSK_OFFSET_MS = 3 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

function parseDay(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('bad_report_day');
  const d = new Date(value + 'T00:00:00.000Z');
  if (Number.isNaN(d.valueOf()) || d.toISOString().slice(0, 10) !== value)
    throw new Error('bad_report_day');
  return d;
}

export function moscowPeriod(
  kind: 'day' | 'week' | 'month' | 'custom',
  date: string,
  until?: string,
): { fromUtc: string; toUtc: string; label: string } {
  const d = parseDay(date);
  let start = new Date(d.getTime());
  let end: Date;
  if (kind === 'week') {
    start = new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * DAY_MS);
    end = new Date(start.getTime() + 7 * DAY_MS);
  } else if (kind === 'month') {
    start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
    end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
  } else if (kind === 'custom') {
    if (!until) throw new Error('bad_report_until');
    const last = parseDay(until);
    if (last.getTime() < start.getTime() || last.getTime() - start.getTime() > 366 * DAY_MS)
      throw new Error('bad_report_range');
    end = new Date(last.getTime() + DAY_MS);
  } else {
    end = new Date(start.getTime() + DAY_MS);
  }
  return {
    fromUtc: new Date(start.getTime() - MSK_OFFSET_MS).toISOString(),
    toUtc: new Date(end.getTime() - MSK_OFFSET_MS).toISOString(),
    label: start.toISOString().slice(0, 10) + ' – ' + new Date(end.getTime() - DAY_MS).toISOString().slice(0, 10) + ' МСК',
  };
}

export function safeCsvCell(value: unknown): string {
  const s = String(value ?? '');
  // Avoid spreadsheet formula injection when opening accounting exports in Excel.
  const safe = /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
  return '"' + safe.replace(/"/g, '""') + '"';
}
