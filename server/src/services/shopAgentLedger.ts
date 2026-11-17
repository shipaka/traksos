/**
 * Isolated persistence for evidence-based shop agency accounting.
 *
 * Deliberately NOT registered in app.ts. No automatic money movement,
 * tax filing, supplier API call or live checkout mutation occurs.
 */
import { createHash } from 'node:crypto';
import type { Db, Queryable } from '../db/index.ts';
import type { AuthUser } from '../http/router.ts';
import { bad, conflict, forbidden, notFound } from '../http/router.ts';
import {
  type LedgerLine, type LedgerEntry, type Period, type Register,
  validateLine, validateEntry, assessLine, periodBounds, buildRegister, registerCsv,
} from './shopAgentLedgerCore.ts';

const REPO = 'shop_agent_ledger';
function assertAdmin(actor: AuthUser) {
  if (!actor?.roles?.includes('admin')) throw forbidden('Только администратор может работать с внутренним финансовым реестром');
}
function sha256(payload: string): string {
  return createHash('sha256').update(payload, 'utf8').digest('hex');
}
function moneyNumber(value: unknown): number {
  const n = Number(value);
  if (!Number.isSafeInteger(n)) throw new Error('Ledger integer outside safe range');
  return n;
}
function lineFromDb(row: any): LedgerLine {
  return {
    id: row.id, orderId: row.shop_order_id, lineKey: row.line_key,
    clientOrganizationId: row.client_org_ref, supplierRef: row.supplier_ref,
    operationKind: row.operation_kind, agreedCustomerTotal: moneyNumber(row.agreed_customer_total),
    currency: row.currency, offerVersion: row.offer_version, offerHash: row.offer_hash,
    feeScheduleVersion: row.fee_schedule_version, mandateRef: row.mandate_ref,
    mandateAcceptedAt: row.mandate_accepted_at == null ? null : new Date(row.mandate_accepted_at).toISOString(),
  };
}
function eventFromDb(row: any): LedgerEntry {
  return {
    eventKey: row.event_key, lineId: row.line_id, kind: row.event_kind,
    amountKopecks: moneyNumber(row.amount_kopecks),
    occurredAt: new Date(row.occurred_at).toISOString(),
    sourceKind: row.source_kind, sourceRef: row.source_ref,
    evidenceHash: row.evidence_hash, compensatesEventKey: row.compensates_event_key,
    correctionReason: row.correction_reason,
  };
}
function normalizeInstant(value: string | null): string | null {
  return value == null ? null : new Date(value).toISOString();
}
function normalizeLine(x: LedgerLine): LedgerLine {
  return {
    ...x, offerHash: x.offerHash.toLowerCase(),
    mandateAcceptedAt: normalizeInstant(x.mandateAcceptedAt),
  };
}
function normalizeEntry(x: LedgerEntry): LedgerEntry {
  return {
    ...x, occurredAt: new Date(x.occurredAt).toISOString(),
    evidenceHash: x.evidenceHash?.toLowerCase() ?? null,
    compensatesEventKey: x.compensatesEventKey ?? null,
    correctionReason: x.correctionReason ?? null,
  };
}
function eventFingerprint(e: LedgerEntry): string {
  return sha256(JSON.stringify([
    e.eventKey, e.lineId, e.kind, e.amountKopecks, e.occurredAt,
    e.sourceKind, e.sourceRef, e.evidenceHash,
    e.compensatesEventKey, e.correctionReason,
  ]));
}
function sameLine(a: LedgerLine, b: LedgerLine): boolean {
  const relevant = (x: LedgerLine) => [
    x.orderId, x.lineKey, x.clientOrganizationId, x.supplierRef,
    x.operationKind, x.agreedCustomerTotal, x.currency, x.offerVersion,
    x.offerHash.toLowerCase(), x.feeScheduleVersion, x.mandateRef,
    normalizeInstant(x.mandateAcceptedAt),
  ];
  return JSON.stringify(relevant(a)) === JSON.stringify(relevant(b));
}
async function audit(q: Queryable, actor: AuthUser, action: string, target: string, data: object) {
  await q.query('insert into audit_log(actor_id, action, target, data) values ($1,$2,$3,$4)',
    [actor.id, action, target, data]);
}

export class ShopAgentLedger {
  constructor(private readonly db: Db) {}

  /** One immutable classification per supplier/retail order line. */
  async registerLine(actor: AuthUser, input: Omit<LedgerLine, 'id'>): Promise<LedgerLine> {
    assertAdmin(actor);
    const candidate = { id: '', ...input } as LedgerLine;
    try { validateLine(candidate); } catch (err) { throw bad('ledger_invalid_line', (err as Error).message); }
    return this.db.tx(async (q) => {
      const row = await q.one<any>(
        'insert into shop_agent_ledger_lines ' +
        '(shop_order_id,line_key,client_org_ref,supplier_ref,operation_kind,' +
        'agreed_customer_total,currency,offer_version,offer_hash,fee_schedule_version,' +
        'mandate_ref,mandate_accepted_at,recorded_by) ' +
        'values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ' +
        'on conflict (shop_order_id,line_key) do nothing returning *',
        [input.orderId, input.lineKey, input.clientOrganizationId, input.supplierRef,
          input.operationKind, input.agreedCustomerTotal, input.currency,
          input.offerVersion, input.offerHash.toLowerCase(), input.feeScheduleVersion,
          input.mandateRef, normalizeInstant(input.mandateAcceptedAt), actor.id],
      );
      const existing = row ?? await q.one<any>(
        'select * from shop_agent_ledger_lines where shop_order_id=$1 and line_key=$2',
        [input.orderId, input.lineKey]);
      if (!existing) throw notFound('Order line missing');
      const saved = lineFromDb(existing);
      if (!sameLine(saved, normalizeLine(candidate))) {
        throw conflict('ledger_line_immutable', 'Строка уже существует с другими условиями; требуется отдельная корректировка');
      }
      if (row) await audit(q, actor, 'shop_agent_ledger.line_created', saved.id,
        { orderId: saved.orderId, kind: saved.operationKind });
      return saved;
    });
  }

  /** Save an immutable, idempotent evidence or money event. */
  async appendEvent(actor: AuthUser, input: LedgerEntry): Promise<LedgerEntry> {
    assertAdmin(actor);
    try { validateEntry(input); } catch (err) { throw bad('ledger_invalid_event', (err as Error).message); }
    const e = normalizeEntry(input);
    const fingerprint = eventFingerprint(e);
    return this.db.tx(async (q) => {
      // Lock the line to serialize partial reversals, approvals and imports.
      const lineRow = await q.one<any>('select * from shop_agent_ledger_lines where id=$1 for update', [e.lineId]);
      if (!lineRow) throw notFound('Ledger line not found');
      const previous = await q.one<any>(
        'select * from shop_agent_ledger_events where event_key=$1', [e.eventKey]);
      if (previous) {
        if (previous.payload_hash !== fingerprint) {
          throw conflict('ledger_idempotency_conflict', 'The same external event key has different contents');
        }
        return eventFromDb(previous);
      }
      if (e.compensatesEventKey) {
        const original = await q.one<any>(
          'select * from shop_agent_ledger_events where event_key=$1', [e.compensatesEventKey]);
        if (!original || original.line_id !== e.lineId || original.event_kind !== e.kind ||
          moneyNumber(original.amount_kopecks) <= 0) {
          throw conflict('ledger_invalid_correction', 'Correction must reference a positive original event on the same line and kind');
        }
        const corrections = await q.query<any>(
          'select amount_kopecks from shop_agent_ledger_events where compensates_event_key=$1',
          [e.compensatesEventKey]);
        const reversed = corrections.reduce((n: number, row: any) => n + Math.abs(moneyNumber(row.amount_kopecks)), 0);
        if (reversed + Math.abs(e.amountKopecks) > moneyNumber(original.amount_kopecks)) {
          throw conflict('ledger_correction_excess', 'Correction cannot exceed original amount');
        }
      }
      if (e.kind === 'accountant_approval') {
        const history = await q.query<any>(
          'select * from shop_agent_ledger_events where line_id=$1 order by occurred_at,id',
          [e.lineId]);
        const current = assessLine(lineFromDb(lineRow), history.map(eventFromDb));
        if (current.findings.length) throw conflict('ledger_unverified', 'Cannot approve a ledger line with open findings');
      }
      const inserted = await q.one<any>(
        'insert into shop_agent_ledger_events ' +
        '(line_id,event_key,event_kind,amount_kopecks,occurred_at,source_kind,' +
        'source_ref,evidence_hash,compensates_event_key,correction_reason,payload_hash,recorded_by) ' +
        'values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ' +
        'on conflict (event_key) do nothing returning *',
        [e.lineId, e.eventKey, e.kind, e.amountKopecks, e.occurredAt,
          e.sourceKind, e.sourceRef, e.evidenceHash, e.compensatesEventKey,
          e.correctionReason, fingerprint, actor.id],
      );
      if (!inserted) {
        const race = await q.one<any>('select * from shop_agent_ledger_events where event_key=$1', [e.eventKey]);
        if (!race || race.payload_hash !== fingerprint) throw conflict('ledger_idempotency_conflict');
        return eventFromDb(race);
      }
      await audit(q, actor, 'shop_agent_ledger.event_created', e.lineId, {
        eventKey: e.eventKey, kind: e.kind, sourceKind: e.sourceKind,
        correction: !!e.compensatesEventKey,
      });
      return eventFromDb(inserted);
    });
  }

  /** Read the whole evidentiary chain only within the privileged service. */
  async inspectLine(actor: AuthUser, lineId: string) {
    assertAdmin(actor);
    const lineRow = await this.db.one<any>(
      'select * from shop_agent_ledger_lines where id=$1', [lineId]);
    if (!lineRow) throw notFound('Ledger line not found');
    const entries = (await this.db.query<any>(
      'select * from shop_agent_ledger_events where line_id=$1 order by occurred_at,id',
      [lineId])).map(eventFromDb);
    const line = lineFromDb(lineRow);
    const assessment = assessLine(line, entries);
    await audit(this.db, actor, 'shop_agent_ledger.line_viewed', lineId,
      { eventCount: entries.length });
    return { line, entries, assessment };
  }

  /**
   * Bound all financial reporting queries. Monetary values are source events,
   * not current order status; statuses are assessed using history as-of end.
   */
  async getRegister(actor: AuthUser, period: Period): Promise<Register> {
    assertAdmin(actor);
    let bounds;
    try { bounds = periodBounds(period); }
    catch (err) { throw bad('ledger_invalid_period', (err as Error).message); }
    const lineRows = await this.db.query<any>(
      'select l.* from shop_agent_ledger_lines l ' +
      'where exists (select 1 from shop_agent_ledger_events e where e.line_id=l.id ' +
      'and e.occurred_at >= $1 and e.occurred_at < $2) ' +
      'order by l.client_org_ref,l.shop_order_id,l.line_key limit 10001',
      [bounds.fromUtc, bounds.toUtcExclusive],
    );
    if (lineRows.length > 10000) throw conflict('ledger_report_too_large', 'Split report by smaller date range');
    const lines = lineRows.map(lineFromDb);
    let entries: LedgerEntry[] = [];
    if (lines.length) {
      const data = await this.db.query<any>(
        'select * from shop_agent_ledger_events ' +
        'where line_id=any($1::uuid[]) and occurred_at<$2 order by occurred_at,id limit 500001',
        [lines.map((x) => x.id), bounds.toUtcExclusive]);
      if (data.length > 500000) throw conflict('ledger_report_too_large', 'Too many evidence events');
      entries = data.map(eventFromDb);
    }
    const report = buildRegister(lines, entries, period);
    await audit(this.db, actor, 'shop_agent_ledger.report_viewed', REPO,
      { period: bounds.label, lines: report.rows.length });
    return report;
  }

  /**
   * Save a frozen report version for later audit; output is an internal CSV,
   * not an approved tax return, declaration or signed FNS submission.
   */
  async archiveCsv(actor: AuthUser, period: Period) {
    assertAdmin(actor);
    const report = await this.getRegister(actor, period);
    const csv = registerCsv(report);
    const snapshot = JSON.stringify(report);
    const hash = sha256(snapshot);
    const row = await this.db.tx(async (q) => {
      const created = await q.one<any>(
        'insert into shop_agent_ledger_exports ' +
        '(period_from_utc,period_to_utc,snapshot,sha256,created_by) ' +
        'values ($1,$2,$3::jsonb,$4,$5) returning id,created_at',
        [report.period.fromUtc, report.period.toUtcExclusive, snapshot, hash, actor.id]);
      await audit(q, actor, 'shop_agent_ledger.csv_archived', created.id,
        { sha256: hash, period: report.period.label, rows: report.rows.length });
      return created;
    });
    return {
      id: row.id as string, createdAt: new Date(row.created_at).toISOString(),
      sha256: hash, csv,
      mime: 'text/csv; charset=utf-8',
      filename: 'shop-agent-ledger-' + report.period.fromUtc.slice(0, 10) + '.csv',
      blockedForTaxPackage: report.blockedForTaxPackage,
      disclaimer: report.note,
    };
  }
}
