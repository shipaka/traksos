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
  if (deliveredQty !== amount(c.quantity)) missing.push('Количество закупки не подтверждено полностью');
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
  if (events.some(e => e.kind !== 'handover' && e.kind !== 'agent_report' && !e.source_ref))
    missing.push('Есть платёж без источника');
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
    if (!bytes.length || bytes.length > 450_000 || bytes.toString('base64').replace(/=+$/, '') !== b.base64.replace(/=+$/, ''))
      throw bad('document_invalid', 'Файл должен быть корректным Base64 и не более 450 КБ');
    const magic = b.mime === 'application/pdf' ? bytes.subarray(0,5).toString() === '%PDF-'
      : b.mime === 'image/png' ? bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex'))
      : bytes[0] === 0xff && bytes[1] === 0xd8;
    if (!magic) throw bad('document_type', 'Формат файла не соответствует MIME');
    if (b.kind !== 'purchase' && (b.amount || b.vatAmount || b.quantity))
      throw bad('document_amount', 'Финансовые суммы указываются только для первички закупки');
    if (b.vatAmount > b.amount) throw bad('vat_amount', 'НДС превышает сумму документа');
    const hash = createHash('sha256').update(bytes).digest('hex');
    return this.db.tx(async q => {
      const [r] = await q.query<any>(`insert into shop_agency_documents
        (kind,supplier_name,reference,issued_at,amount,vat_amount,quantity,mime,file_data,sha256,created_by)
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) on conflict (sha256) do nothing returning id`,
        [b.kind,b.supplierName.trim(),b.reference.trim(),signedDate(b.issuedAt),b.amount,b.vatAmount,
          b.quantity,b.mime,'\\x'+bytes.toString('hex'),hash,actor.id]);
      if (r) await this.audit(actor,'shop.agency.document_upload',r.id,{sha256:hash,kind:b.kind},q);
      const saved = r ?? await q.one<{id:string}>('select id from shop_agency_documents where sha256=$1',[hash]);
      return { id:saved!.id, sha256:hash, duplicate:!r, source:'manual_unverified' };
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

  async addEvent(actor: AuthUser, caseId: string, b: EventInput) {
    return this.db.tx(async q => {
      const c = await q.one<any>('select id from shop_agency_cases where id=$1 for update',[caseId]);
      if (!c) throw notFound('Операция не найдена');
      const past = await q.one<any>('select * from shop_agency_events where case_id=$1 and idempotency_key=$2',
        [caseId,b.idempotencyKey]);
      if (past) {
        if (past.kind === b.kind && Number(past.amount) === b.amount &&
            past.source_ref === b.sourceRef && new Date(past.occurred_at).getTime() === Date.parse(b.occurredAt))
          return {id:past.id,duplicate:true};
        throw conflict('event_key_conflict','Ключ события уже относится к другим данным');
      }
      const [r] = await q.query<any>(`insert into shop_agency_events
        (case_id,idempotency_key,kind,amount,source_ref,occurred_at,created_by)
        values($1,$2,$3,$4,$5,$6,$7) returning id`,
        [caseId,b.idempotencyKey,b.kind,b.amount,b.sourceRef.trim(),signedDate(b.occurredAt),actor.id]);
      await q.query('update shop_agency_cases set evidence_version=evidence_version+1 where id=$1',[caseId]);
      await this.audit(actor,'shop.agency.cash_event',r.id,{caseId,kind:b.kind},q);
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
      const a=await q.query<any>(`select al.*,d.kind,d.issued_at,d.source
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

  async report(actor:AuthUser,from:string,to:string) {
    if(!/^\d{4}-\d{2}-\d{2}$/.test(from)||!/^\d{4}-\d{2}-\d{2}$/.test(to) ||
      !Number.isFinite(Date.parse(from)) || !Number.isFinite(Date.parse(to)) || from>to ||
      (Date.parse(to)-Date.parse(from))/86400000>366)
      throw bad('bad_period','Укажите корректный период до 366 дней');
    const cases=await this.db.query<any>(`select c.* from shop_agency_cases c
      where (c.created_at at time zone 'Europe/Moscow')::date between $1::date and $2::date
         or exists(select 1 from shop_agency_events e where e.case_id=c.id and
           (e.occurred_at at time zone 'Europe/Moscow')::date between $1::date and $2::date)
      order by c.created_at,c.id limit 2001`,[from,to]);
    if(cases.length>2000) throw conflict('report_too_large','Период содержит более 2000 операций. Уточните диапазон.');
    const evidence=await this.loadEvidence(cases.map(c=>c.id));
    const records=cases.map(c=>{
      const v=this.view(c,evidence);
      // Period cash totals are actual event dates (Moscow civil day), not order creation dates.
      const inPeriod=v.events.filter((e:any)=>{
        const date=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Moscow',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(e.occurred_at));
        return date>=from && date<=to;
      });
      return {...v,periodCash:moneyTotals(inPeriod)};
    });
    const confirmed=records.filter(r=>r.status==='verified'||r.status==='accountant_approved');
    const total=(rows:any[],key:string)=>rows.reduce((a,r)=>a+amount(r.financial[key]),0);
    const cash=(rows:any[],key:string)=>rows.reduce((a,r)=>a+amount(r.periodCash[key]),0);
    const summary={
      cases:records.length,verified:confirmed.length,unverified:records.length-confirmed.length,
      agreedCustomerTotal:total(records,'agreedCustomerTotal'),
      confirmedPurchases:total(confirmed,'purchaseConfirmed'),
      recordedPurchases:total(records,'purchaseRecorded'),
      feePotential:total(records,'feePotential'),
      confirmedFeePotential:total(confirmed,'feePotential'),
      customerReceived:cash(records,'customerReceived'),
      supplierPaid:cash(records,'supplierPaid'),
      refunds:cash(records,'customerRefunds'),
      vatRecorded:total(records,'inputVatRecorded'),
      taxableRevenue:null,
    };
    const companies=new Map<string,any>();
    for(const r of records){
      const key=r.client_inn||r.client_id;
      const group=companies.get(key)||{key,name:r.client_name,inn:r.client_inn,count:0,received:0,purchases:0,fees:0,unverified:0};
      group.count++;group.received+=r.periodCash.customerReceived;
      group.purchases+=r.financial.purchaseRecorded;group.fees+=r.financial.feePotential;
      if(r.status!=='verified'&&r.status!=='accountant_approved') group.unverified++;
      companies.set(key,group);
    }
    await this.audit(actor,'shop.agency.report_read',from+'_'+to,{cases:records.length});
    return {from,to,timezone:'Europe/Moscow',summary,companies:[...companies.values()],records,
      disclaimer:'Черновой доказательный реестр, НЕ декларация, НЕ КУДиР и НЕ установленная налоговая база. До подписания договорной схемы бухгалтером сведения не использовать для налоговой отчётности.'};
  }
  async csv(actor:AuthUser,from:string,to:string) {
    const result=await this.report(actor,from,to);
    const safe=(v:unknown)=>{
      let s=String(v??'').replace(/"/g,'""');
      // Prevent spreadsheet formula injection from user-entered names and references.
      if(/^[\s]*[=+@-]/.test(s))s="'"+s;
      return '"'+s+'"';
    };
    const heads=['case_id','shop_order_id','client','inn','operation_kind','status','agreed_kopecks',
      'purchase_recorded_kopecks','purchase_verified_kopecks','fees_potential_kopecks',
      'customer_received_in_period_kopecks','supplier_paid_in_period_kopecks','vat_recorded_kopecks',
      'issues','missing','taxable_revenue'];
    const rows=result.records.map(r=>[r.id,r.shop_order_id,r.client_name,r.client_inn,r.operation_kind,
      r.status,r.financial.agreedCustomerTotal,r.financial.purchaseRecorded,r.financial.purchaseConfirmed,
      r.financial.feePotential,r.periodCash.customerReceived,r.periodCash.supplierPaid,
      r.financial.inputVatRecorded,r.problems.join('; '),r.missing.join('; '),'NOT_DETERMINED'].map(safe).join(';'));
    await this.audit(actor,'shop.agency.csv_export',from+'_'+to,{rows:rows.length});
    return '\ufeff'+[heads.map(safe).join(';'),...rows].join('\r\n')+'\r\n';
  }
}
