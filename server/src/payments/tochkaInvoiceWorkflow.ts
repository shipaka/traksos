import type { Db } from '../db/index.ts';
import { bad, conflict, notFound, HttpError } from '../http/router.ts';
import type { TochkaBuyer, TochkaVat } from './tochkaInvoices.ts';
import { TochkaInvoiceClient } from './tochkaInvoices.ts';

/**
 * Controls document creation only. Never updates payments.status or starts
 * transfers: a Tochka document status can be manually changed in the bank UI.
 * Financial settlement needs independent bank-statement verification.
 */
export class TochkaInvoiceWorkflow {
  constructor(private readonly db: Db, private readonly bank: TochkaInvoiceClient) {}

  async issue(paymentId: string, actorId: string, buyer: TochkaBuyer,
    workVat: TochkaVat, serviceVat: TochkaVat) {
    const plan = await this.db.tx(async q => {
      const pay = await q.one<any>(
        'select p.*, o.number as order_number from payments p join orders o on o.id=p.order_id where p.id=$1 for update of p',
        [paymentId]);
      if (!pay || pay.method !== 'invoice' || pay.kind !== 'work' || pay.status !== 'pending')
        throw bad('invoice_not_pending', 'Нужен подтверждённый заказ с неоплаченным счётом');
      const existing = await q.one<any>(
        'select * from tochka_invoice_documents where payment_id=$1 for update', [paymentId]);
      if (existing) {
        if (existing.buyer_inn !== buyer.taxCode || Number(existing.total_kopecks) !== pay.total)
          throw conflict('invoice_immutable', 'Нельзя изменить получателя или сумму уже созданного документа');
        return { already: existing, pay };
      }
      if (!Number.isSafeInteger(pay.total) || pay.total <= 0 ||
          !Number.isSafeInteger(pay.client_fee) || pay.client_fee < 0 || pay.client_fee > pay.total)
        throw bad('invoice_amount', 'Неверная сумма счёта');
      const invoiceNumber = 'TS-' + paymentId.replaceAll('-', '');
      await q.query(
        'insert into tochka_invoice_documents(payment_id,order_id,invoice_number,buyer_inn,total_kopecks,status,created_by) values ($1,$2,$3,$4,$5,\'sending\',$6)',
        [paymentId,pay.order_id,invoiceNumber,buyer.taxCode,pay.total,actorId]);
      return { already: null, pay, invoiceNumber };
    });
    if (plan.already) {
      if (plan.already.status !== 'issued')
        throw conflict('bank_creation_unknown',
          'Банк мог создать счёт. Проверьте исходящий запрос в Точке — повторять нельзя');
      return { paymentId, documentId: plan.already.bank_document_id,
        invoiceNumber: plan.already.invoice_number, status: 'issued', reused: true };
    }
    const work = plan.pay.total - plan.pay.client_fee;
    const lines = [
      ...(work > 0 ? [{ title: 'Услуги исполнителя по заявке TrakSOS №' + plan.pay.order_number,
        kopecks: work, vat: workVat }] : []),
      ...(plan.pay.client_fee > 0 ? [{ title: 'Сервисное вознаграждение TrakSOS по заявке №' + plan.pay.order_number,
        kopecks: plan.pay.client_fee, vat: serviceVat }] : []),
    ];
    let documentId: string;
    try {
      documentId = await this.bank.createInvoice({
        number: plan.invoiceNumber,
        basedOn: 'Заявка TrakSOS №' + plan.pay.order_number,
        buyer, lines,
        expectedTotalKopecks: plan.pay.total,
      });
    } catch {
      // Timeout may mean the bank created the document. No automatic retries.
      await this.db.query(
        'update tochka_invoice_documents set status=\'needs_review\',last_error=\'Bank response not confirmed\',updated_at=now() where payment_id=$1 and status=\'sending\'',
        [paymentId]);
      throw new HttpError(502, 'tochka_invoice_unknown',
        'Неизвестный результат запроса в банк: проверьте Точку, повтор запрещён');
    }
    await this.db.tx(async q => {
      const updated = await q.one<{ payment_id: string }>(
        'update tochka_invoice_documents set status=\'issued\',bank_document_id=$2,updated_at=now() where payment_id=$1 and status=\'sending\' returning payment_id',
        [paymentId,documentId]);
      if (!updated) throw new Error('Invoice state changed during bank request');
      await q.query(
        'insert into audit_log(actor_id,action,target,data) values ($1,\'tochka.invoice.issued\',$2,$3)',
        [actorId,paymentId,{ documentId }]);
    });
    return { paymentId, documentId, invoiceNumber: plan.invoiceNumber,
      status: 'issued', reused: false };
  }

  async local(paymentId: string) {
    const doc = await this.db.one<any>(
      'select payment_id,order_id,invoice_number,bank_document_id,total_kopecks,status,bank_payment_status,created_at,updated_at from tochka_invoice_documents where payment_id=$1',
      [paymentId]);
    if (!doc) throw notFound('Счёт Точки не создавался');
    return doc;
  }

  private async bankDocument(paymentId: string) {
    const doc = await this.local(paymentId);
    if (doc.status !== 'issued' || !doc.bank_document_id)
      throw conflict('invoice_not_issued', 'Банковский счёт не подтверждён');
    return doc as { bank_document_id: string; [key: string]: any };
  }

  async status(paymentId: string) {
    const doc = await this.bankDocument(paymentId);
    const bankStatus = await this.bank.getPaymentStatus(doc.bank_document_id);
    await this.db.query(
      'update tochka_invoice_documents set bank_payment_status=$2,updated_at=now() where payment_id=$1',
      [paymentId,bankStatus]);
    // This does NOT change payments.status; only verified incoming bank statement
    // with payer INN, exact amount and unique transaction reference can do that.
    return { documentId: doc.bank_document_id, bankStatus,
      settlementConfirmed: false, note: 'Требуется сверка банковской выписки' };
  }

  async email(paymentId: string, email: string, actorId: string) {
    const doc = await this.bankDocument(paymentId);
    await this.bank.emailInvoice(doc.bank_document_id, email);
    await this.db.query(
      'insert into audit_log(actor_id,action,target,data) values ($1,\'tochka.invoice.emailed\',$2,$3)',
      [actorId,paymentId,{ email }]);
    return { sent: true, paymentId };
  }

  async pdf(paymentId: string) {
    const doc = await this.bankDocument(paymentId);
    return this.bank.getInvoicePdf(doc.bank_document_id);
  }
}
