import { createHash } from 'node:crypto';
import type { Db, Queryable } from '../db/index.ts';
import type { AuthUser } from '../http/router.ts';
import { bad, conflict, notFound } from '../http/router.ts';

/** Evidence-only ledger. Does not initiate purchases, payments or tax declarations. */
type CaseInput = {
  shopOrderId: string; lineIndex: number;
  operationKind: 'client_purchase_agent' | 'supplier_sales_agent' | 'own_inventory_sale';
  supplierName: string; article: string; clientName: string; clientInn?: string | null;
  mandateRef?: string | null; mandateAcceptedAt?: string | null;
  offerVersion?: string | null; feeScheduleVersion?: string | null;
  expectedReimbursement: number; procurementFee: number; platformFee: number;
};
type DocInput = {
  kind: 'purchase' | 'mandate' | 'handover' | 'agent_report' | 'payment_proof';
  supplierName: string; reference: string; issuedAt: string;
  amount: number; vatAmount: number; quantity: number;
  mime: 'application/pdf' | 'image/png' | 'image/jpeg'; base64: string;
};
type EventInput = {
  idempotencyKey: string; kind: string; amount: number; sourceRef: string; occurredAt: string;
  reversesEventId?: string | null; correctionReason?: string | null;
};
type AllocationInput = { documentId: string; lineKey: string; quantity: number; amount: number; vatAmount: number };

function amount(value: unknown): number {
  const n = Number(value ?? 0);
  if (!Number.isSafeInteger(n)) throw bad('bad_money', 'Сумма должна быть целым числом копеек');
  return n;
}
function signedDate(value: string) {
  const t = Date.parse(value);
  if (!Number.isFinite(t)) throw bad('bad_date', 'Неправильная дата');
  return new Date(t).toISOString();
}
function sum(items: any[], key: string) {
  return items.reduce((a, x) => a + amount(x[key]), 0);
}
const msk = new Intl.DateTimeFormat('en-GB', {
  timeZone:'Europe/Moscow', year:'numeric', month:'2-digit', day:'2-digit',
});
/** Stable ISO civil date; avoids locale-specific en-CA formatting differences. */
export function moscowDay(value: string | Date): string {
  const parts = msk.formatToParts(new Date(value));
  const get = (type: string) => parts.find(p => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}
function reportDay(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) ||
      !Number.isFinite(Date.parse(value)) ||
      new Date(value+'T00:00:00.000Z').toISOString().slice(0,10) !== value)
    throw bad('bad_period', 'Дата должна существовать в календаре (ГГГГ-ММ-ДД)');
  return value;
}
function within(day: string, from: string, to: string) { return day >= from && day <= to; }
function moneyTotals(events: any[]) {
  const of = (k: string) => events.filter(e => e.kind === k).reduce((a, e) => a + amount(e.amount), 0);
  return {
    customerReceived: of('customer_receipt') - of('customer_receipt_reversal') - of('customer_refund'),
    supplierPaid: of('supplier_payment') - of('supplier_payment_reversal') - of('supplier_refund'),
    customerRefunds: of('customer_refund'),
    supplierRefunds: of('supplier_refund'),
  };
}
export function reconcileCase(c: any, allocations: any[], events: any[], reviews: any[] = []) {
  const problems: string[] = [];
  const missing: string[] = [];
  const byKind = (kind: string) => allocations.filter(a => a.kind === kind);
  const purchase = byKind('purchase');
  const purchaseAmount = sum(purchase, 'amount');
  const purchaseVat = sum(purchase, 'vat_amount');
  const deliveredQty = sum(purchase, 'quantity');
  const verifiedPurchase = purchase.length > 0 && purchase.every(a => a.source === 'manually_checked');
  const evidenceKind = (kind: string) => byKind(kind).some(a => a.source === 'manually_checked');
  const cash = moneyTotals(events);
  const agreed = amount(c.agreed_customer_total);
  const expected = amount(c.expected_reimbursement);
  const fee = amount(c.procurement_fee) + amount(c.platform_fee);
  const isAgent = c.operation_kind !== 'own_inventory_sale';
  if (isAgent) {
    if (!c.mandate_ref || !c.mandate_accepted_at || !c.offer_version || !c.fee_schedule_version)
      missing.push('Нет поручения/акцепта, версии оферты или тарифа');
    if (!evidenceKind('mandate')) missing.push('Нет проверенного оригинала поручения');
    if (agreed !== expected + fee) problems.push('Сумма договора не совпадает с возмещением и комиссиями');
    if (c.operation_kind === 'supplier_sales_agent') missing.push('Не подтверждён действующий договор агентирования поставщика');
  }
  if (!purchase.length) missing.push('Нет первичного документа фактической закупки');
  if (purchase.length && !verifiedPurchase) missing.push('Первичные документы не прошли ручную проверку');
  if (deliveredQty > amount(c.quantity)) problems.push('Закуплено больше количества из поручения');
  else if (deliveredQty < amount(c.quantity)) missing.push('Количество закупки не подтверждено полностью');
  // Partial/missing primary documents mean 'awaiting_docs', not an invented discrepancy.
  // Compare contracted reimbursement only once the full purchase quantity is evidenced.
  if (isAgent && verifiedPurchase && deliveredQty === amount(c.quantity) && purchaseAmount !== expected)
    problems.push('Фактическая закупка отличается от согласованного возмещения');
  if (purchase.some(a => amount(a.vat_amount) > amount(a.amount))) problems.push('НДС превышает сумму строки');
  if (isAgent && c.mandate_accepted_at && purchase.some(a =>
      Date.parse(a.issued_at) < Date.parse(c.mandate_accepted_at))) {
    problems.push('Документ закупки датирован раньше поручения клиента');
  }
  if (isAgent && c.mandate_accepted_at && events.some(e =>
      e.kind === 'supplier_payment' && Date.parse(e.occurred_at) < Date.parse(c.mandate_accepted_at))) {
    problems.push('Оплата поставщику предшествует поручению');
  }
  if (cash.customerReceived < 0 || cash.supplierPaid < 0) problems.push('Возвраты превышают исходные платежи');
  if (cash.customerReceived > agreed) problems.push('Получено от клиента больше согласованной суммы');
  if (cash.supplierPaid > purchaseAmount) problems.push('Поставщику уплачено больше документально подтверждённого');
  if (cash.customerReceived < agreed) missing.push('Не подтверждена полная оплата клиента');
  if (cash.supplierPaid < purchaseAmount) missing.push('Не подтверждена полная оплата поставщику');
  if (!events.some(e => e.kind === 'handover') || !evidenceKind('handover'))
    missing.push('Нет подтверждения передачи');
  if (isAgent && (!events.some(e => e.kind === 'agent_report') || !evidenceKind('agent_report')))
    missing.push('Нет подтверждённого отчёта агента');
  // A manually entered bank reference is NOT proof of payment. Every cash
  // event must match a checked original attached to this exact case.
  const cashEvents = events.filter(e => e.kind !== 'handover' && e.kind !== 'agent_report');
  for (const event of cashEvents) {
    if (!byKind('payment_proof').some(a =>
      a.source === 'manually_checked' && a.reference === event.source_ref)) {
      missing.push('Нет проверенного платёжного подтверждения: ' + event.source_ref);
    }
  }
  const current = reviews.filter(r => Number(r.evidence_version) === Number(c.evidence_version));
  const approved = current.some(r => r.kind === 'accountant_approved');
  const checked = current.some(r => r.kind === 'verified');
  const status = problems.length ? 'requires_reconciliation'
    : missing.length ? 'awaiting_docs'
    : approved ? 'accountant_approved' : checked ? 'verified' : 'requires_reconciliation';
  return {
    status, problems, missing,
    financial: {
      agreedCustomerTotal: agreed, expectedReimbursement: expected,
      purchaseConfirmed: verifiedPurchase ? purchaseAmount : 0,
      purchaseRecorded: purchaseAmount, inputVatRecorded: purchaseVat,
      procurementFee: amount(c.procurement_fee), platformFee: amount(c.platform_fee),
      ...cash, feePotential: isAgent ? fee : 0,
      grossSalePotential: isAgent ? 0 : cash.customerReceived,
      // Neither fees nor receipts can be promoted to a statutory tax base automatically.
      taxableRevenue: null as null,
      taxableRevenueReason: 'Требуется подтверждение правил налогового признания и первичных документов',
      analyticalDifference: cash.customerReceived - purchaseAmount,
    },
  };
}

export class ShopAgencyLedger {
  constructor(private db: Db) {}
  private async audit(actor: AuthUser, action: string, target: string, data: unknown = {}, q: Queryable = this.db) {
    await q.query('insert into audit_log(actor_id, action, target, data) values ($1,$2,$3,$4)', [actor.id, action, target, data]);
  }

  async createCase(actor: AuthUser, b: CaseInput) {
    return this.db.tx(async q => {
      const o = await q.one<any>('select s.*, u.company_name, u.company_inn from shop_orders s join users u on u.id=s.client_id where s.id=$1 for update of s', [b.shopOrderId]);
      if (!o) throw notFound('Заказ магазина не найден');
      const items: any[] = typeof o.items === 'string' ? JSON.parse(o.items) : o.items;
      const line = items[b.lineIndex];
      if (!line || !Number.isInteger(b.lineIndex) || b.lineIndex < 0) throw bad('line_missing', 'Нет такой позиции в заказе');
      if (!b.article.trim()) throw bad('article_required', 'Укажите артикул из подтверждения клиента');
      if (line.article && String(line.article).trim().toLowerCase() !== b.article.trim().toLowerCase())
        throw conflict('article_mismatch', 'Артикул отличается от неизменяемого снимка позиции заказа');
      if (o.company_inn && b.clientInn && o.company_inn !== b.clientInn.trim())
        throw conflict('inn_mismatch', 'ИНН отличается от профиля компании в заказе');
      if (o.company_name && b.clientName && o.company_name.trim() !== b.clientName.trim())
        throw conflict('company_mismatch', 'Название организации отличается от профиля клиента');
      const agreed = amount(line.price) * amount(line.qty);
      if (!Number.isSafeInteger(agreed)) throw bad('money_overflow', 'Слишком большая сумма');
      if (b.operationKind === 'own_inventory_sale' && (b.expectedReimbursement || b.procurementFee || b.platformFee))
        throw bad('own_inventory_fee', 'Собственная перепродажа не оформляется как агентская комиссия');
      if (b.operationKind !== 'own_inventory_sale' &&
          agreed !== b.expectedReimbursement + b.procurementFee + b.platformFee)
        throw bad('fee_breakdown', 'Возмещение и обе согласованные комиссии должны точно совпадать с ценой позиции');
      if (b.operationKind === 'client_purchase_agent' &&
        (!b.mandateRef?.trim() || !b.mandateAcceptedAt || !b.offerVersion?.trim() || !b.feeScheduleVersion?.trim()))
        throw bad('mandate_required', 'Для закупки за клиента требуется уже принятое поручение и версии условий');
      if (b.operationKind === 'client_purchase_agent' && Date.parse(b.mandateAcceptedAt!) > Date.now() + 60_000)
        throw bad('future_mandate', 'Поручение не может быть принято в будущем');
      const [r] = await q.query<any>(`insert into shop_agency_cases
        (shop_order_id,line_index,client_id,client_name,client_inn,operation_kind,supplier_name,article,quantity,
          mandate_ref,mandate_accepted_at,offer_version,fee_schedule_version,agreed_customer_total,
          expected_reimbursement,procurement_fee,platform_fee,created_by)
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
        on conflict (shop_order_id,line_index) do nothing returning *`,
        [b.shopOrderId, b.lineIndex, o.client_id, b.clientName.trim() || o.company_name || 'Клиент',
          b.clientInn?.trim() || o.company_inn || null, b.operationKind, b.supplierName.trim(), b.article.trim(),
          line.qty, b.mandateRef?.trim() || null, b.mandateAcceptedAt ? signedDate(b.mandateAcceptedAt) : null,
          b.offerVersion?.trim() || null, b.feeScheduleVersion?.trim() || null,
          agreed, b.expectedReimbursement, b.procurementFee, b.platformFee, actor.id]);
      if (!r) throw conflict('case_exists', 'Для позиции уже создан доказательный реестр');
      await this.audit(actor, 'shop.agency.case_create', r.id, { shopOrderId:b.shopOrderId, lineIndex:b.lineIndex, operationKind:b.operationKind }, q);
      return { id:r.id, agreedCustomerTotal:agreed };
    });
  }

  async addDocument(actor: AuthUser, b: DocInput) {
    const bytes = Buffer.from(b.base64, 'base64');
    if (!bytes.length || bytes.length > 450_000 ||
        bytes.toString('base64').replace(/=+$/, '') !== b.base64.replace(/=+$/, ''))
      throw bad('document_invalid', 'Файл должен быть корректным Base64 и не более 450 КБ');
    const magic = b.mime === 'application/pdf' ? bytes.subarray(0,5).toString() === '%PDF-'
      : b.mime === 'image/png' ? bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex'))
      : bytes[0] === 0xff && bytes[1] === 0xd8;
    if (!magic) throw bad('document_type', 'Формат файла не соответствует MIME');
    if (b.kind !== 'purchase' && (b.amount || b.vatAmount || b.quantity))
      throw bad('document_amount', 'Финансовые суммы указываются только для первички закупки');
    if (b.vatAmount > b.amount) throw bad('vat_amount', 'НДС превышает сумму документа');
    const issuedAt = signedDate(b.issuedAt);
    const hash = createHash('sha256').update(bytes).digest('hex');
    return this.db.tx(async q => {
      const [newRow] = await q.query<any>(`insert into shop_agency_documents
        (kind,supplier_name,reference,issued_at,amount,vat_amount,quantity,mime,file_data,sha256,created_by)
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) on conflict (sha256) do nothing returning *`,
        [b.kind,b.supplierName.trim(),b.reference.trim(),issuedAt,b.amount,b.vatAmount,
          b.quantity,b.mime,'\\x'+bytes.toString('hex'),hash,actor.id]);
      const saved = newRow ?? await q.one<any>(
        `select id,kind,supplier_name,reference,issued_at,amount,vat_amount,quantity,mime,source
           from shop_agency_documents where sha256=$1`,[hash]);
      if (!saved) throw conflict('document_race', 'Документ был изменён конкурентной загрузкой');
      // Byte-level idempotency must not silently accept conflicting invoice metadata.
      if (!newRow && (saved.kind !== b.kind ||
          saved.supplier_name !== b.supplierName.trim() ||
          saved.reference !== b.reference.trim() ||
          new Date(saved.issued_at).getTime() !== Date.parse(issuedAt) ||
          Number(saved.amount) !== b.amount ||
          Number(saved.vat_amount) !== b.vatAmount ||
          Number(saved.quantity) !== b.quantity || saved.mime !== b.mime))
        throw conflict('document_metadata_conflict',
          'Файл уже загружен с другими реквизитами; нельзя подменять первичку');
      if (newRow) await this.audit(actor,'shop.agency.document_upload',newRow.id,{sha256:hash,kind:b.kind},q);
      return {id:saved.id,sha256:hash,duplicate:!newRow,source:saved.source};
    });
  }

  async reviewDocument(actor: AuthUser, id: string, note: string) {
    return this.db.tx(async q => {
      const d = await q.one<any>('select id, source from shop_agency_documents where id=$1 for update',[id]);
      if (!d) throw notFound('Документ не найден');
      if (d.source === 'manually_checked') return {id, source:d.source};
      await q.query(`update shop_agency_documents set source='manually_checked',verified_by=$2,verified_at=now(),review_note=$3 where id=$1`,
        [id,actor.id,note]);
      await q.query('update shop_agency_cases set evidence_version=evidence_version+1 where id in (select case_id from shop_agency_allocations where document_id=$1)',[id]);
      await this.audit(actor,'shop.agency.document_review',id,{note},q);
      return {id,source:'manually_checked'};
    });
  }

  async allocate(actor: AuthUser, caseId: string, b: AllocationInput) {
    return this.db.tx(async q => {
      const c = await q.one<any>('select * from shop_agency_cases where id=$1 for update',[caseId]);
      if (!c) throw notFound('Операция не найдена');
      const d = await q.one<any>('select * from shop_agency_documents where id=$1 for update',[b.documentId]);
      if (!d) throw notFound('Документ не найден');
      if (d.kind !== 'purchase' && (b.amount || b.vatAmount || b.quantity)) throw bad('nonpurchase_amount','Для этого документа суммы не указываются');
      if (d.kind === 'purchase' && (!b.quantity || !b.amount))
        throw bad('allocation_required','Укажите количество и фактическую стоимость');
      if (d.kind === 'purchase' && d.supplier_name.toLowerCase() !== String(c.supplier_name).toLowerCase())
        throw conflict('supplier_mismatch','Поставщик в документе не совпадает с операцией');
      const exists = await q.one<any>('select * from shop_agency_allocations where document_id=$1 and source_line_key=$2',[b.documentId,b.lineKey]);
      if (exists) {
        if (exists.case_id === caseId && Number(exists.amount) === b.amount &&
            Number(exists.quantity) === b.quantity && Number(exists.vat_amount) === b.vatAmount)
          return { id:exists.id, duplicate:true };
        throw conflict('allocation_key_conflict','Строка документа уже распределена иначе');
      }
      const totals = await q.one<any>(`select coalesce(sum(amount),0)::text as a,
        coalesce(sum(quantity),0)::text as q, coalesce(sum(vat_amount),0)::text as vat
        from shop_agency_allocations where document_id=$1`,[b.documentId]);
      if (Number(totals.a)+b.amount>Number(d.amount) || Number(totals.q)+b.quantity>Number(d.quantity) ||
          Number(totals.vat)+b.vatAmount>Number(d.vat_amount))
        throw conflict('document_overallocated','Распределение превышает сумму, количество или НДС первички');
      const [r] = await q.query<any>(`insert into shop_agency_allocations
        (document_id,case_id,source_line_key,quantity,amount,vat_amount,created_by)
        values($1,$2,$3,$4,$5,$6,$7) returning id`,
        [b.documentId,caseId,b.lineKey,b.quantity,b.amount,b.vatAmount,actor.id]);
      await q.query('update shop_agency_cases set evidence_version=evidence_version+1 where id=$1',[caseId]);
      await this.audit(actor,'shop.agency.allocation',r.id,{caseId,documentId:b.documentId},q);
      return {id:r.id,duplicate:false};
    });
  }

  /** Corrections are append-only, linked to ONE original. The sum of partial
   * reversals cannot exceed the original (even under concurrent admin requests).
   * This only records evidence; it never executes a bank refund. */
  async addEvent(actor: AuthUser, caseId: string, b: EventInput) {
    return this.db.tx(async q => {
      const c = await q.one<any>('select id from shop_agency_cases where id=$1 for update',[caseId]);
      if (!c) throw notFound('Операция не найдена');
      const occurredAt=signedDate(b.occurredAt);
      const sourceRef=b.sourceRef.trim();
      const correctionReason=b.correctionReason?.trim()||null;
      const reverseOf=b.reversesEventId||null;
      const reversalSource:Record<string,string>={
        customer_receipt_reversal:'customer_receipt',
        supplier_payment_reversal:'supplier_payment',
      };
      const originalKind=reversalSource[b.kind];
      if(originalKind){
        if(!reverseOf||!correctionReason||correctionReason.length<8)
          throw bad('reversal_proof_required','Сторно требует ID исходной операции и причину не менее 8 символов');
      }else if(reverseOf||correctionReason){
        throw bad('reversal_only','Ссылка на исходное событие допускается только для сторно');
      }
      const past = await q.one<any>('select * from shop_agency_events where case_id=$1 and idempotency_key=$2',
        [caseId,b.idempotencyKey]);
      if (past) {
        if (past.kind===b.kind && Number(past.amount)===b.amount &&
            past.source_ref===sourceRef &&
            new Date(past.occurred_at).getTime()===Date.parse(occurredAt) &&
            (past.reverses_event_id||null)===reverseOf &&
            (past.correction_reason||null)===correctionReason)
          return {id:past.id,duplicate:true};
        throw conflict('event_key_conflict','Ключ события уже относится к другим данным');
      }
      if(originalKind){
        const original=await q.one<any>(`select id,case_id,kind,amount
          from shop_agency_events where id=$1`,[reverseOf]);
        if(!original||original.case_id!==caseId||original.kind!==originalKind)
          throw conflict('reversal_original_invalid',
            'Сторно должно ссылаться на исходное положительное событие такого же вида в этой операции');
        const used=await q.one<any>(`select coalesce(sum(amount),0)::text as sum
          from shop_agency_events where reverses_event_id=$1`,[reverseOf]);
        if(!Number.isSafeInteger(b.amount)||Number(used.sum)+b.amount>Number(original.amount))
          throw conflict('reversal_amount_exceeded',
            'Сумма всех сторно превышает исходный подтверждённый платёж');
      }
      const [r] = await q.query<any>(`insert into shop_agency_events
        (case_id,idempotency_key,kind,amount,source_ref,occurred_at,created_by,
          reverses_event_id,correction_reason)
        values($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`,
        [caseId,b.idempotencyKey,b.kind,b.amount,sourceRef,occurredAt,
          actor.id,reverseOf,correctionReason]);
      await q.query('update shop_agency_cases set evidence_version=evidence_version+1 where id=$1',[caseId]);
      await this.audit(actor,'shop.agency.cash_event',r.id,
        {caseId,kind:b.kind,reversesEventId:reverseOf,correctionReason},q);
      return {id:r.id,duplicate:false};
    });
  }

  private async loadEvidence(caseIds: string[]) {
    if (!caseIds.length) return {allocations:[] as any[],events:[] as any[],reviews:[] as any[]};
    const [allocations,events,reviews] = await Promise.all([
      this.db.query<any>(`select a.*,d.kind,d.reference,d.issued_at,d.source,d.sha256,d.supplier_name
        from shop_agency_allocations a join shop_agency_documents d on d.id=a.document_id
        where a.case_id=any($1::uuid[]) order by d.issued_at,a.created_at`,[caseIds]),
      this.db.query<any>('select * from shop_agency_events where case_id=any($1::uuid[]) order by occurred_at,created_at',[caseIds]),
      this.db.query<any>('select * from shop_agency_reviews where case_id=any($1::uuid[]) order by created_at',[caseIds]),
    ]);
    return {allocations,events,reviews};
  }
  private view(c: any, all: Awaited<ReturnType<ShopAgencyLedger['loadEvidence']>>) {
    const allocations=all.allocations.filter(a=>a.case_id===c.id);
    const events=all.events.filter(e=>e.case_id===c.id);
    const reviews=all.reviews.filter(r=>r.case_id===c.id);
    const evaluation = reconcileCase(c,allocations,events,reviews);
    return { ...c, ...evaluation, allocations:allocations.map(({file_data,...rest})=>rest),
      events, reviews };
  }

  async detail(actor: AuthUser,id: string) {
    const c=await this.db.one<any>('select * from shop_agency_cases where id=$1',[id]);
    if(!c) throw notFound('Операция не найдена');
    const full=this.view(c,await this.loadEvidence([id]));
    await this.audit(actor,'shop.agency.detail_read',id);
    return full;
  }

  async reviewCase(actor:AuthUser,id:string,kind:'verified'|'accountant_approved',note:string) {
    return this.db.tx(async q=>{
      const c=await q.one<any>('select * from shop_agency_cases where id=$1 for update',[id]);
      if (!c) throw notFound('Операция не найдена');
      // Read evidence inside the transaction, with the case row locked against writers.
      const a=await q.query<any>(`select al.*,d.kind,d.reference,d.issued_at,d.source
        from shop_agency_allocations al join shop_agency_documents d on d.id=al.document_id where al.case_id=$1`,[id]);
      const e=await q.query<any>('select * from shop_agency_events where case_id=$1',[id]);
      const r=await q.query<any>('select * from shop_agency_reviews where case_id=$1',[id]);
      const status=reconcileCase(c,a,e,r);
      if(status.problems.length || status.missing.length)
        throw conflict('evidence_incomplete','Нельзя подтверждать: не устранены расхождения или отсутствует первичка');
      if(kind==='accountant_approved' && status.status!=='verified' && status.status!=='accountant_approved')
        throw conflict('need_verified','Сначала требуется первичная проверка операции');
      const rows=await q.query<any>(`insert into shop_agency_reviews
        (case_id,evidence_version,kind,note,created_by) values($1,$2,$3,$4,$5)
        on conflict(case_id,evidence_version,kind) do nothing returning id`,
        [id,c.evidence_version,kind,note,actor.id]);
      if(rows.length) await this.audit(actor,'shop.agency.review',id,{kind,version:c.evidence_version,note},q);
      return {status:kind,duplicate:!rows.length,evidenceVersion:c.evidence_version};
    });
  }

  async documentFile(actor:AuthUser,id:string) {
    const d=await this.db.one<any>('select mime,file_data,sha256 from shop_agency_documents where id=$1',[id]);
    if(!d) throw notFound('Документ не найден');
    await this.audit(actor,'shop.agency.document_file_read',id);
    const v:unknown=d.file_data;
    return {mime:d.mime, sha256:d.sha256,bytes:Buffer.isBuffer(v)?v:Buffer.from(String(v).replace(/^\\x/,''),'hex')};
  }

  /** Report facts by their OWN Moscow civil date, not by an unrelated order date.
   * Purchase docs are issued facts; fees and prices are creation-time snapshots;
   * bank events use occurred_at. Current verification state is never misrepresented
   * as a historical as-of-period approval. */
  async report(actor:AuthUser,from:string,to:string) {
    reportDay(from); reportDay(to);
    if(from>to || (Date.parse(to)-Date.parse(from))/86400000>366)
      throw bad('bad_period','Укажите период не больше 366 дней');
    const cases=await this.db.query<any>(`select c.* from shop_agency_cases c
      where (c.created_at at time zone 'Europe/Moscow')::date between $1::date and $2::date
        or exists(select 1 from shop_agency_events e where e.case_id=c.id and
          (e.occurred_at at time zone 'Europe/Moscow')::date between $1::date and $2::date)
        or exists(select 1 from shop_agency_allocations a
          join shop_agency_documents d on d.id=a.document_id
          where a.case_id=c.id and d.kind='purchase' and
            (d.issued_at at time zone 'Europe/Moscow')::date between $1::date and $2::date)
      order by c.created_at,c.id limit 2001`,[from,to]);
    if(cases.length>2000) throw conflict('report_too_large',
      'Период содержит более 2000 операций. Уточните диапазон.');
    const evidence=await this.loadEvidence(cases.map(c=>c.id));
    const records=cases.map(c=>{
      const v=this.view(c,evidence);
      const included=(date:string|Date)=>within(moscowDay(date),from,to);
      const periodEvents=v.events.filter((e:any)=>included(e.occurred_at));
      const periodPurchaseDocs=v.allocations.filter((a:any)=>
        a.kind==='purchase' && included(a.issued_at));
      const createdInPeriod=included(c.created_at);
      const isAgent=c.operation_kind!=='own_inventory_sale';
      const period={
        createdInPeriod,
        agreedCustomerTotal:createdInPeriod?amount(c.agreed_customer_total):0,
        feePotential:createdInPeriod&&isAgent?
          amount(c.procurement_fee)+amount(c.platform_fee):0,
        purchaseRecorded:sum(periodPurchaseDocs,'amount'),
        purchaseConfirmed:sum(periodPurchaseDocs.filter((a:any)=>a.source==='manually_checked'),'amount'),
        inputVatRecorded:sum(periodPurchaseDocs,'vat_amount'),
        purchaseQuantity:sum(periodPurchaseDocs,'quantity'),
      };
      return {...v,period,periodCash:moneyTotals(periodEvents)};
    });
    const confirmed=records.filter(r=>r.status==='verified'||r.status==='accountant_approved');
    const add=(rows:any[],section:'period'|'periodCash',key:string)=>
      rows.reduce((a,r)=>a+amount(r[section][key]),0);
    const summary={
      cases:records.length,verified:confirmed.length,unverified:records.length-confirmed.length,
      agreedCustomerTotal:add(records,'period','agreedCustomerTotal'),
      confirmedPurchases:add(records,'period','purchaseConfirmed'),
      recordedPurchases:add(records,'period','purchaseRecorded'),
      feePotential:add(records,'period','feePotential'),
      confirmedFeePotential:add(confirmed,'period','feePotential'),
      customerReceived:add(records,'periodCash','customerReceived'),
      supplierPaid:add(records,'periodCash','supplierPaid'),
      refunds:add(records,'periodCash','customerRefunds'),
      supplierRefunds:add(records,'periodCash','supplierRefunds'),
      vatRecorded:add(records,'period','inputVatRecorded'),
      taxableRevenue:null,
    };
    const companies=new Map<string,any>();
    const suppliers=new Map<string,any>();
    for(const r of records){
      const key=r.client_inn||r.client_id;
      const g=companies.get(key)||{key,name:r.client_name,inn:r.client_inn,count:0,
        received:0,purchases:0,confirmedPurchases:0,fees:0,refunds:0,unverified:0};
      g.count++;g.received+=r.periodCash.customerReceived;
      g.purchases+=r.period.purchaseRecorded;
      g.confirmedPurchases+=r.period.purchaseConfirmed;
      g.fees+=r.period.feePotential;
      g.refunds+=r.periodCash.customerRefunds;
      if(r.status!=='verified'&&r.status!=='accountant_approved')g.unverified++;
      companies.set(key,g);
      const supplierKey=r.supplier_name;
      const sp=suppliers.get(supplierKey)||{name:supplierKey,count:0,purchases:0,
        confirmedPurchases:0,vatRecorded:0,paid:0};
      sp.count++;sp.purchases+=r.period.purchaseRecorded;
      sp.confirmedPurchases+=r.period.purchaseConfirmed;
      sp.vatRecorded+=r.period.inputVatRecorded;sp.paid+=r.periodCash.supplierPaid;
      suppliers.set(supplierKey,sp);
    }
    const manifest={
      format:'traksos-agency-evidence-manifest-v2',from,to,timezone:'Europe/Moscow',
      currentVerificationOnly:true,
      summary,
      cases:records.map(r=>({
        id:r.id,shopOrderId:r.shop_order_id,lineIndex:r.line_index,
        evidenceVersion:r.evidence_version,status:r.status,
        period:r.period,periodCash:r.periodCash,
        problems:r.problems,missing:r.missing,
        documentHashes:r.allocations.map((a:any)=>({
          id:a.document_id,sha256:a.sha256,sourceLineKey:a.source_line_key,
          source:a.source,amount:a.amount,vat:a.vat_amount,quantity:a.quantity,
        })).sort((a:any,b:any)=>a.id.localeCompare(b.id)||a.sourceLineKey.localeCompare(b.sourceLineKey)),
        eventIds:r.events.map((e:any)=>e.id).sort(),
        reviewIds:r.reviews.map((e:any)=>e.id).sort(),
      })),
    };
    const manifestSha256=createHash('sha256').update(JSON.stringify(manifest)).digest('hex');
    await this.audit(actor,'shop.agency.report_read',from+'_'+to,{cases:records.length,manifestSha256});
    return {from,to,timezone:'Europe/Moscow',summary,
      companies:[...companies.values()].sort((a,b)=>a.key.localeCompare(b.key)),
      suppliers:[...suppliers.values()].sort((a,b)=>a.name.localeCompare(b.name)),
      records,manifest,manifestSha256,verificationAsOf:'current',
      disclaimer:'Внутренний доказательный реестр, НЕ декларация, НЕ КУДиР и НЕ налоговая база. Подтверждение показано на дату просмотра, суммы по датам событий МСК. Для бухгалтерской отчётности требуется согласованная методика.'};
  }

  async csv(actor:AuthUser,from:string,to:string) {
    const result=await this.report(actor,from,to);
    const safe=(v:unknown)=>{
      // Numeric negative values must remain numeric; strings beginning with
      // spreadsheet formula markers must not become executable formulas.
      if(typeof v==='number'&&Number.isFinite(v))return '"'+String(v)+'"';
      let x=String(v??'').replace(/"/g,'""');
      if(/^[\s]*[=+@-]/.test(x))x="'"+x;
      return '"'+x+'"';
    };
    const heads=['case_id','shop_order_id','client','inn','supplier','operation_kind',
      'verification_as_of_now','agreed_created_in_period_kopecks',
      'purchase_issued_in_period_kopecks','purchase_checked_now_in_period_kopecks',
      'fees_agreed_in_period_kopecks','customer_cash_in_period_kopecks',
      'supplier_cash_in_period_kopecks','customer_refunds_in_period_kopecks',
      'input_vat_in_supplier_docs_period_kopecks','problems','missing','taxable_revenue'];
    const rows=result.records.map(r=>[r.id,r.shop_order_id,r.client_name,r.client_inn,r.supplier_name,
      r.operation_kind,r.status,r.period.agreedCustomerTotal,r.period.purchaseRecorded,
      r.period.purchaseConfirmed,r.period.feePotential,r.periodCash.customerReceived,
      r.periodCash.supplierPaid,r.periodCash.customerRefunds,r.period.inputVatRecorded,
      r.problems.join('; '),r.missing.join('; '),'NOT_DETERMINED'].map(safe).join(';'));
    await this.audit(actor,'shop.agency.csv_export',from+'_'+to,
      {rows:rows.length,manifestSha256:result.manifestSha256});
    return '\ufeff'+[heads.map(safe).join(';'),...rows].join('\r\n')+'\r\n';
  }

  /** Immutable internal manifest, NOT a signed tax report. Reusing an import
   * key after any data change is a conflict, not a silent history overwrite. */
  async archiveReport(actor:AuthUser,b:{from:string;to:string;requestKey:string;note:string}) {
    const report=await this.report(actor,b.from,b.to);
    const payload={manifest:report.manifest,manifestSha256:report.manifestSha256,
      summary:report.summary,companies:report.companies,suppliers:report.suppliers,
      disclaimer:report.disclaimer};
    return this.db.tx(async q=>{
      const [row]=await q.query<any>(`insert into shop_agency_report_snapshots
        (request_key,from_day,to_day,manifest_sha256,payload,note,created_by)
        values($1,$2::date,$3::date,$4,$5::jsonb,$6,$7)
        on conflict(request_key) do nothing
        returning id,request_key,from_day,to_day,manifest_sha256,note,created_at`,
        [b.requestKey,b.from,b.to,report.manifestSha256,JSON.stringify(payload),b.note,actor.id]);
      const saved=row??await q.one<any>(`select id,request_key,from_day,to_day,
        manifest_sha256,note,created_at from shop_agency_report_snapshots
        where request_key=$1`,[b.requestKey]);
      if(!saved)throw conflict('snapshot_race','Снимок уже создаётся');
      if(!row && (saved.manifest_sha256!==report.manifestSha256 ||
         String(saved.from_day).slice(0,10)!==b.from && moscowDay(saved.from_day)!==b.from ||
         String(saved.to_day).slice(0,10)!==b.to && moscowDay(saved.to_day)!==b.to ||
         saved.note!==b.note))
        throw conflict('snapshot_key_conflict','По этому ключу уже сохранён другой снимок');
      if(row)await this.audit(actor,'shop.agency.report_archive',saved.id,
        {from:b.from,to:b.to,manifestSha256:report.manifestSha256},q);
      return {id:saved.id,duplicate:!row,manifestSha256:saved.manifest_sha256,
        from:b.from,to:b.to,createdAt:saved.created_at};
    });
  }

  async listSnapshots(actor:AuthUser) {
    const rows=await this.db.query<any>(`select id,from_day,to_day,manifest_sha256,note,
      created_at from shop_agency_report_snapshots order by created_at desc,id desc limit 100`);
    await this.audit(actor,'shop.agency.snapshot_index','index',{count:rows.length});
    return rows;
  }

  async snapshot(actor:AuthUser,id:string) {
    const row=await this.db.one<any>(`select id,from_day,to_day,manifest_sha256,
      payload,note,created_at from shop_agency_report_snapshots where id=$1`,[id]);
    if(!row)throw notFound('Архивный снимок не найден');
    await this.audit(actor,'shop.agency.snapshot_read',id);
    return row;
  }
}
