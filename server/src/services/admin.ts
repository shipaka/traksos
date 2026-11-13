// Полный доступ администратора: карточка любого пользователя, возвраты, корректировки, разбор заявок.
// Каждое действие — в журнал; каждое изменение денег — проводками, сумма по заявке остаётся нулевой;
// пользователю, которого это касается, — уведомление.

import type { Db, Queryable } from '../db/index.ts';
import type { Notifier } from './notify.ts';
import type { OrdersService } from './orders.ts';
import type { PaymentsService } from '../payments/service.ts';
import type { ProfilesService } from './profiles.ts';
import { bad, conflict, forbidden, notFound, type AuthUser } from '../http/router.ts';
import { config } from '../config.ts';
import { cancelSplit, pct, type CancelStage } from '../domain/money.ts';
import type { SettingsService } from './settings.ts';
import { rub } from '../util.ts';

export class AdminService {
  constructor(
    private db: Db,
    private notifier: Notifier,
    private orders: OrdersService,
    private payments: PaymentsService,
    private profiles: ProfilesService,
    private settings: SettingsService,
    private now: () => Date,
  ) {}

  private audit(q: Queryable, actor: AuthUser, action: string, target: string, data: unknown) {
    return q.query('insert into audit_log(actor_id, action, target, data) values ($1,$2,$3,$4)', [actor.id, action, target, data]);
  }

  /** Карточка пользователя — всё, что о нём есть, разложено по разделам */
  async userCard(id: string) {
    const u = await this.db.one(
      `select id, phone, name, roles, status, owner_id, company_name, company_inn, edo_operator, edo_id, fee_pct_override,
              rating::float as rating, rating_count, created_at, last_seen_at from users where id=$1`, [id]);
    if (!u) throw notFound('Пользователь не найден');
    const performer = await this.profiles.performer(id);
    const [asClient, asPerformer, vehicles, drivers, owner, reviewsAbout, reviewsBy, payments, ledger, payouts, documents, audit, sessions] = await Promise.all([
      this.db.query(
        `select id, number, status, service, is_sos, address, payment_method, call_out_amount, work_amount, created_at, completed_at
           from orders where client_id=$1 or created_by=$1 order by created_at desc limit 200`, [id]),
      this.db.query(
        `select id, number, status, service, is_sos, address, payment_method, call_out_amount, work_amount, created_at, completed_at
           from orders where performer_id=$1 order by created_at desc limit 200`, [id]),
      this.db.query(`select v.*, d.phone as driver_phone, d.name as driver_name from vehicles v left join users d on d.id=v.driver_id where v.owner_id=$1 order by v.created_at`, [id]),
      this.db.query(`select id, phone, name, status from users where owner_id=$1`, [id]),
      u.owner_id ? this.db.one(`select id, phone, name, company_name from users where id=$1`, [u.owner_id]) : null,
      this.db.query(`select r.id, r.order_id, r.stars, r.tags, r.text, r.weight::float as weight, r.disputed, r.hidden, r.created_at, a.name as author_name
                       from reviews r join users a on a.id=r.author_id where r.target_id=$1 order by r.created_at desc`, [id]),
      this.db.query(`select r.id, r.order_id, r.stars, r.text, r.created_at, t.name as target_name
                       from reviews r join users t on t.id=r.target_id where r.author_id=$1 order by r.created_at desc`, [id]),
      this.db.query(`select p.id, p.order_id, o.number, p.kind, p.method, p.amount, p.client_fee, p.total, p.status, p.refunded_amount, p.created_at
                       from payments p join orders o on o.id=p.order_id where o.client_id=$1 or o.performer_id=$1 order by p.created_at desc`, [id]),
      this.db.query(`select l.id::int as id, l.order_id, o.number, l.account, l.amount, l.kind, l.note, l.created_at
                       from ledger_entries l left join orders o on o.id=l.order_id where l.performer_id=$1 order by l.id desc limit 200`, [id]),
      this.db.query(`select po.id, po.order_id, o.number, po.amount, po.commission, po.status, po.receipt_status, po.created_at, po.paid_at
                       from payouts po join orders o on o.id=po.order_id where po.performer_id=$1 order by po.created_at desc`, [id]),
      this.db.query(`select id, kind, status, note, created_at from documents where user_id=$1 order by created_at`, [id]),
      this.db.query(`select a.id::int as id, a.action, a.data, a.created_at, x.phone as actor_phone
                       from audit_log a left join users x on x.id=a.actor_id where a.target=$1 or a.actor_id=$2::uuid order by a.id desc limit 100`, [id, id]),
      this.db.query(`select created_at, expires_at, device from sessions where user_id=$1 order by created_at desc`, [id]),
    ]);
    const bonusEntries = await this.db.query(`select id::int as id, amount, kind, order_id, note, created_at from bonus_entries where user_id=$1 order by id desc`, [id]);
    const fees = await this.settings.get('fees');
    return {
      user: u, owner, performer, balance: performer ? await this.payments.balance(id) : null,
      pricing: { feePctOverride: u.fee_pct_override == null ? null : Number(u.fee_pct_override), defaultFeePct: fees.clientFeePct,
        bonus: bonusEntries.reduce((s2: number, e: any) => s2 + e.amount, 0), bonusEntries },
      asClient, asPerformer, vehicles, drivers, reviewsAbout, reviewsBy, payments, ledger, payouts, documents, audit, sessions,
    };
  }

  /**
   * Возврат клиенту по платежу (СБП/карта/счёт). from: за чей счёт —
   *   platform  — площадка возвращает из своего сбора и вознаграждения;
   *   performer — удерживается у исполнителя (из невыплаченного или в долг).
   */
  async refund(admin: AuthUser, paymentId: string, p: { amount: number; from: 'platform' | 'performer'; reason: string }) {
    const pay = await this.db.one(`select p.*, o.client_id, o.created_by, o.performer_id, o.number from payments p join orders o on o.id=p.order_id where p.id=$1`, [paymentId]);
    if (!pay) throw notFound('Платёж не найден');
    if (!['captured', 'partially_refunded'].includes(pay.status)) throw conflict('not_refundable', 'Вернуть можно только списанный платёж');
    const left = pay.total - pay.refunded_amount;
    if (!Number.isInteger(p.amount) || p.amount <= 0 || p.amount > left) throw bad('bad_amount', `Можно вернуть от 1 коп. до ${rub(left)}`);
    if (p.from === 'performer' && !pay.performer_id) throw bad('no_performer', 'В заявке нет исполнителя');

    if (pay.provider_payment_id && pay.method !== 'invoice') {
      const r = await this.payments.provider.refund(pay.provider_payment_id, p.amount, `refund:${paymentId}:${pay.refunded_amount + p.amount}`);
      if (r.status === 'failed') throw conflict('refund_failed', 'Платёжный сервис отклонил возврат');
    }
    await this.db.tx(async (q) => {
      const total = pay.refunded_amount + p.amount;
      await q.query(`update payments set refunded_amount=$2, status=$3, updated_at=now() where id=$1`,
        [paymentId, total, total >= pay.total ? 'refunded' : 'partially_refunded']);
      const entries = [{ account: 'client', performerId: null as string | null, amount: p.amount, kind: 'refund', note: p.reason }];
      if (p.from === 'platform') entries.push({ account: 'platform', performerId: null, amount: -p.amount, kind: 'refund', note: p.reason });
      else {
        entries.push({ account: 'performer', performerId: pay.performer_id, amount: -p.amount, kind: 'refund_charge', note: p.reason });
        // Если выплата по этой заявке ещё не ушла — уменьшаем её
        await q.query(`update payouts set amount = greatest(0, amount - $2) where order_id=$1 and status='pending'`, [pay.order_id, p.amount]);
      }
      for (const e of entries) {
        await q.query(`insert into ledger_entries(order_id, payment_id, account, performer_id, amount, kind, note) values ($1,$2,$3,$4,$5,$6,$7)`,
          [pay.order_id, paymentId, e.account, e.performerId, e.amount, e.kind, e.note]);
      }
      await this.orders.event(q, pay.order_id, admin.id, 'refund', { paymentId, amount: p.amount, from: p.from, reason: p.reason });
      await this.audit(q, admin, 'payment.refund', paymentId, p);
    });
    await this.notifier.notify([pay.client_id, pay.created_by], { type: 'order', orderId: pay.order_id, status: 'refund' },
      { kind: 'normal', title: 'Возврат денег', body: `Заявка №${pay.number}: возвращаем ${rub(p.amount)}. ${p.reason}`, data: { orderId: pay.order_id } });
    if (p.from === 'performer') {
      await this.notifier.notify([pay.performer_id], { type: 'balance' },
        { kind: 'normal', title: 'Удержание по заявке', body: `№${pay.number}: ${rub(p.amount)} — ${p.reason}`, data: { orderId: pay.order_id } });
    }
    return this.payments.forOrder(admin, pay.order_id);
  }

  /** Ручное начисление (+) или списание (−) исполнителю: компенсация, штраф, исправление ошибки */
  async adjust(admin: AuthUser, performerId: string, p: { amount: number; reason: string; orderId?: string }) {
    if (!Number.isInteger(p.amount) || p.amount === 0) throw bad('bad_amount', 'Сумма не может быть нулевой');
    const u = await this.db.one('select user_id from performer_profiles where user_id=$1', [performerId]);
    if (!u) throw notFound('Это не исполнитель');
    await this.db.tx(async (q) => {
      for (const [account, amount, pid] of [['performer', p.amount, performerId], ['platform', -p.amount, null]] as const) {
        await q.query(`insert into ledger_entries(order_id, account, performer_id, amount, kind, note) values ($1,$2,$3,$4,'adjustment',$5)`,
          [p.orderId ?? null, account, pid, amount, p.reason]);
      }
      await this.audit(q, admin, 'balance.adjust', performerId, p);
    });
    await this.notifier.notify([performerId], { type: 'balance' }, {
      kind: 'normal', title: p.amount > 0 ? 'Начисление' : 'Списание',
      body: `${p.amount > 0 ? '+' : '−'}${rub(Math.abs(p.amount))}: ${p.reason}`, data: {},
    });
    return this.payments.balance(performerId);
  }

  /**
   * Разбор заявки администратором:
   *   complete — спор решён: фиксируем сумму работы и закрываем, как будто клиент подтвердил;
   *   cancel   — отменить с выбором, сколько выезда положено исполнителю (этап шкалы).
   */
  async resolve(admin: AuthUser, orderId: string, p: { action: 'complete' | 'cancel'; workAmount?: number; stage?: CancelStage; reason: string }) {
    const o = await this.db.one('select * from orders where id=$1', [orderId]);
    if (!o) throw notFound();
    if (['completed', 'cancelled'].includes(o.status)) throw conflict('closed', 'Заявка уже закрыта');
    if (p.action === 'complete') {
      if (!o.performer_id) throw bad('no_performer', 'В заявке нет исполнителя');
      if (p.workAmount == null || p.workAmount < 0) throw bad('bad_amount', 'Укажите сумму работы');
      await this.db.tx(async (q) => {
        const upd = await q.one(
          `update orders set status='completed', work_amount=$2, amount_proposed_at=coalesce(amount_proposed_at,$3), amount_confirmed_at=$3, completed_at=$3
            where id=$1 and status=$4 returning *`, [orderId, p.workAmount, this.now(), o.status]);
        if (!upd) throw conflict('state_changed', 'Заявка уже изменилась — обновите экран');
        await q.query(`update performer_profiles set line_status='online' where user_id=$1 and line_status='on_job'`, [o.performer_id]);
        await this.orders.event(q, orderId, admin.id, 'resolved_complete', { workAmount: p.workAmount, reason: p.reason });
        await this.payments.onConfirmed(upd, q);
        await this.audit(q, admin, 'order.resolve', orderId, p);
      });
      const m = this.orders.money({ ...o, work_amount: p.workAmount });
      await this.orders.systemMessage(orderId, `Поддержка закрыла заявку: итог ${rub(m.total)}. ${p.reason}`);
      await this.notifier.notify([o.client_id, o.created_by, o.performer_id], { type: 'order', orderId, status: 'completed' },
        { kind: 'normal', title: 'Заявка закрыта поддержкой', body: `№${o.number}: ${rub(m.total)}. ${p.reason}`, data: { orderId } });
    } else {
      const stage = p.stage ?? 'searching';
      const scale = (await this.settings.get('cancel')).scale;
      const callOut = o.call_out_amount ?? o.estimate.callOut;
      const split = cancelSplit(scale, stage, callOut, pct(callOut, Number(o.client_fee_pct)));
      const invited = (await this.db.query<{ performer_id: string }>(
        `select performer_id from order_dispatch where order_id=$1 and status in ('queued','ringing','bidding')`, [orderId])).map((x) => x.performer_id);
      await this.db.tx(async (q) => {
        const upd = await q.one(
          `update orders set status='cancelled', cancelled_at=$2, cancelled_by=$3, cancel_reason=$4, cancel_stage=$5 where id=$1 and status=$6 returning *`,
          [orderId, this.now(), admin.id, p.reason, stage, o.status]);
        if (!upd) throw conflict('state_changed', 'Заявка уже изменилась — обновите экран');
        await q.query(`update order_dispatch set status='cancelled' where order_id=$1 and status in ('queued','ringing','bidding')`, [orderId]);
        await q.query(`update bids set status='withdrawn' where order_id=$1 and status='active'`, [orderId]);
        if (o.performer_id) await q.query(`update performer_profiles set line_status='online' where user_id=$1 and line_status='on_job'`, [o.performer_id]);
        await this.orders.event(q, orderId, admin.id, 'resolved_cancel', { stage, reason: p.reason, ...split });
        await this.payments.onCancelled(upd, stage, q);
        // Наличные: если исполнителю положена часть выезда — это он получит на месте; иначе ничего
        await this.audit(q, admin, 'order.resolve', orderId, { ...p, stage });
      });
      this.notifier.live(invited, { type: 'order', orderId, status: 'cancelled' });
      await this.orders.systemMessage(orderId, `Поддержка отменила заявку: ${p.reason}`);
      await this.notifier.notify([o.client_id, o.created_by, o.performer_id], { type: 'order', orderId, status: 'cancelled' },
        { kind: 'normal', title: 'Заявка отменена поддержкой', body: `№${o.number}: ${p.reason}`, data: { orderId } });
    }
    return this.orders.view(admin, orderId);
  }

  // Цена для конкретного клиента ------------------------------------------------

  /** Персональный сервисный сбор клиента (null — общий из настроек). Действует на новые заявки. */
  async setClientFee(admin: AuthUser, userId: string, pctValue: number | null, reason: string) {
    if (pctValue != null && (pctValue < 0 || pctValue > 30)) throw bad('bad_pct', 'Сбор — от 0 до 30%');
    const u = await this.db.one('update users set fee_pct_override=$2 where id=$1 returning id', [userId, pctValue]);
    if (!u) throw notFound();
    await this.audit(this.db, admin, 'client.fee', userId, { pct: pctValue, reason });
    await this.notifier.notify([userId], { type: 'pricing' }, {
      kind: 'normal', title: 'Ваш сервисный сбор изменён',
      body: pctValue == null ? 'Теперь действует общий сбор площадки' : `Теперь ваш сбор — ${pctValue}%. ${reason}`, data: {},
    });
    return { ok: true, feePct: pctValue };
  }

  /** Бонусы клиенту: + начислить, − списать. Списываются сами при подтверждении суммы следующей заявки. */
  async bonus(admin: AuthUser, userId: string, amount: number, reason: string) {
    if (!Number.isInteger(amount) || amount === 0) throw bad('bad_amount', 'Сумма не может быть нулевой');
    const bal = await this.bonusBalance(userId);
    if (bal + amount < 0) throw bad('bad_amount', `Нельзя списать больше остатка: ${rub(bal)}`);
    await this.db.query(`insert into bonus_entries(user_id, amount, kind, note, actor_id) values ($1,$2,$3,$4,$5)`,
      [userId, amount, amount > 0 ? 'grant' : 'revoke', reason, admin.id]);
    await this.audit(this.db, admin, 'client.bonus', userId, { amount, reason });
    await this.notifier.notify([userId], { type: 'pricing' }, {
      kind: 'normal', title: amount > 0 ? 'Вам начислены бонусы' : 'Бонусы списаны',
      body: `${amount > 0 ? '+' : '−'}${rub(Math.abs(amount))}: ${reason}. Спишутся сами со следующей заявки.`, data: {},
    });
    return { ok: true, balance: bal + amount };
  }

  async bonusBalance(userId: string) {
    return (await this.db.one<{ b: number }>('select coalesce(sum(amount),0)::int b from bonus_entries where user_id=$1', [userId]))!.b;
  }

  /** Скидка на конкретную заявку — за счёт площадки, исполнитель получает полностью */
  async discount(admin: AuthUser, orderId: string, amount: number, reason: string) {
    if (!Number.isInteger(amount) || amount < 0) throw bad('bad_amount', 'Скидка — сумма от 0');
    const o = await this.db.one(`update orders set discount_amount=$2, discount_reason=$3
        where id=$1 and status not in ('completed','cancelled') returning client_id, created_by, number`, [orderId, amount, reason]);
    if (!o) throw conflict('closed', 'Скидку можно дать только до закрытия заявки');
    await this.orders.event(this.db, orderId, admin.id, 'discount', { amount, reason });
    await this.audit(this.db, admin, 'order.discount', orderId, { amount, reason });
    await this.notifier.notify([o.client_id, o.created_by], { type: 'order', orderId, status: 'discount' },
      { kind: 'normal', title: 'Скидка на заявку', body: `№${o.number}: −${rub(amount)}. ${reason}`, data: { orderId } });
    return this.orders.view(admin, orderId);
  }

  /** Снять исполнителя с линии (жалобы, не отвечает) — из всех звонков и торгов тоже */
  async forceOffline(admin: AuthUser, performerId: string, reason: string) {
    await this.db.query(`update performer_profiles set line_status='offline' where user_id=$1 and line_status <> 'on_job'`, [performerId]);
    await this.orders.afterRelease(await this.orders.release(this.db, performerId, null));
    await this.audit(this.db, admin, 'performer.offline', performerId, { reason });
    await this.notifier.notify([performerId], { type: 'line_status', lineStatus: 'offline' },
      { kind: 'normal', title: 'Вас сняли с линии', body: reason, data: {} });
    return { ok: true };
  }

  async setRoles(admin: AuthUser, userId: string, roles: string[]) {
    if (userId === admin.id && !roles.includes('admin')) throw bad('self_lockout', 'Нельзя снять роль администратора с самого себя');
    const target = await this.db.one<{ phone: string }>('select phone from users where id=$1', [userId]);
    if (!target) throw notFound('Пользователь не найден');
    // The designated insurance agent must never be repurposed in the admin UI.
    if (config.insurerPrimaryPhone && target.phone === config.insurerPrimaryPhone &&
        (roles.length !== 1 || roles[0] !== 'insurer'))
      throw forbidden('Этот номер закреплён за страховым агентом. Ему доступен только страховой кабинет.');
    // Staff grants are limited to the exact private VPS allowlist, never to
    // arbitrary accounts selected in the admin UI. The backup phone is not a role.
    if (roles.includes('admin') && (config.adminPhones.length !== 1 || !config.adminPhones.includes(target.phone)))
      throw forbidden('Администратором может быть только закреплённый основной номер');
    if (roles.includes('moderator') && !config.moderatorPhones.includes(target.phone))
      throw forbidden('Модератором может быть только закреплённый номер');
    const providerRoles=['master','tow','service'];
    if (roles.includes('inspection_operator') &&
        roles.some(role=>['client','driver',...providerRoles].includes(role)))
      throw bad('incompatible_roles','Оператор техосмотра не совмещается с клиентом или ремонтным исполнителем');
    if (roles.includes('insurer') && roles.some(role=>['client','driver',...providerRoles].includes(role)))
      throw bad('incompatible_roles','Страховой партнёр не совмещается с клиентом или ремонтным исполнителем');
    if (roles.includes('admin') && roles.includes('moderator'))
      throw bad('incompatible_staff_roles', 'Администратор и модератор — разные уровни доступа');
    await this.db.tx(async q => {
      await q.query('update users set roles=$2 where id=$1', [userId, roles]);
      // Any previous sessions must lose old privileges immediately.
      await q.query('delete from sessions where user_id=$1', [userId]);
      await this.audit(q, admin, 'user.roles', userId, { roles });
    });
    return { ok: true };
  }

  /** Поиск по всему: телефон, имя, компания, номер заявки, госномер */
  async search(q: string) {
    const s = q.trim();
    if (!s) return { users: [], orders: [] };
    const like = `%${s.replace(/[%_]/g, '')}%`;
    const digits = s.replace(/\D/g, '');
    const users = await this.db.query(
      `select u.id, u.phone, u.name, u.roles, u.status, u.company_name, p.kind, p.verification
         from users u left join performer_profiles p on p.user_id=u.id
        where u.phone ilike $1 or coalesce(u.name,'') ilike $1 or coalesce(u.company_name,'') ilike $1
           or ($2 <> '' and u.phone like '%' || $2 || '%')
           or exists (select 1 from vehicles v where v.owner_id=u.id and (v.plate ilike $1 or v.trailer_plate ilike $1))
        order by u.created_at desc limit 50`, [like, digits.length >= 4 ? digits : '']);
    const orders = /^\d{3,}$/.test(s)
      ? await this.db.query(`select id, number, status, service, created_at from orders where number=$1`, [Number(s)])
      : [];
    return { users, orders };
  }
}
