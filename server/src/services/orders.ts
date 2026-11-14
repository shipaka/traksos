import type { Db, Queryable } from '../db/index.ts';
import type { SettingsService } from './settings.ts';
import type { Notifier } from './notify.ts';
import { bad, conflict, forbidden, notFound, type AuthUser } from '../http/router.ts';
import { estimate, isNight, billWork, type Tier, type Extra } from '../domain/pricing.ts';
import { rankCandidates, performerKindFor, type Candidate } from '../domain/dispatch.ts';
import { transition, canDo, statusLabels, type Action, type Actor, type OrderStatus } from '../domain/orderState.ts';
import { cancelStage, cancelSplit, pct } from '../domain/money.ts';
import { haversineKm } from '../domain/geo.ts';
import { slot } from '../domain/schedule.ts';
import { rub } from '../util.ts';
import type { AuctionService } from './auction.ts';
const SERVICE_TITLE: Record<string, string> = { consult: 'Консультация', electric: 'Электрик', air: 'Пневматика', autonomy: 'Автономка', tyre: 'Шиномонтаж', diag: 'Диагност', ecu: 'Блоки управления', tow: 'Эвакуатор' };

export interface CreateOrderInput {
  service: string;
  isSos?: boolean;
  problem?: string;
  description?: string;
  address?: string;
  lat?: number;
  lng?: number;
  zoneId: string;
  tier?: Tier;
  vehicleId?: string;
  brand?: string;
  model?: string;
  year?: number;
  groupTrip?: boolean;
  night?: boolean;
  paymentMethod?: 'cash' | 'online' | 'invoice';
  destination?: string;
  cargo?: 'tractor' | 'semitrailer' | 'coupling' | 'truck12' | 'bus' | 'special';
  loaded?: 'empty' | 'loaded' | 'adr';
  driverOnSite?: boolean;
  /** Условия на месте: тип места, пропуск, кто встретит, что с машиной, когда */
  site?: { place?: string; pass?: string; meet?: string; state?: string; when?: string; time?: string };
  /** Выезд после консультации: подсказка мастера переходит в заявку, клиенту — скидка */
  fromConsult?: string;
  /** Следующий самостоятельный этап того же обращения. */
  continueFrom?: string;
}

/** Подсказка мастера после консультации */
export interface ConsultHint { hints: string[]; confidence: 'sure' | 'likely' | 'guess'; note?: string }

/** Хуки оплаты — реализует PaymentsService. Пока оплата выключена, работают как заглушки. */
export interface PaymentHooks {
  onCreated(order: any): Promise<{ confirmationUrl?: string; holdRequired: boolean }>;
  onConfirmed(order: any, q: Queryable): Promise<void>;
  processCaptureForOrder(orderId: string): Promise<string | null>;
  onCancelled(order: any, stage: string, q: Queryable): Promise<void>;
  assertMethodAllowed(method: string): Promise<void>;
}

const SERVICES = ['electric', 'diag', 'air', 'autonomy', 'tyre', 'tow', 'consult', 'ecu'];
const CONSULT_DISCOUNT = 'Скидка после консультации';

export class OrdersService {
  onDispute: ((p: { userId: string; orderId: string; text: string; targetId: string | null; title: string }) => Promise<unknown>) | null = null;
  /** Реферальные баллы: гашение сбора/комиссии и начисления пригласившим */
  referral: import('./referral.ts').ReferralService | null = null;
  ops: import('./ops.ts').OpsService | null = null;
  payments!: PaymentHooks;
  auction!: AuctionService;

  constructor(private db: Db, private settings: SettingsService, private notifier: Notifier, private now: () => Date = () => new Date()) {}

  // Создание ---------------------------------------------------------------

  async create(user: AuthUser, i: CreateOrderInput) {
    if (!SERVICES.includes(i.service)) throw bad('bad_service', 'Неизвестная услуга');
    const all = await this.settings.all();
    const method = i.paymentMethod ?? 'cash';
    await this.payments.assertMethodAllowed(method);

    const clientId = user.owner_id ?? user.id;
    // Previous stage must be closed; never mix its price into the next auction.
    let previous: any = null;
    if (i.continueFrom) {
      if (i.fromConsult || i.service !== 'tow')
        throw bad('bad_continuation', 'Сейчас можно продолжить выезд мастера вызовом эвакуатора');
      previous = await this.db.one<any>('select * from orders where id=$1', [i.continueFrom]);
      if (!previous || previous.client_id !== clientId || (user.owner_id && previous.created_by !== user.id))
        throw forbidden('Продолжить можно только собственное обращение');
      if (previous.status !== 'completed' || !['cause_found', 'not_found'].includes(previous.result) || previous.service === 'tow')
        throw conflict('stage_not_ready', 'Предыдущий этап не завершён или не требует эвакуации');
      const existing = await this.db.one('select id from orders where continuation_of=$1 and status<>$2', [previous.id, 'cancelled']);
      if (existing) throw conflict('continuation_exists', 'Следующий этап этого обращения уже оформлен');
      if (previous.vehicle_id && i.vehicleId && previous.vehicle_id !== i.vehicleId)
        throw bad('different_vehicle', 'Продолжение относится к тому же грузовику');
      i = { ...i, isSos: true, vehicleId: previous.vehicle_id ?? i.vehicleId,
        brand: previous.brand ?? i.brand, model: previous.model ?? i.model, year: previous.year ?? i.year,
        address: i.address || previous.address, lat: i.lat ?? previous.lat, lng: i.lng ?? previous.lng,
        description: i.description || previous.description || 'Эвакуация после выездного ремонта' };
    }
    let brand = i.brand ?? null;
    let model = i.model ?? null;
    let year = i.year ?? null;
    if (i.vehicleId) {
      const v = await this.db.one<{ brand: string; model: string | null; year: number | null; driver_id: string | null }>(
        'select brand, model, year, driver_id from vehicles where id=$1 and owner_id=$2', [i.vehicleId, clientId]);
      if (!v) throw bad('bad_vehicle', 'Машина не найдена в гараже');
      if (user.owner_id && v.driver_id !== user.id) throw forbidden('Эта машина закреплена за другим водителем');
      brand = brand ?? v.brand;
      model = model ?? v.model;
      year = year ?? v.year;
    }
    const isConsult = i.service === 'consult';
    const night = isConsult ? false : i.night ?? isNight(all.pricing, this.now());
    const tier = i.tier ?? 'eco';
    const est = estimate(all.pricing, { service: i.service, tier, zoneId: i.zoneId, night, group: !isConsult && !!i.groupTrip });
    const defaultFee = method === 'cash' ? (all.fees.cashChargesClientFee ? all.fees.clientFeePct : 0) : all.fees.clientFeePct;
    // Персональный сбор клиента (назначает администратор) важнее общего. Консультация — фиксированная цена, сбор уже внутри.
    const personal = await this.db.one<{ fee_pct_override: string | null }>('select fee_pct_override from users where id=$1', [clientId]);
    const feePct = isConsult ? 0 : personal?.fee_pct_override != null ? Number(personal.fee_pct_override) : defaultFee;

    // Выезд после консультации: та же машина, подсказка мастера, скидка — если уложились в срок и скидку ещё не брали
    let consultOf: string | null = null;
    let discount = 0;
    if (i.fromConsult && !isConsult) {
      const c = await this.db.one<any>(`select * from orders where id=$1 and service='consult' and (client_id=$2 or created_by=$3)`, [i.fromConsult, clientId, user.id]);
      if (!c) throw bad('bad_consult', 'Консультация не найдена');
      consultOf = c.id;
      const used = await this.db.one('select 1 from orders where consult_of=$1 and discount_reason=$2 and status<>$3', [c.id, CONSULT_DISCOUNT, 'cancelled']);
      const ref = c.completed_at ?? c.accepted_at;
      const fresh = ref && this.now().getTime() - new Date(ref).getTime() <= all.pricing.consult.backHours * 3600_000;
      if (fresh && !used && ['completed', 'awaiting_confirmation'].includes(c.status)) discount = all.pricing.consult.backDiscount;
      brand = brand ?? c.brand;
      model = model ?? c.model;
      year = year ?? c.year;
    }

    // Record the commission campaign on creation. Never recalculate an existing order.
    const campaign = this.ops ? await this.ops.commissionFor(i.service, this.now()) : null;

    // Водитель парка: что ему можно и до какой суммы. SOS — всегда, без подтверждения.
    const gate = user.owner_id && !i.isSos ? await this.fleetGate(user, i.service, est.callOut) : null;
    const order = await this.db.one(
      `insert into orders(client_id, created_by, vehicle_id, service, is_sos, problem, description, address, lat, lng,
          zone_id, night, group_trip, tier, brand, estimate, payment_method, client_fee_pct, destination, cargo, loaded, driver_on_site,
          consult_of, discount_amount, discount_reason, model, year, site, status, owner_note,
          commission_pct_override, commission_campaign_id, case_root_id, continuation_of)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34) returning *`,
      [clientId, user.id, i.vehicleId ?? null, i.service, !!i.isSos, i.problem ?? null, i.description ?? null, isConsult ? null : i.address ?? null,
        isConsult ? null : i.lat ?? null, isConsult ? null : i.lng ?? null, est.zoneId, night, est.group, tier, brand, est, method, feePct,
        i.destination ?? null, i.cargo ?? null, i.loaded ?? null, i.driverOnSite ?? null,
        consultOf, discount, discount ? CONSULT_DISCOUNT : null, model, year, isConsult ? null : i.site ?? null,
        gate ? 'awaiting_owner' : 'searching', gate, campaign?.commission_pct ?? null, campaign?.id ?? null,
        previous ? (previous.case_root_id ?? previous.id) : null, previous?.id ?? null],
    ).catch((e: any) => {
      if (e?.code === '23505' && e?.constraint === 'orders_one_live_continuation_idx')
        throw conflict('continuation_exists', 'Этап уже оформлен: откройте его из обращения');
      throw e;
    });
    await this.event(this.db, order!.id, user.id, 'created', { estimate: est, sos: !!i.isSos, continuationOf: previous?.id ?? null });

    if (gate) {
      await this.event(this.db, order!.id, user.id, 'owner_approval_requested', { reason: gate });
      await this.notifier.notify([clientId], { type: 'order', orderId: order!.id, status: 'awaiting_owner' },
        { kind: 'normal', title: 'Водитель просит подтвердить заказ', body: `${SERVICE_TITLE[i.service] ?? i.service} · ${(est.callOut / 100).toLocaleString('ru-RU')} ₽ — ${gate}`, data: { orderId: order!.id } });
      return { order: await this.view(user, order!.id), confirmationUrl: null };
    }
    return this.launch(user, order);
  }

  /** Заявка пошла в работу: оплата (холд) и вызов исполнителей */
  async launch(user: AuthUser, order: any) {
    const pay = await this.payments.onCreated(order);
    if (!pay.holdRequired) await this.startDispatch(order!.id);
    return { order: await this.view(user, order!.id), confirmationUrl: pay.confirmationUrl ?? null };
  }

  /** null — можно сразу; строка — почему нужно подтверждение владельца; запрещено — ошибка */
  async fleetGate(user: AuthUser, service: string, amount: number): Promise<string | null> {
    const owner = await this.db.one<{ fleet: any }>('select fleet from users where id=$1', [user.owner_id]);
    const f = owner?.fleet ?? {};
    const kind = service === 'consult' ? 'consult' : service === 'tow' ? 'tow' : 'repair';
    if (f.allow?.[kind] === false) throw forbidden(kind === 'tow' ? 'Владелец не разрешил вызывать эвакуатор — только SOS' : kind === 'consult' ? 'Владелец не разрешил консультации' : 'Владелец не разрешил вызывать мастера — только SOS');
    if (f.mode === 'approve') return 'всё через владельца';
    if (f.perOrder != null && amount > f.perOrder) return `дороже лимита на заказ ${(f.perOrder / 100).toLocaleString('ru-RU')} ₽`;
    if (f.perMonth != null) {
      const spent = await this.monthSpent(user.id);
      if (spent + amount > f.perMonth) return `сверх лимита на месяц ${(f.perMonth / 100).toLocaleString('ru-RU')} ₽`;
    }
    return null;
  }

  async monthSpent(driverId: string) {
    const r = await this.db.one<{ s: number }>(
      `select coalesce(sum(coalesce(call_out_amount, (estimate->>'callOut')::int, 0) + coalesce(work_amount, 0)), 0)::int as s from orders
        where created_by=$1 and status not in ('cancelled','no_performer','awaiting_owner')
          and created_at >= date_trunc('month', now() at time zone 'Europe/Moscow') at time zone 'Europe/Moscow'`, [driverId]);
    return r?.s ?? 0;
  }

  /** Владелец: подтвердить заказ водителя или отказать */
  async ownerDecision(owner: AuthUser, orderId: string, approve: boolean, reason?: string) {
    const o = await this.db.one('select * from orders where id=$1 and client_id=$2', [orderId, owner.id]);
    if (!o) throw notFound('Заявка не найдена');
    if (o.status !== 'awaiting_owner') throw conflict('bad_status', 'Заявка уже не ждёт подтверждения');
    if (!approve) {
      const why = reason?.trim() || 'Владелец отклонил заказ';
      await this.db.query(`update orders set status='cancelled', cancel_reason=$2, cancelled_at=now() where id=$1 and status='awaiting_owner'`, [orderId, why]);
      await this.event(this.db, orderId, owner.id, 'owner_rejected', { reason: why });
      await this.systemMessage(orderId, `Владелец отклонил заказ: ${why}`);
      await this.notifier.notify([o.created_by], { type: 'order', orderId, status: 'cancelled' },
        { kind: 'normal', title: 'Владелец отклонил заказ', body: why, data: { orderId } });
      return this.view(owner, orderId);
    }
    const upd = await this.db.one(`update orders set status='searching' where id=$1 and status='awaiting_owner' returning *`, [orderId]);
    if (!upd) throw conflict('bad_status', 'Заявка уже не ждёт подтверждения');
    await this.event(this.db, orderId, owner.id, 'owner_approved', {});
    await this.notifier.notify([o.created_by], { type: 'order', orderId, status: 'searching' },
      { kind: 'normal', title: 'Владелец подтвердил заказ', body: 'Ищем исполнителя', data: { orderId } });
    await this.launch(owner, upd);
    return this.view(owner, orderId);
  }

  // Очередь вызова ---------------------------------------------------------

  /** Шаг 1: звоним приоритетным (вы с отцом). Нет таких или не взяли — шаг 2, общие торги. */
  async startDispatch(orderId: string, exclude: string[] = []) {
    const all = await this.settings.all();
    const order = await this.db.one('select * from orders where id=$1', [orderId]);
    if (!order || order.status !== 'searching') return;
    if (!all.dispatch.priorityFirst) return this.auction.start(orderId, exclude);
    const kind = performerKindFor(order.service);
    const list = await this.db.query<Candidate>(
      `select p.user_id, p.kind, p.specialties, p.brands, p.is_priority, p.paused, p.line_status, p.verification,
              p.lat, p.lng, u.rating, p.accepts_group, u.status as user_status, p.schedule, p.off_schedule_until, p.extras,
              (select coalesce(-sum(amount),0)::int from ledger_entries l
                where l.performer_id = p.user_id and l.kind in ('cash_commission','cash_commission_paid')) as cash_debt
         from performer_profiles p join users u on u.id = p.user_id
        where p.kind = $1 and p.user_id <> $2 and p.is_priority
          and not exists (select 1 from orders x where x.performer_id=p.user_id and x.status in ('accepted','en_route','arrived','working','awaiting_confirmation') and not (x.service='consult' and x.status='awaiting_confirmation'))`,
      [kind, order.client_id],
    );
    const already = await this.db.query<{ performer_id: string }>('select performer_id from order_dispatch where order_id=$1', [orderId]);
    const ranked = rankCandidates(order as any, list, {
      radiusKm: all.dispatch.radiusKm,
      maxCandidates: all.dispatch.maxCandidates,
      cashDebtLimit: all.fees.cashDebtLimit, now: this.now(),
      exclude: new Set([...exclude, ...already.map((a) => a.performer_id), order.created_by, ...(await this.blockedBy(order.client_id))]),
    });
    if (!ranked.length) return this.auction.start(orderId, exclude);
    const base = already.length;
    for (const [i, r] of ranked.entries()) {
      await this.enlist(r.user_id,
        `insert into order_dispatch(order_id, performer_id, rank, distance_km) values ($1,$2,$3,$4) on conflict do nothing`,
        [orderId, r.user_id, base + i, r.distanceKm]);
    }
    await this.db.query('update orders set dispatch_started_at = coalesce(dispatch_started_at, now()) where id=$1', [orderId]);
    await this.event(this.db, orderId, null, 'dispatch_started', { candidates: ranked.length });
    await this.ringNext(orderId);
  }

  /** Звоним следующему приоритетному; очередь кончилась — общие торги */
  async ringNext(orderId: string) {
    const all = await this.settings.all();
    const order = await this.db.one('select * from orders where id=$1', [orderId]);
    if (!order || order.status !== 'searching') return;
    if (order.auction_until) return; // уже на торгах — звонков приоритетным больше нет
    const parallel = order.is_sos ? all.dispatch.parallelSos : all.dispatch.parallel;
    const ringing = await this.db.one<{ c: number }>(`select count(*)::int c from order_dispatch where order_id=$1 and status='ringing'`, [orderId]);
    const free = parallel - (ringing?.c ?? 0);
    if (free <= 0) return;
    const until = new Date(this.now().getTime() + all.dispatch.ringSeconds * 1000);
    const next = await this.db.query<{ id: string; performer_id: string; distance_km: number | null }>(
      `update order_dispatch set status='ringing', ring_until=$2, sent_at=$3
        where id in (select d.id from order_dispatch d where d.order_id=$1 and d.status='queued'
                       and not exists (select 1 from orders x where x.performer_id=d.performer_id and x.status in ('accepted','en_route','arrived','working','awaiting_confirmation') and not (x.service='consult' and x.status='awaiting_confirmation'))
                     order by d.rank limit $4)
        returning id, performer_id, distance_km`,
      [orderId, until, this.now(), free],
    );
    if (!next.length && (ringing?.c ?? 0) === 0) return this.auction.start(orderId);
    const est = order.estimate;
    for (const n of next) {
      await this.event(this.db, orderId, null, 'ringing', { performerId: n.performer_id });
      await this.notifier.notify([n.performer_id], {
        type: 'incoming_call', orderId, number: order.number, service: order.service, sos: order.is_sos, problem: order.problem,
        address: order.address, zone: est.zoneName, distanceKm: n.distance_km, brand: order.brand, callOut: est.callOut,
        ringUntil: until.toISOString(),
      }, {
        kind: 'call',
        title: order.service === 'consult' ? 'Консультация по телефону' : order.is_sos ? `SOS · ${est.zoneName}` : `Заявка · ${est.zoneName}`,
        body: `${order.brand ?? 'Грузовик'} · ${order.description ?? order.problem ?? ''} · ${order.service === 'consult' ? 'консультация' : 'выезд'} ${rub(est.callOut)}`.trim(),
        data: { orderId, ringUntil: until.toISOString() },
        ttlSeconds: all.dispatch.ringSeconds,
      });
    }
  }

  /** Раз в пару секунд: истёкшие вызовы → пропущенные, звоним следующему */
  async tick() {
    const all = await this.settings.all();
    const missed = await this.db.query<{ order_id: string; performer_id: string }>(
      `update order_dispatch set status='missed', responded_at=$1 where status='ringing' and ring_until < $1 returning order_id, performer_id`,
      [this.now()],
    );
    for (const m of missed) {
      const p = await this.db.one<{ missed_in_row: number }>(
        'update performer_profiles set missed_in_row = missed_in_row + 1 where user_id=$1 returning missed_in_row', [m.performer_id]);
      this.notifier.live([m.performer_id], { type: 'call_missed', orderId: m.order_id });
      if (p && p.missed_in_row >= all.dispatch.missedToOffline) {
        await this.db.query(`update performer_profiles set line_status='offline' where user_id=$1`, [m.performer_id]);
        await this.afterRelease(await this.release(this.db, m.performer_id, null));
        await this.notifier.notify([m.performer_id], { type: 'line_status', lineStatus: 'offline' },
          { kind: 'normal', title: 'Вы не на линии', body: `Пропущено ${p.missed_in_row} вызова подряд — заявки пока не приходят. Вернуться — одной кнопкой.`, data: {} });
      }
    }
    for (const orderId of new Set(missed.map((m) => m.order_id))) await this.ringNext(orderId);
    await this.autoCloseConsults(all.pricing.consult.autoCloseHours);
    await this.applyLineTimers();
    return missed.length;
  }

  /**
   * Перерыв кончился — снова «Свободен». Рабочее время по графику кончилось — «Не на линии»,
   * и звонков нет, пока исполнитель сам не выйдет на линию.
   */
  private async applyLineTimers() {
    const back = await this.db.query<{ user_id: string }>(
      `update performer_profiles set line_status='online', busy_until=null where line_status='busy' and busy_until <= $1 returning user_id`, [this.now()]);
    for (const b of back) this.notifier.live([b.user_id], { type: 'line_status', lineStatus: 'online' });
    const scheduled = await this.db.query<{ user_id: string; schedule: any; off_schedule_until: string | null; line_status: string }>(
      `select user_id, schedule, off_schedule_until, line_status from performer_profiles
        where (schedule->>'on')::boolean and line_status in ('online','on_call')`);
    for (const p of scheduled) {
      if (slot(p.schedule, this.now(), p.off_schedule_until) !== 'off') continue;
      await this.db.query(`update performer_profiles set line_status='offline', off_schedule_until=null where user_id=$1 and line_status in ('online','on_call')`, [p.user_id]);
      await this.afterRelease(await this.release(this.db, p.user_id, null));
      await this.notifier.notify([p.user_id], { type: 'line_status', lineStatus: 'offline' },
        { kind: 'normal', title: 'Рабочее время закончилось', body: 'Вы не на линии — заявки не приходят. Нужно поработать ещё — выйдите на линию вручную.', data: {} });
    }
  }

  /** Консультация, которую клиент не подтвердил за сутки, закрывается сама — как «Вопрос решён» */
  private async autoCloseConsults(hours: number) {
    const due = await this.db.query<{ id: string; client_id: string }>(
      `select id, client_id from orders where service='consult' and status='awaiting_confirmation' and amount_proposed_at < $1 limit 20`,
      [new Date(this.now().getTime() - hours * 3600_000)]);
    for (const o of due) {
      try {
        await this.confirmAmount({ id: o.client_id, roles: ['client'], owner_id: null } as unknown as AuthUser, o.id);
      } catch { /* состояние уже поменялось — пропускаем */ }
    }
  }

  async accept(user: AuthUser, orderId: string) {
    const res = await this.db.tx(async (q) => {
      await q.query('select 1 from performer_profiles where user_id=$1 for update', [user.id]);
      const d = await q.one(
        `update order_dispatch set status='accepted', responded_at=$3
          where order_id=$1 and performer_id=$2 and status='ringing' and ring_until >= $3 returning *`,
        [orderId, user.id, this.now()],
      );
      if (!d) throw conflict('too_late', 'Заявку уже забрали или время вышло');
      const o = await q.one(
        `update orders set status='accepted', performer_id=$2, accepted_at=$3,
            call_out_amount = (estimate->>'callOut')::int
          where id=$1 and status='searching' returning *`,
        [orderId, user.id, this.now()],
      );
      if (!o) throw conflict('too_late', 'Заявку уже забрали');
      if (await this.busyWith(q, user.id, orderId)) throw conflict('busy', 'Сначала закройте текущую заявку');
      await q.query(`update order_dispatch set status='cancelled' where order_id=$1 and status in ('queued','ringing')`, [orderId]);
      await q.query(`update performer_profiles set line_status='on_job', missed_in_row=0 where user_id=$1`, [user.id]);
      await this.event(q, orderId, user.id, 'accepted', {});
      const others = await q.query<{ performer_id: string }>(
        `select performer_id from order_dispatch where order_id=$1 and status='cancelled' and performer_id<>$2`, [orderId, user.id]);
      return Object.assign(o, { _others: others.map((x) => x.performer_id), _released: await this.release(q, user.id, orderId) });
    });
    await this.afterRelease((res as any)._released);
    // Остальным приоритетным, кому звонила эта заявка, — закрыть вызов
    this.notifier.live((res as any)._others, { type: 'order', orderId, status: 'released' });
    const name = user.name ?? 'Исполнитель';
    await this.notifier.notify([res.client_id, res.created_by], { type: 'order', orderId, status: 'accepted' },
      { kind: 'normal', title: 'Заявку приняли', body: `${name} принял заявку №${res.number}`, data: { orderId } });
    await this.systemMessage(orderId, `${name} принял заявку. Чат открыт для всех участников.`);
    return this.view(user, orderId);
  }

  async decline(user: AuthUser, orderId: string) {
    const d = await this.db.one(
      `update order_dispatch set status='declined', responded_at=$3 where order_id=$1 and performer_id=$2 and status='ringing' returning id`,
      [orderId, user.id, this.now()],
    );
    if (!d) throw conflict('not_ringing', 'Вызов уже неактивен');
    await this.ringNext(orderId);
    return { ok: true };
  }

  async incoming(user: AuthUser) {
    return this.db.query(
      `select d.order_id, d.ring_until, d.distance_km, o.number, o.service, o.is_sos, o.problem, o.description, o.address,
              o.brand, o.estimate, o.night, o.group_trip
         from order_dispatch d join orders o on o.id = d.order_id
        where d.performer_id=$1 and d.status='ringing' and d.ring_until >= $2 order by d.sent_at`,
      [user.id, this.now()],
    );
  }

  /** Исполнитель отказался после принятия — заявка снова в поиск, без него */
  async drop(user: AuthUser, orderId: string, reason: string) {
    const o = await this.db.one(`select * from orders where id=$1`, [orderId]);
    if (!o) throw notFound();
    if (o.performer_id !== user.id) throw forbidden();
    if (!['accepted', 'en_route'].includes(o.status)) throw conflict('bad_status', 'На месте отказаться уже нельзя — закройте выезд с итогом');
    await this.db.tx(async (q) => {
      await this.guarded(q,
        `update orders set status='searching', performer_id=null, accepted_at=null, en_route_at=null, call_out_amount=null, auction_until=null
          where id=$1 and status=$2 and performer_id=$3`, [orderId, o.status, user.id]);
      await q.query(`update bids set status='withdrawn' where order_id=$1 and status in ('active','chosen','lost')`, [orderId]);
      await q.query(`delete from order_dispatch where order_id=$1 and performer_id<>$2`, [orderId, user.id]);
      await q.query(`update order_dispatch set status='declined' where order_id=$1 and performer_id=$2`, [orderId, user.id]);
      await q.query(`update performer_profiles set line_status='online' where user_id=$1 and line_status='on_job'`, [user.id]);
      await this.event(q, orderId, user.id, 'performer_dropped', { reason });
    });
    await this.systemMessage(orderId, 'Исполнитель отказался от заявки. Ищем другого.');
    await this.notifier.notify([o.client_id, o.created_by], { type: 'order', orderId, status: 'searching' },
      { kind: 'normal', title: 'Ищем другого исполнителя', body: `Исполнитель отказался от заявки №${o.number}. Уже ищем замену.`, data: { orderId } });
    await this.startDispatch(orderId, [user.id]);
    return this.view(user, orderId);
  }

  // Статусы ----------------------------------------------------------------

  async performerStep(user: AuthUser, orderId: string, action: 'depart' | 'arrive' | 'start_work') {
    const o = await this.mustBePerformer(user, orderId);
    if (o.service === 'consult') throw bad('consult_no_trip', 'Это консультация по телефону — выезда нет. Закройте её с подсказкой.');
    const to = transition(o.status, action, 'performer');
    const col = { depart: 'en_route_at', arrive: 'arrived_at', start_work: 'work_started_at' }[action];
    await this.guarded(this.db, `update orders set status=$2${col ? `, ${col}=$5` : ''} where id=$1 and status=$3 and performer_id=$4`,
      col ? [orderId, to, o.status, user.id, this.now()] : [orderId, to, o.status, user.id]);
    await this.event(this.db, orderId, user.id, action, {});
    const text = { depart: 'Исполнитель выехал', arrive: 'Исполнитель на месте', start_work: 'Исполнитель начал работу' }[action];
    await this.systemMessage(orderId, text);
    await this.notifier.notify([o.client_id, o.created_by], { type: 'order', orderId, status: to },
      { kind: 'normal', title: text, body: `Заявка №${o.number}`, data: { orderId } });
    return this.view(user, orderId);
  }

  /** Разбивка суммы за работу на этот момент: время с отметки «на месте» × цена часа, ожидание, расходники.
   *  Пока заявка на подтверждении — время заморожено на моменте, когда мастер отправил сумму. */
  async billFor(o: any, extras: Extra[], at = this.now()) {
    const all = await this.settings.all();
    // Клиент спорит только с расходниками — время уже отработано и не пересчитывается
    const frozen = (o.status === 'awaiting_confirmation' || o.bill?.disputed) && o.bill?.end ? new Date(o.bill.end) : null;
    const end = frozen ?? at;
    let waitMinutes = Number(o.wait_minutes ?? 0);
    if (o.wait_started_at && !frozen) waitMinutes += Math.max(1, Math.round((end.getTime() - new Date(o.wait_started_at).getTime()) / 60_000));
    const p = o.performer_id ? await this.db.one<{ extras: any }>('select extras from performer_profiles where user_id=$1', [o.performer_id]) : null;
    // Время идёт с отметки «Я на месте» — так договорились до вызова; «Начал работу» на сумму не влияет
    const from = o.arrived_at ?? o.work_started_at;
    const workMinutes = from ? Math.max(0, Math.floor((end.getTime() - new Date(from).getTime()) / 60_000)) : null;
    const bill = billWork({
      hour: o.service === 'tow' ? null : o.estimate?.hour ?? null, step: Number(all.pricing.billingStepMinutes ?? 60),
      workMinutes, waitMinutes, waitRate: p?.extras?.waitRate ?? null, extras,
    });
    return { ...bill, end: end.toISOString() };
  }

  /** Мастер закрывает выезд. Сумму за работу он не вводит: она идёт по таймеру и цене часа, о которой договорились заранее.
   *  Сверху — только расходники и запчасти отдельными строками, клиент видит каждую. */
  async proposeAmount(user: AuthUser, orderId: string, p: { extras?: Extra[]; result?: 'solved' | 'cause_found' | 'not_found'; note?: string }) {
    const o = await this.mustBePerformer(user, orderId);
    if (o.service === 'consult') throw bad('consult_fixed', 'Цена консультации фиксированная. Закройте её с подсказкой.');
    const to = transition(o.status, 'propose_amount', 'performer');
    if (['cause_found', 'not_found'].includes(p.result ?? '') && (p.note?.trim().length ?? 0) < 10)
      throw bad('result_reason_required', 'Напишите, почему неисправность нельзя устранить на месте (не меньше 10 символов)');
    const extras = (p.extras ?? []).map((x) => ({ name: x.name.trim(), amount: x.amount })).filter((x) => x.name && x.amount > 0);
    if (extras.some((x) => !Number.isInteger(x.amount))) throw bad('bad_amount', 'Сумма — целое число копеек');
    const bill = await this.billFor(o, extras);
    await this.guarded(this.db,
      `update orders set status=$2, work_amount=$3, bill=$9, amount_proposed_at=$6, amount_confirmed_at=null,
         wait_minutes=$10, wait_started_at=null,
         result=coalesce($4,result), result_note=coalesce($5,result_note) where id=$1 and status=$7 and performer_id=$8`,
      [orderId, to, bill.total, p.result ?? null, p.note ?? null, this.now(), o.status, user.id, bill, bill.waitMinutes],
    );
    const m = this.money({ ...o, work_amount: bill.total });
    await this.event(this.db, orderId, user.id, 'amount_proposed', { workAmount: bill.total, total: m.total, result: p.result, bill });
    const parts = [
      bill.units ? `работа ${hoursText(bill.units, bill.step)} × ${rub(bill.hour!)}/ч = ${rub(bill.time)}` : null,
      bill.wait ? `ожидание ${bill.waitMinutes} мин ${rub(bill.wait)}` : null,
      ...bill.extras.map((x) => `${x.name} ${rub(x.amount)}`),
    ].filter(Boolean).join(', ');
    await this.systemMessage(orderId, `Исполнитель закрыл выезд: выезд ${rub(m.callOut)}${parts ? `, ${parts}` : ''}${m.clientFee ? ` + сбор ${rub(m.clientFee)}` : ''} = ${rub(m.total)}. Подтвердите в заявке.`);
    await this.notifier.notify([o.client_id, o.created_by], { type: 'order', orderId, status: to },
      { kind: 'normal', title: 'Подтвердите сумму', body: `Заявка №${o.number}: ${rub(m.total)}`, data: { orderId } });
    return this.view(user, orderId);
  }

  /** Мастер закрывает консультацию: подсказка обязательна — она перейдёт следующему мастеру, если понадобится выезд */
  async finishConsult(user: AuthUser, orderId: string, h: ConsultHint) {
    const o = await this.mustBePerformer(user, orderId);
    if (o.service !== 'consult') throw bad('not_consult', 'Это не консультация');
    const to = transition(o.status, 'finish_consult', 'performer');
    if (!h.hints.length) throw bad('need_hint', 'Отметьте хотя бы одно подозрение — без него консультацию не закрыть');
    await this.guarded(this.db,
      `update orders set status=$2, work_amount=0, amount_proposed_at=$3, result='consult', consult_hint=$4 where id=$1 and status=$5 and performer_id=$6`,
      [orderId, to, this.now(), h, o.status, user.id]);
    // Разговор окончен — мастер снова свободен, пока клиент нажимает «Вопрос решён»
    await this.db.query(`update performer_profiles set line_status='online' where user_id=$1 and line_status='on_job'`, [user.id]);
    await this.event(this.db, orderId, user.id, 'consult_finished', h);
    const m = this.money(o);
    await this.systemMessage(orderId, `Мастер завершил консультацию. Подозрение: ${h.hints.join(', ')}${h.note ? ` — ${h.note}` : ''}. ` +
      `Нажмите «Вопрос решён» (${rub(m.total)}) или «Нужен выезд» — подсказка перейдёт мастеру на выезде.`);
    await this.notifier.notify([o.client_id, o.created_by], { type: 'order', orderId, status: to },
      { kind: 'normal', title: 'Консультация завершена', body: `Подозрение: ${h.hints.join(', ')}`, data: { orderId } });
    return this.view(user, orderId);
  }

  async confirmAmount(user: AuthUser, orderId: string, expectedTotal?: number, points = 0) {
    const o = await this.mustBeClient(user, orderId);
    const to = transition(o.status, 'confirm_amount', 'client');
    const m = this.money(o);
    let used = 0;
    if (expectedTotal != null && expectedTotal !== m.total) throw conflict('amount_changed', 'Сумма изменилась — проверьте заново');
    await this.db.tx(async (q) => {
      // Бонусы клиента списываются сами в момент подтверждения
      const bonus = await q.one<{ b: number }>('select coalesce(sum(amount),0)::int b from bonus_entries where user_id=$1', [o.client_id]);
      const use = Math.min(bonus?.b ?? 0, m.total);
      if (use > 0) {
        await q.query('update orders set discount_amount = discount_amount + $2, discount_reason = coalesce(discount_reason, $3) where id=$1', [orderId, use, 'Бонусы']);
        await q.query(`insert into bonus_entries(user_id, amount, kind, order_id, note) values ($1,$2,'use',$3,'Списано за заявку')`, [o.client_id, -use, orderId]);
      }
      used = use;
      // Баллы — по выбору клиента: сколько вписал, но не больше половины сервисного сбора и остатка
      const pts = this.referral ? await this.referral.spendClientFee(q, o, m.clientFee, points) : 0;
      used += pts;
      // Подтверждаем ровно ту сумму, что видел клиент: если мастер успел её поменять — конфликт
      await this.guarded(q, `update orders set status=$2, amount_confirmed_at=$3, completed_at=$3
          where id=$1 and status='awaiting_confirmation' and work_amount is not distinct from $4 and performer_id=$5`,
        [orderId, to, this.now(), o.work_amount, o.performer_id]);
      await q.query(`update performer_profiles set line_status='online' where user_id=$1 and line_status='on_job'`, [o.performer_id]);
      await this.event(q, orderId, user.id, 'amount_confirmed', { total: m.total, method: o.payment_method });
      await this.payments.onConfirmed({ ...o, status: to, discount_amount: Number(o.discount_amount ?? 0) + used }, q);
      await this.referral?.afterOrder(q, { ...o, status: to }, m.amount);
    });
    await this.systemMessage(orderId, `Сумма ${rub(m.total - used)} подтверждена${used ? ` (бонусами и баллами ${rub(used)})` : ''}. Оставьте отзыв друг о друге.`);
    await this.notifier.notify([o.performer_id], { type: 'order', orderId, status: to },
      { kind: 'normal', title: 'Сумма подтверждена', body: `Заявка №${o.number}: ${rub(m.total)}`, data: { orderId } });
    return this.view(user, orderId);
  }

  async disputeAmount(user: AuthUser, orderId: string, reason: string) {
    const o = await this.mustBeClient(user, orderId);
    const to = transition(o.status, 'dispute_amount', 'client');
    await this.guarded(this.db, `update orders set status=$2, bill = case when bill is null then null else bill || '{"disputed":true}'::jsonb end
        where id=$1 and status='awaiting_confirmation'`, [orderId, to]);
    await this.event(this.db, orderId, user.id, 'amount_disputed', { reason });
    await this.systemMessage(orderId, `Клиент не согласен с расходниками: ${reason}. Время работы не меняется — исправьте строки расходников или позовите поддержку.`);
    await this.onDispute?.({ userId: user.id, orderId, text: reason, targetId: o.performer_id, title: `Не согласен с суммой по заявке №${o.number}` });
    await this.notifier.notify([o.performer_id], { type: 'order', orderId, status: to },
      { kind: 'normal', title: 'Клиент не согласен с суммой', body: reason, data: { orderId } });
    return this.view(user, orderId);
  }

  async cancel(user: AuthUser, orderId: string, reason: string) {
    const o = await this.db.one('select * from orders where id=$1', [orderId]);
    if (!o) throw notFound();
    const actor = this.actorOf(user, o);
    if (actor === 'performer') throw bad('use_drop', 'Исполнитель отказывается от заявки кнопкой «Не смогу приехать»');
    if (!actor) throw forbidden();
    transition(o.status, 'cancel', actor);
    let leftKm: number | null = null;
    if (o.status === 'en_route' && o.lat != null) {
      const p = await this.db.one('select lat, lng from performer_profiles where user_id=$1', [o.performer_id]);
      if (p?.lat != null) leftKm = haversineKm({ lat: o.lat, lng: o.lng }, { lat: p.lat, lng: p.lng });
    }
    const d = o.performer_id
      ? await this.db.one<{ distance_km: number | null }>('select distance_km from order_dispatch where order_id=$1 and performer_id=$2', [orderId, o.performer_id])
      : null;
    const stage = cancelStage(o.status, { startKm: d?.distance_km ?? null, leftKm });
    const scale = (await this.settings.get('cancel')).scale;
    const m = this.money(o);
    const splitInfo = cancelSplit(scale, stage, m.callOut, pct(m.callOut, Number(o.client_fee_pct)));
    const invited = (await this.db.query<{ performer_id: string }>(
      `select performer_id from order_dispatch where order_id=$1 and status in ('queued','ringing','bidding')`, [orderId])).map((x) => x.performer_id);
    await this.db.tx(async (q) => {
      await this.guarded(q, `update orders set status='cancelled', cancelled_at=$5, cancelled_by=$2, cancel_reason=$3, cancel_stage=$4
          where id=$1 and status=$6 and performer_id is not distinct from $7`,
        [orderId, user.id, reason, stage, this.now(), o.status, o.performer_id]);
      await q.query(`update order_dispatch set status='cancelled' where order_id=$1 and status in ('queued','ringing','bidding')`, [orderId]);
      await q.query(`update bids set status='withdrawn' where order_id=$1 and status='active'`, [orderId]);
      if (o.performer_id) await q.query(`update performer_profiles set line_status='online' where user_id=$1 and line_status='on_job'`, [o.performer_id]);
      await this.event(q, orderId, user.id, 'cancelled', { reason, stage, ...splitInfo });
      await this.payments.onCancelled({ ...o, status: 'cancelled' }, stage, q);
    });
    this.notifier.live(invited, { type: 'order', orderId, status: 'cancelled' });
    await this.systemMessage(orderId, `Заявка отменена: ${reason}`);
    await this.notifier.notify([o.client_id, o.created_by, o.performer_id].filter((x) => x !== user.id), { type: 'order', orderId, status: 'cancelled' },
      { kind: 'normal', title: 'Заявка отменена', body: `№${o.number}: ${reason}`, data: { orderId } });
    return this.view(user, orderId);
  }

  async retry(user: AuthUser, orderId: string) {
    const o = await this.mustBeClient(user, orderId);
    transition(o.status, 'retry', 'client');
    await this.guarded(this.db, `update orders set status='searching', auction_until=null where id=$1 and status='no_performer'`, [orderId]);
    await this.db.query(`delete from order_dispatch where order_id=$1`, [orderId]);
    await this.db.query(`update bids set status='withdrawn' where order_id=$1 and status='active'`, [orderId]);
    await this.event(this.db, orderId, user.id, 'retry', {});
    await this.startDispatch(orderId);
    return this.view(user, orderId);
  }

  /** Сколько с кого: выезд + работа + сбор */
  money(o: any) {
    const callOut: number = o.call_out_amount ?? o.estimate?.callOut ?? 0;
    const work: number = o.work_amount ?? 0;
    const amount = callOut + work;
    const clientFee = pct(amount, Number(o.client_fee_pct ?? 0));
    // Скидка и бонусы — за счёт площадки, не больше суммы заявки
    const discount = Math.min(Number(o.discount_amount ?? 0), amount + clientFee);
    return { callOut, work, amount, clientFee, discount, total: amount + clientFee - discount };
  }

  // Просмотр ---------------------------------------------------------------

  actorOf(user: AuthUser, o: any): Actor | null {
    if (user.roles.includes('admin') || user.roles.includes('moderator')) return 'admin';
    if (o.client_id === user.id || o.created_by === user.id) return 'client';
    if (o.performer_id === user.id) return 'performer';
    return null;
  }

  async participants(orderId: string) {
    const o = await this.db.one('select client_id, created_by, performer_id from orders where id=$1', [orderId]);
    return o ? [o.client_id, o.created_by, o.performer_id].filter(Boolean) as string[] : [];
  }

  async mustSee(user: AuthUser, orderId: string) {
    const o = await this.db.one('select * from orders where id=$1', [orderId]);
    if (!o) throw notFound('Заявка не найдена');
    if (this.actorOf(user, o)) return o;
    // Исполнитель, которому сейчас «звонит» заявка, видит её без контактов
    const ringing = await this.db.one(`select 1 from order_dispatch where order_id=$1 and performer_id=$2 and status in ('ringing','bidding')`, [orderId, user.id]);
    if (ringing) return o;
    throw forbidden();
  }

  async view(user: AuthUser, orderId: string) {
    const o = await this.mustSee(user, orderId);
    const actor = this.actorOf(user, o);
    const performer = o.performer_id
      ? await this.db.one(
          `select u.id, u.name, u.rating::float as rating, u.rating_count, p.car, p.kind, p.lat, p.lng, p.location_at, (p.extras->>'waitRate')::int as wait_rate
             from users u left join performer_profiles p on p.user_id=u.id where u.id=$1`, [o.performer_id])
      : null;
    const client = actor === 'performer' || actor === 'admin'
      ? await this.db.one(`select id, name, company_name, rating::float as rating, rating_count from users where id=$1`, [o.client_id])
      : null;
    const vehicle = o.vehicle_id ? await this.db.one('select brand, model, year, plate, trailer_plate from vehicles where id=$1', [o.vehicle_id]) : null;
    const events = actor ? await this.db.query('select type, data, actor_id, created_at from order_events where order_id=$1 order by id', [orderId]) : [];
    const caseRootId = o.case_root_id ?? o.id;
    // The combined customer invoice is visible to the customer/admin only:
    // a performer sees exclusively the price of their own contract.
    const caseRows = actor === 'client' || actor === 'admin'
      ? await this.db.query<any>(
          `select id, number, status, service, result, result_note, continuation_of, estimate,
                  call_out_amount, work_amount, client_fee_pct, discount_amount
             from orders where id=$1 or case_root_id=$1 order by created_at, number`, [caseRootId])
      : [];
    const caseBookings = actor === 'client' || actor === 'admin'
      ? await this.db.query<any>(
          `select b.id, b.number, b.status, b.need, b.amount, b.discount, b.from_order_id
             from service_bookings b left join orders step on step.id=b.from_order_id
            where b.case_root_id=$1 or step.id=$1 or step.case_root_id=$1
            order by b.created_at, b.number`, [caseRootId])
      : [];
    const caseServiceStages = caseBookings.map((b: any) => ({
      id: b.id, number: b.number, status: b.status, need: b.need,
      confirmedTotal: b.status === 'closed' ? Math.max(0, Number(b.amount ?? 0) - Number(b.discount ?? 0)) : null,
    }));
    const caseSteps = caseRows.map((step: any) => ({
      id: step.id, number: step.number, service: step.service, status: step.status,
      result: step.result, resultNote: step.result_note, money: this.money(step),
    }));
    const caseConfirmedTotal = caseRows.filter((step: any) => step.status === 'completed')
      .reduce((sum: number, step: any) => sum + this.money(step).total, 0)
      + caseServiceStages.reduce((sum: number, stage: any) => sum + (stage.confirmedTotal ?? 0), 0);
    const search = o.status === 'searching'
      ? await this.db.one<{ candidates: number; offers: number }>(
          `select (select count(*)::int from order_dispatch where order_id=$1 and status in ('bidding','ringing','queued')) as candidates,
                  (select count(*)::int from bids where order_id=$1 and status='active') as offers`, [orderId])
      : null;
    return {
      id: o.id, number: o.number, status: o.status as OrderStatus, statusLabel: statusLabels[o.status as OrderStatus],
      service: o.service, isSos: o.is_sos, problem: o.problem, description: o.description,
      address: o.address, lat: o.lat, lng: o.lng, zoneId: o.zone_id, night: o.night, groupTrip: o.group_trip, tier: o.tier,
      brand: o.brand, model: o.model, year: o.year, vehicleId: o.vehicle_id, vehicle, estimate: o.estimate, paymentMethod: o.payment_method,
      auction: o.status === 'searching' && !!o.auction_until, auctionUntil: o.auction_until, autoPick: o.auto_pick, search,
      limits: o.status === 'searching' ? this.auction.limits(o, (await this.settings.get('dispatch'))) : null,
      destination: o.destination, cargo: o.cargo, loaded: o.loaded, driverOnSite: o.driver_on_site, discountReason: o.discount_reason,
      money: this.money(o), result: o.result, resultNote: o.result_note,
      pointsFee: o.points_fee ?? 0, pointsCommission: actor === 'performer' || actor === 'admin' ? o.points_commission ?? 0 : undefined,
      points: actor === 'client' && o.status === 'awaiting_confirmation' && this.referral ? await this.referral.available(o.client_id, this.money(o).clientFee) : null,
      bill: o.bill ?? null, billingStep: Number((await this.settings.get('pricing')).billingStepMinutes ?? 60),
      site: o.site, workStartedAt: o.work_started_at ?? null, waitRate: performer?.wait_rate ?? null, ownerNote: o.owner_note ?? null, partMode: o.part_mode ?? null, waitStartedAt: o.wait_started_at ?? null, waitMinutes: o.wait_minutes ?? 0,
      consultHint: o.consult_hint, consultOf: o.consult_of,
      continuationOf: o.continuation_of ?? null, caseRootId,
      caseSummary: {
        rootId: caseRootId, stages: caseSteps, serviceBookings: caseServiceStages,
        confirmedTotal: caseConfirmedTotal,
        multiStage: caseSteps.length + caseServiceStages.length > 1,
      },
      canContinueWithTow: actor === 'client' && o.status === 'completed' &&
        o.service !== 'tow' && ['cause_found', 'not_found'].includes(o.result) &&
        !caseRows.some((step: any) => step.continuation_of === o.id && step.status !== 'cancelled'),
      siteFlags: o.site_flags ?? [], lateMinutes: o.late_minutes ?? 0, hintCheck: o.hint_check,
      consultFrom: o.consult_of ? await this.db.one(`select o.number, o.consult_hint as hint, u.name as performer_name from orders o
          left join users u on u.id=o.performer_id where o.id=$1`, [o.consult_of]) : null,
      recommendedCenter: o.recommended_center_id ? await this.db.one(`select id, name, address from service_centers where id=$1`, [o.recommended_center_id]) : null,
      followUps: o.service === 'consult' ? await this.db.query(`select id, number, service, status from orders where consult_of=$1 order by created_at`, [o.id]) : [],
      consultBack: o.service === 'consult' ? (await this.settings.get('pricing')).consult : null,
      cancelReason: o.cancel_reason, cancelStage: o.cancel_stage,
      createdAt: o.created_at, acceptedAt: o.accepted_at, arrivedAt: o.arrived_at, completedAt: o.completed_at,
      performer, client, events,
      you: actor ?? 'candidate',
      actions: actor ? canDo(o.status, actor === 'admin' ? 'admin' : actor) : [],
    };
  }

  async list(user: AuthUser, scope: 'client' | 'performer', status?: string) {
    const where = scope === 'performer' ? 'o.performer_id = $1' : user.owner_id ? 'o.created_by = $1' : '(o.client_id = $1 or o.created_by = $1)';
    const items = await this.db.query<any>(
      `select o.id, o.number, o.status, o.service, o.is_sos, o.problem, o.description, o.address, o.brand, o.estimate, o.work_amount, o.call_out_amount,
              o.client_fee_pct, o.discount_amount, o.payment_method, o.created_at, o.completed_at, o.consult_of,
              o.case_root_id, o.continuation_of, o.result, o.result_note, o.vehicle_id,
              v.brand as v_brand, v.model as v_model, v.year as v_year, v.plate as v_plate,
              (select coalesce(company_name, name) from users where id=o.client_id) as client_name
         from orders o left join vehicles v on v.id=o.vehicle_id where ${where} ${status ? 'and o.status = $2' : ''} order by o.created_at desc limit 100`,
      status ? [user.id, status] : [user.id],
    );
    // The archive and the order detail must use the same final price formula.
    // Do not recalculate totals from just call_out_amount + work_amount on the client.
    return items.map((order: any) => ({ ...order, money: this.money(order) }));
  }

  /**
   * Смена статуса только если заявка всё ещё в том состоянии, которое видел человек.
   * Иначе — конфликт: два одновременных действия не перезапишут друг друга.
   */
  private async guarded(q: Queryable, sql: string, params: unknown[]) {
    const r = await q.query(sql + ' returning id', params);
    if (!r.length) throw conflict('state_changed', 'Заявка уже изменилась — обновите экран');
  }

  /**
   * Поставить исполнителя в звонки/торги заявки — под блокировкой исполнителя, той же, что при выборе.
   * Если он в этот миг взял другую заявку или ушёл с линии — не ставим. false — не поставлен.
   */
  async enlist(performerId: string, sql: string, params: unknown[]) {
    return this.db.tx(async (q) => {
      const p = await q.one<{ line_status: string; paused: boolean }>(
        'select line_status, paused from performer_profiles where user_id=$1 for update', [performerId]);
      if (!p || p.paused || p.line_status === 'offline' || p.line_status === 'on_job') return false;
      if (await this.busyWith(q, performerId, null)) return false;
      await q.query(sql, params);
      return true;
    });
  }

  // Занятость исполнителя ----------------------------------------------------

  /** Кому заявку не предлагаем: исполнитель не берёт этого клиента или клиент скрыл исполнителя («Не предлагать») */
  async blockedBy(clientId: string) {
    return (await this.db.query<{ performer_id: string }>(
      `select performer_id from performer_blocks where client_id=$1
       union select performer_id from client_prefs where client_id=$1 and pref='hide'`, [clientId])).map((r) => r.performer_id);
  }

  /** «Мои мастера»: кто уже работал у клиента, с отметками «избранное» / «не предлагать» */
  async myPerformers(user: AuthUser) {
    const clientId = user.owner_id ?? user.id;
    return this.db.query(
      `select u.id, u.name, u.rating::float as rating, u.rating_count, p.kind, p.line_status, p.specialties, cp.pref,
              count(o.id)::int as jobs, max(o.completed_at) as last_at,
              (array_agg(o.service order by o.completed_at desc))[1] as last_service
         from orders o join users u on u.id=o.performer_id join performer_profiles p on p.user_id=u.id
         left join client_prefs cp on cp.client_id=o.client_id and cp.performer_id=u.id
        where o.client_id=$1 and o.status='completed'
        group by u.id, p.kind, p.line_status, p.specialties, cp.pref
       union
       select u.id, u.name, u.rating::float, u.rating_count, p.kind, p.line_status, p.specialties, cp.pref, 0, null, null
         from client_prefs cp join users u on u.id=cp.performer_id join performer_profiles p on p.user_id=u.id
        where cp.client_id=$1 and not exists (select 1 from orders o where o.client_id=$1 and o.performer_id=u.id and o.status='completed')
        order by last_at desc nulls last`, [clientId]);
  }

  async setPref(user: AuthUser, performerId: string, pref: 'fav' | 'hide' | null) {
    const clientId = user.owner_id ?? user.id;
    if (pref) await this.db.query(`insert into client_prefs(client_id, performer_id, pref) values ($1,$2,$3)
      on conflict (client_id, performer_id) do update set pref=excluded.pref, created_at=now()`, [clientId, performerId, pref]);
    else await this.db.query('delete from client_prefs where client_id=$1 and performer_id=$2', [clientId, performerId]);
    return { pref };
  }

  /** Есть ли у исполнителя другая заявка в работе */
  async busyWith(q: Queryable, performerId: string, exceptOrderId: string | null) {
    return !!(await q.one(
      `select 1 from orders where performer_id=$1 and status in ('accepted','en_route','arrived','working','awaiting_confirmation') and not (service='consult' and status='awaiting_confirmation') and ($2::uuid is null or id<>$2::uuid) limit 1`,
      [performerId, exceptOrderId]));
  }

  /**
   * Исполнитель занят (взял заявку, ушёл с линии, на паузе) — убираем его из всех других торгов и звонков:
   * отклики отзываются, «звонки» гаснут. Возвращает, кого и о чём сообщить.
   */
  async release(q: Queryable, performerId: string, exceptOrderId: string | null) {
    const rows = await q.query<{ order_id: string; client_id: string; created_by: string }>(
      `update order_dispatch d set status='cancelled', responded_at=$3
         from orders o
        where o.id=d.order_id and d.performer_id=$1 and ($2::uuid is null or d.order_id<>$2::uuid)
          and d.status in ('queued','ringing','bidding') and o.status='searching'
        returning d.order_id, o.client_id, o.created_by`,
      [performerId, exceptOrderId, this.now()]);
    const bids = await q.query<{ order_id: string }>(
      `update bids set status='withdrawn', updated_at=now()
        where performer_id=$1 and status='active' and ($2::uuid is null or order_id<>$2::uuid) returning order_id`,
      [performerId, exceptOrderId]);
    const orders = new Map<string, string[]>();
    for (const r of rows) orders.set(r.order_id, [r.client_id, r.created_by]);
    for (const b of bids) if (!orders.has(b.order_id)) {
      const o = await q.one<{ client_id: string; created_by: string }>('select client_id, created_by from orders where id=$1', [b.order_id]);
      if (o) orders.set(b.order_id, [o.client_id, o.created_by]);
    }
    return { performerId, orders: [...orders.entries()].map(([orderId, clients]) => ({ orderId, clients })) };
  }

  /** После release: клиентам — обновить отклики, исполнителю — закрыть вызовы; если там звонили приоритетным — звоним дальше */
  async afterRelease(r: { performerId: string; orders: { orderId: string; clients: string[] }[] }) {
    for (const o of r.orders) {
      this.notifier.live(o.clients, { type: 'order', orderId: o.orderId, status: 'searching', offers: true });
      this.notifier.live([r.performerId], { type: 'order', orderId: o.orderId, status: 'released' });
      await this.ringNext(o.orderId);
    }
  }

  // Внутреннее -------------------------------------------------------------

  private async mustBePerformer(user: AuthUser, orderId: string) {
    const o = await this.db.one('select * from orders where id=$1', [orderId]);
    if (!o) throw notFound();
    if (o.performer_id !== user.id) throw forbidden('Это не ваша заявка');
    return o;
  }

  private async mustBeClient(user: AuthUser, orderId: string) {
    const o = await this.db.one('select * from orders where id=$1', [orderId]);
    if (!o) throw notFound();
    if (o.client_id !== user.id && o.created_by !== user.id) throw forbidden('Это не ваша заявка');
    return o;
  }

  async event(q: Queryable, orderId: string, actorId: string | null, type: string, data: unknown) {
    await q.query('insert into order_events(order_id, actor_id, type, data) values ($1,$2,$3,$4)', [orderId, actorId, type, data]);
  }

  async systemMessage(orderId: string, body: string) {
    const m = await this.db.one(
      `insert into chat_messages(order_id, sender_id, kind, body) values ($1, null, 'system', $2) returning id, order_id, sender_id, kind, body, created_at`,
      [orderId, body],
    );
    this.notifier.live(await this.participants(orderId), { type: 'chat', message: m });
  }
}

export type { Action };

/** «2 ч», «1,5 ч» — сколько шагов насчитано */
export function hoursText(units: number, step: number) {
  const h = (units * step) / 60;
  return `${String(h).replace('.', ',')} ч`;
}
