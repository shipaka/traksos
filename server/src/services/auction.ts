// Торги для всех услуг. Заявка, которую не взяли приоритетные (вы с отцом), уходит всем подходящим
// исполнителям рядом как звонок. Каждый откликается: «Беру за обычную цену» или своя цена (85–130%).
// Клиент видит один список с сортировками «Рекомендуем / Дешевле / Быстрее / Ближе» и выбирает.
// SOS: через 90 секунд лучший из «Рекомендуем» назначается сам.

import type { Db } from '../db/index.ts';
import type { SettingsService } from './settings.ts';
import type { Notifier } from './notify.ts';
import type { OrdersService } from './orders.ts';
import { bad, conflict, forbidden, notFound, type AuthUser } from '../http/router.ts';
import { rankCandidates, performerKindFor, type Candidate } from '../domain/dispatch.ts';
import { offerLimits, sortOffers, etaMinutes, type Sort } from '../domain/offers.ts';
import type { Settings } from '../domain/defaults.ts';
import { rub } from '../util.ts';

export class AuctionService {
  constructor(private db: Db, private settings: SettingsService, private notifier: Notifier, private orders: OrdersService, private now: () => Date) {}

  limits(order: any, d: Settings['dispatch']) {
    return offerLimits(order.estimate.callOut as number, d.offerFloor, d.offerCeil);
  }

  /** Обычная цена часа для отклика исполнителя: из профиля или по уровню */
  private async hourFor(performerId: string, order: any): Promise<number | null> {
    if (order.service === 'tow') return null;
    const p = await this.db.one<{ hour_price: number | null }>('select hour_price from performer_profiles where user_id=$1', [performerId]);
    return p?.hour_price ?? order.estimate.hour ?? null;
  }

  async start(orderId: string, exclude: string[] = []) {
    const all = await this.settings.all();
    const order = await this.db.one('select * from orders where id=$1', [orderId]);
    if (!order || order.status !== 'searching') return;
    const kind = performerKindFor(order.service);
    const list = await this.db.query<Candidate>(
      `select p.user_id, p.kind, p.specialties, p.brands, false as is_priority, p.paused, p.line_status, p.verification,
              p.lat, p.lng, u.rating, p.accepts_group, u.status as user_status,
              (select coalesce(-sum(amount),0)::int from ledger_entries l
                where l.performer_id = p.user_id and l.kind in ('cash_commission','cash_commission_paid')) as cash_debt
         from performer_profiles p join users u on u.id = p.user_id
        where p.kind = $1 and p.user_id <> $2`, [kind, order.client_id]);
    const already = await this.db.query<{ performer_id: string }>(
      `select performer_id from order_dispatch where order_id=$1 and status in ('declined','missed','bidding','lost')`, [orderId]);
    const ranked = rankCandidates(order as any, list, {
      radiusKm: all.dispatch.radiusKm, maxCandidates: all.dispatch.maxCandidates, cashDebtLimit: all.fees.cashDebtLimit,
      exclude: new Set([order.created_by, ...exclude, ...already.map((a) => a.performer_id)]),
    });
    const ms = order.is_sos ? all.dispatch.sosAuctionSeconds * 1000 : all.dispatch.auctionMinutes * 60_000;
    const until = new Date(this.now().getTime() + ms);
    await this.db.query('update orders set auction_until=$2, auto_pick=$3, dispatch_started_at=coalesce(dispatch_started_at,$4) where id=$1',
      [orderId, until, !!order.is_sos, this.now()]);
    for (const [i, r] of ranked.entries()) {
      await this.db.query(
        `insert into order_dispatch(order_id, performer_id, rank, distance_km, status, ring_until, sent_at)
         values ($1,$2,$3,$4,'bidding',$5,$6)
         on conflict (order_id, performer_id) do update set status='bidding', ring_until=excluded.ring_until, sent_at=excluded.sent_at`,
        [orderId, r.user_id, 100 + i, r.distanceKm, until, this.now()]);
    }
    await this.orders.event(this.db, orderId, null, 'auction_started', { candidates: ranked.length, until, sos: !!order.is_sos });
    const ids = await this.participants(orderId);
    this.notifier.live([order.client_id, order.created_by], { type: 'order', orderId, status: 'searching', auction: true });
    if (!ranked.length) return this.finishEmpty(order);

    const lim = this.limits(order, all.dispatch);
    const ring = new Date(this.now().getTime() + Math.min(ms, all.dispatch.ringSeconds * 1000)).toISOString();
    for (const r of ranked) {
      await this.notifier.notify([r.user_id], {
        type: 'auction', orderId, number: order.number, service: order.service, sos: order.is_sos, problem: order.problem,
        description: order.description, address: order.address, destination: order.destination, cargo: order.cargo,
        zone: order.estimate.zoneName, brand: order.brand, distanceKm: r.distanceKm,
        usual: lim.usual, floor: lim.floor, ceil: lim.ceil, until: until.toISOString(), ringUntil: ring,
      }, {
        kind: 'call',
        title: `${order.is_sos ? 'SOS · ' : ''}${order.service === 'tow' ? 'Эвакуатор' : 'Заявка'} · ${order.estimate.zoneName}`,
        body: `${order.brand ?? 'Грузовик'} · ${order.description ?? order.problem ?? ''} · обычная цена ${rub(lim.usual)}`.trim(),
        data: { orderId, ringUntil: ring, auction: 'true', price: String(lim.usual) },
        ttlSeconds: all.dispatch.ringSeconds,
      });
    }
    void ids;
  }

  private async participants(orderId: string) {
    return this.orders.participants(orderId);
  }

  /** Отклик исполнителя: price не указана — по обычной цене. Можно поменять, пока клиент не выбрал. */
  async offer(user: AuthUser, orderId: string, price?: number) {
    const all = await this.settings.all();
    const order = await this.db.one('select * from orders where id=$1', [orderId]);
    if (!order) throw notFound();
    if (order.status !== 'searching') throw conflict('too_late', 'Клиент уже выбрал исполнителя');
    const d = await this.db.one(`select * from order_dispatch where order_id=$1 and performer_id=$2 and status='bidding'`, [orderId, user.id]);
    if (!d) throw forbidden('Эта заявка вам не предлагалась');
    if (order.auction_until && new Date(order.auction_until) < this.now() && order.auto_pick) {
      throw conflict('auction_closed', 'Приём откликов закончился');
    }
    const lim = this.limits(order, all.dispatch);
    const p = price ?? lim.usual;
    if (!Number.isInteger(p) || p < lim.floor || p > lim.ceil) {
      throw bad('price_out_of_corridor', `Цена для этой заявки — от ${rub(lim.floor)} до ${rub(lim.ceil)}`);
    }
    const prof = await this.db.one<{ prep_minutes: number }>('select prep_minutes from performer_profiles where user_id=$1', [user.id]);
    const speed = order.service === 'tow' ? all.dispatch.towSpeedKmh : all.dispatch.citySpeedKmh;
    const eta = etaMinutes(d.distance_km == null ? null : Number(d.distance_km), prof?.prep_minutes ?? 0, speed);
    const hour = await this.hourFor(user.id, order);
    const o = await this.db.one(
      `insert into bids(order_id, performer_id, price, hour_price, eta_minutes) values ($1,$2,$3,$4,$5)
       on conflict (order_id, performer_id) do update set price=excluded.price, hour_price=excluded.hour_price,
         eta_minutes=excluded.eta_minutes, status='active', updated_at=now()
       returning *`, [orderId, user.id, p, hour, eta]);
    await this.orders.event(this.db, orderId, user.id, 'offer', { price: p, eta });
    const diff = Math.round((p / lim.usual - 1) * 100);
    await this.notifier.notify([order.client_id, order.created_by], { type: 'order', orderId, status: 'searching', offers: true },
      { kind: 'normal', title: 'Новый отклик', body: `${user.name ?? 'Исполнитель'}: ${rub(p)}${diff ? ` (${diff > 0 ? '+' : ''}${diff}%)` : ''}, подача ~${eta} мин`, data: { orderId } });
    return o;
  }

  async withdraw(user: AuthUser, orderId: string) {
    await this.db.query(`update bids set status='withdrawn', updated_at=now() where order_id=$1 and performer_id=$2 and status='active'`, [orderId, user.id]);
    await this.db.query(`update order_dispatch set status='declined', responded_at=$3 where order_id=$1 and performer_id=$2 and status='bidding'`, [orderId, user.id, this.now()]);
    const o = await this.db.one('select client_id, created_by from orders where id=$1', [orderId]);
    if (o) this.notifier.live([o.client_id, o.created_by], { type: 'order', orderId, status: 'searching', offers: true });
    return { ok: true };
  }

  /** Список откликов: клиенту — все, исполнителю — только свой */
  async list(user: AuthUser, orderId: string, sort: Sort = 'recommended') {
    const o = await this.orders.mustSee(user, orderId);
    const all = await this.settings.all();
    const actor = this.orders.actorOf(user, o);
    const rows = await this.rows(orderId, o.brand, actor ? null : user.id);
    const lim = this.limits(o, all.dispatch);
    return {
      limits: lim, until: o.auction_until, autoPick: o.auto_pick, sort,
      offers: sortOffers(rows, sort, lim, all.dispatch.weights).map((r) => ({ ...r, diffPct: Math.round((r.price / lim.usual - 1) * 100) })),
    };
  }

  private async rows(orderId: string, brand: string | null, onlyPerformer: string | null) {
    const rows = await this.db.query(
      `select f.id, f.performer_id, f.price, f.hour_price, f.eta_minutes, f.status,
              u.name, u.rating::float as rating, u.rating_count, p.car, p.brands, p.tier, d.distance_km::float as distance_km,
              (select count(*)::int from orders c where c.performer_id=f.performer_id and c.status='completed') as completed
         from bids f join users u on u.id=f.performer_id left join performer_profiles p on p.user_id=f.performer_id
         left join order_dispatch d on d.order_id=f.order_id and d.performer_id=f.performer_id
        where f.order_id=$1 and f.status in ('active','chosen') ${onlyPerformer ? 'and f.performer_id=$2' : ''}`,
      onlyPerformer ? [orderId, onlyPerformer] : [orderId]);
    return rows.map((r: any) => ({ ...r, brand_level: brand ? r.brands?.[brand] ?? 'good' : null, brands: undefined }));
  }

  /** Клиент (или система для SOS) выбирает отклик — исполнитель назначен, цена выезда зафиксирована */
  async choose(user: AuthUser | null, orderId: string, offerId: string) {
    const res = await this.db.tx(async (q) => {
      const o = await q.one('select * from orders where id=$1', [orderId]);
      if (!o) throw notFound();
      if (user && o.client_id !== user.id && o.created_by !== user.id) throw forbidden();
      if (o.status !== 'searching') throw conflict('too_late', 'Исполнитель уже выбран');
      const f = await q.one(`update bids set status='chosen', updated_at=now() where id=$1 and order_id=$2 and status='active' returning *`, [offerId, orderId]);
      if (!f) throw conflict('offer_gone', 'Этот отклик уже недоступен');
      await q.query(`update bids set status='lost', updated_at=now() where order_id=$1 and id<>$2 and status='active'`, [orderId, offerId]);
      await q.query(`update order_dispatch set status = case when performer_id=$2 then 'accepted' else 'lost' end, responded_at=$3
                      where order_id=$1 and status in ('bidding','queued','ringing')`, [orderId, f.performer_id, this.now()]);
      const upd = await q.one(
        `update orders set status='accepted', performer_id=$2, accepted_at=$3, call_out_amount=$4,
            estimate = jsonb_set(estimate, '{hour}', coalesce(to_jsonb($5::int), estimate->'hour'))
          where id=$1 returning *`,
        [orderId, f.performer_id, this.now(), f.price, f.hour_price]);
      await q.query(`update performer_profiles set line_status='on_job' where user_id=$1`, [f.performer_id]);
      await this.orders.event(q, orderId, user?.id ?? null, user ? 'offer_chosen' : 'offer_autopicked', { offerId, price: f.price, eta: f.eta_minutes });
      const losers = await q.query<{ performer_id: string }>(`select performer_id from order_dispatch where order_id=$1 and status='lost'`, [orderId]);
      return { o: upd!, f, losers: losers.map((l) => l.performer_id) };
    });
    await this.notifier.notify([res.f.performer_id], { type: 'order', orderId, status: 'accepted' },
      { kind: 'normal', title: 'Клиент выбрал вас', body: `Заявка №${res.o.number}: выезд ${rub(res.f.price)}, подача ~${res.f.eta_minutes} мин`, data: { orderId } });
    this.notifier.live(res.losers, { type: 'order', orderId, status: 'lost' });
    if (!user) {
      await this.notifier.notify([res.o.client_id, res.o.created_by], { type: 'order', orderId, status: 'accepted' },
        { kind: 'normal', title: 'Исполнитель назначен', body: `Выбрали лучшего из откликов: выезд ${rub(res.f.price)}, подача ~${res.f.eta_minutes} мин`, data: { orderId } });
    }
    await this.orders.systemMessage(orderId, `Исполнитель выбран: выезд ${rub(res.f.price)}, подача ~${res.f.eta_minutes} мин. Чат открыт.`);
    return user ? this.orders.view(user, orderId) : null;
  }

  async open(user: AuthUser) {
    const all = await this.settings.all();
    const rows = await this.db.query(
      `select o.id as order_id, o.number, o.service, o.address, o.destination, o.cargo, o.brand, o.description, o.problem,
              o.estimate, o.auction_until, o.is_sos, o.auto_pick, d.distance_km::float as distance_km, f.price as my_price
         from order_dispatch d join orders o on o.id=d.order_id
         left join bids f on f.order_id=o.id and f.performer_id=d.performer_id and f.status='active'
        where d.performer_id=$1 and d.status='bidding' and o.status='searching'
          and (o.auction_until > $2 or not o.auto_pick)
        order by o.is_sos desc, o.created_at desc`, [user.id, this.now()]);
    return rows.map((r: any) => ({ ...r, limits: this.limits(r, all.dispatch) }));
  }

  /** Время вышло: SOS с откликами — назначаем лучшего; без откликов — «никто не взял» */
  async tick() {
    const all = await this.settings.all();
    const due = await this.db.query(
      `select o.* from orders o where o.status='searching' and o.auction_until < $1
          and (o.auto_pick or not exists (select 1 from bids f where f.order_id=o.id and f.status='active'))`, [this.now()]);
    let n = 0;
    for (const o of due) {
      const rows = await this.rows(o.id, o.brand, null);
      const active = rows.filter((r: any) => r.status === 'active');
      if (!active.length) { await this.finishEmpty(o); n++; continue; }
      if (o.auto_pick) {
        const best = sortOffers(active, 'recommended', this.limits(o, all.dispatch), all.dispatch.weights)[0];
        await this.choose(null, o.id, best.id).catch(() => {});
        n++;
      }
    }
    return n;
  }

  private async finishEmpty(order: any) {
    const r = await this.db.query(`update orders set status='no_performer' where id=$1 and status='searching' returning id`, [order.id]);
    if (!r.length) return;
    await this.db.query(`update order_dispatch set status='missed' where order_id=$1 and status='bidding'`, [order.id]);
    await this.orders.event(this.db, order.id, null, 'no_performer', { auction: true });
    await this.notifier.notify([order.client_id, order.created_by], { type: 'order', orderId: order.id, status: 'no_performer' },
      { kind: 'normal', title: 'Нет откликов', body: 'Свободных исполнителей рядом сейчас нет. Попробуйте ещё раз или позвоните в поддержку.', data: { orderId: order.id } });
  }
}
