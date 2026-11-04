import type { Db, Queryable } from '../db/index.ts';
import type { SettingsService } from './settings.ts';
import type { Notifier } from './notify.ts';
import { bad, conflict, forbidden, notFound, type AuthUser } from '../http/router.ts';
import { estimate, isNight, type Tier } from '../domain/pricing.ts';
import { rankCandidates, performerKindFor, type Candidate } from '../domain/dispatch.ts';
import { transition, canDo, statusLabels, type Action, type Actor, type OrderStatus } from '../domain/orderState.ts';
import { cancelStage, cancelSplit, pct, split } from '../domain/money.ts';
import { haversineKm } from '../domain/geo.ts';
import { rub } from '../util.ts';

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
  groupTrip?: boolean;
  night?: boolean;
  paymentMethod?: 'cash' | 'online' | 'invoice';
}

/** Хуки оплаты — реализует PaymentsService. Пока оплата выключена, работают как заглушки. */
export interface PaymentHooks {
  onCreated(order: any): Promise<{ confirmationUrl?: string; holdRequired: boolean }>;
  onConfirmed(order: any, q: Queryable): Promise<void>;
  onCancelled(order: any, stage: string, q: Queryable): Promise<void>;
  assertMethodAllowed(method: string): Promise<void>;
}

const SERVICES = ['electric', 'diag', 'air', 'autonomy', 'tyre', 'tow', 'consult', 'ecu'];

export class OrdersService {
  payments!: PaymentHooks;

  constructor(private db: Db, private settings: SettingsService, private notifier: Notifier, private now: () => Date = () => new Date()) {}

  // Создание ---------------------------------------------------------------

  async create(user: AuthUser, i: CreateOrderInput) {
    if (!SERVICES.includes(i.service)) throw bad('bad_service', 'Неизвестная услуга');
    const all = await this.settings.all();
    const method = i.paymentMethod ?? 'cash';
    await this.payments.assertMethodAllowed(method);

    const clientId = user.owner_id ?? user.id;
    let brand = i.brand ?? null;
    if (i.vehicleId) {
      const v = await this.db.one<{ brand: string; driver_id: string | null }>('select brand, driver_id from vehicles where id=$1 and owner_id=$2', [i.vehicleId, clientId]);
      if (!v) throw bad('bad_vehicle', 'Машина не найдена в гараже');
      if (user.owner_id && v.driver_id !== user.id) throw forbidden('Эта машина закреплена за другим водителем');
      brand = brand ?? v.brand;
    }
    const night = i.night ?? isNight(all.pricing, this.now());
    const tier = i.tier ?? 'eco';
    const est = estimate(all.pricing, { service: i.service, tier, zoneId: i.zoneId, night, group: !!i.groupTrip });
    const feePct = method === 'cash' ? (all.fees.cashChargesClientFee ? all.fees.clientFeePct : 0) : all.fees.clientFeePct;

    const order = await this.db.one(
      `insert into orders(client_id, created_by, vehicle_id, service, is_sos, problem, description, address, lat, lng,
          zone_id, night, group_trip, tier, brand, estimate, payment_method, client_fee_pct)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) returning *`,
      [clientId, user.id, i.vehicleId ?? null, i.service, !!i.isSos, i.problem ?? null, i.description ?? null, i.address ?? null,
        i.lat ?? null, i.lng ?? null, est.zoneId, night, est.group, tier, brand, est, method, feePct],
    );
    await this.event(this.db, order!.id, user.id, 'created', { estimate: est, sos: !!i.isSos });

    const pay = await this.payments.onCreated(order);
    if (!pay.holdRequired) await this.startDispatch(order!.id);
    return { order: await this.view(user, order!.id), confirmationUrl: pay.confirmationUrl ?? null };
  }

  // Очередь вызова ---------------------------------------------------------

  async startDispatch(orderId: string, exclude: string[] = []) {
    const all = await this.settings.all();
    const order = await this.db.one('select * from orders where id=$1', [orderId]);
    if (!order || order.status !== 'searching') return;
    const kind = performerKindFor(order.service);
    const list = await this.db.query<Candidate>(
      `select p.user_id, p.kind, p.specialties, p.brands, p.is_priority, p.paused, p.line_status, p.verification,
              p.lat, p.lng, u.rating, p.accepts_group, u.status as user_status,
              (select coalesce(-sum(amount),0)::int from ledger_entries l
                where l.performer_id = p.user_id and l.kind in ('cash_commission','cash_commission_paid')) as cash_debt
         from performer_profiles p join users u on u.id = p.user_id
        where p.kind = $1 and p.user_id <> $2`,
      [kind, order.client_id],
    );
    const already = await this.db.query<{ performer_id: string }>('select performer_id from order_dispatch where order_id=$1', [orderId]);
    const ranked = rankCandidates(order as any, list, {
      radiusKm: all.dispatch.radiusKm,
      maxCandidates: all.dispatch.maxCandidates,
      cashDebtLimit: all.fees.cashDebtLimit,
      exclude: new Set([...exclude, ...already.map((a) => a.performer_id), order.created_by]),
    });
    const base = already.length;
    for (const [i, r] of ranked.entries()) {
      await this.db.query(
        `insert into order_dispatch(order_id, performer_id, rank, distance_km) values ($1,$2,$3,$4) on conflict do nothing`,
        [orderId, r.user_id, base + i, r.distanceKm],
      );
    }
    await this.db.query('update orders set dispatch_started_at = coalesce(dispatch_started_at, now()) where id=$1', [orderId]);
    await this.event(this.db, orderId, null, 'dispatch_started', { candidates: ranked.length });
    await this.ringNext(orderId);
  }

  /** Звоним следующему в очереди; если очередь кончилась — «никто не взял» */
  async ringNext(orderId: string) {
    const all = await this.settings.all();
    const order = await this.db.one('select * from orders where id=$1', [orderId]);
    if (!order || order.status !== 'searching') return;
    const parallel = order.is_sos ? all.dispatch.parallelSos : all.dispatch.parallel;
    const ringing = await this.db.one<{ c: number }>(`select count(*)::int c from order_dispatch where order_id=$1 and status='ringing'`, [orderId]);
    const free = parallel - (ringing?.c ?? 0);
    if (free <= 0) return;
    const until = new Date(this.now().getTime() + all.dispatch.ringSeconds * 1000);
    const next = await this.db.query<{ id: string; performer_id: string; distance_km: number | null }>(
      `update order_dispatch set status='ringing', ring_until=$2, sent_at=$3
        where id in (select id from order_dispatch where order_id=$1 and status='queued' order by rank limit $4)
        returning id, performer_id, distance_km`,
      [orderId, until, this.now(), free],
    );
    if (!next.length && (ringing?.c ?? 0) === 0) {
      await this.db.query(`update orders set status='no_performer' where id=$1 and status='searching'`, [orderId]);
      await this.event(this.db, orderId, null, 'no_performer', {});
      await this.notifier.notify([order.client_id, order.created_by], { type: 'order', orderId, status: 'no_performer' },
        { kind: 'normal', title: 'Никто не взял заявку', body: 'Сейчас свободных исполнителей нет. Попробуйте ещё раз или позвоните в поддержку.', data: { orderId } });
      return;
    }
    const est = order.estimate;
    for (const n of next) {
      await this.event(this.db, orderId, null, 'ringing', { performerId: n.performer_id });
      await this.notifier.notify([n.performer_id], {
        type: 'incoming_call', orderId, number: order.number, service: order.service, sos: order.is_sos, problem: order.problem,
        address: order.address, zone: est.zoneName, distanceKm: n.distance_km, brand: order.brand, callOut: est.callOut,
        ringUntil: until.toISOString(),
      }, {
        kind: 'call',
        title: order.is_sos ? `SOS · ${est.zoneName}` : `Заявка · ${est.zoneName}`,
        body: `${order.brand ?? 'Грузовик'} · ${order.description ?? order.problem ?? ''} · выезд ${rub(est.callOut)}`.trim(),
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
        await this.notifier.notify([m.performer_id], { type: 'line_status', lineStatus: 'offline' },
          { kind: 'normal', title: 'Вы не на линии', body: `Пропущено ${p.missed_in_row} вызова подряд — заявки пока не приходят. Вернуться — одной кнопкой.`, data: {} });
      }
    }
    for (const orderId of new Set(missed.map((m) => m.order_id))) await this.ringNext(orderId);
    return missed.length;
  }

  async accept(user: AuthUser, orderId: string) {
    const res = await this.db.tx(async (q) => {
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
      await q.query(`update order_dispatch set status='cancelled' where order_id=$1 and status in ('queued','ringing')`, [orderId]);
      await q.query(`update performer_profiles set line_status='on_job', missed_in_row=0 where user_id=$1`, [user.id]);
      await this.event(q, orderId, user.id, 'accepted', {});
      return o;
    });
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
    await this.db.query(
      `update orders set status='searching', performer_id=null, accepted_at=null, en_route_at=null, call_out_amount=null where id=$1`, [orderId]);
    await this.db.query(`update performer_profiles set line_status='online' where user_id=$1`, [user.id]);
    await this.event(this.db, orderId, user.id, 'performer_dropped', { reason });
    await this.systemMessage(orderId, 'Исполнитель отказался от заявки. Ищем другого.');
    await this.notifier.notify([o.client_id, o.created_by], { type: 'order', orderId, status: 'searching' },
      { kind: 'normal', title: 'Ищем другого исполнителя', body: `Исполнитель отказался от заявки №${o.number}. Уже ищем замену.`, data: { orderId } });
    await this.startDispatch(orderId, [user.id]);
    return this.view(user, orderId);
  }

  // Статусы ----------------------------------------------------------------

  async performerStep(user: AuthUser, orderId: string, action: 'depart' | 'arrive' | 'start_work') {
    const o = await this.mustBePerformer(user, orderId);
    const to = transition(o.status, action, 'performer');
    const col = { depart: 'en_route_at', arrive: 'arrived_at', start_work: null }[action];
    await this.db.query(`update orders set status=$2 ${col ? `, ${col}=$3` : ''} where id=$1`, col ? [orderId, to, this.now()] : [orderId, to]);
    await this.event(this.db, orderId, user.id, action, {});
    const text = { depart: 'Исполнитель выехал', arrive: 'Исполнитель на месте', start_work: 'Исполнитель начал работу' }[action];
    await this.systemMessage(orderId, text);
    await this.notifier.notify([o.client_id, o.created_by], { type: 'order', orderId, status: to },
      { kind: 'normal', title: text, body: `Заявка №${o.number}`, data: { orderId } });
    return this.view(user, orderId);
  }

  /** Мастер называет сумму за работу (выезд уже зафиксирован) */
  async proposeAmount(user: AuthUser, orderId: string, p: { workAmount: number; result?: 'solved' | 'cause_found' | 'not_found'; note?: string }) {
    const o = await this.mustBePerformer(user, orderId);
    const to = transition(o.status, 'propose_amount', 'performer');
    if (!Number.isInteger(p.workAmount) || p.workAmount < 0) throw bad('bad_amount', 'Сумма — целое число копеек, не меньше нуля');
    await this.db.query(
      `update orders set status=$2, work_amount=$3, amount_proposed_at=$6, amount_confirmed_at=null,
         result=coalesce($4,result), result_note=coalesce($5,result_note) where id=$1`,
      [orderId, to, p.workAmount, p.result ?? null, p.note ?? null, this.now()],
    );
    const m = this.money({ ...o, work_amount: p.workAmount });
    await this.event(this.db, orderId, user.id, 'amount_proposed', { workAmount: p.workAmount, total: m.total, result: p.result });
    await this.systemMessage(orderId, `Исполнитель назвал сумму: выезд ${rub(m.callOut)} + работа ${rub(m.work)}${m.clientFee ? ` + сбор ${rub(m.clientFee)}` : ''} = ${rub(m.total)}. Подтвердите в заявке.`);
    await this.notifier.notify([o.client_id, o.created_by], { type: 'order', orderId, status: to },
      { kind: 'normal', title: 'Подтвердите сумму', body: `Заявка №${o.number}: ${rub(m.total)}`, data: { orderId } });
    return this.view(user, orderId);
  }

  async confirmAmount(user: AuthUser, orderId: string, expectedTotal?: number) {
    const o = await this.mustBeClient(user, orderId);
    const to = transition(o.status, 'confirm_amount', 'client');
    const m = this.money(o);
    if (expectedTotal != null && expectedTotal !== m.total) throw conflict('amount_changed', 'Сумма изменилась — проверьте заново');
    await this.db.tx(async (q) => {
      await q.query(`update orders set status=$2, amount_confirmed_at=$3, completed_at=$3 where id=$1`, [orderId, to, this.now()]);
      await q.query(`update performer_profiles set line_status='online' where user_id=$1 and line_status='on_job'`, [o.performer_id]);
      await this.event(q, orderId, user.id, 'amount_confirmed', { total: m.total, method: o.payment_method });
      await this.payments.onConfirmed({ ...o, status: to }, q);
    });
    await this.systemMessage(orderId, `Сумма ${rub(m.total)} подтверждена. Оставьте отзыв друг о друге.`);
    await this.notifier.notify([o.performer_id], { type: 'order', orderId, status: to },
      { kind: 'normal', title: 'Сумма подтверждена', body: `Заявка №${o.number}: ${rub(m.total)}`, data: { orderId } });
    return this.view(user, orderId);
  }

  async disputeAmount(user: AuthUser, orderId: string, reason: string) {
    const o = await this.mustBeClient(user, orderId);
    const to = transition(o.status, 'dispute_amount', 'client');
    await this.db.query(`update orders set status=$2 where id=$1`, [orderId, to]);
    await this.event(this.db, orderId, user.id, 'amount_disputed', { reason });
    await this.systemMessage(orderId, `Клиент не согласен с суммой: ${reason}. Обсудите в чате или позовите поддержку.`);
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
    await this.db.tx(async (q) => {
      await q.query(`update orders set status='cancelled', cancelled_at=$5, cancelled_by=$2, cancel_reason=$3, cancel_stage=$4 where id=$1`,
        [orderId, user.id, reason, stage, this.now()]);
      await q.query(`update order_dispatch set status='cancelled' where order_id=$1 and status in ('queued','ringing')`, [orderId]);
      if (o.performer_id) await q.query(`update performer_profiles set line_status='online' where user_id=$1 and line_status='on_job'`, [o.performer_id]);
      await this.event(q, orderId, user.id, 'cancelled', { reason, stage, ...splitInfo });
      await this.payments.onCancelled({ ...o, status: 'cancelled' }, stage, q);
    });
    await this.systemMessage(orderId, `Заявка отменена: ${reason}`);
    await this.notifier.notify([o.client_id, o.created_by, o.performer_id].filter((x) => x !== user.id), { type: 'order', orderId, status: 'cancelled' },
      { kind: 'normal', title: 'Заявка отменена', body: `№${o.number}: ${reason}`, data: { orderId } });
    return this.view(user, orderId);
  }

  async retry(user: AuthUser, orderId: string) {
    const o = await this.mustBeClient(user, orderId);
    transition(o.status, 'retry', 'client');
    await this.db.query(`update orders set status='searching' where id=$1`, [orderId]);
    await this.db.query(`delete from order_dispatch where order_id=$1 and status in ('missed','declined')`, [orderId]);
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
    return { callOut, work, amount, clientFee, total: amount + clientFee };
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
    const ringing = await this.db.one(`select 1 from order_dispatch where order_id=$1 and performer_id=$2 and status='ringing'`, [orderId, user.id]);
    if (ringing) return o;
    throw forbidden();
  }

  async view(user: AuthUser, orderId: string) {
    const o = await this.mustSee(user, orderId);
    const actor = this.actorOf(user, o);
    const performer = o.performer_id
      ? await this.db.one(
          `select u.id, u.name, u.rating::float as rating, u.rating_count, p.car, p.kind, p.lat, p.lng, p.location_at
             from users u left join performer_profiles p on p.user_id=u.id where u.id=$1`, [o.performer_id])
      : null;
    const client = actor === 'performer' || actor === 'admin'
      ? await this.db.one(`select id, name, company_name, rating::float as rating, rating_count from users where id=$1`, [o.client_id])
      : null;
    const vehicle = o.vehicle_id ? await this.db.one('select brand, model, year, plate, trailer_plate from vehicles where id=$1', [o.vehicle_id]) : null;
    const events = actor ? await this.db.query('select type, data, actor_id, created_at from order_events where order_id=$1 order by id', [orderId]) : [];
    return {
      id: o.id, number: o.number, status: o.status as OrderStatus, statusLabel: statusLabels[o.status as OrderStatus],
      service: o.service, isSos: o.is_sos, problem: o.problem, description: o.description,
      address: o.address, lat: o.lat, lng: o.lng, zoneId: o.zone_id, night: o.night, groupTrip: o.group_trip, tier: o.tier,
      brand: o.brand, vehicle, estimate: o.estimate, paymentMethod: o.payment_method,
      money: this.money(o), result: o.result, resultNote: o.result_note,
      cancelReason: o.cancel_reason, cancelStage: o.cancel_stage,
      createdAt: o.created_at, acceptedAt: o.accepted_at, arrivedAt: o.arrived_at, completedAt: o.completed_at,
      performer, client, events,
      you: actor ?? 'candidate',
      actions: actor ? canDo(o.status, actor === 'admin' ? 'admin' : actor) : [],
    };
  }

  async list(user: AuthUser, scope: 'client' | 'performer', status?: string) {
    const where = scope === 'performer' ? 'performer_id = $1' : user.owner_id ? 'created_by = $1' : '(client_id = $1 or created_by = $1)';
    return this.db.query(
      `select id, number, status, service, is_sos, problem, address, brand, estimate, work_amount, call_out_amount,
              client_fee_pct, payment_method, created_at, completed_at
         from orders where ${where} ${status ? 'and status = $2' : ''} order by created_at desc limit 100`,
      status ? [user.id, status] : [user.id],
    );
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
