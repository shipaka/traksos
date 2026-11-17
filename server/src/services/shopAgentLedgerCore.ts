/**
 * Evidence-first shop agency register. This module never infers an agent's taxable
 * income from the retail/supplier price difference. Money is integer kopecks.
 *
 * Kept separate from the live shop/checkout paths until contracts and tax
 * recognition rules have been signed off.
 */
export const OPERATION_KINDS = ['client_purchase_agent', 'supplier_sales_agent', 'own_inventory_sale'] as const;
export type OperationKind = typeof OPERATION_KINDS[number];

export const ENTRY_KINDS = [
  'mandate_evidence', 'supplier_order', 'procurement_document', 'sale_document',
  'handover', 'agent_report', 'customer_receipt', 'supplier_payment',
  'customer_refund', 'supplier_refund', 'reimbursement_agreed',
  'procurement_fee_agreed', 'platform_fee_agreed', 'recognized_revenue',
  'input_vat', 'output_vat', 'accountant_approval',
] as const;
export type EntryKind = typeof ENTRY_KINDS[number];
export type EvidenceSource =
  | 'internal_record'
  | 'supplier_api_quote'
  | 'manual_unverified'
  | 'primary_document_verified'
  | 'payment_confirmed'
  | 'accountant_attested';

export type LineStatus = 'awaiting_docs' | 'requires_reconciliation' | 'verified' | 'accountant_approved';

export interface LedgerLine {
  id: string;
  orderId: string;
  lineKey: string;
  clientOrganizationId: string;
  supplierRef: string;
  operationKind: OperationKind;
  agreedCustomerTotal: number;
  currency: 'RUB';
  offerVersion: string;
  offerHash: string;
  feeScheduleVersion: string;
  mandateRef: string | null;
  mandateAcceptedAt: string | null;
}

export interface LedgerEntry {
  eventKey: string;
  lineId: string;
  kind: EntryKind;
  amountKopecks: number;
  occurredAt: string;
  sourceKind: EvidenceSource;
  sourceRef: string;
  evidenceHash: string | null;
  compensatesEventKey: string | null;
  correctionReason: string | null;
}

export type MonetaryKind = Exclude<EntryKind,
  'mandate_evidence' | 'supplier_order' | 'handover' | 'agent_report' | 'accountant_approval'>;
export const MARKER_KINDS = new Set<EntryKind>([
  'mandate_evidence', 'supplier_order', 'handover', 'agent_report', 'accountant_approval',
]);

export const SUM_KINDS = [
  'procurement_document', 'sale_document', 'customer_receipt', 'supplier_payment',
  'customer_refund', 'supplier_refund', 'reimbursement_agreed',
  'procurement_fee_agreed', 'platform_fee_agreed', 'recognized_revenue',
  'input_vat', 'output_vat',
] as const;

export type Totals = Record<typeof SUM_KINDS[number], number>;
export interface Finding {
  code: string;
  severity: 'missing' | 'mismatch';
  message: string;
}
export interface Assessment {
  lineId: string;
  status: LineStatus;
  findings: Finding[];
  totals: Totals;
  /** For analytics only; never equivalent to taxable income. */
  priceDifferenceForAnalytics: number;
}
export interface Period {
  kind: 'day' | 'week' | 'month' | 'range';
  /** Moscow calendar date YYYY-MM-DD. A week starts Monday. */
  from: string;
  /** Required only for range; inclusive Moscow date. */
  through?: string;
}
export interface PeriodBounds {
  fromUtc: string;
  toUtcExclusive: string;
  label: string;
}

const MONEY_KINDS = new Set<string>(SUM_KINDS);
const VALID_SOURCES: EvidenceSource[] = [
  'internal_record', 'supplier_api_quote', 'manual_unverified',
  'primary_document_verified', 'payment_confirmed', 'accountant_attested',
];
const PROOF_KINDS = new Set<EntryKind>([
  'mandate_evidence', 'procurement_document', 'sale_document', 'handover', 'agent_report',
]);

function ensure(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
export function validMoney(amount: number, allowZero = false): void {
  ensure(Number.isSafeInteger(amount) && (allowZero ? amount >= 0 : amount > 0),
    'Amount must be a positive safe integer in kopecks');
}
function textField(x: string, max = 300): boolean {
  return typeof x === 'string' && x.trim().length > 0 && x.length <= max;
}
function strictInstant(value: string): number {
  ensure(typeof value === 'string' &&
    /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(value),
    'A UTC/offset timestamp is required');
  const ms = Date.parse(value);
  ensure(Number.isFinite(ms), 'Invalid timestamp');
  return ms;
}
export function validateLine(line: LedgerLine): void {
  ensure(textField(line.orderId, 80) && textField(line.lineKey, 120), 'Order and line identifiers are required');
  ensure(textField(line.clientOrganizationId, 160), 'Client organisation identifier is required');
  ensure(textField(line.supplierRef, 160), 'Supplier reference is required');
  ensure(OPERATION_KINDS.includes(line.operationKind), 'Unknown operation kind');
  validMoney(line.agreedCustomerTotal, true);
  ensure(line.currency === 'RUB', 'Only RUB is supported');
  ensure(textField(line.offerVersion, 160) && /^[a-fA-F0-9]{64}$/.test(line.offerHash),
    'Signed offer version and SHA-256 are required');
  ensure(textField(line.feeScheduleVersion, 160), 'Fee terms version is required');
  if (line.mandateAcceptedAt != null) strictInstant(line.mandateAcceptedAt);
  if (line.operationKind === 'client_purchase_agent') {
    ensure(textField(line.mandateRef ?? '', 300), 'Client mandate reference is required');
    ensure(!!line.mandateAcceptedAt, 'Client mandate acceptance time is required');
  }
}
export function validateEntry(entry: LedgerEntry): void {
  ensure(textField(entry.eventKey, 160) && textField(entry.lineId, 80), 'Event and line keys required');
  ensure(ENTRY_KINDS.includes(entry.kind), 'Unknown ledger event kind');
  ensure(VALID_SOURCES.includes(entry.sourceKind), 'Unknown evidence source');
  ensure(textField(entry.sourceRef, 500), 'Evidence source reference required');
  strictInstant(entry.occurredAt);
  ensure(entry.evidenceHash == null || /^[a-fA-F0-9]{64}$/.test(entry.evidenceHash),
    'Evidence hash must be SHA-256');
  if (MARKER_KINDS.has(entry.kind)) {
    ensure(entry.amountKopecks === 0, 'Evidence markers must have zero amount');
  } else {
    ensure(MONEY_KINDS.has(entry.kind), 'Invalid amount event');
    validMoney(Math.abs(entry.amountKopecks));
  }
  if (PROOF_KINDS.has(entry.kind) && entry.sourceKind === 'primary_document_verified') {
    ensure(!!entry.evidenceHash, 'Verified evidence requires original document SHA-256');
  }
  if (entry.kind === 'accountant_approval') {
    ensure(entry.sourceKind === 'accountant_attested' && !!entry.evidenceHash,
      'Accountant approval must reference a signed attestation');
  }
  if (entry.amountKopecks < 0) {
    ensure(textField(entry.compensatesEventKey ?? '', 160), 'Negative entry must reference original event');
    ensure(textField(entry.correctionReason ?? '', 1000) &&
      (entry.correctionReason ?? '').trim().length >= 8, 'Reason required for correction');
  } else {
    ensure(entry.compensatesEventKey == null, 'Only negative corrections may compensate an event');
  }
}
export function emptyTotals(): Totals {
  return Object.fromEntries(SUM_KINDS.map((kind) => [kind, 0])) as Totals;
}
export function entryTotals(entries: readonly LedgerEntry[]): Totals {
  const sums = emptyTotals();
  for (const entry of entries) {
    if (entry.kind in sums) {
      const k = entry.kind as keyof Totals;
      const n = sums[k] + entry.amountKopecks;
      ensure(Number.isSafeInteger(n), 'Aggregate kopecks exceeded safe integer');
      sums[k] = n;
    }
  }
  return sums;
}
function acceptedProof(entries: readonly LedgerEntry[], kind: EntryKind): LedgerEntry[] {
  return entries.filter((e) => e.kind === kind && e.sourceKind === 'primary_document_verified' &&
    !!e.evidenceHash && !e.compensatesEventKey);
}
function hasMarker(entries: readonly LedgerEntry[], kind: EntryKind): boolean {
  return acceptedProof(entries, kind).length > 0;
}
function finding(code: string, severity: Finding['severity'], message: string): Finding {
  return { code, severity, message };
}
export function assessLine(line: LedgerLine, allEntries: readonly LedgerEntry[]): Assessment {
  validateLine(line);
  const entries = allEntries.filter((e) => e.lineId === line.id);
  for (const e of entries) validateEntry(e);
  const t = entryTotals(entries);
  const findings: Finding[] = [];
  const missing = (code: string, message: string) => findings.push(finding(code, 'missing', message));
  const mismatch = (code: string, message: string) => findings.push(finding(code, 'mismatch', message));
  const agency = line.operationKind !== 'own_inventory_sale';
  if (agency) {
    if (line.operationKind === 'supplier_sales_agent') {
      // Supplier-agency contracts are NOT inferred from a supplier quote.
      if (!hasMarker(entries, 'mandate_evidence')) missing('supplier_agency_contract', 'Verified supplier agency contract is missing');
    } else {
      if (!line.mandateRef || !line.mandateAcceptedAt || !hasMarker(entries, 'mandate_evidence')) {
        missing('client_mandate', 'Accepted client mandate with original evidence required');
      }
      const earliestPurchase = entries.filter((e) =>
        e.kind === 'supplier_order' || e.kind === 'procurement_document' || e.kind === 'supplier_payment')
        .map((e) => strictInstant(e.occurredAt)).sort((a, b) => a - b)[0];
      if (earliestPurchase != null && line.mandateAcceptedAt &&
        strictInstant(line.mandateAcceptedAt) >= earliestPurchase) {
        mismatch('mandate_late', 'Mandate was accepted at or after procurement');
      }
    }
    if (acceptedProof(entries, 'procurement_document').length === 0 || t.procurement_document <= 0) {
      missing('supplier_primary_doc', 'Allocated supplier primary document required');
    }
    if (t.reimbursement_agreed !== t.procurement_document) {
      mismatch('reimbursement_vs_purchase', 'Agreed reimbursement differs from verified purchase documents');
    }
    if (t.reimbursement_agreed + t.procurement_fee_agreed + t.platform_fee_agreed !== line.agreedCustomerTotal) {
      mismatch('fees_vs_agreed_total', 'Reimbursement plus agreed fees differs from client-approved total');
    }
    if (t.recognized_revenue > t.procurement_fee_agreed + t.platform_fee_agreed) {
      mismatch('revenue_above_fees', 'Recognised agency revenue exceeds agreed fees');
    }
    if (!hasMarker(entries, 'agent_report')) missing('agent_report', 'Signed agent report required');
  } else {
    if (acceptedProof(entries, 'sale_document').length === 0 || t.sale_document <= 0) {
      missing('sale_primary_doc', 'Verified own-inventory sale evidence required');
    }
    if (t.sale_document !== line.agreedCustomerTotal) {
      mismatch('sale_vs_agreed', 'Sale document total differs from client approved total');
    }
    if (t.recognized_revenue > t.sale_document) {
      mismatch('sale_revenue_above_total', 'Recognised revenue exceeds documented sale total');
    }
  }
  if (!hasMarker(entries, 'handover')) missing('handover', 'Verified handover evidence required');
  if (t.customer_receipt - t.customer_refund > line.agreedCustomerTotal) {
    mismatch('overpayment', 'Net customer receipts exceed agreed total');
  }
  if (t.customer_refund > t.customer_receipt) mismatch('refund_exceeds_receipt', 'Customer refunds exceed receipts');
  if (t.supplier_refund > t.supplier_payment) mismatch('supplier_refund_exceeds_paid', 'Supplier refunds exceed payments');
  if (t.input_vat > t.procurement_document) mismatch('input_vat_above_purchase', 'Input VAT greater than purchase evidence');
  if (t.output_vat > (agency ? t.procurement_fee_agreed + t.platform_fee_agreed : t.sale_document)) {
    mismatch('output_vat_above_base', 'Output VAT exceeds underlying documented income');
  }
  if (t.recognized_revenue < 0 || t.procurement_document < 0 || t.sale_document < 0 ||
    t.reimbursement_agreed < 0 || t.procurement_fee_agreed < 0 || t.platform_fee_agreed < 0) {
    mismatch('negative_balance', 'Corrected balances cannot be negative');
  }
  const approved = entries.some((e) => e.kind === 'accountant_approval' &&
    e.sourceKind === 'accountant_attested' && !!e.evidenceHash);
  const status: LineStatus = findings.some((f) => f.severity === 'mismatch')
    ? 'requires_reconciliation'
    : findings.length ? 'awaiting_docs'
      : approved ? 'accountant_approved' : 'verified';
  return {
    lineId: line.id, status, findings, totals: t,
    priceDifferenceForAnalytics: line.agreedCustomerTotal - t.procurement_document,
  };
}
function parseDay(s: string): Date {
  ensure(/^\d{4}-\d{2}-\d{2}$/.test(s), 'Date must use YYYY-MM-DD');
  const d = new Date(s + 'T00:00:00.000Z');
  ensure(!Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s, 'Invalid calendar date');
  return d;
}
function dayText(d: Date): string { return d.toISOString().slice(0, 10); }
function addDays(d: Date, days: number): Date {
  const next = new Date(d.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}
/**
 * Moscow is UTC+03:00 under current rules. No JS local timezone is consulted.
 * If Moscow timezone legislation changes, migrate this conversion explicitly.
 */
export function periodBounds(period: Period): PeriodBounds {
  const input = parseDay(period.from);
  let first = input;
  let after: Date;
  if (period.kind === 'day') after = addDays(first, 1);
  else if (period.kind === 'week') {
    first = addDays(first, -((first.getUTCDay() + 6) % 7));
    after = addDays(first, 7);
  } else if (period.kind === 'month') {
    first = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), 1));
    after = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 1));
  } else if (period.kind === 'range') {
    ensure(!!period.through, 'Range end required');
    after = addDays(parseDay(period.through), 1);
    ensure(after > first && after.getTime() - first.getTime() <= 366 * 86_400_000,
      'Range must be at most 366 days');
  } else throw new Error('Unknown period');
  const from = dayText(first);
  const to = dayText(after);
  return {
    fromUtc: new Date(from + 'T00:00:00+03:00').toISOString(),
    toUtcExclusive: new Date(to + 'T00:00:00+03:00').toISOString(),
    label: from + '..' + dayText(addDays(after, -1)) + ' Europe/Moscow',
  };
}
export interface RegisterRow {
  lineId: string;
  orderId: string;
  lineKey: string;
  clientOrganizationId: string;
  operationKind: OperationKind;
  status: LineStatus;
  eventTotals: Totals;
  confirmedTaxableRevenue: number;
  unverifiedTaxableRevenue: number;
  findingCodes: string[];
}
export interface Register {
  period: PeriodBounds;
  rows: RegisterRow[];
  totals: Totals;
  confirmedTaxableRevenue: number;
  unverifiedTaxableRevenue: number;
  byOrganization: Array<{ clientOrganizationId: string; totals: Totals; confirmedTaxableRevenue: number; unverifiedTaxableRevenue: number; count: number }>;
  blockedForTaxPackage: boolean;
  note: string;
}
/** Period totals count EVENTS in the interval; verification uses all historical events AS OF end. */
export function buildRegister(lines: readonly LedgerLine[], entries: readonly LedgerEntry[], period: Period): Register {
  const bounds = periodBounds(period);
  const start = Date.parse(bounds.fromUtc);
  const end = Date.parse(bounds.toUtcExclusive);
  const rows: RegisterRow[] = [];
  for (const line of lines) {
    const history = entries.filter((e) => e.lineId === line.id && strictInstant(e.occurredAt) < end);
    const active = history.filter((e) => strictInstant(e.occurredAt) >= start);
    if (!active.length) continue;
    const assessment = assessLine(line, history);
    const eventTotals = entryTotals(active);
    const confirmed = assessment.status === 'verified' || assessment.status === 'accountant_approved';
    rows.push({
      lineId: line.id, orderId: line.orderId, lineKey: line.lineKey,
      clientOrganizationId: line.clientOrganizationId, operationKind: line.operationKind,
      status: assessment.status, eventTotals,
      confirmedTaxableRevenue: confirmed ? eventTotals.recognized_revenue : 0,
      unverifiedTaxableRevenue: confirmed ? 0 : eventTotals.recognized_revenue,
      findingCodes: assessment.findings.map((f) => f.code),
    });
  }
  rows.sort((a, b) => a.clientOrganizationId.localeCompare(b.clientOrganizationId) ||
    a.orderId.localeCompare(b.orderId) || a.lineKey.localeCompare(b.lineKey));
  const totals = emptyTotals();
  const groups = new Map<string, Register['byOrganization'][number]>();
  for (const row of rows) {
    let group = groups.get(row.clientOrganizationId);
    if (!group) {
      group = { clientOrganizationId: row.clientOrganizationId, totals: emptyTotals(),
        confirmedTaxableRevenue: 0, unverifiedTaxableRevenue: 0, count: 0 };
      groups.set(row.clientOrganizationId, group);
    }
    group.count++;
    group.confirmedTaxableRevenue += row.confirmedTaxableRevenue;
    group.unverifiedTaxableRevenue += row.unverifiedTaxableRevenue;
    for (const k of SUM_KINDS) {
      totals[k] += row.eventTotals[k];
      group.totals[k] += row.eventTotals[k];
      ensure(Number.isSafeInteger(totals[k]) && Number.isSafeInteger(group.totals[k]),
        'Aggregate kopecks exceeded safe integer');
    }
  }
  const confirmedTaxableRevenue = rows.reduce((n, row) => n + row.confirmedTaxableRevenue, 0);
  const unverifiedTaxableRevenue = rows.reduce((n, row) => n + row.unverifiedTaxableRevenue, 0);
  ensure(Number.isSafeInteger(confirmedTaxableRevenue) && Number.isSafeInteger(unverifiedTaxableRevenue),
    'Aggregate kopecks exceeded safe integer');
  return {
    period: bounds, rows, totals, confirmedTaxableRevenue, unverifiedTaxableRevenue,
    byOrganization: [...groups.values()].sort((a, b) =>
      a.clientOrganizationId.localeCompare(b.clientOrganizationId)),
    blockedForTaxPackage: rows.some((r) => r.status !== 'accountant_approved'),
    note: 'Internal evidence register only; not a USN declaration, tax return, KUDiR or legally approved tax calculation.',
  };
}
function csvCell(value: string | number): string {
  let s = String(value);
  // Neutralize spreadsheet formula injection even when identifiers come from clients.
  if (/^[\s]*[=+@-]/.test(s)) s = "'" + s;
  return '"' + s.replace(/"/g, '""') + '"';
}
/** UTF-8 BOM for Excel. Not intended as a legally signed export. */
export function registerCsv(report: Register): string {
  const keys = ['lineId', 'orderId', 'clientOrganizationId', 'operationKind', 'status',
    ...SUM_KINDS, 'confirmedTaxableRevenue', 'unverifiedTaxableRevenue', 'findingCodes'];
  const output = [keys.map(csvCell).join(',')];
  for (const row of report.rows) {
    output.push([
      row.lineId, row.orderId, row.clientOrganizationId, row.operationKind, row.status,
      ...SUM_KINDS.map((k) => row.eventTotals[k]),
      row.confirmedTaxableRevenue, row.unverifiedTaxableRevenue,
      row.findingCodes.join(';'),
    ].map(csvCell).join(','));
  }
  return '\uFEFF' + output.join('\r\n') + '\r\n';
}
