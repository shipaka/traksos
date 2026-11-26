import { bad } from '../http/router.ts';

// Pure evidence reconciliation: no DB or payment side effects.
export function amount(value: unknown): number {
  const n = Number(value ?? 0);
  if (!Number.isSafeInteger(n)) throw bad('bad_money', 'Сумма должна быть целым числом копеек');
  return n;
}
export function signedDate(value: string) {
  const t = Date.parse(value);
  if (!Number.isFinite(t)) throw bad('bad_date', 'Неправильная дата');
  return new Date(t).toISOString();
}
export function sum(items: any[], key: string) {
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
export function reportDay(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) ||
      !Number.isFinite(Date.parse(value)) ||
      new Date(value+'T00:00:00.000Z').toISOString().slice(0,10) !== value)
    throw bad('bad_period', 'Дата должна существовать в календаре (ГГГГ-ММ-ДД)');
  return value;
}
export function within(day: string, from: string, to: string) { return day >= from && day <= to; }
export function moneyTotals(events: any[]) {
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
  // Historical rows are immutable. Do not approve evidence with an impossible
  // chronology even if the financial totals happen to reconcile.
  const originals = new Map(events.filter(e => e.id != null).map(e => [e.id, e]));
  for (const event of events) {
    if (event.kind !== 'customer_receipt_reversal' && event.kind !== 'supplier_payment_reversal') continue;
    const original = event.reverses_event_id == null ? undefined : originals.get(event.reverses_event_id);
    const expectedKind = event.kind === 'customer_receipt_reversal' ? 'customer_receipt' : 'supplier_payment';
    if (!original || original.kind !== expectedKind) {
      problems.push('Сторно не связано с исходным платежом нужного вида');
      continue;
    }
    const correctionTime = new Date(event.occurred_at).getTime();
    const originalTime = new Date(original.occurred_at).getTime();
    if (!Number.isFinite(correctionTime) || !Number.isFinite(originalTime) || correctionTime < originalTime)
      problems.push('Сторно предшествует исходному платежу или содержит неверную дату');
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
