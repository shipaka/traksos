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
    return policyFor(order, dispatch.sosProgressive);
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
    if (order.service === 'ecu')
      return {usual:0,floor:100,ceil:100_000_000}; // scope and specialist price required
    return offerLimits(order.estimate.callOut as number, d.offerFloor, d.offerCeil);
  }

  /** Обычная цена часа для отклика исполнителя: из профиля или по уровню */
  private async hourFor(performerId: string, order: any): Promise<number | null> {
    if (order.service === 'tow' || order.service === 'consult' || order.service === 'ecu') return null;
    const p = await this.db.one<{ hour_price: number | null }>('select hour_price from performer_profiles where user_id=$1', [performerId]);
    return p?.hour_price ?? order.estimate.hour ?? null;
  }

  async start(orderId: string, exclude: string[] = []) {
    const all = await this.settings.all();
    const loaded = await this.db.one('select * from orders where id=$1', [orderId]);
    if (!loaded || loaded.status !== 'searching') return;
    // Loaded row passed the existence guard. Subsequent conditional UPDATE
    // RETURNING rows are non-null when present.
    let order: NonNullable<typeof loaded> = loaded;
    const stages = order.service==='ecu'?null:this.stages(order,all.dispatch);
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
          and ($3::boolean or not exists (select 1 from orders x where x.performer_id=p.user_id and x.status in ('accepted','en_route','arrived','working','awaiting_confirmation') and not (x.service='consult' and x.status='awaiting_confirmation')))`, [kind, order.client_id,order.service==='ecu']);
    const already = await this.db.query<{ performer_id: string }>(
      `select performer_id from order_dispatch where order_id=$1 and status in ('declined','missed','bidding','lost')`, [orderId]);
    const ranked = order.service==='ecu'
      ? list.filter(c=>c.user_id===order.site?.ecuSpecialistId
          && c.verification==='approved' && c.user_status==='active'
          && !c.paused && ['online','on_call','on_job'].includes(c.line_status))
          .map(c=>({user_id:c.user_id,distanceKm:null,reason:'explicit_workshop'}))
      : rankCandidates(order as any, list, {
          radiusKm: stage?.radiusKm??all.dispatch.radiusKm,
          maxCandidates: all.dispatch.maxCandidates, cashDebtLimit: all.fees.cashDebtLimit, now: this.now(),
          exclude: new Set([order.created_by, ...exclude, ...already.map(a=>a.performer_id),
             ...(await this.orders.blockedBy(order.client_id))]),
        });
    const eligible=await this.stagedCandidates(order,list,ranked,stage);
    const ms = order.service==='ecu'?7*24*60*60_000 : stage ? stage.waitSeconds*1000 :
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
      // The customer may cancel while routes/push payloads are prepared.
      // Never send a new call for an already-cancelled or finished request.
      if (!(await this.db.one(
        "select 1 from orders where id=$1 and status='searching'",
        [orderId]))) break;
      await this.notifier.notify([r.user_id], {
        type: 'auction', orderId, number: order.number, service: order.service, sos: order.is_sos, problem: order.problem,
        description: order.description, address: order.address, destination: order.destination, cargo: order.cargo,
        zone: order.estimate.zoneName, brand: order.brand, distanceKm: r.distanceKm,
        usual: lim.usual, floor: lim.floor, ceil: lim.ceil, until: until.toISOString(), ringUntil: ring,
      }, {
        kind: order.service==='ecu'?'normal':'call',
        title: order.service==='ecu'?'Запрос цены диагностики ЭБУ' : order.service === 'consult' ? 'Консультация по телефону' : `${order.is_sos ? 'SOS · ' : ''}${order.service === 'tow' ? 'Эвакуатор' : 'Заявка'} · ${order.estimate.zoneName}`,
        body: order.service==='ecu' ? 'Клиент выбрал вашу мастерскую. Укажите цену диагностики, без выезда.' : `${order.brand ?? 'Грузовик'} · ${order.description ?? order.problem ?? ''} · ${order.service === 'consult' ? 'консультация' : 'обычная цена'} ${rub(lim.usual)}`.trim(),
        data: { orderId, ringUntil: ring, auction: 'true', price: String(lim.usual) },
        ttlSeconds: all.dispatch.ringSeconds,
      });
    }
  }

  /** Отклик исполнителя: price не указана — по обычной цене. Можно поменять, пока клиент не выбрал. */
  async offer(user: AuthUser, orderId: string, price?: number, diagnosticScope?: string) {
    const all = await this.settings.all();
    const order = await this.db.one('select * from orders where id=$1', [orderId]);
    if (!order) throw notFound();
    if (order.status !== 'searching') throw conflict('too_late', 'Клиент уже выбрал исполнителя');
    const d = await this.db.one(`select * from order_dispatch where order_id=$1 and performer_id=$2 and status='bidding'`, [orderId, user.id]);
    if (!d) throw forbidden('Эта заявка вам не предлагалась');
    if (order.auction_until && new Date(order.auction_until) < this.now() && order.auto_pick) {
      throw conflict('auction_closed', 'Приём откликов закончился');
    }
    if (order.service!=='ecu' && await this.orders.busyWith(this.db, user.id, orderId)) throw conflict('busy', 'Сначала закройте текущую заявку');
    const prof0 = await this.db.one<{ line_status: string; paused: boolean }>('select line_status, paused from performer_profiles where user_id=$1', [user.id]);
    if (!prof0 || prof0.paused || prof0.line_status === 'offline') throw conflict('offline', 'Выйдите на линию, чтобы откликаться');
    const lim = this.limits(order, all.dispatch);
    // A free inquiry becomes a scoped, explicitly priced offer — not a bank hold.
    if(order.service==='ecu' && (!Number.isInteger(price) || (price??0)<100))
      throw bad('ecu_diagnostic_price_required','Укажите цену диагностики до начала работ');
    const scope=order.service==='ecu'?diagnosticScope?.trim()??'':null;
    if(order.service==='ecu' && (scope!.length<10||scope!.length>500))
      throw bad('ecu_diagnostic_scope_required','Укажите объём диагностики (10–500 символов)');
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
      if (!pr || pr.paused || pr.line_status === 'offline' || (order.service!=='ecu' && (pr.line_status === 'on_job' || await this.orders.busyWith(q, user.id, null)))) {
        throw conflict('busy', 'Вы заняты или не на линии');
      }
      const still = await q.one(`select 1 from order_dispatch d join orders o on o.id=d.order_id
          where d.order_id=$1 and d.performer_id=$2 and d.status='bidding' and o.status='searching'`, [orderId, user.id]);
      if (!still) throw conflict('too_late', 'Клиент уже выбрал исполнителя');
      return q.one(
        `insert into bids(order_id, performer_id, price, hour_price, eta_minutes, ecu_diagnostic_scope) values ($1,$2,$3,$4,$5,$6)
         on conflict (order_id, performer_id) do update set price=excluded.price, hour_price=excluded.hour_price,
           eta_minutes=excluded.eta_minutes, ecu_diagnostic_scope=excluded.ecu_diagnostic_scope, status='active', updated_at=greatest(clock_timestamp(),bids.updated_at + interval '1 millisecond')
         returning *`, [orderId, user.id, p, hour, eta, scope]);
    });
    await this.orders.event(this.db, orderId, user.id, 'offer', {price:p,eta,diagnosticScope:scope,quoteVersion:new Date(o!.updated_at).toISOString()});
    const diff = order.service==='ecu'?0:Math.round((p / lim.usual - 1) * 100);
    await this.notifier.notify([order.client_id, order.created_by], { type: 'order', orderId, status: 'searching', offers: true },
      { kind: 'normal', title: order.service==='ecu'?'Цена диагностики ЭБУ':'Новый отклик', body: order.service==='ecu'?`Специалист предложил диагностику за ${rub(p)}. Подтвердите сумму отдельно.`:`${user.name ?? 'Исполнитель'}: ${rub(p)}${diff ? ` (${diff > 0 ? '+' : ''}${diff}%)` : ''}, подача ~${eta} мин`, data: { orderId } });
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
    let sorted=(o.service==='ecu'?rows:sortOffers(rows,sort,lim,all.dispatch.weights))
      .map((r:any)=>({...r,favorite:favs.has(r.performer_id),
        diffPct:o.service==='ecu'?null:Math.round((r.price / lim.usual-1)*100)}));
    if (sort === 'recommended') sorted = [...sorted.filter((r) => r.favorite), ...sorted.filter((r) => !r.favorite)];
    return { limits: lim, until: o.auction_until, autoPick: o.auto_pick, sort, offers: sorted };
  }

  private async rows(orderId: string, brand: string | null, onlyPerformer: string | null) {
    const rows = await this.db.query(
      `select f.id, f.performer_id, f.price, f.hour_price, f.eta_minutes, f.status,
               f.updated_at as quote_version, f.ecu_diagnostic_scope,
              u.name, u.rating::float as rating, u.rating_count, p.car, p.brands, p.tier, p.extras, p.kind as performer_kind, p.verification as performer_verification, pl.level as partner_level, d.distance_km::float as distance_km, d.road_eta_minutes,
              (select count(*)::int from orders c where c.performer_id=f.performer_id and c.status='completed') as completed
         from bids f join users u on u.id=f.performer_id left join performer_profiles p on p.user_id=f.performer_id
         left join partner_level_decisions pl on pl.user_id=f.performer_id and pl.current=true
         left join order_dispatch d on d.order_id=f.order_id and d.performer_id=f.performer_id
        where f.order_id=$1 and f.status in ('active','chosen') ${onlyPerformer ? 'and f.performer_id=$2' : ''}`,
      onlyPerformer ? [orderId, onlyPerformer] : [orderId]);
    return rows.map((r: any) => ({ ...r, brand_level: brand ? r.brands?.[brand] ?? 'good' : null, brands: undefined }));
  }

  /** Клиент (или система для SOS) выбирает отклик — исполнитель назначен, цена выезда зафиксирована */
  async choose(user: AuthUser | null, orderId: string, offerId: string, acceptedPrice?: number, quoteVersion?: string, ecuConsent?: boolean) {
    const pre = await this.db.one('select o.client_id, o.created_by, o.service, b.performer_id from orders o join bids b on b.order_id=o.id where o.id=$1 and b.id=$2', [orderId, offerId]);
    if (!pre) throw notFound('Отклик не найден');
    if(pre.service==='ecu' && (!user || !Number.isInteger(acceptedPrice) || (acceptedPrice??0)<100 || !quoteVersion || ecuConsent!==true))
      throw bad('ecu_price_consent_required','Подтвердите точную стоимость диагностики');
    if (user && pre.client_id !== user.id && pre.created_by !== user.id) throw forbidden();
    // Исполнитель мог только что взять другую заявку — его отклик здесь больше не действует
    if (pre.service!=='ecu' && await this.orders.busyWith(this.db, pre.performer_id, orderId)) {
      await this.db.query(`update bids set status='withdrawn', updated_at=now() where id=$1 and status='active'`, [offerId]);
      this.notifier.live([pre.client_id, pre.created_by], { type: 'order', orderId, status: 'searching', offers: true });
      throw conflict('performer_busy', 'Этот исполнитель только что взял другую заявку — выберите другого');
    }

    const res = await this.db.tx(async (q) => {
      // Сначала занимаем заявку: из двух одновременных выборов пройдёт только один
      // Блокируем исполнителя: выборы одного и того же человека в разных заявках идут строго по очереди
      await q.query('select 1 from performer_profiles where user_id=$1 for update', [pre.performer_id]);
      const f0 = await q.one(`select * from bids where id=$1 and order_id=$2 and status='active' for update`, [offerId, orderId]);
      if (!f0) throw conflict('offer_gone', 'Этот отклик уже недоступен');
      if(pre.service==='ecu' && (Number(f0.price)!==acceptedPrice || (f0.ecu_diagnostic_scope??'').length<10 || new Date(f0.updated_at).toISOString()!==quoteVersion))
        throw conflict('ecu_quote_changed','Цена изменилась. Проверьте и подтвердите новую сумму');
      const upd = await q.one(
        `update orders set status='accepted', performer_id=$2, accepted_at=$3, call_out_amount=$4,
            ecu_due_at=case when service='ecu' then $3::timestamptz + interval '7 days' else ecu_due_at end,
            estimate = jsonb_set(estimate, '{hour}', coalesce(to_jsonb($5::int), estimate->'hour'))
          where id=$1 and status='searching' returning *`,
        [orderId, f0.performer_id, this.now(), f0.price, f0.hour_price]);
      if (!upd) throw conflict('too_late', 'Исполнитель уже выбран');
      if (pre.service!=='ecu' && await this.orders.busyWith(q, f0.performer_id, orderId)) throw conflict('performer_busy', 'Этот исполнитель только что взял другую заявку');
      const f = (await q.one(`update bids set status='chosen', updated_at=now() where id=$1 returning *`, [offerId]))!;
      await q.query(`update bids set status='lost', updated_at=now() where order_id=$1 and id<>$2 and status='active'`, [orderId, offerId]);
      await q.query(`update order_dispatch set status = case when performer_id=$2 then 'accepted' else 'lost' end, responded_at=$3
                      where order_id=$1 and status in ('bidding','queued','ringing')`, [orderId, f.performer_id, this.now()]);
      if(pre.service!=='ecu') await q.query(`update performer_profiles set line_status='on_job' where user_id=$1`, [f.performer_id]);
      await this.orders.event(q, orderId, user?.id ?? null, user ? 'offer_chosen' : 'offer_autopicked', { offerId, price: f.price, eta: f.eta_minutes, ...(pre.service==='ecu'?{diagnosticScope:f.ecu_diagnostic_scope,quoteVersion:new Date(f0.updated_at).toISOString(),ecuConsent:true}:{}) });
      const losers = await q.query<{ performer_id: string }>(`select performer_id from order_dispatch where order_id=$1 and status='lost'`, [orderId]);
      const released = await this.orders.release(q, f.performer_id, orderId);
      return { o: upd, f, losers: losers.map((l) => l.performer_id), released };
    });
    await this.orders.afterRelease(res.released);
    await this.notifier.notify([res.f.performer_id], { type: 'order', orderId, status: 'accepted' },
      { kind: 'normal', title: 'Клиент выбрал вас', body: res.o.service==='ecu'?(res.f.price===0?'Клиент выбрал вашу мастерскую. Итоговую стоимость нужно отдельно согласовать после диагностики.':`Предложена диагностика ЭБУ: ${rub(res.f.price)}. Клиент приедет в мастерскую.`) : res.o.service === 'consult' ? `Консультация №${res.o.number}: свяжитесь с клиентом` : `Заявка №${res.o.number}: выезд ${rub(res.f.price)}, подача ~${res.f.eta_minutes} мин`, data: { orderId } });
    this.notifier.live(res.losers, { type: 'order', orderId, status: 'lost' });
    if (!user) {
      await this.notifier.notify([res.o.client_id, res.o.created_by], { type: 'order', orderId, status: 'accepted' },
        { kind: 'normal', title: 'Исполнитель назначен', body: res.o.service === 'consult' ? 'Мастер на связи — он позвонит или напишет в чат' : `Выбрали лучшего из откликов: выезд ${rub(res.f.price)}, подача ~${res.f.eta_minutes} мин`, data: { orderId } });
    }
    await this.orders.systemMessage(orderId, res.o.service==='ecu'
      ? (res.f.price===0?'Специалист по ЭБУ выбран. Цена пока не известна, окончательную сумму клиент должен подтвердить отдельно.':'Предварительное предложение ЭБУ: '+rub(res.f.price)+'. Дополнительные суммы требуют отдельного согласия.')
      : res.o.service === 'consult'
      ? `Мастер на связи: консультация ${rub(res.f.price)}. Он позвонит через TrakSOS или напишет здесь.`
      : `Исполнитель выбран: выезд ${rub(res.f.price)}, подача ~${res.f.eta_minutes} мин. Чат открыт.`);
    return user ? this.orders.view(user, orderId) : null;
  }

  async open(user: AuthUser) {
    const all = await this.settings.all();
    const rows = await this.db.query(
      `select o.id as order_id, o.number, o.service, o.address, o.destination, o.cargo, o.brand, o.description, o.problem,
              o.estimate, o.auction_until, o.is_sos, o.auto_pick,
              (o.additional_to is not null) as is_linked_stage,
              d.distance_km::float as distance_km, f.price as my_price, f.ecu_diagnostic_scope as my_scope
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
