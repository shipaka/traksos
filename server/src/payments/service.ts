// Оплата по агентской схеме. ТракSOS — агент исполнителя: принимает деньги клиента за исполнителя,
// перечисляет ему сумму за вычетом вознаграждения, себе оставляет сбор и вознаграждение.
//
// Три способа, каждый включается отдельно в настройках площадки (payments.cash/online/invoice):
//  • cash    — клиент платит мастеру на месте; мастер должен площадке сбор + вознаграждение (долг в учёте);
//  • online  — СБП/карта: выезд замораживается при вызове, работа списывается после подтверждения суммы;
//  • invoice — счёт компании по ИНН; после поступления денег админ отмечает оплату.
//
// Учёт (ledger_entries): по каждой заявке сумма проводок = 0.
//   client −total · performer +к выплате · platform +сбор и вознаграждение · payout при выплате.

import type { Db, Queryable } from '../db/index.ts';
import type { SettingsService } from '../services/settings.ts';
import type { Notifier } from '../services/notify.ts';
import type { OrdersService, PaymentHooks } from '../services/orders.ts';
import type { PaymentProvider, ProviderStatus } from './provider.ts';
import { HttpError, bad, forbidden, notFound, type AuthUser } from '../http/router.ts';
import { cancelSplit, commissionPct, pct, split, type CancelStage } from '../domain/money.ts';
import { agentReceipt } from './yookassa.ts';
import { config } from '../config.ts';
import { rub } from '../util.ts';
import { roundTo } from '../domain/pricing.ts';

const STATUS_MAP: Record<ProviderStatus, string> = {
  pending: 'pending', held: 'held', captured: 'captured', cancelled: 'cancelled', failed: 'failed',
};

export class PaymentsService implements PaymentHooks {
  constructor(
    private db: Db,
    private settings: SettingsService,
    public provider: PaymentProvider,
    private notifier: Notifier,
    private orders: OrdersService,
  ) {}

  async assertMethodAllowed(method: string) {
    const p = await this.settings.get('payments');
    const on = method === 'cash' ? p.cash : method === 'online' ? p.online : method === 'invoice' ? p.invoice : false;
    if (!on) {
      throw new HttpError(403, 'payment_method_disabled',
        method === 'online' ? 'Оплата на сайте пока не подключена — оплатите исполнителю на месте'
          : method === 'invoice' ? 'Оплата по счёту пока не подключена' : 'Этот способ оплаты сейчас недоступен');
    }
  }

  async methods() {
    const p = await this.settings.get('payments');
    return { cash: p.cash, online: p.online, invoice: p.invoice, defaultMethod: p.online ? p.defaultMethod : 'cash' };
  }

  // Хуки заявки -----------------------------------------------------------

  async onCreated(order: any) {
    if (order.payment_method !== 'online') return { holdRequired: false };
    // Цена выезда станет известна после выбора отклика (до 130% обычной) — замораживаем потолок,
    // при списании берём фактическую сумму, остаток вернётся клиенту сам.
    const d = await this.settings.get('dispatch');
    const ceil = roundTo((order.estimate.callOut as number) * d.offerCeil, 5_000);
    const pay = await this.createProviderPayment(this.db, order, 'call_out', ceil, false);
    return { holdRequired: true, confirmationUrl: pay.confirmation_url };
  }

  async onConfirmed(order: any, q: Queryable) {
    const m = this.orders.money(order);
    const perf = await q.one<{ is_priority: boolean }>('select is_priority from performer_profiles where user_id=$1', [order.performer_id]);
    const fees = await this.settings.get('fees');
    const s = split(fees, m.amount, { isPriority: !!perf?.is_priority });

    if (order.payment_method === 'cash') {
      // Клиент отдал мастеру итог со скидкой; мастер должен площадке сбор + вознаграждение − скидку.
      // Если скидка больше — площадка доплачивает мастеру разницу.
      const debt = s.commission + m.clientFee - m.discount;
      if (debt > 0) {
        await this.ledger(q, order.id, null, [
          { account: 'performer', performerId: order.performer_id, amount: -debt, kind: 'cash_commission',
            note: `Наличные ${rub(m.total)}: сбор ${rub(m.clientFee)} + вознаграждение ${rub(s.commission)}${m.discount ? ` − скидка ${rub(m.discount)}` : ''}` },
          { account: 'platform', amount: debt, kind: 'cash_commission' },
        ]);
      } else if (debt < 0) {
        await this.ledger(q, order.id, null, [
          { account: 'performer', performerId: order.performer_id, amount: -debt, kind: 'adjustment', note: `Скидка клиенту ${rub(m.discount)} за счёт площадки` },
          { account: 'platform', amount: debt, kind: 'adjustment' },
        ]);
      }
      return;
    }
    if (order.payment_method === 'invoice') {
      await q.query(
        `insert into payments(order_id, kind, method, amount, client_fee, total, status, provider, idempotency_key)
         values ($1,'work','invoice',$2,$3,$4,'pending','invoice',$5)`,
        [order.id, m.amount, m.clientFee, m.total, `${order.id}:invoice`],
      );
      return;
    }
    // online: выезд уже заморожен, работу списываем сразу (скидка сначала уменьшает оплату работы)
    const workTotal = m.work + pct(m.work, Number(order.client_fee_pct));
    if (m.work > 0 && workTotal - Math.min(m.discount, workTotal) > 0) {
      const p = await this.createProviderPayment(q, order, 'work', m.work, true, Math.min(m.discount, workTotal));
      await this.notifier.notify([order.client_id, order.created_by], { type: 'payment', orderId: order.id, url: p.confirmation_url },
        { kind: 'normal', title: 'Оплатите работу', body: `Заявка №${order.number}: ${rub(p.total)}`, data: { orderId: order.id } });
    } else {
      await this.finalizeOnline(order.id, q);
    }
  }

  async onCancelled(order: any, stage: string, q: Queryable) {
    if (order.payment_method !== 'online') return;
    const pay = await q.one(`select * from payments where order_id=$1 and kind='call_out' and status in ('pending','held')`, [order.id]);
    if (!pay) return;
    if (pay.status === 'pending') {
      // Do not report a payment as cancelled when the provider rejected cancellation.
      // The provider state must be reconciled before changing our local record.
      await this.provider.cancel(pay.provider_payment_id);
      await q.query(`update payments set status='cancelled', updated_at=now() where id=$1`, [pay.id]);
      return;
    }
    const scale = (await this.settings.get('cancel')).scale;
    const base: number = order.call_out_amount ?? order.estimate.callOut;
    const c = cancelSplit(scale, stage as CancelStage, base, pct(base, Number(order.client_fee_pct)));
    const keep = c.toPerformer + c.platformKeeps;
    c.refund = pay.total - keep; // замороженный потолок минус удержанное
    if (keep === 0) {
      await this.provider.cancel(pay.provider_payment_id);
      await q.query(`update payments set status='cancelled', updated_at=now() where id=$1`, [pay.id]);
      return;
    }
    await this.provider.capture(pay.provider_payment_id, keep);
    await q.query(`update payments set status=$2, refunded_amount=$3, updated_at=now() where id=$1`,
      [pay.id, c.refund > 0 ? 'partially_refunded' : 'captured', c.refund]);
    const fees = await this.settings.get('fees');
    const perf = await q.one<{ is_priority: boolean }>('select is_priority from performer_profiles where user_id=$1', [order.performer_id]);
    const commission = pct(c.toPerformer, commissionPct(fees, { isPriority: !!perf?.is_priority }));
    await this.ledger(q, order.id, pay.id, [
      { account: 'client', amount: -keep, kind: 'payment', note: `Отмена (${stage}): удержано ${rub(keep)}, возврат ${rub(c.refund)}` },
      { account: 'performer', performerId: order.performer_id, amount: c.toPerformer - commission, kind: 'earning' },
      { account: 'platform', amount: c.platformKeeps + commission, kind: 'fee' },
    ]);
    if (c.toPerformer > 0) {
      await q.query(`insert into payouts(order_id, performer_id, amount, commission, provider) values ($1,$2,$3,$4,$5)`,
        [order.id, order.performer_id, c.toPerformer - commission, commission, this.provider.name]);
    }
  }

  // Платежи ---------------------------------------------------------------

  private async createProviderPayment(q: Queryable, order: any, kind: 'call_out' | 'work', amount: number, capture: boolean, discount = 0) {
    const p = await this.settings.get('payments');
    const fee = pct(amount, Number(order.client_fee_pct));
    const total = amount + fee - discount;
    const n = (await q.one<{ c: number }>('select count(*)::int c from payments where order_id=$1 and kind=$2', [order.id, kind]))!.c;
    const key = `${order.id}:${kind}:${n + 1}`;
    const row = await q.one(
      `insert into payments(order_id, kind, method, amount, client_fee, total, provider, idempotency_key)
       values ($1,$2,$3,$4,$5,$6,$7,$8) returning *`,
      [order.id, kind, p.defaultMethod, amount, fee, total, this.provider.name, key],
    );
    let receipt: unknown;
    if (p.sendReceipts) {
      const client = await q.one<{ phone: string }>('select phone from users where id=$1', [order.client_id]);
      const perf = order.performer_id
        ? await q.one<{ name: string; inn: string }>('select u.name, p.inn from users u join performer_profiles p on p.user_id=u.id where u.id=$1', [order.performer_id])
        : null;
      receipt = agentReceipt({
        customerPhone: client!.phone,
        items: [
          { description: kind === 'call_out' ? 'Выезд мастера' : 'Работы по заявке', amount, supplier: perf?.inn ? { name: perf.name, inn: perf.inn } : undefined },
          ...(fee ? [{ description: 'Сервисный сбор ТракSOS', amount: fee }] : []),
        ],
      });
    }
    const r = await this.provider.createPayment({
      total, capture, method: p.defaultMethod, idempotencyKey: key,
      description: `ТракSOS, заявка №${order.number}: ${kind === 'call_out' ? 'выезд' : 'работа'}`,
      returnUrl: `${config.publicUrl}/orders/${order.id}`,
      metadata: { orderId: order.id, paymentId: row!.id, kind },
      receipt,
    });
    return q.one(
      `update payments set provider_payment_id=$2, status=$3, confirmation_url=$4, updated_at=now() where id=$1 returning *`,
      [row!.id, r.id, STATUS_MAP[r.status] === 'created' ? 'pending' : STATUS_MAP[r.status], r.confirmationUrl],
    ) as Promise<any>;
  }

  /** Уведомление от платёжного сервиса. Статус перепроверяем запросом к сервису. */
  async handleWebhook(body: any) {
    const ev = this.provider.parseWebhook(body);
    if (!ev) throw bad('bad_webhook');
    const pay = await this.db.one('select * from payments where provider_payment_id=$1', [ev.providerPaymentId]);
    if (!pay) throw notFound('Платёж не найден');
    const actual = await this.provider.getPayment(ev.providerPaymentId);
    return this.sync(pay, STATUS_MAP[actual.status]);
  }

  private async sync(pay: any, status: string) {
    if (pay.status === status) return { changed: false };
    // A delayed provider notification must not reopen a settled or cancelled payment.
    // The local partially_refunded status is also terminal for this payment.
    if (['captured', 'cancelled', 'failed', 'partially_refunded'].includes(pay.status)) {
      return { changed: false };
    }
    // A hold cannot revert to pending when notifications arrive out of order.
    if (pay.status === 'held' && status === 'pending') return { changed: false };
    await this.db.query('update payments set status=$2, updated_at=now() where id=$1', [pay.id, status]);
    await this.orders.event(this.db, pay.order_id, null, `payment_${pay.kind}_${status}`, { paymentId: pay.id, total: pay.total });
    if (pay.kind === 'call_out' && status === 'held') {
      await this.orders.startDispatch(pay.order_id);
    } else if (pay.kind === 'work' && status === 'captured') {
      await this.db.tx((q) => this.finalizeOnline(pay.order_id, q));
    } else if (pay.kind === 'call_out' && (status === 'cancelled' || status === 'failed')) {
      const o = await this.db.one(`update orders set status='cancelled', cancelled_at=now(), cancel_reason='Оплата выезда не прошла'
                                    where id=$1 and status='searching' and dispatch_started_at is null returning *`, [pay.order_id]);
      if (o) await this.notifier.notify([o.client_id, o.created_by], { type: 'order', orderId: o.id, status: 'cancelled' },
        { kind: 'normal', title: 'Оплата не прошла', body: `Заявка №${o.number} не отправлена исполнителям`, data: { orderId: o.id } });
    }
    return { changed: true };
  }

  /** Всё оплачено: списываем замороженный выезд, разносим по счетам, ставим выплату */
  private async finalizeOnline(orderId: string, q: Queryable) {
    const order = (await q.one('select * from orders where id=$1', [orderId]))!;
    const callOutPay = await q.one(`select * from payments where order_id=$1 and kind='call_out' and status='held'`, [orderId]);
    const m0 = this.orders.money(order);
    const workTotal = m0.work + pct(m0.work, Number(order.client_fee_pct));
    const discountOnCallOut = Math.max(0, m0.discount - workTotal);
    if (callOutPay) {
      const actual: number = order.call_out_amount ?? callOutPay.amount;
      const fee = pct(actual, Number(order.client_fee_pct)) - discountOnCallOut;
      await this.provider.capture(callOutPay.provider_payment_id, actual + fee);
      // Разморозка лишнего — не возврат: просто списываем меньше, чем было заморожено
      await q.query(`update payments set status='captured', amount=$2, client_fee=$3, total=$4, updated_at=now() where id=$1`,
        [callOutPay.id, actual, fee, actual + fee]);
    }
    const m = this.orders.money(order);
    const perf = await q.one<{ is_priority: boolean }>('select is_priority from performer_profiles where user_id=$1', [order.performer_id]);
    const fees = await this.settings.get('fees');
    const s = split(fees, m.amount, { isPriority: !!perf?.is_priority });
    await this.ledger(q, orderId, null, [
      { account: 'client', amount: -m.total, kind: 'payment' },
      { account: 'performer', performerId: order.performer_id, amount: m.amount - s.commission, kind: 'earning' },
      { account: 'platform', amount: m.clientFee + s.commission - m.discount, kind: 'fee',
        note: `сбор ${rub(m.clientFee)} + вознаграждение ${rub(s.commission)}${m.discount ? ` − скидка ${rub(m.discount)}` : ''}` },
    ]);
    await q.query(`insert into payouts(order_id, performer_id, amount, commission, provider) values ($1,$2,$3,$4,$5)`,
      [orderId, order.performer_id, m.amount - s.commission, s.commission, this.provider.name]);
    await this.orders.event(q, orderId, null, 'paid', { total: m.total, toPerformer: m.amount - s.commission });
  }

  /** Счёт компании оплачен (отмечает админ по выписке) */
  async markInvoicePaid(admin: AuthUser, paymentId: string) {
    return this.db.tx(async (q) => {
      const pay = await q.one(`update payments set status='captured', updated_at=now() where id=$1 and method='invoice' and status='pending' returning *`, [paymentId]);
      if (!pay) throw notFound('Неоплаченный счёт не найден');
      const order = (await q.one('select * from orders where id=$1', [pay.order_id]))!;
      const fees = await this.settings.get('fees');
      const perf = await q.one<{ is_priority: boolean }>('select is_priority from performer_profiles where user_id=$1', [order.performer_id]);
      const s = split(fees, pay.amount, { isPriority: !!perf?.is_priority });
      await this.ledger(q, order.id, pay.id, [
        { account: 'client', amount: -pay.total, kind: 'payment', note: 'Оплата по счёту' },
        { account: 'performer', performerId: order.performer_id, amount: pay.amount - s.commission, kind: 'earning' },
        { account: 'platform', amount: pay.total - (pay.amount - s.commission), kind: 'fee' },
      ]);
      await q.query(`insert into payouts(order_id, performer_id, amount, commission, provider) values ($1,$2,$3,$4,'manual')`,
        [order.id, order.performer_id, pay.amount - s.commission, s.commission]);
      await q.query('insert into audit_log(actor_id, action, target) values ($1,$2,$3)', [admin.id, 'invoice.paid', paymentId]);
      return pay;
    });
  }

  // Выплаты и долги -------------------------------------------------------

  async runPayouts(admin: AuthUser | null) {
    const list = await this.db.query(
      `select po.*, p.tax_status, p.inn from payouts po join performer_profiles p on p.user_id = po.performer_id
        where po.status='pending' order by po.created_at limit 100`);
    const results = [];
    for (const po of list) {
      if (!po.tax_status) {
        results.push({ id: po.id, status: 'skipped', reason: 'нет статуса самозанятого или ИП' });
        continue;
      }
      // Списания и удержания больше начислений — сначала гасим долг, выплату не отправляем
      if ((await this.balance(po.performer_id)).to_pay < po.amount) {
        results.push({ id: po.id, status: 'skipped', reason: 'есть удержания — баланс меньше выплаты' });
        continue;
      }
      if (po.amount === 0) {
        await this.db.query(`update payouts set status='paid', paid_at=now(), receipt_status='not_required' where id=$1`, [po.id]);
        results.push({ id: po.id, status: 'paid' });
        continue;
      }
      const r = await this.provider.payout({
        amount: po.amount, idempotencyKey: `payout:${po.id}`,
        description: `ТракSOS: выплата по заявке`, metadata: { payoutId: po.id, orderId: po.order_id },
        performer: { id: po.performer_id, taxStatus: po.tax_status, inn: po.inn },
      });
      if (!r) {
        results.push({ id: po.id, status: 'manual' });
        continue;
      }
      await this.db.query(
        `update payouts set status=$2, provider_payout_id=$3, paid_at = case when $2='paid' then now() end,
           receipt_status = $4 where id=$1`,
        [po.id, r.status === 'paid' ? 'paid' : r.status === 'failed' ? 'failed' : 'processing', r.id,
          po.tax_status === 'self_employed' ? (r.receiptIssued ? 'issued' : 'pending') : 'not_required'],
      );
      if (r.status === 'paid') {
        await this.ledger(this.db, po.order_id, null, [
          { account: 'performer', performerId: po.performer_id, amount: -po.amount, kind: 'payout' },
          { account: 'payout', amount: po.amount, kind: 'payout' },
        ]);
      }
      results.push({ id: po.id, status: r.status });
    }
    if (admin) await this.db.query('insert into audit_log(actor_id, action, data) values ($1,$2,$3)', [admin.id, 'payouts.run', { count: results.length }]);
    return results;
  }

  /** Мастер погасил долг по комиссии с наличных (переводом на счёт ИП) — отмечает админ */
  async cashDebtPaid(admin: AuthUser, performerId: string, amount: number) {
    if (amount <= 0) throw bad('bad_amount');
    await this.ledger(this.db, null, null, [
      { account: 'performer', performerId, amount, kind: 'cash_commission_paid', note: `Отметил ${admin.phone}` },
      { account: 'platform', amount: -amount, kind: 'cash_commission_paid' },
    ]);
    return this.balance(performerId);
  }

  async balance(performerId: string) {
    const r = await this.db.one<{ cash_debt: number; to_pay: number; paid: number }>(
      `select
         coalesce(-sum(amount) filter (where kind in ('cash_commission','cash_commission_paid')), 0)::int as cash_debt,
         coalesce(sum(amount) filter (where kind in ('earning','payout','adjustment','refund_charge','points')), 0)::int as to_pay,
         coalesce(-sum(amount) filter (where kind = 'payout'), 0)::int as paid
       from ledger_entries where account='performer' and performer_id=$1`, [performerId]);
    const limit = (await this.settings.get('fees')).cashDebtLimit;
    return { ...r!, cashDebtLimit: limit, paused: (r?.cash_debt ?? 0) > limit };
  }

  /** Отчёт агента за месяц: по каждому исполнителю (или одному) */
  async agentReport(period: string, performerId?: string) {
    if (!/^\d{4}-\d{2}$/.test(period)) throw bad('bad_period', 'Период в формате ГГГГ-ММ');
    const from = `${period}-01T00:00:00+03:00`;
    const rows = await this.db.query(
      `with o as (
         select * from orders
          where status='completed' and completed_at >= $1::timestamptz and completed_at < ($1::timestamptz + interval '1 month')
            and ($2::uuid is null or performer_id = $2::uuid))
       select o.performer_id, u.name, p.inn, p.tax_status,
              count(*)::int as orders,
              coalesce(sum(coalesce(o.call_out_amount,0) + coalesce(o.work_amount,0)),0)::int as principal_amount,
              count(*) filter (where o.payment_method='cash')::int as cash_orders,
              coalesce((select -sum(l.amount) from ledger_entries l where l.performer_id=o.performer_id and l.kind='cash_commission'
                         and l.order_id in (select id from o o2 where o2.performer_id=o.performer_id)),0)::int as cash_commission,
              coalesce((select sum(po.commission) from payouts po where po.order_id in (select id from o o3 where o3.performer_id=o.performer_id)),0)::int as online_commission,
              coalesce((select sum(po.amount) from payouts po where po.order_id in (select id from o o4 where o4.performer_id=o.performer_id)),0)::int as to_performer
         from o join users u on u.id = o.performer_id left join performer_profiles p on p.user_id = o.performer_id
        group by o.performer_id, u.name, p.inn, p.tax_status`,
      [from, performerId ?? null],
    );
    for (const r of rows) {
      await this.db.query(
        `insert into agent_reports(performer_id, period, totals) values ($1,$2,$3)
         on conflict (performer_id, period) do update set totals=excluded.totals, created_at=now()`,
        [r.performer_id, period, r],
      );
    }
    return rows;
  }

  async forOrder(user: AuthUser, orderId: string) {
    const order = await this.orders.mustSee(user, orderId);
    // Bidding candidates may preview the job price, but never its payment records
    // or confirmation links. Those belong to the client, assigned performer and admin.
    if (!this.orders.actorOf(user, order)) throw forbidden();
    return this.db.query(
      `select id, kind, method, amount, client_fee, total, status, confirmation_url, refunded_amount, created_at
         from payments where order_id=$1 order by created_at`, [orderId]);
  }

  async ledger(q: Queryable, orderId: string | null, paymentId: string | null,
    entries: { account: string; performerId?: string; amount: number; kind: string; note?: string }[]) {
    const sum = entries.reduce((s, e) => s + e.amount, 0);
    if (sum !== 0) throw new Error(`Проводки не сходятся: ${sum}`);
    for (const e of entries) {
      if (e.amount === 0) continue;
      await q.query(
        `insert into ledger_entries(order_id, payment_id, account, performer_id, amount, kind, note) values ($1,$2,$3,$4,$5,$6,$7)`,
        [orderId, paymentId, e.account, e.performerId ?? null, e.amount, e.kind, e.note ?? null],
      );
    }
  }
}
