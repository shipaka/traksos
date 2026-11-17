import type { Db, Queryable } from '../db/index.ts';
import type { AuthUser } from '../http/router.ts';
import { bad, conflict, forbidden, notFound } from '../http/router.ts';
import {
  digest, moscowPeriod, reviewEvidenceLine, safeCsvCell, validateEvidenceEvent,
  type EvidenceEvent, type EvidenceLine, type EvidenceReview,
  type EvidenceEventKind, type MoneyComponent, type OperationKind,
} from '../domain/shopAgentEvidence.ts';

// Internal service only. No public shop API, checkout changes or implicit fiscal posting.
// Explicitly mount admin-only handlers in a separate integration PR after review.
export interface NewEvidenceLine {
  externalLineKey: string;
  shopOrderId?: string | null;
  customerId?: string | null;
  customerName: string;
  customerInn?: string | null;
  operationKind: OperationKind;
  supplierKey: string;
  article: string;
  quantityOrdered: number;
  agreedCustomerTotalKopecks: number;
  agentFeeAgreedKopecks: number;
  platformFeeAgreedKopecks: number;
  mandateReference?: string | null;
  mandateAcceptedAt?: string | null;
  supplierContractReference?: string | null;
  offerVersion?: string | null;
  offerHash?: string | null;
  feeScheduleVersion: string;
}
export interface NewEvidenceEvent {
  externalKey: string;
  kind: EvidenceEventKind;
  component?: MoneyComponent | null;
  amountKopecks?: number;
  vatKopecks?: number;
  quantity?: number;
  source: 'manual_unverified' | 'accountant_verified' | 'system';
  reference?: string | null;
  documentHash?: string | null;
  documentTotalKopecks?: number | null;
  occurredAt: string;
  metadata?: Record<string, unknown>;
}

type LineRow = Record<string, any>;
type EventRow = Record<string, any>;

function admin(actor: AuthUser) {
  if (!actor.roles?.includes('admin')) throw forbidden('Только администратор может работать с внутренним учётом закупок');
}
function integer(value: unknown, label: string): number {
  const number = typeof value === 'string' ? Number(value) : value;
  if (typeof number !== 'number' || !Number.isSafeInteger(number) || number < 0)
    throw bad('ledger_number_invalid', 'Некорректная сумма или количество: ' + label);
  return number;
}
function iso(value: unknown): string {
  const d = new Date(value as any);
  if (Number.isNaN(d.valueOf())) throw bad('ledger_time_invalid', 'Неверная дата события');
  return d.toISOString();
}
function optionalText(value: string | null | undefined, max = 250): string | null {
  const v = value?.trim() || null;
  if (v && v.length > max) throw bad('ledger_text_too_long', 'Слишком длинное текстовое поле');
  return v;
}
function validateNewLine(input: NewEvidenceLine) {
  if (!['client_purchase_agent','supplier_sales_agent','own_inventory_sale'].includes(input.operationKind))
    throw bad('ledger_kind', 'Неизвестная модель закупки');
  if (!input.externalLineKey?.trim() || input.externalLineKey.trim().length < 3 ||
      input.externalLineKey.length > 120 || !input.customerName?.trim() ||
      input.customerName.trim().length > 200 || !input.supplierKey?.trim() ||
      input.supplierKey.length > 100 || !input.article?.trim() ||
      input.article.length > 160 || !input.feeScheduleVersion?.trim())
    throw bad('ledger_line_required', 'Не заполнены обязательные поля закупки');
  const q = integer(input.quantityOrdered, 'quantityOrdered');
  if (q < 1 || q > 100000) throw bad('ledger_quantity', 'Количество за пределами допуска');
  const total = integer(input.agreedCustomerTotalKopecks, 'agreedCustomerTotalKopecks');
  const agent = integer(input.agentFeeAgreedKopecks, 'agentFeeAgreedKopecks');
  const platform = integer(input.platformFeeAgreedKopecks, 'platformFeeAgreedKopecks');
  if (agent + platform > total)
    throw bad('ledger_fee_over_total', 'Сумма согласованных комиссий больше суммы заказа');
  if (input.operationKind === 'own_inventory_sale' && (agent || platform))
    throw bad('ledger_own_sale_fees', 'Собственная продажа не может быть записана как агентское вознаграждение');
  if ([total, agent, platform].some((v) => v > 10_000_000_000))
    throw bad('ledger_money_limit', 'Сумма строки выше допустимого лимита: разбейте операцию');
  if (input.mandateAcceptedAt) iso(input.mandateAcceptedAt);
  if (input.offerHash && !/^[0-9a-f]{64}$/i.test(input.offerHash))
    throw bad('ledger_offer_digest', 'Хеш принятой оферты должен быть SHA-256');
  if (input.customerInn && !/^\d{10}(\d{2})?$/.test(input.customerInn))
    throw bad('ledger_inn', 'ИНН компании должен содержать 10 или 12 цифр');
}
function persistedLine(r: LineRow): EvidenceLine {
  return {
    id: r.id, external_line_key: r.external_line_key, operation_kind: r.operation_kind,
    supplier_key: r.supplier_key, article: r.article,
    quantity_ordered: integer(r.quantity_ordered, 'quantity'),
    agreed_customer_total_kopecks: integer(r.agreed_customer_total_kopecks, 'total'),
    agent_fee_agreed_kopecks: integer(r.agent_fee_agreed_kopecks, 'agent fee'),
    platform_fee_agreed_kopecks: integer(r.platform_fee_agreed_kopecks, 'platform fee'),
    mandate_reference: r.mandate_reference, mandate_accepted_at: r.mandate_accepted_at ? iso(r.mandate_accepted_at) : null,
    supplier_contract_reference: r.supplier_contract_reference, offer_version: r.offer_version,
    offer_hash: r.offer_hash, fee_schedule_version: r.fee_schedule_version,
    customer_name: r.customer_name, customer_inn: r.customer_inn, snapshot_hash: r.snapshot_hash,
  };
}
function persistedEvent(r: EventRow): EvidenceEvent {
  return {
    id: String(r.id), line_id: r.line_id, external_key: r.external_key, kind: r.kind,
    component: r.component, amount_kopecks: integer(r.amount_kopecks, 'amount'),
    vat_kopecks: integer(r.vat_kopecks, 'VAT'), quantity: integer(r.quantity, 'quantity'),
    source: r.source, reference: r.reference, document_hash: r.document_hash,
    document_total_kopecks: r.document_total_kopecks == null ? null : integer(r.document_total_kopecks, 'document total'),
    occurred_at: iso(r.occurred_at), recorded_at: iso(r.recorded_at),
    metadata: r.metadata || {}, payload_hash: r.payload_hash,
  };
}
function canonicalLine(input: NewEvidenceLine): Omit<NewEvidenceLine, 'shopOrderId' | 'customerId'> & {
  shopOrderId: string | null; customerId: string | null;
} {
  return {
    externalLineKey: input.externalLineKey.trim(), shopOrderId: input.shopOrderId || null,
    customerId: input.customerId || null, customerName: input.customerName.trim(),
    customerInn: optionalText(input.customerInn, 12), operationKind: input.operationKind,
    supplierKey: input.supplierKey.trim(), article: input.article.trim(),
    quantityOrdered: input.quantityOrdered, agreedCustomerTotalKopecks: input.agreedCustomerTotalKopecks,
    agentFeeAgreedKopecks: input.agentFeeAgreedKopecks, platformFeeAgreedKopecks: input.platformFeeAgreedKopecks,
    mandateReference: optionalText(input.mandateReference),
    mandateAcceptedAt: input.mandateAcceptedAt ? iso(input.mandateAcceptedAt) : null,
    supplierContractReference: optionalText(input.supplierContractReference),
    offerVersion: optionalText(input.offerVersion), offerHash: optionalText(input.offerHash, 64),
    feeScheduleVersion: input.feeScheduleVersion.trim(),
  };
}
function canonicalEvent(input: NewEvidenceEvent) {
  const item = {
    external_key: input.externalKey.trim(), kind: input.kind, component: input.component ?? null,
    amount_kopecks: input.amountKopecks ?? 0, vat_kopecks: input.vatKopecks ?? 0,
    quantity: input.quantity ?? 0, source: input.source, reference: optionalText(input.reference),
    document_hash: optionalText(input.documentHash, 64),
    document_total_kopecks: input.documentTotalKopecks ?? null,
    occurred_at: iso(input.occurredAt), metadata: input.metadata ?? {},
  };
  if (item.external_key.length < 3 || item.external_key.length > 160)
    throw bad('ledger_external_key', 'Неверный ключ события');
  if (item.amount_kopecks > 10_000_000_000 || item.document_total_kopecks != null &&
      item.document_total_kopecks > 10_000_000_000)
    throw bad('ledger_money_limit', 'Сумма события превышает допустимый лимит');
  if (!['manual_unverified','accountant_verified','system'].includes(item.source))
    throw bad('ledger_source', 'Неверный источник');
  if (item.document_hash && !/^[0-9a-f]{64}$/i.test(item.document_hash))
    throw bad('ledger_document_hash', 'Документ должен иметь SHA-256');
  if (JSON.stringify(item.metadata).length > 4000)
    throw bad('ledger_metadata_size', 'Слишком большой служебный комментарий');
  try {
    validateEvidenceEvent({ ...item, line_id: undefined, payload_hash: undefined } as any);
  } catch (e) {
    throw bad('ledger_event_invalid', 'Неверное событие: ' + (e as Error).message);
  }
  return item;
}
function netAmount(events: EvidenceEvent[], kind: EvidenceEventKind, component?: MoneyComponent): number {
  return events.reduce((a, e) => a + (e.kind === kind && (component === undefined || e.component === component) ? e.amount_kopecks : 0), 0);
}
function periodFlows(line: EvidenceLine, events: EvidenceEvent[]) {
  const received = netAmount(events, 'customer_receipt');
  const refunds = netAmount(events, 'customer_refund');
  const component = (c: MoneyComponent) => netAmount(events, 'customer_receipt', c) - netAmount(events, 'customer_refund', c);
  return {
    receivedNetKopecks: received - refunds,
    refundedKopecks: refunds,
    supplierPaidNetKopecks: netAmount(events, 'supplier_payment') - netAmount(events, 'supplier_refund'),
    supplierDocumentedKopecks: netAmount(events.filter((e) => e.source === 'accountant_verified'), 'supplier_document'),
    agentFeeNetKopecks: component('agent_fee'),
    platformFeeNetKopecks: component('platform_fee'),
    reimbursementNetKopecks: component('reimbursement'),
    outputVatAssessedKopecks: netAmount(events, 'output_vat_assessed'),
    inputVatDocumentedKopecks: events.reduce((a, e) => a + (e.kind === 'supplier_document' && e.source === 'accountant_verified' ? e.vat_kopecks : 0), 0),
    candidateCashRevenueKopecks: line.operation_kind === 'own_inventory_sale'
      ? component('own_sale') : component('agent_fee') + component('platform_fee'),
  };
}
type Flows = ReturnType<typeof periodFlows>;
const zeroFlows = (): Flows => ({
  receivedNetKopecks: 0, refundedKopecks: 0, supplierPaidNetKopecks: 0,
  supplierDocumentedKopecks: 0, agentFeeNetKopecks: 0, platformFeeNetKopecks: 0,
  reimbursementNetKopecks: 0, outputVatAssessedKopecks: 0,
  inputVatDocumentedKopecks: 0, candidateCashRevenueKopecks: 0,
});
function addFlows(a: Flows, b: Flows) {
  for (const k of Object.keys(a) as (keyof Flows)[]) a[k] += b[k];
}
async function audit(q: Queryable, actor: AuthUser, action: string, target: string, data: object) {
  await q.query('insert into audit_log(actor_id,action,target,data) values ($1,$2,$3,$4)',
    [actor.id, action, target, data]);
}

export class ShopAgentEvidenceLedger {
  constructor(private readonly db: Db) {}

  async createLine(actor: AuthUser, input: NewEvidenceLine) {
    admin(actor);
    validateNewLine(input);
    const p = canonicalLine(input);
    const hash = digest(p);
    return this.db.tx(async (q) => {
      const args = [
        p.externalLineKey, p.shopOrderId, p.customerId, p.customerName, p.customerInn,
        p.operationKind, p.supplierKey, p.article, p.quantityOrdered,
        p.agreedCustomerTotalKopecks, p.agentFeeAgreedKopecks, p.platformFeeAgreedKopecks,
        p.mandateReference, p.mandateAcceptedAt, p.supplierContractReference,
        p.offerVersion, p.offerHash, p.feeScheduleVersion, hash, actor.id,
      ];
      const sql = 'insert into shop_agent_evidence_lines ' +
        '(external_line_key,shop_order_id,customer_id,customer_name,customer_inn,operation_kind,' +
        'supplier_key,article,quantity_ordered,agreed_customer_total_kopecks,agent_fee_agreed_kopecks,' +
        'platform_fee_agreed_kopecks,mandate_reference,mandate_accepted_at,supplier_contract_reference,' +
        'offer_version,offer_hash,fee_schedule_version,snapshot_hash,created_by) ' +
        'values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20) ' +
        'on conflict (external_line_key) do nothing returning *';
      const inserted = await q.one<LineRow>(sql, args);
      const found = inserted ?? await q.one<LineRow>(
        'select * from shop_agent_evidence_lines where external_line_key=$1', [p.externalLineKey]);
      if (!found) throw conflict('ledger_line_conflict', 'Строка не найдена после попытки создания');
      if (found.snapshot_hash !== hash)
        throw conflict('ledger_line_key_collision', 'Этот ключ уже используется другой версией закупки');
      if (inserted) await audit(q, actor, 'shop.agent_line_created', found.id, { line: p.externalLineKey, snapshotHash: hash });
      return persistedLine(found);
    });
  }

  private async append(q: Queryable, actor: AuthUser, lineId: string, input: NewEvidenceEvent) {
    const p = canonicalEvent(input);
    const hash = digest([lineId, p]);
    const values = [
      p.external_key, lineId, p.kind, p.component, p.amount_kopecks, p.vat_kopecks,
      p.quantity, p.source, p.reference, p.document_hash, p.document_total_kopecks,
      p.occurred_at, actor.id, p.metadata, hash,
    ];
    const sql = 'insert into shop_agent_evidence_events ' +
      '(external_key,line_id,kind,component,amount_kopecks,vat_kopecks,quantity,source,' +
      'reference,document_hash,document_total_kopecks,occurred_at,recorded_by,metadata,payload_hash) ' +
      'values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) ' +
      'on conflict (external_key) do nothing returning *';
    const inserted = await q.one<EventRow>(sql, values);
    const row = inserted ?? await q.one<EventRow>(
      'select * from shop_agent_evidence_events where external_key=$1', [p.external_key]);
    if (!row) throw conflict('ledger_event_conflict', 'Событие не найдено после создания');
    if (row.payload_hash !== hash) throw conflict('ledger_event_key_collision', 'Повтор ключа с другим содержимым');
    if (inserted) await audit(q, actor, 'shop.agent_event_created', String(row.id),
      { lineId, kind: p.kind, source: p.source, reference: p.reference, hash });
    return persistedEvent(row);
  }

  async appendEvent(actor: AuthUser, externalLineKey: string, event: NewEvidenceEvent) {
    admin(actor);
    if (event.kind === 'accountant_approval')
      throw forbidden('Подтверждение возможно только после документальной сверки');
    return this.db.tx(async (q) => {
      const line = await q.one<LineRow>(
        'select * from shop_agent_evidence_lines where external_line_key=$1 for update', [externalLineKey]);
      if (!line) throw notFound('Строка закупки не найдена');
      return this.append(q, actor, line.id, event);
    });
  }

  private async loadEvents(q: Queryable, ids: string[]): Promise<EvidenceEvent[]> {
    if (!ids.length) return [];
    const rows = await q.query<EventRow>(
      'select * from shop_agent_evidence_events where line_id=any($1::uuid[]) order by id', [ids]);
    if (rows.length > 100000) throw bad('ledger_result_too_large', 'Разбейте выгрузку на более короткие периоды');
    return rows.map(persistedEvent);
  }
  private async coverage(q: Queryable, events: EvidenceEvent[]): Promise<Record<string, number>> {
    const hashes = [...new Set(events.filter((e) => e.document_hash).map((e) => e.document_hash!))];
    if (!hashes.length) return {};
    const rows = await q.query<{ document_hash: string; amount: string; versions: number }>(
      "select document_hash, sum(amount_kopecks)::text as amount, " +
      "count(distinct document_total_kopecks)::int as versions " +
      "from shop_agent_evidence_events where kind='supplier_document' " +
      'and document_hash=any($1::text[]) group by document_hash', [hashes]);
    return Object.fromEntries(rows.map((r) =>
      [r.document_hash, r.versions === 1 ? integer(r.amount, 'document allocation') : -1]));
  }
  private async review(q: Queryable, row: LineRow) {
    const line = persistedLine(row);
    const events = await this.loadEvents(q, [line.id]);
    const docs = await this.coverage(q, events);
    return { line, events, review: reviewEvidenceLine(line, events, docs) };
  }

  async inspect(actor: AuthUser, externalLineKey: string) {
    admin(actor);
    const row = await this.db.one<LineRow>(
      'select * from shop_agent_evidence_lines where external_line_key=$1', [externalLineKey]);
    if (!row) throw notFound('Строка закупки не найдена');
    const result = await this.review(this.db, row);
    await audit(this.db, actor, 'shop.agent_line_viewed', row.id, { key: externalLineKey });
    return result;
  }

  async approve(actor: AuthUser, externalLineKey: string, reason: string) {
    admin(actor);
    if (!reason?.trim() || reason.trim().length < 8)
      throw bad('ledger_approval_reason', 'Нужно указать основание подтверждения (не менее 8 символов)');
    return this.db.tx(async (q) => {
      const row = await q.one<LineRow>(
        'select * from shop_agent_evidence_lines where external_line_key=$1 for update', [externalLineKey]);
      if (!row) throw notFound('Строка закупки не найдена');
      const before = await this.review(q, row);
      if (!['verified','accountant_approved'].includes(before.review.status))
        throw conflict('ledger_unverified', 'Сверка не завершена, запись нельзя подтвердить');
      const receipt: NewEvidenceEvent = {
        externalKey: 'approval:' + row.id + ':' + before.review.eventDigest,
        kind: 'accountant_approval', source: 'accountant_verified', occurredAt: new Date().toISOString(),
        reference: reason.trim().slice(0, 250), metadata: { review_digest: before.review.eventDigest },
      };
      const signed = await this.append(q, actor, row.id, receipt);
      return { ...before.review, status: 'accountant_approved' as const, approvalEvent: signed.external_key };
    });
  }

  async periodReport(actor: AuthUser, kind: 'day' | 'week' | 'month' | 'custom',
    date: string, until?: string, customerInn?: string | null) {
    admin(actor);
    if (customerInn && !/^\d{10}(\d{2})?$/.test(customerInn))
      throw bad('ledger_inn', 'Неверный ИНН');
    let period: ReturnType<typeof moscowPeriod>;
    try { period = moscowPeriod(kind, date, until); }
    catch { throw bad('ledger_period', 'Неверные границы отчётного периода'); }

    const lines = await this.db.query<LineRow>(
      'select distinct l.* from shop_agent_evidence_lines l ' +
      'join shop_agent_evidence_events e on e.line_id=l.id ' +
      'where e.occurred_at >= $1::timestamptz and e.occurred_at < $2::timestamptz ' +
      'and ($3::text is null or l.customer_inn=$3) ' +
      'order by l.customer_name,l.external_line_key limit 5001',
      [period.fromUtc, period.toUtc, customerInn || null]);
    if (lines.length > 5000) throw bad('ledger_report_limit', 'Больше 5000 строк: сузьте период или ИНН');
    const allEvents = await this.loadEvents(this.db, lines.map((r) => r.id));
    const coverage = await this.coverage(this.db, allEvents);
    const grouped = new Map<string, EvidenceEvent[]>();
    for (const e of allEvents) grouped.set(e.line_id, [...(grouped.get(e.line_id) ?? []), e]);
    const from = Date.parse(period.fromUtc);
    const to = Date.parse(period.toUtc);
    const rows = lines.map((r) => {
      const line = persistedLine(r);
      const full = grouped.get(line.id) ?? [];
      const review = reviewEvidenceLine(line, full, coverage);
      const money = periodFlows(line, full.filter((e) =>
        Date.parse(e.occurred_at) >= from && Date.parse(e.occurred_at) < to));
      return { line, review, money };
    });
    const totals = zeroFlows();
    const approved = zeroFlows();
    const groups = new Map<string, { customer: string; inn: string | null; rows: number; totals: Flows; approved: Flows }>();
    for (const row of rows) {
      addFlows(totals, row.money);
      const qualified = row.review.status === 'accountant_approved';
      if (qualified) addFlows(approved, row.money);
      const key = row.line.customer_inn || 'name:' + row.line.customer_name;
      const group = groups.get(key) ?? {
        customer: row.line.customer_name, inn: row.line.customer_inn,
        rows: 0, totals: zeroFlows(), approved: zeroFlows(),
      };
      group.rows++;
      addFlows(group.totals, row.money);
      if (qualified) addFlows(group.approved, row.money);
      groups.set(key, group);
    }
    await audit(this.db, actor, 'shop.agent_period_viewed', kind + ':' + date,
      { fromUtc: period.fromUtc, toUtc: period.toUtc, filterInn: customerInn || null, count: rows.length });
    return {
      disclaimer: 'Внутренний черновой реестр, не налоговая декларация и не КУДиР. Правовая модель агентирования, НДС и правила признания дохода требуют отдельного подтверждения.',
      period, rowCount: rows.length, totals, approvedTotals: approved,
      statusCounts: {
        awaiting_docs: rows.filter((r) => r.review.status === 'awaiting_docs').length,
        requires_reconciliation: rows.filter((r) => r.review.status === 'requires_reconciliation').length,
        verified: rows.filter((r) => r.review.status === 'verified').length,
        accountant_approved: rows.filter((r) => r.review.status === 'accountant_approved').length,
      },
      companies: [...groups.values()].sort((a, b) => a.customer.localeCompare(b.customer, 'ru')),
      rows,
    };
  }

  async exportCsv(actor: AuthUser, kind: 'day' | 'week' | 'month' | 'custom',
    date: string, until?: string, customerInn?: string | null) {
    admin(actor);
    const report = await this.periodReport(actor, kind, date, until, customerInn);
    const headers = [
      'Период МСК', 'Ключ строки', 'Компания', 'ИНН', 'Модель', 'Статус',
      'Согласовано коп.', 'Первичка коп.', 'Входящий НДС коп.',
      'Получено от клиента нетто коп.', 'Возмещение коп.', 'Вознаграждение коп.',
      'Сервисный сбор коп.', 'Платёж поставщику нетто коп.', 'Возврат клиенту коп.',
      'Предварительная денежная выручка коп.', 'Подтверждённая денежная выручка коп.',
      'Расхождения', 'Хеш снимка',
    ];
    const body = report.rows.map((r) => [
      report.period.label, r.line.external_line_key, r.line.customer_name, r.line.customer_inn,
      r.line.operation_kind, r.review.status, r.line.agreed_customer_total_kopecks,
      r.money.supplierDocumentedKopecks, r.money.inputVatDocumentedKopecks,
      r.money.receivedNetKopecks, r.money.reimbursementNetKopecks,
      r.money.agentFeeNetKopecks, r.money.platformFeeNetKopecks,
      r.money.supplierPaidNetKopecks, r.money.refundedKopecks,
      r.money.candidateCashRevenueKopecks,
      r.review.status === 'accountant_approved' ? r.money.candidateCashRevenueKopecks : '',
      r.review.findings.join('|'), r.review.eventDigest,
    ].map(safeCsvCell).join(';'));
    const csv = '\uFEFF' + [headers.map(safeCsvCell).join(';'), ...body].join('\r\n') + '\r\n';
    const hash = digest({ csv, report });
    const snapshotId = await this.db.tx(async (q) => {
      const snapshot = await q.one<{ id: string }>(
        'insert into shop_agent_evidence_exports ' +
        '(from_utc,to_utc,filter_inn,digest_sha256,report_json,row_count,created_by) ' +
        'values ($1,$2,$3,$4,$5,$6,$7) returning id',
        [report.period.fromUtc, report.period.toUtc, customerInn || null,
          hash, report, report.rowCount, actor.id]);
      if (!snapshot) throw conflict('ledger_export_failed', 'Не удалось сохранить снимок отчёта');
      await audit(q, actor, 'shop.agent_csv_exported', snapshot.id,
        { digest: hash, rows: report.rowCount, period: report.period });
      return snapshot.id;
    });
    return { csv, digest: hash, snapshotId, period: report.period, rows: report.rowCount };
  }
}
