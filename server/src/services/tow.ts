// Торги эвакуатора. Заявка сразу уходит всем подходящим эвакуаторщикам рядом (как звонок),
// они предлагают цену в коридоре площадки, клиент выбирает предложение — это и есть «принял».

import type { Db } from '../db/index.ts';
import type { SettingsService } from './settings.ts';
import type { Notifier } from './notify.ts';
import type { OrdersService } from './orders.ts';
import { bad, conflict, forbidden, notFound, type AuthUser } from '../http/router.ts';
import { rankCandidates, type Candidate } from '../domain/dispatch.ts';
import { roundTo } from '../domain/pricing.ts';
import { rub } from '../util.ts';

export class TowService {
  constructor(private db: Db, private settings: SettingsService, private notifier: Notifier, private orders: OrdersService, private now: () => Date) {}

  corridor(order: any, d: { towCorridorMin: number; towCorridorMax: number }) {
    const base = order.estimate.callOut as number;
    return { min: roundTo(base * d.towCorridorMin, 10_000), max: roundTo(base * d.towCorridorMax, 10_000), suggested: base };
  }

  async startAuction(orderId: string) {
    const all = await this.settings.all();
    const order = await this.db.one('select * from orders where id=$1', [orderId]);
    if (!order || order.status !== 'searching') return;
    const list = await this.db.query<Candidate & { prep_minutes: number }>(
      `select p.user_id, p.kind, p.specialties, p.brands, p.is_priority, p.paused, p.line_status, p.verification,
              p.lat, p.lng, u.rating, p.accepts_group, u.status as user_status, p.prep_minutes
         from performer_profiles p join users u on u.id = p.user_id
        where p.kind = 'tow' and p.user_id <> $1`, [order.client_id]);
    const ranked = rankCandidates(order as any, list, {
      radiusKm: all.dispatch.radiusKm, maxCandidates: 50, cashDebtLimit: all.fees.cashDebtLimit,
      exclude: new Set([order.created_by]),
    });
    const until = new Date(this.now().getTime() + all.dispatch.towAuctionMinutes * 60_000);
    await this.db.query('update orders set auction_until=$2, dispatch_started_at=coalesce(dispatch_started_at, $3) where id=$1', [orderId, until, this.now()]);
    for (const [i, r] of ranked.entries()) {
      await this.db.query(
        `insert into order_dispatch(order_id, performer_id, rank, distance_km, status, ring_until, sent_at)
         values ($1,$2,$3,$4,'bidding',$5,$6) on conflict (order_id, performer_id) do update set status='bidding', ring_until=excluded.ring_until`,
        [orderId, r.user_id, i, r.distanceKm, until, this.now()]);
    }
    await this.orders.event(this.db, orderId, null, 'auction_started', { candidates: ranked.length, until });
    if (!ranked.length) return this.finishEmpty(order);

    const c = this.corridor(order, all.dispatch);
    const ring = new Date(this.now().getTime() + all.dispatch.ringSeconds * 1000).toISOString();
    for (const r of ranked) {
      await this.notifier.notify([r.user_id], {
        type: 'tow_auction', orderId, number: order.number, address: order.address, destination: order.destination,
        cargo: order.cargo, distanceKm: r.distanceKm, min: c.min, max: c.max, until: until.toISOString(),
      }, {
        kind: 'call',
        title: `Эвакуатор · торги${order.is_sos ? ' · SOS' : ''}`,
        body: `${order.address ?? order.estimate.zoneName}${order.destination ? ' → ' + order.destination : ''} · ${rub(c.min)}–${rub(c.max)}`,
        data: { orderId, ringUntil: ring, auction: 'true' },
        ttlSeconds: all.dispatch.ringSeconds,
      });
    }
  }

  /** Эвакуаторщик предлагает цену (можно поменять, пока клиент не выбрал) */
  async bid(user: AuthUser, orderId: string, price: number) {
    const all = await this.settings.all();
    const order = await this.db.one('select * from orders where id=$1', [orderId]);
    if (!order || order.service !== 'tow') throw notFound();
    if (order.status !== 'searching') throw conflict('too_late', 'Клиент уже выбрал эвакуатор');
    const d = await this.db.one(`select * from order_dispatch where order_id=$1 and performer_id=$2 and status='bidding'`, [orderId, user.id]);
    if (!d) throw forbidden('Эта заявка вам не предлагалась');
    if (order.auction_until && new Date(order.auction_until) < this.now()) throw conflict('auction_closed', 'Приём предложений закончился');
    const c = this.corridor(order, all.dispatch);
    if (!Number.isInteger(price) || price < c.min || price > c.max) {
      throw bad('price_out_of_corridor', `Цена для этой заявки — от ${rub(c.min)} до ${rub(c.max)}`);
    }
    const p = await this.db.one<{ prep_minutes: number }>('select prep_minutes from performer_profiles where user_id=$1', [user.id]);
    const road = d.distance_km == null ? 30 : Math.round((Number(d.distance_km) / all.dispatch.towSpeedKmh) * 60);
    const eta = (p?.prep_minutes ?? 0) + road;
    const b = await this.db.one(
      `insert into tow_bids(order_id, performer_id, price, eta_minutes) values ($1,$2,$3,$4)
       on conflict (order_id, performer_id) do update set price=excluded.price, eta_minutes=excluded.eta_minutes, status='active', updated_at=now()
       returning *`, [orderId, user.id, price, eta]);
    await this.orders.event(this.db, orderId, user.id, 'bid', { price, eta });
    await this.notifier.notify([order.client_id, order.created_by], { type: 'order', orderId, status: 'searching', bids: true },
      { kind: 'normal', title: 'Новое предложение эвакуатора', body: `${rub(price)} · подача ~${eta} мин`, data: { orderId } });
    return b;
  }

  async withdraw(user: AuthUser, orderId: string) {
    await this.db.query(`update tow_bids set status='withdrawn', updated_at=now() where order_id=$1 and performer_id=$2 and status='active'`, [orderId, user.id]);
    const o = await this.db.one('select client_id, created_by from orders where id=$1', [orderId]);
    if (o) this.notifier.live([o.client_id, o.created_by], { type: 'order', orderId, status: 'searching', bids: true });
    return { ok: true };
  }

  async bids(user: AuthUser, orderId: string) {
    const o = await this.orders.mustSee(user, orderId);
    const all = await this.settings.all();
    const actor = this.orders.actorOf(user, o);
    const rows = await this.db.query(
      `select b.id, b.performer_id, b.price, b.eta_minutes, b.status, b.updated_at,
              u.name, u.rating::float as rating, u.rating_count, p.car, d.distance_km
         from tow_bids b join users u on u.id=b.performer_id left join performer_profiles p on p.user_id=b.performer_id
         left join order_dispatch d on d.order_id=b.order_id and d.performer_id=b.performer_id
        where b.order_id=$1 and b.status in ('active','chosen') ${actor ? '' : 'and b.performer_id=$2'}
        order by b.price, b.eta_minutes`, actor ? [orderId] : [orderId, user.id]);
    return { corridor: this.corridor(o, all.dispatch), until: o.auction_until, bids: rows };
  }

  /** Клиент выбирает предложение — эвакуаторщик назначен, цена перевозки зафиксирована */
  async choose(user: AuthUser, orderId: string, bidId: string) {
    const res = await this.db.tx(async (q) => {
      const o = await q.one('select * from orders where id=$1', [orderId]);
      if (!o) throw notFound();
      if (o.client_id !== user.id && o.created_by !== user.id) throw forbidden();
      if (o.status !== 'searching') throw conflict('too_late', 'Эвакуатор уже выбран');
      const b = await q.one(`update tow_bids set status='chosen', updated_at=now() where id=$1 and order_id=$2 and status='active' returning *`, [bidId, orderId]);
      if (!b) throw conflict('bid_gone', 'Это предложение уже недоступно');
      await q.query(`update tow_bids set status='lost', updated_at=now() where order_id=$1 and id<>$2 and status='active'`, [orderId, bidId]);
      await q.query(`update order_dispatch set status = case when performer_id=$2 then 'accepted' else 'lost' end, responded_at=$3
                      where order_id=$1 and status='bidding'`, [orderId, b.performer_id, this.now()]);
      const upd = await q.one(
        `update orders set status='accepted', performer_id=$2, accepted_at=$3, call_out_amount=$4 where id=$1 returning *`,
        [orderId, b.performer_id, this.now(), b.price]);
      await q.query(`update performer_profiles set line_status='on_job' where user_id=$1`, [b.performer_id]);
      await this.orders.event(q, orderId, user.id, 'bid_chosen', { bidId, price: b.price, eta: b.eta_minutes });
      const losers = await q.query<{ performer_id: string }>(`select performer_id from order_dispatch where order_id=$1 and status='lost'`, [orderId]);
      return { o: upd!, b, losers: losers.map((l) => l.performer_id) };
    });
    await this.notifier.notify([res.b.performer_id], { type: 'order', orderId, status: 'accepted' },
      { kind: 'normal', title: 'Клиент выбрал вас', body: `Заявка №${res.o.number}: ${rub(res.b.price)}, подача ~${res.b.eta_minutes} мин`, data: { orderId } });
    this.notifier.live(res.losers, { type: 'order', orderId, status: 'lost' });
    await this.orders.systemMessage(orderId, `Выбран эвакуатор: ${rub(res.b.price)}, подача ~${res.b.eta_minutes} мин. Чат открыт.`);
    return this.orders.view(user, orderId);
  }

  async openAuctions(user: AuthUser) {
    return this.db.query(
      `select o.id as order_id, o.number, o.address, o.destination, o.cargo, o.loaded, o.brand, o.estimate, o.auction_until, o.is_sos,
              d.distance_km, b.price as my_price
         from order_dispatch d join orders o on o.id=d.order_id
         left join tow_bids b on b.order_id=o.id and b.performer_id=d.performer_id and b.status='active'
        where d.performer_id=$1 and d.status='bidding' and o.status='searching' and o.auction_until > $2
        order by o.created_at desc`, [user.id, this.now()]);
  }

  /** Торги закончились: без предложений — «никто не взял»; с предложениями — ждём выбора клиента */
  async tick() {
    const expired = await this.db.query(
      `select o.* from orders o where o.service='tow' and o.status='searching' and o.auction_until < $1
          and not exists (select 1 from tow_bids b where b.order_id=o.id and b.status='active')`, [this.now()]);
    for (const o of expired) await this.finishEmpty(o);
    return expired.length;
  }

  private async finishEmpty(order: any) {
    await this.db.query(`update orders set status='no_performer' where id=$1 and status='searching'`, [order.id]);
    await this.db.query(`update order_dispatch set status='missed' where order_id=$1 and status='bidding'`, [order.id]);
    await this.orders.event(this.db, order.id, null, 'no_performer', { auction: true });
    await this.notifier.notify([order.client_id, order.created_by], { type: 'order', orderId: order.id, status: 'no_performer' },
      { kind: 'normal', title: 'Нет предложений', body: 'Свободных эвакуаторов рядом сейчас нет. Попробуйте ещё раз или позвоните в поддержку.', data: { orderId: order.id } });
  }
}
