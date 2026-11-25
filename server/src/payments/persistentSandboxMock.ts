// Fake money only. Same PaymentProvider interface as the real order engine,
// but durable across restarts of the separate sandbox PostgreSQL container.
import { createHash, randomUUID } from 'node:crypto';
import type { Db } from '../db/index.ts';
import type { CreatePaymentInput, PaymentProvider, PayoutInput, ProviderStatus } from './provider.ts';
import { config } from '../config.ts';

type PayRow = {
  id: string; status: ProviderStatus; total: number; captured: number; refunded: number;
  metadata: Record<string,string>; confirmation_url: string; request_hash: string;
};
type RefundRow = { id: string; status: 'succeeded' | 'pending' | 'failed' };

function requireSandbox() {
  if (!config.sandboxInstance) throw new Error('Durable mock payments are forbidden outside the isolated sandbox');
}
function requireInt(value: number, label: string) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('sandbox mock: invalid ' + label);
}
const hash = (p: CreatePaymentInput) => createHash('sha256').update(JSON.stringify(p)).digest('hex');

export async function prepareSandboxMockDb(db: Db) {
  requireSandbox();
  await db.exec(`
    create table if not exists sandbox_mock_payments(
      id text primary key,
      idempotency_key text not null unique,
      request_hash text not null,
      status text not null check (status in ('pending','held','captured','cancelled','failed')),
      total integer not null check(total >= 0),
      captured integer not null default 0 check(captured >= 0 and captured <= total),
      refunded integer not null default 0 check(refunded >= 0),
      metadata jsonb not null default '{}'::jsonb,
      confirmation_url text not null,
      created_at timestamptz not null default now()
    );
    create table if not exists sandbox_mock_refunds(
      id text primary key,
      payment_id text not null references sandbox_mock_payments(id),
      idempotency_key text not null unique,
      amount integer not null check(amount >= 0),
      status text not null check(status in ('succeeded','pending','failed')),
      created_at timestamptz not null default now()
    );
    create table if not exists sandbox_mock_payouts(
      id text primary key,
      idempotency_key text not null unique,
      performer_id text not null,
      amount integer not null check(amount >= 0),
      receipt_issued boolean not null,
      created_at timestamptz not null default now()
    );
  `);
}

export class PersistentSandboxMockProvider implements PaymentProvider {
  readonly name = 'mock';
  constructor(private db: Db, private publicUrl: string) { requireSandbox(); }

  async createPayment(p: CreatePaymentInput) {
    requireInt(p.total, 'payment amount');
    const id = 'sandbox_mock_' + randomUUID();
    const fingerprint = hash(p);
    const url = this.publicUrl + '/api/dev/mock-pay/' + id;
    const inserted = await this.db.one<PayRow>(`
      insert into sandbox_mock_payments
        (id,idempotency_key,request_hash,status,total,metadata,confirmation_url)
      values ($1,$2,$3,'pending',$4,$5::jsonb,$6)
      on conflict (idempotency_key) do nothing returning *
    `, [id,p.idempotencyKey,fingerprint,p.total,JSON.stringify(p.metadata),url]);
    const row = inserted ?? await this.db.one<PayRow>(
      'select * from sandbox_mock_payments where idempotency_key=$1', [p.idempotencyKey]);
    if (!row || row.request_hash !== fingerprint)
      throw new Error('sandbox mock: reused idempotency key for different amount or request');
    return { id: row.id, status: row.status, confirmationUrl: row.confirmation_url };
  }

  private async payment(id: string) {
    const p = await this.db.one<PayRow>('select * from sandbox_mock_payments where id=$1', [id]);
    if (!p) throw new Error('sandbox mock: unknown payment');
    return p;
  }
  async getPayment(id: string) {
    const p = await this.payment(id);
    return { id, status:p.status, total:p.status === 'captured' ? p.captured : p.total,
      metadata:p.metadata, confirmationUrl:p.confirmation_url };
  }

  async simulate(id: string, status: ProviderStatus) {
    const p = await this.db.one<PayRow>(`
      update sandbox_mock_payments
      set status=$2, captured=case when $2='captured' then total else captured end
      where id=$1 returning *
    `, [id,status]);
    if (!p) throw new Error('sandbox mock: unknown payment');
  }

  async capture(id: string, amount?: number) {
    const original = await this.payment(id);
    const settled = amount ?? original.total;
    requireInt(settled, 'capture amount');
    if (settled > original.total) throw new Error('sandbox mock: capture exceeds payment');
    if (original.status === 'captured') {
      if (original.captured !== settled) throw new Error('sandbox mock: conflicting second capture');
      return { status: 'captured' as const };
    }
    const row = await this.db.one<PayRow>(`
      update sandbox_mock_payments set status='captured', captured=$2
      where id=$1 and status in ('pending','held') returning *
    `, [id,settled]);
    if (!row) throw new Error('sandbox mock: cancelled or failed payment cannot be captured');
    return { status: 'captured' as const };
  }

  async cancel(id: string) {
    const p = await this.db.one<PayRow>(
      "update sandbox_mock_payments set status='cancelled' where id=$1 returning *", [id]);
    if (!p) throw new Error('sandbox mock: unknown payment');
    return { status: 'cancelled' as const };
  }

  async refund(id: string, amount: number, idempotencyKey: string) {
    requireInt(amount, 'refund amount');
    return this.db.tx(async q => {
      const receiptId = 'sandbox_refund_' + randomUUID();
      const added = await q.one<RefundRow>(`
        insert into sandbox_mock_refunds (id,payment_id,idempotency_key,amount,status)
        values ($1,$2,$3,$4,'succeeded')
        on conflict (idempotency_key) do nothing returning id,status
      `, [receiptId,id,idempotencyKey,amount]);
      if (!added) {
        const old = await q.one<RefundRow & {payment_id:string;amount:number}>(
          'select * from sandbox_mock_refunds where idempotency_key=$1',[idempotencyKey]);
        if (!old || old.payment_id !== id || old.amount !== amount)
          throw new Error('sandbox mock: refund idempotency conflict');
        return { id:old.id, status:old.status };
      }
      const paid = await q.one(`
        update sandbox_mock_payments set refunded=refunded+$2
        where id=$1 and status='captured' and refunded+$2<=captured returning id
      `,[id,amount]);
      if (!paid) throw new Error('sandbox mock: refund exceeds captured amount');
      return { id: added.id, status: added.status };
    });
  }

  async getRefund(id: string) {
    const r = await this.db.one<RefundRow>('select id,status from sandbox_mock_refunds where id=$1',[id]);
    if (!r) throw new Error('sandbox mock: unknown refund');
    return r;
  }
  async payout(p: PayoutInput) {
    requireInt(p.amount, 'payout amount');
    const id = 'sandbox_payout_' + randomUUID();
    const receipt = p.performer.taxStatus === 'self_employed';
    const inserted = await this.db.one<{id:string;amount:number;performer_id:string;receipt_issued:boolean}>(`
      insert into sandbox_mock_payouts(id,idempotency_key,performer_id,amount,receipt_issued)
      values ($1,$2,$3,$4,$5) on conflict (idempotency_key) do nothing returning *
    `,[id,p.idempotencyKey,p.performer.id,p.amount,receipt]);
    const r = inserted ?? await this.db.one<{id:string;amount:number;performer_id:string;receipt_issued:boolean}>(
      'select * from sandbox_mock_payouts where idempotency_key=$1',[p.idempotencyKey]);
    if (!r || r.amount !== p.amount || r.performer_id !== p.performer.id)
      throw new Error('sandbox mock: payout idempotency conflict');
    return {id:r.id,status:'paid' as const,receiptIssued:r.receipt_issued};
  }
  parseWebhook(body: any) {
    return body?.paymentId ? {providerPaymentId:String(body.paymentId)} : null;
  }
}
