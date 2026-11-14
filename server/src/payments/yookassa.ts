// ЮKassa — заготовка адаптера. Методы API v3: payments (capture=false для заморозки),
// payments/{id}/capture, payments/{id}/cancel, refunds, payouts (выплаты самозанятым с чеком НПД).
// ПЕРЕД ВКЛЮЧЕНИЕМ: сверить поля с документацией ЮKassa и договором (безопасная сделка / выплаты),
// получить shopId/secretKey и отдельно agentId/ключ для выплат, проверить чеки с бухгалтером.

import type { CreatePaymentInput, PaymentProvider, PayoutInput, ProviderStatus } from './provider.ts';

const API = 'https://api.yookassa.ru/v3';

const toValue = (kopecks: number) => ({ value: (kopecks / 100).toFixed(2), currency: 'RUB' });
const fromValue = (v: { value: string }) => Math.round(Number(v.value) * 100);

function mapStatus(s: string): ProviderStatus {
  switch (s) {
    case 'pending': return 'pending';
    case 'waiting_for_capture': return 'held';
    case 'succeeded': return 'captured';
    case 'canceled': return 'cancelled';
    default: return 'failed';
  }
}

export class YooKassaProvider implements PaymentProvider {
  name = 'yookassa';
  constructor(private shopId: string, private secretKey: string, private agentId = '', private payoutKey = '') {}

  private async call(path: string, body: unknown, key?: string, auth = `${this.shopId}:${this.secretKey}`) {
    const r = await fetch(API + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        authorization: 'Basic ' + Buffer.from(auth).toString('base64'),
        'content-type': 'application/json',
        ...(key ? { 'idempotence-key': key } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const j: any = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`ЮKassa ${r.status}: ${j.description ?? j.code ?? ''}`);
    return j;
  }

  async createPayment(p: CreatePaymentInput) {
    const j = await this.call('/payments', {
      amount: toValue(p.total),
      capture: p.capture,
      description: p.description.slice(0, 128),
      payment_method_data: { type: p.method === 'sbp' ? 'sbp' : 'bank_card' },
      confirmation: { type: 'redirect', return_url: p.returnUrl },
      metadata: p.metadata,
      ...(p.receipt ? { receipt: p.receipt } : {}),
    }, p.idempotencyKey);
    return { id: j.id, status: mapStatus(j.status), confirmationUrl: j.confirmation?.confirmation_url ?? null };
  }

  async capture(id: string, amount?: number) {
    const j = await this.call(`/payments/${id}/capture`, amount != null ? { amount: toValue(amount) } : {}, `cap_${id}_${amount ?? 'all'}`);
    return { status: mapStatus(j.status) };
  }

  async cancel(id: string) {
    const j = await this.call(`/payments/${id}/cancel`, {}, `cancel_${id}`);
    return { status: mapStatus(j.status) };
  }

  async refund(id: string, amount: number, key: string) {
    const j = await this.call('/refunds', { payment_id: id, amount: toValue(amount) }, key);
    return { id: j.id, status: j.status === 'succeeded' ? 'succeeded' as const : j.status === 'canceled' ? 'failed' as const : 'pending' as const };
  }

  async getRefund(id: string) {
    const j = await this.call(`/refunds/${encodeURIComponent(id)}`, undefined);
    return { id: j.id, status: j.status === 'succeeded' ? 'succeeded' as const
      : j.status === 'canceled' ? 'failed' as const : 'pending' as const };
  }

  async getPayment(id: string) {
    const j = await this.call(`/payments/${id}`, undefined);
    return { id: j.id, status: mapStatus(j.status), total: fromValue(j.amount) };
  }

  async payout(p: PayoutInput) {
    if (!this.agentId || !p.performer.payoutToken) return null; // выплаты не настроены — вручную
    const j = await this.call('/payouts', {
      amount: toValue(p.amount),
      payout_token: p.performer.payoutToken,
      description: p.description.slice(0, 128),
      metadata: p.metadata,
      ...(p.performer.taxStatus === 'self_employed' && p.performer.inn
        ? { self_employed: { id: p.performer.inn }, receipt_data: { service_name: 'Ремонт грузового автомобиля на выезде' } }
        : {}),
    }, p.idempotencyKey, `${this.agentId}:${this.payoutKey}`);
    return {
      id: j.id,
      status: j.status === 'succeeded' ? 'paid' as const : j.status === 'canceled' ? 'failed' as const : 'pending' as const,
      receiptIssued: !!j.self_employed,
    };
  }

  parseWebhook(body: any) {
    const id = body?.object?.id;
    return typeof id === 'string' && body?.type === 'notification' ? { providerPaymentId: id } : null;
  }
}

/**
 * Чек 54-ФЗ при агентской схеме: позиция исполнителя — с признаком агента и данными поставщика,
 * сервисный сбор — собственная услуга ТракSOS. Для самозанятых порядок уточнить у бухгалтера.
 */
export function agentReceipt(p: {
  customerPhone: string;
  items: { description: string; amount: number; supplier?: { name: string; inn: string; phone?: string } }[];
}) {
  return {
    customer: { phone: p.customerPhone.replace('+', '') },
    items: p.items.map((i) => ({
      description: i.description.slice(0, 128),
      quantity: '1.00',
      amount: toValue(i.amount),
      vat_code: 1, // без НДС — уточнить у бухгалтера
      payment_mode: 'full_payment',
      payment_subject: 'service',
      ...(i.supplier ? { agent_type: 'agent', supplier: { name: i.supplier.name, inn: i.supplier.inn, phone: i.supplier.phone } } : {}),
    })),
  };
}
