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
import { policyFor, withinStage, type VerifiedRoadEta, type SosSearchStage } from '../domain/progressiveSos.ts';

export class AuctionService {
  constructor(private db: Db, private settings: SettingsService, private notifier: Notifier, private orders: OrdersService,
    private now: () => Date, readonly roadEta?: VerifiedRoadEta) {}

  /** Disabled for real users until admin approves thresholds AND a trusted router is connected. */
  stages(order: any, dispatch: Settings['dispatch']): SosSearchStage[] | null {
    return policyFor(order, dispatch.sosProgressive, !!this.roadEta);
  }

  /** Filter AFTER ordinary eligibility: no missing GPS, no fabricated drive time. */
  async stagedCandidates(order:any, list: Candidate[], ranked: import('../domain/dispatch.ts').Ranked[],
    stage:SosSearchStage|null) {
    if (!stage) return ranked.map(r=>({...r,roadEtaMinutes:null as number|null}));
    const pickup=order.lat==null||order.lng==null?null:{lat:Number(order.lat),lng:Number(order.lng)};
    const matches = await Promise.all(ranked.map(async r=>{
      const p=list.find(c=>c.user_id===r.user_id);
      const performer=p?.lat==null||p?.lng==null?null:{lat:Number(p.lat),lng:Number(p.lng)};
      const eta=await withinStage(stage,pickup,performer,r.distanceKm,
        Number(p?.prep_minutes ?? 0),this.roadEta);
      return eta?{...r,roadEtaMinutes:eta.totalMinutes}:null;
    }));
    return matches.filter((x):x is NonNullable<typeof x>=>x!==null);
  }

  limits(order: any, d: Settings['dispatch']) {
    // Консультация — фиксированная цена, торговаться не о чем
    if (order.service === 'consult') return offerLimits(order.estimate.callOut as number, 1, 1);
    return offerLimits(order.estimate.callOut as number, d.offerFloor, d.offerCeil);
  }

  /** Обычная цена часа для отклика исполнителя: из профиля или по уровню */
  private async hourFor(performerId: string, order: any): Promise<number | null> {
    if (order.service === 'tow' || order.service === 'consult') return null;
    const p = await this.db.one<{ hour_price: number | null }>('select hour_price from performer_profiles where user_id=$1', [performerId]);
    return p?.hour_price ?? order.estimate.hour ?? null;
  }

  async start(orderId: string, exclude: string[] = []) {
    const all = await this.settings.all();
    let order = await this.db.one('select * from orders where id=$1', [orderId]);
    if (!order || order.status !== 'searching') return;
    const stages = this.stages(order,all.dispatch);
    const stageIndex=Number(order.sos_dispatch_stage??0);
    const stage=stages?.[stageIndex]??null;
    if (stages && !stage) return this.finishEmpty(order);
    // Only one tick/HTTP worker claims a given wave. Cancellation wins if the
    // order has already left searching; a retry must clear auction_until first.
    if (stage) {
      const deadline=new Date(this.now().getTime()+stage.waitSeconds*1000);
      const claimed=await this.db.query<any>(
        `update orders set auction_until=$3,auto_pick=true,dispatch_started_at=coalesce(dispatch_started_at,$4)
          where id=$1 and status='searching' and sos_dispatch_stage=$2
            and auction_until is null returning *`,
        [orderId,stageIndex,deadline,this.now()]);
      if (!claimed.length) return;
      order=claimed[0];
    }
    const kind = performerKindFor(order.service);
    const list = await this.db.query<Candidate>(
      `select p.user_id, p.kind, p.specialties, p.brands, false as is_priority, p.paused, p.line_status, p.verification,
              p.lat, p.lng, p.prep_minutes, u.rating, p.accepts_group, u.status as user_status, p.schedule, p.off_schedule_until, p.extras,
              (select coalesce(-sum(amount),0)::int from ledger_entries l
                where l.performer_id = p.user_id and l.kind in ('cash_commission','cash_commission_paid')) as cash_debt
         from performer_profiles p join users u on u.id = p.user_id
        where p.kind = $1 and p.user_id <> $2
          and not exists (select 1 from orders x where x.performer_id=p.user_id and x.status in ('accepted','en_route','arrived','working','awaiting_confirmation') and not (x.service='consult' and x.status='awaiting_confirmation'))`, [kind, order.client_id]);
    const already = await this.db.query<{ performer_id: string }>(
      `select performer_id from order_dispatch where order_id=$1 and status in ('declined','missed','bidding','lost')`, [orderId]);
    const ranked = rankCandidates(order as any, list, {
      radiusKm: stage?.radiusKm??all.dispatch.radiusKm,
      maxCandidates: all.dispatch.maxCandidates, cashDebtLimit: all.fees.cashDebtLimit, now: this.now(),
      exclude: new Set([order.created_by, ...exclude, ...already.map((a) => a.performer_id), ...(await this.orders.blockedBy(order.client_id))]),
    });
    const eligible=await this.stagedCandidates(order,list,ranked,stage);
    const ms = stage ? stage.waitSeconds*1000 :
      order.is_sos ? all.dispatch.sosAuctionSeconds * 1000 : all.dispatch.auctionMinutes * 60_000;
    const until = stage ? new Date(order.auction_until) : new Date(this.now().getTime() + ms);
    if (!stage) await this.db.query(
      'update orders set auction_until=$2, auto_pick=$3, dispatch_started_at=coalesce(dispatch_started_at,$4) where id=$1 and status=\'searching\'',
      [orderId,until,!!order.is_sos,this.now()]);
    const invited: typeof eligible = [];
    for (const [i, r] of eligible.entries()) {
      if (stage && !(await this.db.one(
        "select 1 from orders where id=$1 and status='searching' and sos_dispatch_stage=$2",
        [orderId,stageIndex]))) break;
      const ok = await this.orders.enlist(r.user_id,
        stage
          ? `insert into order_dispatch(order_id,performer_id,rank,distance_km,status,ring_until,sent_at,road_eta_minutes)
             select $1,$2,$3,$4,'bidding',$5,$6,$7
              from orders where id=$1 and status='searching' and sos_dispatch_stage=$8
             on conflict (order_id,performer_id) do nothing returning id`
          : `insert into order_dispatch(order_id, performer_id, rank, distance_km, status, ring_until, sent_at)
             values ($1,$2,$3,$4,'bidding',$5,$6)
             on conflict (order_id, performer_id) do update set status='bidding', ring_until=excluded.ring_until, sent_at=excluded.sent_at`,
        stage?[orderId,r.user_id,100+i,r.distanceKm,until,this.now(),r.roadEtaMinutes,stageIndex]:
          [orderId,r.user_id,100+i,r.distanceKm,until,this.now()],!!stage);
      if (ok) invited.push(r);
    }
    await this.orders.event(this.db, orderId, null, 'auction_started', { candidates: invited.length, until, sos: !!order.is_sos, wave: stage?stageIndex+1:null, waves: stages?.length??null });
    this.notifier.live([order.client_id, order.created_by], { type: 'order', orderId, status: 'searching', auction: true });
    if (!invited.length) return stage ? undefined : this.finishEmpty(order);

    const lim = this.limits(order, all.dispatch);
    const ring = new Date(this.now().getTime() + Math.min(ms, all.dispatch.ringSeconds * 1000)).toISOString();
    for (const r of invited) {
      await this.notifier.notify([r.user_id], {
        type: 'auction', orderId, number: order.number, service: order.service, sos: order.is_sos, problem: order.problem,
        description: order.description, address: order.address, destination: order.destination, cargo: order.cargo,
        zone: order.estimate.zoneName, brand: order.brand, distanceKm: r.distanceKm,
        usual: lim.usual, floor: lim.floor, ceil: lim.ceil, until: until.toISOString(), ringUntil: ring,
      }, {
        kind: 'call',
        title: order.service === 'consult' ? 'Консультация по телефону' : `${order.is_sos ? 'SOS · ' : ''}${order.service === 'tow' ? 'Эвакуатор' : 'Заявка'} · ${order.estimate.zoneName}`,
        body: `${order.brand ?? 'Грузовик'} · ${order.description ?? order.problem ?? ''} · ${order.service === 'consult' ? 'консультация' : 'обычная цена'} ${rub(lim.usual)}`.trim(),
        data: { orderId, ringUntil: ring, auction: 'true', price: String(lim.usual) },
        ttlSeconds: all.dispatch.ringSeconds,
      });
    }
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
    if (await this.orders.busyWith(this.db, user.id, orderId)) throw conflict('busy', 'Сначала закройте текущую заявку');
    const prof0 = await this.db.one<{ line_status: string; paused: boolean }>('select line_status, paused from performer_profiles where user_id=$1', [user.id]);
    if (!prof0 || prof0.paused || prof0.line_status === 'offline') throw conflict('offline', 'Выйдите на линию, чтобы откликаться');
    const lim = this.limits(order, all.dispatch);
    const p = price ?? lim.usual;
    if (!Number.isInteger(p) || p < lim.floor || p > lim.ceil) {
      throw bad('price_out_of_corridor', `Цена для этой заявки — от ${rub(lim.floor)} до ${rub(lim.ceil)}`);
    }
    const prof = await this.db.one<{ prep_minutes: number }>('select prep_minutes from performer_profiles where user_id=$1', [user.id]);
    const speed = order.service === 'tow' ? all.dispatch.towSpeedKmh : all.dispatch.citySpeedKmh;
    const eta = d.road_eta_minutes == null
      ? etaMinutes(d.distance_km == null ? null : Number(d.distance_km), prof?.prep_minutes ?? 0, speed)
      : Number(d.road_eta_minutes);
    const hour = await this.hourFor(user.id, order);
    const o = await this.db.tx(async (q) => {
      // Та же блокировка, что при выборе: занятый или ушедший с линии в этот миг не откликнется
      const pr = await q.one<{ line_status: string; paused: boolean }>('select line_status, paused from performer_profiles where user_id=$1 for update', [user.id]);
      if (!pr || pr.paused || pr.line_status === 'offline' || pr.line_status === 'on_job' || await this.orders.busyWith(q, user.id, null)) {
        throw conflict('busy', 'Вы заняты или не на линии');
      }
      const still = await q.one(`select 1 from order_dispatch d join orders o on o.id=d.order_id
          where d.order_id=$1 and d.performer_id=$2 and d.status='bidding' and o.status='searching'`, [orderId, user.id]);
      if (!still) throw conflict('too_late', 'Клиент уже выбрал исполнителя');
      return q.one(
        `insert into bids(order_id, performer_id, price, hour_price, eta_minutes) values ($1,$2,$3,$4,$5)
         on conflict (order_id, performer_id) do update set price=excluded.price, hour_price=excluded.hour_price,
           eta_minutes=excluded.eta_minutes, status='active', updated_at=now()
         returning *`, [orderId, user.id, p, hour, eta]);
    });
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
    // «Мои мастера»: избранные клиента — первыми в «Рекомендуем»
    const favs = new Set((await this.db.query<{ performer_id: string }>(`select performer_id from client_prefs where client_id=$1 and pref='fav'`, [o.client_id])).map((r) => r.performer_id));
    let sorted = sortOffers(rows, sort, lim, all.dispatch.weights).map((r: any) => ({ ...r, favorite: favs.has(r.performer_id), diffPct: Math.round((r.price / lim.usual - 1) * 100) }));
    if (sort === 'recommended') sorted = [...sorted.filter((r) => r.favorite), ...sorted.filter((r) => !r.favorite)];
    return { limits: lim, until: o.auction_until, autoPick: o.auto_pick, sort, offers: sorted };
  }

  private async rows(orderId: string, brand: string | null, onlyPerformer: string | null) {
    const rows = await this.db.query(
      `select f.id, f.performer_id, f.price, f.hour_price, f.eta_minutes, f.status,
              u.name, u.rating::float as rating, u.rating_count, p.car, p.brands, p.tier, p.extras, d.distance_km::float as distance_km, d.road_eta_minutes,
              (select count(*)::int from orders c where c.performer_id=f.performer_id and c.status='completed') as completed
         from bids f join users u on u.id=f.performer_id left join performer_profiles p on p.user_id=f.performer_id
         left join order_dispatch d on d.order_id=f.order_id and d.performer_id=f.performer_id
        where f.order_id=$1 and f.status in ('active','chosen') ${onlyPerformer ? 'and f.performer_id=$2' : ''}`,
      onlyPerformer ? [orderId, onlyPerformer] : [orderId]);
    return rows.map((r: any) => ({ ...r, brand_level: brand ? r.brands?.[brand] ?? 'good' : null, brands: undefined }));
  }

  /** Клиент (или система для SOS) выбирает отклик — исполнитель назначен, цена выезда зафиксирована */
  async choose(user: AuthUser | null, orderId: string, offerId: string) {
    const pre = await this.db.one('select o.client_id, o.created_by, b.performer_id from orders o join bids b on b.order_id=o.id where o.id=$1 and b.id=$2', [orderId, offerId]);
    if (!pre) throw notFound('Отклик не найден');
    if (user && pre.client_id !== user.id && pre.created_by !== user.id) throw forbidden();
    // Исполнитель мог только что взять другую заявку — его отклик здесь больше не действует
    if (await this.orders.busyWith(this.db, pre.performer_id, orderId)) {
      await this.db.query(`update bids set status='withdrawn', updated_at=now() where id=$1 and status='active'`, [offerId]);
      this.notifier.live([pre.client_id, pre.created_by], { type: 'order', orderId, status: 'searching', offers: true });
      throw conflict('performer_busy', 'Этот исполнитель только что взял другую заявку — выберите другого');
    }

    const res = await this.db.tx(async (q) => {
      // Сначала занимаем заявку: из двух одновременных выборов пройдёт только один
      // Блокируем исполнителя: выборы одного и того же человека в разных заявках идут строго по очереди
      await q.query('select 1 from performer_profiles where user_id=$1 for update', [pre.performer_id]);
      const f0 = await q.one(`select * from bids where id=$1 and order_id=$2 and status='active'`, [offerId, orderId]);
      if (!f0) throw conflict('offer_gone', 'Этот отклик уже недоступен');
      const upd = await q.one(
        `update orders set status='accepted', performer_id=$2, accepted_at=$3, call_out_amount=$4,
            estimate = jsonb_set(estimate, '{hour}', coalesce(to_jsonb($5::int), estimate->'hour'))
          where id=$1 and status='searching' returning *`,
        [orderId, f0.performer_id, this.now(), f0.price, f0.hour_price]);
      if (!upd) throw conflict('too_late', 'Исполнитель уже выбран');
      if (await this.orders.busyWith(q, f0.performer_id, orderId)) throw conflict('performer_busy', 'Этот исполнитель только что взял другую заявку');
      const f = (await q.one(`update bids set status='chosen', updated_at=now() where id=$1 returning *`, [offerId]))!;
      await q.query(`update bids set status='lost', updated_at=now() where order_id=$1 and id<>$2 and status='active'`, [orderId, offerId]);
      await q.query(`update order_dispatch set status = case when performer_id=$2 then 'accepted' else 'lost' end, responded_at=$3
                      where order_id=$1 and status in ('bidding','queued','ringing')`, [orderId, f.performer_id, this.now()]);
      await q.query(`update performer_profiles set line_status='on_job' where user_id=$1`, [f.performer_id]);
      await this.orders.event(q, orderId, user?.id ?? null, user ? 'offer_chosen' : 'offer_autopicked', { offerId, price: f.price, eta: f.eta_minutes });
      const losers = await q.query<{ performer_id: string }>(`select performer_id from order_dispatch where order_id=$1 and status='lost'`, [orderId]);
      const released = await this.orders.release(q, f.performer_id, orderId);
      return { o: upd, f, losers: losers.map((l) => l.performer_id), released };
    });
    await this.orders.afterRelease(res.released);
    await this.notifier.notify([res.f.performer_id], { type: 'order', orderId, status: 'accepted' },
      { kind: 'normal', title: 'Клиент выбрал вас', body: res.o.service === 'consult' ? `Консультация №${res.o.number}: свяжитесь с клиентом` : `Заявка №${res.o.number}: выезд ${rub(res.f.price)}, подача ~${res.f.eta_minutes} мин`, data: { orderId } });
    this.notifier.live(res.losers, { type: 'order', orderId, status: 'lost' });
    if (!user) {
      await this.notifier.notify([res.o.client_id, res.o.created_by], { type: 'order', orderId, status: 'accepted' },
        { kind: 'normal', title: 'Исполнитель назначен', body: res.o.service === 'consult' ? 'Мастер на связи — он позвонит или напишет в чат' : `Выбрали лучшего из откликов: выезд ${rub(res.f.price)}, подача ~${res.f.eta_minutes} мин`, data: { orderId } });
    }
    await this.orders.systemMessage(orderId, res.o.service === 'consult'
      ? `Мастер на связи: консультация ${rub(res.f.price)}. Он позвонит через TrakSOS или напишет здесь.`
      : `Исполнитель выбран: выезд ${rub(res.f.price)}, подача ~${res.f.eta_minutes} мин. Чат открыт.`);
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
      if (!active.length) {
        const stages=this.stages(o,all.dispatch);
        const index=Number(o.sos_dispatch_stage??0);
        if (stages && index+1 < stages.length) {
          // Atomic compare-and-set: concurrent timers advance a wave once.
          // A cancelled order or another tick must never restart dispatch.
          const next=await this.db.query<{id:string}>(
            `update orders set sos_dispatch_stage=sos_dispatch_stage+1,auction_until=null
              where id=$1 and status='searching' and sos_dispatch_stage=$2
                and auction_until<=$3 returning id`,[o.id,index,this.now()]);
          if (next.length) {
            await this.orders.event(this.db,o.id,null,'search_expanded',{
              wave:index+2,waves:stages.length,maxRoadEtaMinutes:stages[index+1].maxRoadEtaMinutes,
            });
            await this.start(o.id);
            n++;
          }
        } else {
          await this.finishEmpty(o);
          n++;
        }
        continue;
      }
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
