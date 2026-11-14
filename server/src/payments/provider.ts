// Платёжный сервис для агентской схемы. Любой банк/касса подключается через этот интерфейс:
// заморозка выезда (capture=false), списание, частичное списание при отмене, возврат, выплата исполнителю.

export type ProviderStatus = 'pending' | 'held' | 'captured' | 'cancelled' | 'failed';

export interface CreatePaymentInput {
  total: number; // копейки, списывается с клиента
  description: string;
  capture: boolean; // false — заморозить (выезд), true — списать сразу
  method: 'sbp' | 'card';
  idempotencyKey: string;
  returnUrl: string;
  metadata: Record<string, string>;
  receipt?: unknown;
}

export interface PayoutInput {
  amount: number;
  description: string;
  idempotencyKey: string;
  performer: { id: string; taxStatus: 'self_employed' | 'ip' | null; inn: string | null; payoutToken?: string | null };
  metadata: Record<string, string>;
}

export interface PaymentProvider {
  name: string;
  createPayment(p: CreatePaymentInput): Promise<{ id: string; status: ProviderStatus; confirmationUrl: string | null }>;
  /** amount — частичное списание замороженного (остаток вернётся клиенту) */
  capture(id: string, amount?: number): Promise<{ status: ProviderStatus }>;
  cancel(id: string): Promise<{ status: ProviderStatus }>;
  refund(id: string, amount: number, idempotencyKey: string): Promise<{ id: string; status: 'succeeded' | 'pending' | 'failed' }>;
  getPayment(id: string): Promise<{ id: string; status: ProviderStatus; total: number; metadata?: Record<string, string>; confirmationUrl?: string | null }>;
  getRefund(id: string): Promise<{ id: string; status: 'succeeded' | 'pending' | 'failed' }>;
  /** Выплата исполнителю; null — выплаты через этот сервис не настроены, платим вручную */
  payout(p: PayoutInput): Promise<{ id: string; status: 'pending' | 'paid' | 'failed'; receiptIssued: boolean } | null>;
  /** Разбор уведомления; статус всё равно перепроверяем через getPayment */
  parseWebhook(body: any): { providerPaymentId: string } | null;
}

/** Тестовый сервис: ничего не списывает, статусы меняются вызовом simulate (кнопка «Оплатить» в dev) */
export class MockProvider implements PaymentProvider {
  name = 'mock';
  private seq = 0;
  payments = new Map<string, { id: string; status: ProviderStatus; total: number; captured: number; refunded: number; metadata: Record<string,string>; confirmationUrl: string }>();
  private creations = new Map<string, { id: string; input: string }>();
  payouts: PayoutInput[] = [];
  refunds = new Map<string, { id: string; status: 'succeeded' | 'pending' | 'failed'; paymentId: string; amount: number }>();
  constructor(private publicUrl: string) {}

  async createPayment(p: CreatePaymentInput) {
    const input = JSON.stringify(p);
    const previous = this.creations.get(p.idempotencyKey);
    if (previous) {
      if (previous.input !== input) throw new Error('mock: same bank key used with different request');
      const original = this.payments.get(previous.id)!;
      return { id:original.id, status:original.status,
        confirmationUrl:original.confirmationUrl };
    }
    const id = `mock_${++this.seq}_${Date.now().toString(36)}`;
    const confirmationUrl = `${this.publicUrl}/api/dev/mock-pay/${id}`;
    this.payments.set(id, { id, status:'pending', total:p.total, captured:0, refunded:0,
      metadata:p.metadata, confirmationUrl });
    this.creations.set(p.idempotencyKey,{id,input});
    return { id, status:'pending' as const, confirmationUrl };
  }
  simulate(id: string, status: ProviderStatus) {
    const p = this.payments.get(id);
    if (!p) throw new Error('mock: нет платежа ' + id);
    p.status = status;
    if (status === 'captured') p.captured = p.total;
  }
  async capture(id: string, amount?: number) {
    const p = this.payments.get(id)!;
    p.status = 'captured';
    p.captured = amount ?? p.total;
    return { status: p.status };
  }
  async cancel(id: string) {
    const p = this.payments.get(id)!;
    p.status = 'cancelled';
    return { status: p.status };
  }
  async refund(id: string, amount: number, key: string) {
    const existing = this.refunds.get(key);
    if (existing) return { id: existing.id, status: existing.status };
    const p = this.payments.get(id);
    if (!p) throw new Error('mock: нет платежа ' + id);
    p.refunded += amount;
    const result = { id: `${id}_r${p.refunded}`, status: 'succeeded' as const, paymentId: id, amount };
    this.refunds.set(key, result);
    return { id: result.id, status: result.status };
  }
  async getRefund(id: string) {
    const r = [...this.refunds.values()].find(x => x.id === id);
    if (!r) throw new Error('mock: нет возврата ' + id);
    return { id: r.id, status: r.status };
  }
  async getPayment(id: string) {
    const p = this.payments.get(id)!;
    // A partial capture reduces the held amount; mirror bank's current settled sum.
    return { id, status: p.status, total: p.status === 'captured' ? p.captured : p.total,
      metadata:p.metadata,confirmationUrl:p.confirmationUrl };
  }
  async payout(p: PayoutInput) {
    this.payouts.push(p);
    return { id: `mock_payout_${this.payouts.length}`, status: 'paid' as const, receiptIssued: p.performer.taxStatus === 'self_employed' };
  }
  parseWebhook(body: any) {
    return body?.paymentId ? { providerPaymentId: String(body.paymentId) } : null;
  }
}
