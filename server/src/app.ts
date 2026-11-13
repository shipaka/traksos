import http from 'node:http';
import { isIP } from 'node:net';
import { z } from 'zod';
import type { Db } from './db/index.ts';
import { Router, parse, readBody, send, errorBody, forbidden, bad, notFound, HttpError, type Ctx, type AuthedCtx } from './http/router.ts';
import { Hub } from './realtime/hub.ts';
import type { SmsProvider } from './providers/sms.ts';
import type { PushProvider } from './providers/push.ts';
import type { PaymentProvider } from './payments/provider.ts';
import { MockProvider } from './payments/provider.ts';
import { SettingsService } from './services/settings.ts';
import { Notifier } from './services/notify.ts';
import { AuthService, SELF_ROLES } from './services/auth.ts';
import { ReferralService } from './services/referral.ts';
import { ProfilesService } from './services/profiles.ts';
import { OrdersService } from './services/orders.ts';
import { ChatService } from './services/chat.ts';
import { ReviewsService, REVIEW_TAGS } from './services/reviews.ts';
import { OffersService } from './services/offers.ts';
import { AuctionService } from './services/auction.ts';
import { DocumentsService } from './services/documents.ts';
import { AdminService } from './services/admin.ts';
import { SupportService, TOPICS } from './services/support.ts';
import { StatsService } from './services/stats.ts';
import { OpsService } from './services/ops.ts';
import { OnsiteService } from './services/onsite.ts';
import { ServiceCenters } from './services/service.ts';
import { FleetService } from './services/fleet.ts';
import { VehicleServiceRequests } from './services/vehicleServiceRequests.ts';
import { PartnerFinance } from './services/partnerFinance.ts';
import { InsuranceQuoteFlow } from './services/insuranceQuoteFlow.ts';
import { PrivacyService } from './services/privacy.ts';
import { StandingService } from './services/standing.ts';
import { ShopService } from './services/shop.ts';
import { ShopCatalogService } from './services/shopCatalog.ts';
import { ModerationService } from './services/moderation.ts';
import { checkAppealToken } from './services/auth.ts';
import { normalizePhone, sha256 } from './util.ts';
import { Raw } from './http/router.ts';
import { PaymentsService } from './payments/service.ts';
import { estimate, isNight } from './domain/pricing.ts';
import { defaultSettings } from './domain/defaults.ts';
import { config, isProd } from './config.ts';

export interface Deps {
  db: Db;
  sms: SmsProvider;
  push: PushProvider;
  payments: PaymentProvider;
  now?: () => Date;
}

const money = z.number().int().nonnegative();
const ROLES = ['client', 'driver', 'master', 'tow', 'service', 'insurer', 'moderator', 'admin'];

export function createApp(d: Deps) {
  const now = d.now ?? (() => new Date());
  const hub = new Hub();
  const settings = new SettingsService(d.db);
  const notifier = new Notifier(d.db, hub, d.push);
  const auth = new AuthService(d.db, d.sms, now, settings);
  const profiles = new ProfilesService(d.db, settings, now);
  const orders = new OrdersService(d.db, settings, notifier, now);
  const payments = new PaymentsService(d.db, settings, d.payments, notifier, orders);
  orders.payments = payments;
  const auction = new AuctionService(d.db, settings, notifier, orders, now);
  orders.auction = auction;
  profiles.onUnavailable = async (userId) => orders.afterRelease(await orders.release(d.db, userId, null));
  const chat = new ChatService(d.db, settings, notifier, orders);
  const reviews = new ReviewsService(d.db, settings, orders);
  const onsite = new OnsiteService(d.db, notifier, orders);
  const offers = new OffersService(d.db, notifier, now);
  const documents = new DocumentsService(d.db, notifier, settings, now);
  const admin = new AdminService(d.db, notifier, orders, payments, profiles, settings, now);
  const support = new SupportService(d.db, notifier, orders, now);
  const stats = new StatsService(d.db, now);
  const ops = new OpsService(d.db, now);
  orders.ops = ops;
  const centers = new ServiceCenters(d.db, notifier, settings, support, now);
  const referral = new ReferralService(d.db, settings, notifier, now);
  referral.ledger = payments.ledger.bind(payments);
  orders.referral = referral;
  centers.referral = referral;
  const fleet = new FleetService(d.db, notifier, orders);
  const vehicleRequests = new VehicleServiceRequests(d.db);
  const partnerFinance = new PartnerFinance(d.db);
  const insuranceFlow = new InsuranceQuoteFlow(d.db);
  const privacy = new PrivacyService(d.db, notifier, now);
  const standing = new StandingService(d.db, now, settings);
  const shop = new ShopService(d.db, notifier, settings);
  const partCatalog = new ShopCatalogService(d.db, settings);
  const moderation = new ModerationService(d.db, notifier, reviews, now, d.sms);
  // Споры — в очередь модератора: из суммы заявки, из сверки работ, из ремонта в сервисе
  orders.onDispute = (p) => moderation.open({ kind: 'dispute', title: p.title, text: p.text, openedBy: p.userId, targetId: p.targetId, orderId: p.orderId, priority: 1 });
  support.onDispute = async (p) => {
    if (!p.orderId) return;
    const o = await d.db.one<any>('select number, performer_id from orders where id=$1', [p.orderId]);
    return moderation.open({ kind: 'dispute', title: `${p.topic} · заявка №${o?.number ?? ''}`, text: p.text, openedBy: p.userId, targetId: o?.performer_id ?? null, orderId: p.orderId, ticketId: p.ticketId, priority: 1 });
  };
  centers.onDispute = (p) => moderation.open({ kind: 'dispute', title: p.title, text: p.text, openedBy: p.userId, targetId: p.targetId, bookingId: p.bookingId, ticketId: p.ticketId, priority: 1 });

  const r = new Router();
  const staff = ['admin', 'moderator'];
  const performerRoles = ['master', 'tow', 'service'];

  // Служебное ----------------------------------------------------------------
  r.get('/api/health', false, async () => ({ ok: true, db: (await d.db.one('select 1 as ok'))?.ok === 1, time: now() }));

  // Вход ---------------------------------------------------------------------
  r.post('/api/auth/code', false, (c: Ctx) => {
    const b = parse(z.object({ phone: z.string(), purpose: z.enum(['register','reset']).optional(),
      accountType: z.enum(['owner','driver','master','tow','service','master_service','insurer']).optional() }), c.body);
    return auth.requestCode(b.phone, c.ip, b.purpose ?? 'register', b.accountType);
  });
  r.post('/api/auth/login', false, (c: Ctx) => {
    const b = parse(z.object({ phone: z.string(), password: z.string().min(1).max(128), device: z.string().max(200).optional() }), c.body);
    return auth.loginPassword(b.phone, b.password, b.device, c.ip);
  });
  r.post('/api/auth/verify', false, async (c: Ctx) => {
    const b = parse(z.object({ phone: z.string(), code: z.string().min(4).max(6), role: z.enum(SELF_ROLES).optional(),
      device: z.string().max(200).optional(), accountType: z.enum(['owner','driver','master','tow','service','master_service','insurer']).optional(),
      password: z.string().max(128).optional(), purpose: z.enum(['register','reset']).optional(),
      acceptOffers: z.boolean().optional(), ref: z.string().max(20).optional() }), c.body);
    const r = await auth.verify(b.phone, b.code, b.role, b.device, b.accountType, b.password, b.purpose ?? 'register');
    // Вход по приглашению: код из ссылки привязывается только к новому номеру
    if (b.ref) await referral.attach(r.user as any, b.ref).catch(() => false);
    // Галочка «Согласен с офертой» на экране входа — записываем согласие на действующие редакции
    if (b.acceptOffers) await offers.acceptCurrent(r.user as any, c.ip);
    return r;
  });
  r.post('/api/auth/logout', true, async (c: AuthedCtx) => {
    // Closing/minimizing the app never calls logout and never changes availability.
    // Explicit sign-out must not leave a performer discoverable without any call token.
    const activePerformer = await profiles.performer(c.user.id);
    if (activePerformer?.line_status === 'on_job')
      throw bad('active_job', 'Завершите текущую заявку перед выходом из аккаунта');
    if (activePerformer && ['online', 'on_call', 'busy'].includes(activePerformer.line_status))
      await profiles.setLine(c.user.id, { lineStatus: 'offline' });
    // Do not deliver sensitive order/location notifications to a signed-out device.
    // Other logged-in devices re-register their push token on next app launch.
    const sessionHash = sha256(bearer(c.req)!);
    await d.db.query('delete from push_tokens where user_id=$1 and (session_token_hash=$2 or session_token_hash is null)',
      [c.user.id, sessionHash]);
    await auth.logout(bearer(c.req)!);
    return { ok: true };
  });

  // Профиль ------------------------------------------------------------------
  r.get('/api/me', true, (c: AuthedCtx) => profiles.me(c.user));
  r.patch('/api/me', true, async (c: AuthedCtx) => {
    await profiles.updateMe(c.user.id, parse(z.object({
      name: z.string().min(1).max(100).optional(), companyName: z.string().max(200).nullish(), companyInn: z.string().nullish(),
      edoOperator: z.string().max(50).nullish(), edoId: z.string().max(100).nullish(),
    }), c.body));
    return profiles.me(c.user);
  });
  r.post('/api/me/push-token', true, async (c: AuthedCtx) => {
    const b = parse(z.object({ provider: z.enum(['rustore', 'web']), token: z.string().min(10).max(4096) }), c.body);
    const sessionHash = sha256(bearer(c.req)!);
    await d.db.tx(async (q) => {
      // Same physical phone must never receive notifications for an old account.
      // Serialize token ownership even when an app switches accounts concurrently.
      await q.query('select pg_advisory_xact_lock(hashtext($1))', ['push:' + b.provider + ':' + b.token]);
      await q.query('delete from push_tokens where provider=$1 and token=$2', [b.provider, b.token]);
      await q.query(`insert into push_tokens(user_id, provider, token, session_token_hash)
                     values ($1,$2,$3,$4)`, [c.user.id, b.provider, b.token, sessionHash]);
    });
    return { ok: true };
  });
  r.get('/api/me/notifications', true, async (c: AuthedCtx) => ({
    unread: (await d.db.one<{ n: number }>('select count(*)::int n from notifications where user_id=$1 and read_at is null', [c.user.id]))!.n,
    items: await d.db.query(
      `select id::int as id, kind, body, data, created_at, read_at, title
         from notifications where user_id=$1 order by id desc limit 100`, [c.user.id]),
  }));
  r.post('/api/me/notifications/read', true, async (c: AuthedCtx) => {
    await d.db.query('update notifications set read_at=now() where user_id=$1 and read_at is null', [c.user.id]);
    return { ok: true };
  });
  // Поддержка
  r.get('/api/support/topics', false, () => TOPICS);
  r.get('/api/support', true, (c: AuthedCtx) => support.mine(c.user));
  r.post('/api/support', true, (c: AuthedCtx) => support.open(c.user, parse(z.object({
    topic: z.string().min(2).max(80), text: z.string().min(1).max(2000), orderId: z.string().uuid().optional(), ledgerEntryId: z.number().int().positive().optional(),
  }), c.body)));
  r.get('/api/support/:id', true, (c: AuthedCtx) => support.thread(c.user, c.params.id));
  r.post('/api/support/:id/messages', true, (c: AuthedCtx) => support.post(c.user, c.params.id, parse(z.object({ body: z.string().min(1).max(2000) }), c.body).body));
  r.post('/api/support/:id/close', true, (c: AuthedCtx) => support.close(c.user, c.params.id));
  r.get('/api/live', true, () => stats.live());
  r.get('/api/admin/stats', ['admin'], (c: AuthedCtx) => stats.overview(Math.min(365, Math.max(1, Number(c.query.get('days') ?? 30)))));

  // Operational demand analysis does not overwrite or hide any order.
  r.get('/api/admin/demand', ['admin'], (c: AuthedCtx) =>
    ops.demand(Math.min(365,Math.max(1,Number(c.query.get('days') ?? 7))),
      Math.min(240,Math.max(5,Number(c.query.get('wait') ?? 15)))));
  r.put('/api/admin/demand/:id/review', ['admin'], (c: AuthedCtx) => {
    const b=parse(z.object({state:z.enum(['open','investigating','resolved']),
      note:z.string().max(1200)}),c.body);
    return ops.review(c.user,c.params.id,b.state,b.note);
  });
  r.get('/api/admin/announcements', ['admin'], () => ops.announcements(undefined,true));
  r.post('/api/admin/announcements', ['admin'], (c: AuthedCtx) =>
    ops.publish(c.user,parse(z.object({
      audience:z.enum(['master','tow','service','all_workers']),
      service:z.enum(['electric','diag','air','autonomy','tyre','tow','consult','ecu']).nullish(),
      title:z.string().trim().min(3).max(140),body:z.string().trim().min(3).max(3000),
      startsAt:z.string().datetime(),endsAt:z.string().datetime(),published:z.boolean(),
    }),c.body)));
  r.get('/api/worker/announcements', performerRoles, (c: AuthedCtx) => {
    const kind = c.user.roles.includes('service') && c.query.get('audience') === 'service' ? 'service'
      : c.user.roles.includes('tow') ? 'tow' : c.user.roles.includes('master') ? 'master' : 'service';
    return ops.announcements(kind, false, c.query.get('service') ?? undefined);
  });
  r.put('/api/admin/announcements/:id/status', ['admin'], (c:AuthedCtx) => {
    const b=parse(z.object({published:z.boolean()}),c.body);
    return ops.setAnnouncementPublished(c.user,c.params.id,b.published);
  });
  r.get('/api/worker/commission-campaigns', performerRoles, () => ops.activeCampaigns());
  r.post('/api/admin/announcements/:id/notify', ['admin'],
    (c:AuthedCtx)=>ops.notifyAnnouncement(c.user,c.params.id,notifier));
  r.get('/api/admin/commission-campaigns', ['admin'], () => ops.campaigns());
  r.put('/api/admin/commission-campaigns/:id/status', ['admin'], (c:AuthedCtx) => {
    const b=parse(z.object({enabled:z.boolean()}),c.body);
    return ops.setCampaignEnabled(c.user,c.params.id,b.enabled);
  });
  r.post('/api/admin/commission-campaigns', ['admin'], (c: AuthedCtx) =>
    ops.campaign(c.user,parse(z.object({
      service:z.enum(['electric','diag','air','autonomy','tyre','tow','consult','ecu']).nullish(),
      commissionPct:z.number().min(0).max(100),
      startsAt:z.string().datetime(),endsAt:z.string().datetime(),
      enabled:z.boolean(),reason:z.string().trim().min(3).max(500),
    }),c.body)));

  r.get('/api/admin/support', staff, (c: AuthedCtx) => support.queue(c.query.get('status') === 'closed' ? 'closed' : 'open'));
  r.get('/api/me/referral', true, (c: AuthedCtx) => referral.mine(c.user));
  r.get('/api/me/offers', true, (c: AuthedCtx) => offers.status(c.user));
  r.post('/api/offers/:id/accept', true, (c: AuthedCtx) => offers.accept(c.user, c.params.id, c.ip));
  r.get('/api/offers/current/:audience', false, async (c: Ctx) => (await offers.current(c.params.audience)) ?? null);
  r.get('/api/offers/:id', false, (c: Ctx) => offers.byId(c.params.id));

  // Гараж --------------------------------------------------------------------
  const vehicleSchema = z.object({ brand: z.string().min(1).max(50), model: z.string().max(50).optional(), year: z.number().int().min(1960).max(2100).optional(),
    plate: z.string().max(15).optional(), trailerPlate: z.string().max(15).optional() });
  r.get('/api/vehicles', true, (c: AuthedCtx) => profiles.vehicles(c.user));
  r.post('/api/vehicles', true, (c: AuthedCtx) => profiles.addVehicle(c.user, parse(vehicleSchema, c.body)));
  r.get('/api/vehicles/:id/history', true, (c: AuthedCtx) => profiles.vehicleHistory(c.user, c.params.id));
  r.delete('/api/vehicles/:id', true, async (c: AuthedCtx) => (await profiles.removeVehicle(c.user, c.params.id), { ok: true }));
  r.post('/api/vehicles/:id/driver', true, (c: AuthedCtx) => profiles.assignDriver(c.user, c.params.id, parse(z.object({ phone: z.string().nullable() }), c.body).phone));

  // Исполнитель --------------------------------------------------------------
  const brandLevel = z.enum(['excellent', 'good', 'last_resort', 'refuse']);
  r.get('/api/performer/profile', true, (c: AuthedCtx) => profiles.performer(c.user.id));
  r.put('/api/performer/profile', true, (c: AuthedCtx) => profiles.upsertPerformer(c.user, parse(z.object({
    kind: z.enum(['master', 'tow', 'service', 'ecu']), name: z.string().min(1).max(100).optional(),
    specialties: z.array(z.enum(['electric', 'diag', 'air', 'autonomy', 'tyre', 'consult'])).max(10).optional(),
    brands: z.record(z.string().max(40), brandLevel).optional(), tier: z.enum(['eco', 'comfort', 'pro']).optional(),
    callOutPrice: money.nullish(), hourPrice: money.nullish(), kmRate: money.nullish(), prepMinutes: z.number().int().min(0).max(60).optional(),
    acceptsGroup: z.boolean().optional(), taxStatus: z.enum(['self_employed', 'ip']).nullish(), inn: z.string().nullish(),
    car: z.object({ brand: z.string().max(50), color: z.string().max(30).optional(), plate: z.string().max(15) }).nullish(),
    cars: z.array(z.object({ brand: z.string().min(1).max(50), color: z.string().max(30).optional(), plate: z.string().min(1).max(15) })).max(3).optional(),
  }), c.body)));
  r.put('/api/performer/extras', performerRoles, (c: AuthedCtx) => profiles.setExtras(c.user.id, parse(z.object({
    weekendPct: z.number().int().min(0).max(100).optional(), nightPct: z.number().int().min(0).max(100).optional(),
    holidayPct: z.number().int().min(0).max(100).optional(), waitRate: z.number().int().min(0).max(1_000_000).optional(),
    prepay: z.enum(['never', 'low', 'always']).optional(), vacation: z.boolean().optional(),
    stock: z.array(z.string().max(40)).max(20).optional(),
    takes: z.array(z.enum(['tractor', 'semitrailer', 'coupling', 'truck12', 'bus', 'special'])).max(6).optional(),
    towType: z.enum(['partial', 'break', 'crane']).optional(), maxMass: z.number().min(1).max(100).optional(), prepAck: z.boolean().optional(),
    ring: z.boolean().optional(),
    // Баллы: гасить ли ими комиссию и сколько максимум с одной заявки (копейки, null — сколько можно)
    pointsAuto: z.boolean().optional(), pointsMax: money.nullable().optional(),
  }), c.body)));
  r.put('/api/performer/schedule', performerRoles, (c: AuthedCtx) => {
    const t = z.string().regex(/^\d{2}:\d{2}$/);
    const day = z.boolean();
    return profiles.setSchedule(c.user.id, parse(z.object({
      on: z.boolean(), from: t, to: t, phoneTo: t,
      days: z.object({ mon: day, tue: day, wed: day, thu: day, fri: day, sat: day, sun: day }),
    }), c.body));
  });
  r.get('/api/performer/ledger', performerRoles, (c: AuthedCtx) => profiles.ledger(c.user.id));
  r.post('/api/performer/line', performerRoles, async (c: AuthedCtx) => {
    const b = parse(z.object({
      lineStatus: z.enum(['online', 'on_call', 'busy', 'offline']).optional(), busyUntil: z.string().datetime().nullish(), paused: z.boolean().optional(),
    }), c.body);
    if (b.lineStatus === 'online') await offers.requirePerformer(c.user);
    return profiles.setLine(c.user.id, b);
  });
  r.post('/api/performer/location', performerRoles, async (c: AuthedCtx) => {
    const b = parse(z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }), c.body);
    await profiles.setLocation(c.user.id, b.lat, b.lng);
    // Клиенту в заявке — живая точка исполнителя
    const active = await d.db.query<{ id: string; client_id: string; created_by: string }>(
      `select id, client_id, created_by from orders where performer_id=$1 and status in ('accepted','en_route')`, [c.user.id]);
    for (const o of active) hub.send([o.client_id, o.created_by], { type: 'performer_location', orderId: o.id, lat: b.lat, lng: b.lng });
    return { ok: true };
  });
  // Проверка: фото документов и машины
  r.get('/api/performer/documents', true, (c: AuthedCtx) => documents.mine(c.user));
  r.post('/api/performer/documents', true, (c: AuthedCtx) => documents.upload(c.user, parse(z.object({
    kind: z.string().max(20), dataUrl: z.string().max(7_000_000), takenAt: z.string().datetime().optional(),
  }), c.body)));
  r.post('/api/performer/documents/submit', true, (c: AuthedCtx) => documents.submit(c.user));
  r.get('/api/documents/:id/file', true, async (c: AuthedCtx) => {
    const f = await documents.file(c.user, c.params.id);
    return new Raw(f.mime, f.body);
  });
  r.get('/api/performer/incoming', performerRoles, (c: AuthedCtx) => orders.incoming(c.user));
  r.get('/api/performer/balance', performerRoles, (c: AuthedCtx) => payments.balance(c.user.id));

  // Цены ---------------------------------------------------------------------
  r.get('/api/pricing', false, async () => {
    const all = await settings.all();
    return { zones: all.pricing.zones, tiers: all.pricing.tiers, consult: all.pricing.consult, towBase: all.pricing.towBase, nightNow: isNight(all.pricing, now()), payments: await payments.methods(),
      clientFeePct: all.fees.clientFeePct, reviewTags: REVIEW_TAGS, cancelScale: all.cancel.scale,
      serviceCommissionPct: all.fees.serviceCommissionPct, serviceCommissionMax: all.fees.serviceCommissionMax, serviceReferralDiscountPct: all.fees.serviceReferralDiscountPct, performerCommissionPct: all.fees.performerCommissionPct,
      billingStep: Number(all.pricing.billingStepMinutes ?? 60) };
  });
  r.post('/api/pricing/estimate', false, async (c: Ctx) => {
    const b = parse(z.object({ service: z.string(), tier: z.enum(['eco', 'comfort', 'pro']).default('eco'), zoneId: z.string(),
      night: z.boolean().optional(), group: z.boolean().default(false) }), c.body);
    const p = await settings.get('pricing');
    try {
      return estimate(p, { ...b, night: b.night ?? isNight(p, now()) });
    } catch (e) {
      throw bad('bad_zone', (e as Error).message);
    }
  });

  // Заявки -------------------------------------------------------------------
  r.post('/api/orders', true, async (c: AuthedCtx) => {
    if (!c.user.roles.some((r) => ['client', 'driver'].includes(r))) throw forbidden('Для заявки нужен отдельный клиентский аккаунт');
    await offers.requireClient(c.user);
    return orders.create(c.user, parse(z.object({
    service: z.string(), isSos: z.boolean().optional(), problem: z.string().max(40).optional(), description: z.string().max(1000).optional(),
    address: z.string().max(300).optional(), lat: z.number().optional(), lng: z.number().optional(), zoneId: z.string().default('spb'),
    tier: z.enum(['eco', 'comfort', 'pro']).optional(), vehicleId: z.string().uuid().optional(), brand: z.string().max(40).optional(),
    model: z.string().max(40).optional(), year: z.number().int().min(1950).max(2100).optional(),
    groupTrip: z.boolean().optional(), night: z.boolean().optional(), paymentMethod: z.enum(['cash', 'online', 'invoice']).optional(),
    destination: z.string().max(300).optional(), cargo: z.enum(['tractor', 'semitrailer', 'coupling', 'truck12', 'bus', 'special']).optional(),
    loaded: z.enum(['empty', 'loaded', 'adr']).optional(), driverOnSite: z.boolean().optional(), fromConsult: z.string().uuid().optional(),
    site: z.object({
      place: z.enum(['parking', 'yard', 'plant', 'road']).optional(), pass: z.enum(['none', 'onsite', 'ahead']).optional(),
      meet: z.string().max(60).optional(), state: z.enum(['free', 'loading', 'other_work']).optional(),
      when: z.enum(['now', 'today', 'tomorrow']).optional(), time: z.string().max(20).optional(),
    }).optional(),
  }), c.body));
  });
  r.get('/api/performer/standing', performerRoles, (c: AuthedCtx) => standing.standing(c.user));
  r.get('/api/performer/nearby', performerRoles, (c: AuthedCtx) => standing.nearby(c.user));
  r.get('/api/masters-nearby', true, (c: AuthedCtx) => {
    const q = c.query; const num = (x: string | null) => (x == null || x === '' || !Number.isFinite(Number(x)) ? undefined : Number(x));
    const service = q.get('service') ?? 'electric';
    if (!/^[a-z]{2,12}$/.test(service)) throw bad('bad_service', 'Нет такой услуги');
    return standing.mastersNearby(c.user, { service, lat: num(q.get('lat')), lng: num(q.get('lng')), brand: q.get('brand') ?? undefined });
  });
  r.post('/api/orders/:id/part', true, (c: AuthedCtx) => onsite.part(c.user, c.params.id, parse(z.object({ mode: z.enum(['wait', 'resume', 'return', 'tow']) }), c.body).mode));

  // Магазин ---------------------------------------------------------------------
  const productSchema = z.object({
    category: z.string().max(20).optional(), name: z.string().min(2).max(120).optional(), spec: z.string().max(200).nullable().optional(),
    description: z.string().max(2000).nullable().optional(), price: z.number().int().min(0).max(100_000_000).optional(),
    stock: z.number().int().min(0).max(100_000).nullable().optional(), leadDays: z.number().int().min(0).max(90).optional(),
    isKit: z.boolean().optional(), active: z.boolean().optional(), sort: z.number().int().min(0).max(10_000).optional(),
    photoDataUrl: z.string().max(2_100_000).nullable().optional(),
    brand: z.string().max(80).nullable().optional(), article: z.string().max(100).nullable().optional(),
    searchTerms: z.string().max(400).nullable().optional(),
  });
  r.get('/api/legal', false, () => settings.get('legal'));
  // The legacy full catalog endpoint remains for older APK versions. New clients
  // request light configuration then load only one page of products at a time.
  r.get('/api/shop', true, (c: AuthedCtx) => shop.catalog(c.query.get('light') === '1'));
  r.get('/api/shop/search', true, (c: AuthedCtx) => shop.search(
    c.query.get('q') ?? '', c.query.get('category') ?? '',
    Number(c.query.get('page') ?? '0'), Number(c.query.get('limit') ?? '24')));
  r.get('/api/shop/selection', true, (c: AuthedCtx) => {
    const raw = c.query.get('ids') ?? '';
    const ids = raw.split(',').filter(Boolean).slice(0, 50);
    if (ids.some((id) => !z.string().uuid().safeParse(id).success)) throw bad('bad_ids', 'Неверный артикул товара');
    return shop.selection(ids);
  });
  r.get('/api/shop/index/manifest', true, () => shop.indexManifest());
  r.get('/api/shop/index/page', true, (c: AuthedCtx) => {
    const after = c.query.get('after');
    if (after && !z.string().uuid().safeParse(after).success) throw bad('bad_cursor', 'Некорректный курсор');
    return shop.indexPage(after, Number(c.query.get('limit') ?? '750'));
  });
  r.get('/api/shop/index/changes', true, (c: AuthedCtx) => {
    const after = c.query.get('after') ?? '0';
    if (!/^\d{1,19}$/.test(after)) throw bad('bad_cursor', 'Неверная версия справочника');
    return shop.indexChanges(after, Number(c.query.get('limit') ?? '750'));
  });
  r.get('/api/shop/products/:id/analogs', true, (c: AuthedCtx) => shop.alternatives(c.params.id));
  r.post('/api/admin/shop/products/:id/analogs', ['admin'], (c: AuthedCtx) => {
    const b = parse(z.object({
      analogId: z.string().uuid(), source: z.string().min(3).max(300), verified: z.boolean().default(false),
    }), c.body);
    return shop.linkAnalog(c.user, c.params.id, b.analogId, b.source, b.verified);
  });
  // Reference-only catalog: no fictitious prices or stock, and no sales before opening.
  r.get('/api/shop/catalog/search', true, (c: AuthedCtx) => partCatalog.search(
    c.query.get('q') ?? '', c.query.get('category') ?? '', Number(c.query.get('page') ?? '0')));
  r.get('/api/shop/catalog/index/manifest', true, () => partCatalog.indexManifest());
  r.get('/api/shop/catalog/index/page', true, (c: AuthedCtx) => {
    const after = c.query.get('after');
    if (after && !z.string().uuid().safeParse(after).success)
      throw bad('bad_cursor', 'Некорректный курсор');
    return partCatalog.indexPage(after, Number(c.query.get('limit') ?? '750'));
  });
  r.get('/api/shop/catalog/index/changes', true, (c: AuthedCtx) =>
    partCatalog.indexChanges(c.query.get('after') ?? '0', Number(c.query.get('limit') ?? '750')));
  // Upload preview and import are deliberately admin-only, licensed-data gated,
  // and capped at 200 records per atomic request.
  const catalogRecordSchema = z.object({
    brand: z.string().min(1).max(80),
    article: z.string().min(2).max(100),
    name: z.string().min(2).max(120),
    category: z.string().min(1).max(30),
    searchTerms: z.string().max(400).nullable().optional(),
  });
  r.post('/api/admin/shop/catalog/import', ['admin'], (c: AuthedCtx) =>
    partCatalog.importBatch(c.user, parse(z.object({
      sourceNote: z.string().trim().min(3).max(300),
      rightsConfirmed: z.literal(true),
      dryRun: z.boolean().default(true),
      rows: z.array(catalogRecordSchema).min(1).max(200),
    }), c.body)));
  r.get('/api/admin/shop/catalog/stats', ['admin'], () => partCatalog.stats());
  r.get('/api/admin/shop/catalog', ['admin'], (c: AuthedCtx) =>
    partCatalog.adminList(c.query.get('q') ?? '', c.query.get('state') ?? 'all',
      Number(c.query.get('page') ?? '0')));
  r.post('/api/admin/shop/catalog/:id/review', ['admin'], (c: AuthedCtx) => {
    if (!z.string().uuid().safeParse(c.params.id).success) throw bad('bad_id', 'Неверный идентификатор');
    const b = parse(z.object({ reviewed: z.boolean() }), c.body);
    return partCatalog.review(c.user, c.params.id, b.reviewed);
  });
  r.get('/api/shop/history', true, (c: AuthedCtx) => {
    const vehicleId = c.query.get('vehicleId');
    if (vehicleId && !z.string().uuid().safeParse(vehicleId).success) throw bad('bad_vehicle', 'Неверная машина');
    return shop.history(c.user, vehicleId, Number(c.query.get('page') ?? '0'));
  });
  r.get('/api/shop/products/:id/photo', false, async (c: Ctx) => { const f = await shop.photo(c.params.id); return new Raw(f.mime, f.body, { 'cache-control': 'public, max-age=86400' }); });
  r.post('/api/shop/orders', true, (c: AuthedCtx) => shop.order(c.user, parse(z.object({
    items: z.array(z.object({ productId: z.string().uuid(), qty: z.number().int().min(1).max(99) })).min(1).max(50),
    delivery: z.enum(['pickup', 'delivery', 'master']), address: z.string().max(300).nullable().optional(), orderId: z.string().uuid().nullable().optional(),
    payment: z.enum(['on_receipt', 'invoice']).optional(), comment: z.string().max(500).nullable().optional(),
    vehicleId: z.string().uuid().nullable().optional(),
  }), c.body)));
  r.get('/api/shop/orders', true, (c: AuthedCtx) => shop.myOrders(c.user));
  r.post('/api/shop/orders/:id/cancel', true, (c: AuthedCtx) => shop.cancelMine(c.user, c.params.id));
  // Autokontinent purchase identifiers: strictly admin-only; there is no supplier API connection yet.
  r.get('/api/admin/shop/supplier/status', ['admin'], () => shop.supplierStatus());
  r.get('/api/admin/shop/products/:id/supplier', ['admin'], (c: AuthedCtx) => shop.supplierRef(c.params.id));
  r.put('/api/admin/shop/products/:id/supplier', ['admin'], (c: AuthedCtx) => {
    const body = parse(z.object({
      article: z.string().trim().min(2).max(100),
      brand: z.string().trim().max(80).nullable().optional(),
      sourceNote: z.string().trim().max(500).nullable().optional(),
      verified: z.boolean().default(false),
    }), c.body);
    return shop.setSupplierRef(c.user, c.params.id, body);
  });
  r.delete('/api/admin/shop/products/:id/supplier', ['admin'], (c: AuthedCtx) =>
    shop.clearSupplierRef(c.user, c.params.id));
  r.get('/api/admin/shop/products', ['admin'], () => shop.adminProducts());
  r.post('/api/admin/shop/products', ['admin'], (c: AuthedCtx) => shop.saveProduct(c.user, null, parse(productSchema, c.body)));
  r.put('/api/admin/shop/products/:id', ['admin'], (c: AuthedCtx) => shop.saveProduct(c.user, c.params.id, parse(productSchema, c.body)));
  r.delete('/api/admin/shop/products/:id', ['admin'], (c: AuthedCtx) => shop.deleteProduct(c.user, c.params.id));
  r.get('/api/admin/shop/orders', ['admin'], (c: AuthedCtx) => shop.adminOrders(c.query.get('status') ?? undefined));
  r.post('/api/admin/shop/orders/:id/status', ['admin'], (c: AuthedCtx) => {
    const b = parse(z.object({ status: z.enum(['confirmed', 'ready', 'shipped', 'done', 'cancelled']), note: z.string().max(300).optional() }), c.body);
    return shop.setStatus(c.user, c.params.id, b.status, b.note);
  });

  // Модерация -----------------------------------------------------------------
  r.post('/api/appeals', true, (c: AuthedCtx) => moderation.appeal(c.user, parse(z.object({ text: z.string().max(2000) }), c.body).text));
  r.post('/api/appeals/blocked', false, async (c: Ctx) => {
    const b = parse(z.object({ phone: z.string(), appealToken: z.string().max(100), text: z.string().max(2000) }), c.body);
    const phone = normalizePhone(b.phone);
    if (!phone || !checkAppealToken(phone, b.appealToken, now())) throw new HttpError(403, 'bad_token', 'Войдите по коду ещё раз — и сразу отправьте обжалование');
    const u = await d.db.one<{ id: string }>(`select id from users where phone=$1 and status='blocked'`, [phone]);
    if (!u) throw new HttpError(404, 'not_found', 'Аккаунт не заблокирован');
    return moderation.appealBlocked(u.id, b.text);
  });
  r.post('/api/reviews/:id/contest', true, (c: AuthedCtx) => moderation.contestReview(c.user, c.params.id, parse(z.object({ text: z.string().min(5).max(1000) }), c.body).text));
  r.get('/api/me/reviews', true, (c: AuthedCtx) => reviews.about(c.user.id));
  r.get('/api/my-cases', true, (c: AuthedCtx) => moderation.mine(c.user));
  r.get('/api/mod/cases', staff, (c: AuthedCtx) => moderation.queue(c.query.get('status') === 'resolved' ? 'resolved' : 'open', c.query.get('kind') ?? undefined));
  r.get('/api/mod/cases/:id', staff, (c: AuthedCtx) => moderation.caseView(c.params.id));
  r.post('/api/mod/cases/:id/decide', staff, (c: AuthedCtx) => {
    const b = parse(z.object({ decision: z.string().max(20), note: z.string().max(1000).optional() }), c.body);
    return moderation.decide(c.user, c.params.id, b.decision, b.note);
  });
  r.post('/api/mod/cases/:id/reopen', staff, (c: AuthedCtx) => moderation.reopen(c.user, c.params.id));
  r.post('/api/mod/cases/:id/priority', staff, (c: AuthedCtx) => moderation.setPriority(c.user, c.params.id, parse(z.object({ priority: z.number().int().min(1).max(3) }), c.body).priority));
  r.post('/api/mod/cases/:id/enter-chat', staff, (c: AuthedCtx) => moderation.enterChat(c.user, c.params.id));

  // Персональные данные ---------------------------------------------------------
  r.get('/api/me/privacy', true, (c: AuthedCtx) => privacy.status(c.user));
  r.get('/api/me/export', true, (c: AuthedCtx) => privacy.export(c.user));
  r.post('/api/me/delete', true, (c: AuthedCtx) => privacy.requestDelete(c.user));
  r.delete('/api/me/delete', true, (c: AuthedCtx) => privacy.cancelDelete(c.user));

  // Мой парк --------------------------------------------------------------------
  // Страхование и ТО (восстановлено из согласованной рабочей ветки) ----------
  const vehicleRequestKind = z.enum(['insurance', 'inspection']);
  const vehicleRequestStatus = z.enum(['in_review', 'need_documents', 'sent_to_partner', 'completed', 'rejected', 'cancelled']);
  r.get('/api/vehicles/:id/service-history', true, (c: AuthedCtx) => vehicleRequests.history(c.user, c.params.id));
  r.patch('/api/vehicle-service-requests/:id/renewal', true, async (c: AuthedCtx) => {
    const b = parse(z.object({ expiresOn: z.string().regex(/^\\d{4}-\\d{2}-\\d{2}$/) }), c.body);
    const updated = await vehicleRequests.renewPolicy(c.user, c.params.id, b.expiresOn);
    notifier.live(await vehicleRequests.recipients(updated), { type: 'vehicle_service', vehicleId: updated?.vehicle_id, requestId: updated?.id });
    return updated;
  });
  r.get('/api/vehicle-service-requests', true, (c: AuthedCtx) => vehicleRequests.mine(c.user));
  r.get('/api/insurance/agents', true, () => insuranceFlow.agents());
  const truckInsuranceFields = z.object({
    brand: z.string().trim().min(1).max(90), model: z.string().trim().min(1).max(90),
    year: z.string().regex(/^\d{4}$/), vin: z.string().trim().min(11).max(17),
    plate: z.string().trim().min(3).max(24), category: z.string().trim().max(60),
    bodyType: z.string().trim().max(90), enginePower: z.string().trim().max(60),
    maximumMass: z.string().trim().max(40), emptyMass: z.string().trim().max(40),
    chassisNumber: z.string().trim().max(50), registrationCertificate: z.string().trim().max(80),
    engineNumber: z.string().trim().max(80), trailerPlate: z.string().trim().max(30),
    registrationRegion: z.string().trim().max(90), usage: z.string().trim().max(120),
  }).strict();
  r.post('/api/vehicle-service-requests', true, async (c: AuthedCtx) => {
    const b = parse(z.object({
      vehicleId: z.string().uuid().optional(), kind: vehicleRequestKind, comment: z.string().max(2000).optional(),
      insurance: z.object({
        agentId:z.string().uuid(),
        consentToPartner:z.literal(true),
        details:z.object({
          applicant:z.object({firstName:z.string().trim().min(1).max(90),
            lastName:z.string().trim().min(1).max(90), middleName:z.string().trim().max(90).optional()}),
          vehicle:truckInsuranceFields,
        }),
      }).optional(),
    }), c.body);
    const created = await vehicleRequests.create(c.user,b.vehicleId,b.kind,b.comment,b.insurance ? {...b.insurance,details:{...b.insurance.details,consentAt:new Date().toISOString()}} : undefined);
    const recipients = await vehicleRequests.recipients(created!);
    if(b.insurance) recipients.push(b.insurance.agentId);
    notifier.live(recipients,{type:'vehicle_service',vehicleId:created?.vehicle_id,requestId:created?.id});
    return created;
  });
  // Quotation and PDF workflow: real insured customer vs designated agent, never automatic insurer API calls.
  r.get('/api/insurance/requests/:id', true, (c:AuthedCtx)=>insuranceFlow.detail(c.user,c.params.id));
  r.post('/api/insurance/requests/:id/accept', ['insurer'], async (c:AuthedCtx)=>{
    const out=await insuranceFlow.accept(c.user,c.params.id);
    const item=await insuranceFlow.detail(c.user,c.params.id);
    notifier.live([item.request.owner_id],{type:'vehicle_service',requestId:c.params.id});
    return out;
  });
  r.post('/api/insurance/requests/:id/offers', ['insurer'], async (c:AuthedCtx)=>{
    const o=z.object({company:z.string().trim().min(1).max(140),
      product:z.string().trim().min(1).max(140),
      premiumKopecks:z.number().int().positive().max(1_000_000_000),
      description:z.string().max(1000),coverage:z.string().max(800)});
    const b=parse(z.object({offers:z.array(o).min(1).max(20)}),c.body);
    const out=await insuranceFlow.publish(c.user,c.params.id,b.offers);
    const item=await insuranceFlow.detail(c.user,c.params.id);
    await notifier.notify([item.request.owner_id],
      {type:'vehicle_service',requestId:c.params.id},
      {kind:'normal',title:'Пришли страховые предложения',
       body:'Сравните цены и выберите вариант в страховой заявке.',
       data:{requestId:c.params.id}}).catch(()=>{});
    return out;
  });
  r.post('/api/insurance/requests/:id/choose',true,async(c:AuthedCtx)=>{
    const b=parse(z.object({proposalId:z.string().uuid()}),c.body);
    const out=await insuranceFlow.choose(c.user,c.params.id,b.proposalId);
    const item=await insuranceFlow.detail(c.user,c.params.id);
    notifier.live([item.request.owner_id,item.request.assigned_to].filter(Boolean),
      {type:'vehicle_service',requestId:c.params.id});
    return out;
  });
  r.post('/api/insurance/requests/:id/messages',true,async(c:AuthedCtx)=>{
    const b=parse(z.object({message:z.string().trim().min(1).max(2000)}),c.body);
    const out=await insuranceFlow.message(c.user,c.params.id,b.message);
    const item=await insuranceFlow.detail(c.user,c.params.id);
    notifier.live([item.request.owner_id,item.request.assigned_to].filter(Boolean),
      {type:'vehicle_service',requestId:c.params.id});
    return out;
  });
  r.post('/api/insurance/requests/:id/policy', ['insurer'],async(c:AuthedCtx)=>{
    const b=parse(z.object({dataUrl:z.string().max(6_100_000),
      fileName:z.string().max(120),expiresOn:z.string().regex(/^\d{4}-\d{2}-\d{2}$/)}),c.body);
    const out=await insuranceFlow.uploadPolicy(c.user,c.params.id,b.dataUrl,b.fileName,b.expiresOn);
    const item=await insuranceFlow.detail(c.user,c.params.id);
    await notifier.notify([item.request.owner_id],{type:'vehicle_service',requestId:c.params.id},
      {kind:'normal',title:'Готовый страховой полис',body:'PDF-полис загружен в переписку по вашей заявке.',
        data:{requestId:c.params.id}}).catch(()=>{});
    return out;
  });
  r.get('/api/insurance/requests/:id/policy',true,async(c:AuthedCtx)=>{
    const file=await insuranceFlow.downloadPolicy(c.user,c.params.id);
    return new Raw('application/pdf',file.body,{
      'content-disposition':'attachment; filename="insurance-policy.pdf"'
    });
  });
  r.post('/api/vehicle-service-requests/:id/cancel', true, async (c: AuthedCtx) => {
    const updated = await vehicleRequests.cancel(c.user, c.params.id);
    notifier.live(await vehicleRequests.recipients(updated), { type: 'vehicle_service', vehicleId: updated?.vehicle_id, requestId: updated?.id });
    return updated;
  });
  r.get('/api/admin/insurers', ['admin'], (c: AuthedCtx) => vehicleRequests.insurers(c.user));
  r.post('/api/admin/vehicle-service-requests/:id/assign-insurer', staff, async (c: AuthedCtx) => {
    const b = parse(z.object({ insurerId: z.string().uuid() }), c.body);
    const request = await vehicleRequests.assignInsurer(c.user, c.params.id, b.insurerId);
    notifier.live([b.insurerId], { type: 'vehicle_service', requestId: request.id, vehicleId: request.vehicle_id });
    return request;
  });
  r.get('/api/insurer/requests', ['insurer'], (c: AuthedCtx) => vehicleRequests.insurerQueue(c.user));
  r.get('/api/insurer/inspections', ['insurer'], (c: AuthedCtx) => vehicleRequests.inspectionQueue(c.user));
  r.get('/api/insurer/finance', ['insurer'], (c: AuthedCtx) => partnerFinance.mine(c.user));
  r.patch('/api/insurer/inspections/:id', ['insurer'], async (c: AuthedCtx) => {
    const b = parse(z.object({status:z.enum(['completed','rejected']),note:z.string().max(2000).optional()}),c.body);
    const updated = await vehicleRequests.updateInspection(c.user,c.params.id,b.status,b.note);
    notifier.live(await vehicleRequests.recipients(updated),
      {type:'vehicle_service',requestId:updated.id,vehicleId:updated.vehicle_id,status:updated.status});
    return updated;
  });

  r.post('/api/admin/vehicle-service-requests/:id/assign-inspection', staff, async (c: AuthedCtx) => {
    const b = parse(z.object({ partnerId: z.string().uuid() }), c.body);
    const request = await vehicleRequests.assignInspection(c.user,c.params.id,b.partnerId);
    notifier.live([b.partnerId],{type:'vehicle_service',requestId:request.id,vehicleId:request.vehicle_id});
    return request;
  });

  r.patch('/api/insurer/requests/:id', ['insurer'], async (c: AuthedCtx) => {
    const b = parse(z.object({ status: z.enum(['completed', 'rejected']), note: z.string().max(2000).optional(),
      policyExpiresOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }), c.body);
    const updated = await vehicleRequests.setStatus(c.user, c.params.id, b.status, b.note, b.policyExpiresOn);
    const recipients = await vehicleRequests.recipients(updated);
    await notifier.notify(recipients, { type: 'vehicle_service', requestId: updated.id, vehicleId: updated.vehicle_id, status: updated.status },
      { kind: 'normal', title: b.status === 'completed' ? 'Страхование оформлено' : 'Страхование отклонено',
        body: updated.staff_note || (b.status === 'completed' ? 'Проверьте срок полиса в гараже' : 'Посмотрите комментарий в истории машины'),
        data: { vehicleId: String(updated.vehicle_id), requestId: String(updated.id) } });
    return updated;
  });
  r.get('/api/admin/vehicle-service-requests', ['admin'], (c: AuthedCtx) => vehicleRequests.queue(c.user));
  r.patch('/api/admin/vehicle-service-requests/:id', staff, async (c: AuthedCtx) => {
    const b = parse(z.object({ status: vehicleRequestStatus, note: z.string().max(2000).optional(), policyExpiresOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }), c.body);
    const updated = await vehicleRequests.setStatus(c.user, c.params.id, b.status, b.note, b.policyExpiresOn);
    const recipients = await vehicleRequests.recipients(updated);
    const event = { type: 'vehicle_service', vehicleId: updated?.vehicle_id, requestId: updated?.id, status: updated?.status };
    const important: Record<string, { title: string; body: string }> = {
      need_documents: { title: 'Нужны документы по заявке', body: updated?.staff_note || 'Откройте историю автомобиля и проверьте комментарий специалиста.' },
      completed: { title: 'Услуга выполнена', body: updated?.kind === 'insurance' ? 'Страхование завершено. Проверьте срок полиса в гараже.' : 'Техосмотр завершён. Подробности доступны в гараже.' },
      rejected: { title: 'Заявка отклонена', body: updated?.staff_note || 'Причину можно посмотреть в истории автомобиля.' },
    };
    if (important[b.status]) {
      await notifier.notify(recipients, event, {
        kind: 'normal', ...important[b.status],
        data: { vehicleId: String(updated.vehicle_id), requestId: String(updated.id), status: b.status },
      }).catch((error) => console.warn('[vehicle service notification]', error));
    } else {
      notifier.live(recipients, event);
    }
    return updated;
  });
  r.get('/api/insurance-reminders/settings', true, async (c: AuthedCtx) => {
    const ownerId = c.user.owner_id ?? c.user.id;
    const row = await d.db.one<{ insurance_reminders_enabled: boolean }>(
      'select insurance_reminders_enabled from users where id=$1', [ownerId]);
    return { enabled: row?.insurance_reminders_enabled ?? true };
  });
  r.put('/api/insurance-reminders/settings', true, async (c: AuthedCtx) => {
    if (c.user.owner_id) throw forbidden('Настройками напоминаний управляет владелец');
    const { enabled } = parse(z.object({ enabled: z.boolean() }), c.body);
    await d.db.query('update users set insurance_reminders_enabled=$2 where id=$1', [c.user.id, enabled]);
    return { enabled };
  });
  r.get('/api/fleet', true, (c: AuthedCtx) => fleet.get(c.user));
  r.put('/api/fleet', true, (c: AuthedCtx) => fleet.set(c.user, parse(z.object({
    mode: z.enum(['limit', 'approve']).optional(),
    perOrder: z.number().int().min(0).max(100_000_000).nullable().optional(), perMonth: z.number().int().min(0).max(1_000_000_000).nullable().optional(),
    allow: z.object({ repair: z.boolean().optional(), tow: z.boolean().optional(), consult: z.boolean().optional(), service: z.boolean().optional(), shop: z.boolean().optional(), insurance: z.boolean().optional(), inspection: z.boolean().optional() }).optional(),
    edoPdfOnly: z.boolean().optional(),
  }), c.body)));
  r.post('/api/fleet/vehicles/:id/new-qr', true, (c: AuthedCtx) => fleet.newQr(c.user, c.params.id));
  r.get('/api/fleet/rules', true, (c: AuthedCtx) => fleet.rules(c.user));
  r.post('/api/orders/:id/owner-decision', true, (c: AuthedCtx) => {
    const b = parse(z.object({ approve: z.boolean(), reason: z.string().max(300).optional() }), c.body);
    return orders.ownerDecision(c.user, c.params.id, b.approve, b.reason);
  });
  r.get('/api/qr/:code', false, (c: Ctx) => fleet.qrInfo(c.params.code));
  r.post('/api/qr/:code/join', true, (c: AuthedCtx) => fleet.qrJoin(c.user, c.params.code));

  // Рембаза: кабинет сервиса ---------------------------------------------------
  const centerSchema = z.object({
    name: z.string().min(2).max(120).optional(), address: z.string().min(3).max(300).optional(),
    lat: z.number().min(-90).max(90).nullable().optional(), lng: z.number().min(-180).max(180).nullable().optional(),
    hours: z.string().max(60).optional(), inn: z.string().max(12).nullable().optional(),
    brands: z.array(z.string().max(40)).max(40).optional(),
    staff: z.record(z.string().max(20), z.enum(['own', 'invite', 'none'])).optional(),
    conditions: z.array(z.enum(['parking', 'pit', 'lift', 'night'])).max(4).optional(),
    accepts: z.array(z.enum(['quick', 'day', 'long'])).max(3).optional(),
    closedDays: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).max(60).optional(),
    paused: z.boolean().optional(),
  });
  r.get('/api/base', true, (c: AuthedCtx) => centers.cabinet(c.user));
  r.put('/api/base', true, (c: AuthedCtx) => centers.save(c.user, parse(centerSchema, c.body)));
  r.post('/api/base/confirm-accepts', ['service'], (c: AuthedCtx) => centers.confirmAccepts(c.user));
  r.post('/api/base/bookings/:id/respond', ['service'], (c: AuthedCtx) => centers.respond(c.user, c.params.id, parse(z.object({
    action: z.enum(['accept', 'clarify', 'decline', 'undo']), time: z.string().max(20).optional(), q: z.string().max(300).optional(), reason: z.string().max(200).optional(),
  }), c.body)));
  r.post('/api/base/bookings/:id/status', ['service'], (c: AuthedCtx) => centers.setStatus(c.user, c.params.id, parse(z.object({ status: z.string().max(20) }), c.body).status));
  r.post('/api/base/bookings/:id/note', ['service'], (c: AuthedCtx) => centers.note(c.user, c.params.id, parse(z.object({ text: z.string().max(500).optional(), notesPublic: z.boolean().optional() }), c.body)));
  r.post('/api/base/bookings/:id/still-here', ['service'], (c: AuthedCtx) => centers.stillHere(c.user, c.params.id));
  r.post('/api/base/bookings/:id/ready', ['service'], (c: AuthedCtx) => centers.ready(c.user, c.params.id, parse(z.object({ works: z.array(z.string().max(80)).max(20) }), c.body).works));
  r.post('/api/base/bookings/:id/invoice', ['service'], (c: AuthedCtx) => { const b = parse(z.object({ amount: z.number().int().min(100).max(100_000_000), points: money.optional() }), c.body); return centers.invoice(c.user, c.params.id, b.amount, b.points ?? 0); });
  // Сколько баллов рембаза может погасить в счёте на сумму amount
  r.get('/api/base/points', ['service'], async (c: AuthedCtx) => { const fees = await settings.get('fees'); const amount = Number(c.query.get('amount') ?? 0) || 0; const commission = Math.min(Math.round(amount * fees.serviceCommissionPct / 100), fees.serviceCommissionMax); return referral.available(c.user.id, commission); });
  r.get('/api/base/bookings/:id/company', ['service'], (c: AuthedCtx) => centers.companyCard(c.user, c.params.id));
  // Рембаза: клиент
  r.get('/api/services', true, (c: AuthedCtx) => {
    const q = c.query;
    const num = (x: string | null) => (x == null || x === '' || !Number.isFinite(Number(x)) ? undefined : Number(x));
    return centers.list(c.user, { lat: num(q.get('lat')), lng: num(q.get('lng')), need: q.get('need') ?? undefined, brand: q.get('brand') ?? undefined });
  });
  r.get('/api/services/:id', true, (c: AuthedCtx) => centers.center(c.user, c.params.id));
  r.post('/api/services/:id/book', true, (c: AuthedCtx) => {
    if (!c.user.roles.some((r) => ['client','driver'].includes(r))) throw forbidden('Для записи в СТО нужен клиентский аккаунт');
    return centers.book(c.user, c.params.id, parse(z.object({
    vehicleId: z.string().uuid().nullable().optional(), need: z.string().max(20), day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    time: z.string().max(20).nullable().optional(), arrival: z.enum(['self', 'tow']).default('self'), comment: z.string().max(500).nullable().optional(),
    fromOrderId: z.string().uuid().nullable().optional(),
  }), c.body));
  });
  r.get('/api/bookings', true, (c: AuthedCtx) => centers.myBookings(c.user));
  r.get('/api/bookings/:id', true, (c: AuthedCtx) => centers.booking(c.user, c.params.id));
  r.post('/api/bookings/:id/answer', true, (c: AuthedCtx) => centers.answer(c.user, c.params.id, parse(z.object({ text: z.string().min(2).max(500) }), c.body).text));
  r.post('/api/bookings/:id/cancel', true, (c: AuthedCtx) => centers.cancel(c.user, c.params.id));
  r.post('/api/bookings/:id/confirm', true, (c: AuthedCtx) => centers.confirm(c.user, c.params.id, parse(z.object({
    agree: z.boolean(), stars: z.number().int().min(1).max(5).optional(), text: z.string().max(1000).optional(), why: z.string().max(1000).optional(),
  }), c.body)));
  r.post('/api/orders/:id/recommend-service', performerRoles, (c: AuthedCtx) => onsite.recommend(c.user, c.params.id, parse(z.object({ centerId: z.string().uuid().nullable() }), c.body).centerId));
  r.get('/api/admin/services', staff, () => centers.pending());
  r.get('/api/admin/service-payouts', ['admin'], () => centers.payoutsDue());
  r.post('/api/admin/bookings/:id/paid', ['admin'], (c: AuthedCtx) => centers.markPaidOut(c.user, c.params.id));
  r.get('/api/base/money', ['service'], (c: AuthedCtx) => centers.money(c.user));
  r.get('/api/admin/summary', ['admin'], () => stats.summary());
  r.get('/api/admin/live', ['admin'], () => stats.liveOrders());
  r.post('/api/admin/services/:id/verify', staff, (c: AuthedCtx) => centers.verify(c.user, c.params.id, parse(z.object({ decision: z.enum(['approved', 'rejected']) }), c.body).decision));

  r.get('/api/my-performers', true, (c: AuthedCtx) => orders.myPerformers(c.user));
  r.put('/api/my-performers/:id', true, (c: AuthedCtx) => orders.setPref(c.user, c.params.id, parse(z.object({ pref: z.enum(['fav', 'hide']).nullable() }), c.body).pref));
  r.get('/api/orders', true, (c: AuthedCtx) =>
    orders.list(c.user, c.query.get('as') === 'performer' ? 'performer' : 'client', c.query.get('status') ?? undefined));
  r.get('/api/orders/:id', true, (c: AuthedCtx) => orders.view(c.user, c.params.id));
  r.post('/api/orders/:id/accept', performerRoles, async (c: AuthedCtx) => (await offers.requirePerformer(c.user), orders.accept(c.user, c.params.id)));
  r.post('/api/orders/:id/decline', performerRoles, (c: AuthedCtx) => orders.decline(c.user, c.params.id));
  r.post('/api/orders/:id/drop', performerRoles, (c: AuthedCtx) => orders.drop(c.user, c.params.id, parse(z.object({ reason: z.string().min(2).max(300) }), c.body).reason));
  r.post('/api/orders/:id/step', performerRoles, (c: AuthedCtx) =>
    orders.performerStep(c.user, c.params.id, parse(z.object({ action: z.enum(['depart', 'arrive', 'start_work']) }), c.body).action));
  r.post('/api/orders/:id/amount', performerRoles, (c: AuthedCtx) => orders.proposeAmount(c.user, c.params.id, parse(z.object({
    // Суммы за работу здесь нет — её считает таймер. Только расходники и запчасти, каждая строкой
    extras: z.array(z.object({ name: z.string().min(2).max(60), amount: money })).max(10).optional(),
    result: z.enum(['solved', 'cause_found', 'not_found']).optional(), note: z.string().max(300).optional(),
  }), c.body)));
  // Неоплата: клиент отказывается платить — сообщает мастер или сам клиент. Сразу поддержка и случай модератору.
  // not_done — клиент: работа не выполнена (причина обязательна); refuse — клиент отказывается без причины
  // (экран заранее напомнил ему условия оферты); client_refuses — мастер: клиент не платит.
  r.post('/api/orders/:id/nonpayment', true, async (c: AuthedCtx) => {
    const b = parse(z.object({ kind: z.enum(['not_done', 'refuse', 'client_refuses']), reason: z.string().max(500).optional() }), c.body);
    const o = await orders.mustSee(c.user, c.params.id);
    const who = orders.actorOf(c.user, o);
    if (who !== 'client' && who !== 'performer') throw forbidden('Сообщить о неоплате могут участники заявки');
    if ((who === 'performer') !== (b.kind === 'client_refuses')) throw bad('bad_kind', 'Не тот вариант для вашей роли');
    if (!['arrived', 'working', 'awaiting_confirmation'].includes(o.status)) throw new HttpError(409, 'bad_status', 'Это решается на месте, пока сумма не подтверждена');
    const reason = (b.reason ?? '').trim();
    if (b.kind !== 'refuse' && reason.length < 5) throw bad('need_reason', 'Опишите коротко, что случилось');
    const label = { not_done: 'Клиент: работа не выполнена', refuse: 'Клиент отказывается платить без причины (условия оферты показаны)', client_refuses: 'Мастер: клиент отказывается платить' }[b.kind];
    const text = `${label}${reason ? `. ${reason}` : ''}`;
    const t = await support.open(c.user, { topic: 'Отказ от оплаты', text, orderId: o.id });
    await moderation.open({ kind: 'dispute', title: `Отказ от оплаты · заявка №${o.number}`, text, openedBy: c.user.id,
      targetId: b.kind === 'not_done' ? o.performer_id : o.client_id, orderId: o.id, ticketId: (t as any)?.id ?? null, priority: 2 });
    await orders.event(d.db, o.id, c.user.id, 'nonpayment', { kind: b.kind, reason });
    return orders.view(c.user, o.id);
  });
  // Мастер на заявке
  r.post('/api/orders/:id/late', performerRoles, (c: AuthedCtx) => onsite.late(c.user, c.params.id, parse(z.object({ minutes: z.number().int().min(5).max(240) }), c.body).minutes));
  r.post('/api/orders/:id/site-flags', performerRoles, (c: AuthedCtx) => onsite.flags(c.user, c.params.id, parse(z.object({ flags: z.array(z.string().max(30)).max(10) }), c.body).flags));
  r.post('/api/orders/:id/hint-check', performerRoles, (c: AuthedCtx) => onsite.hintCheck(c.user, c.params.id, parse(z.object({ result: z.enum(['yes', 'part', 'no']) }), c.body).result));
  r.get('/api/orders/:id/client-card', performerRoles, (c: AuthedCtx) => onsite.clientCard(c.user, c.params.id));
  r.post('/api/orders/:id/vehicle', performerRoles, (c: AuthedCtx) => onsite.fixVehicle(c.user, c.params.id, parse(z.object({
    brand: z.string().min(1).max(40).optional(), model: z.string().max(40).nullish(), year: z.number().int().min(1950).max(2100).nullish(), axles: z.number().int().min(2).max(5).nullish(),
  }), c.body)));
  r.post('/api/orders/:id/block-client', performerRoles, (c: AuthedCtx) => {
    const b = parse(z.object({ on: z.boolean(), reason: z.string().max(200).optional() }), c.body);
    return onsite.block(c.user, c.params.id, b.on, b.reason);
  });
  r.get('/api/performer/blacklist', performerRoles, (c: AuthedCtx) => onsite.blacklist(c.user));
  r.delete('/api/performer/blacklist/:id', performerRoles, (c: AuthedCtx) => onsite.unblock(c.user, c.params.id));
  r.post('/api/orders/:id/consult-finish', performerRoles, (c: AuthedCtx) => orders.finishConsult(c.user, c.params.id, parse(z.object({
    hints: z.array(z.string().min(1).max(40)).min(1).max(3), confidence: z.enum(['sure', 'likely', 'guess']), note: z.string().max(300).optional(),
  }), c.body)));
  r.post('/api/orders/:id/confirm', true, (c: AuthedCtx) => { const b = parse(z.object({ total: money.optional(), points: money.optional() }), c.body); return orders.confirmAmount(c.user, c.params.id, b.total, b.points ?? 0); });
  r.post('/api/orders/:id/dispute', true, (c: AuthedCtx) => orders.disputeAmount(c.user, c.params.id, parse(z.object({ reason: z.string().min(2).max(500) }), c.body).reason));
  r.post('/api/orders/:id/cancel', true, (c: AuthedCtx) => orders.cancel(c.user, c.params.id, parse(z.object({ reason: z.string().min(2).max(300) }), c.body).reason));
  r.post('/api/orders/:id/retry', true, (c: AuthedCtx) => orders.retry(c.user, c.params.id));
  // Торги
  r.get('/api/orders/:id/offers', true, (c: AuthedCtx) => {
    const sort = c.query.get('sort') ?? 'recommended';
    return auction.list(c.user, c.params.id, (['recommended', 'price', 'eta', 'distance', 'rating'].includes(sort) ? sort : 'recommended') as any);
  });
  r.post('/api/orders/:id/offers', performerRoles, async (c: AuthedCtx) => {
    await offers.requirePerformer(c.user);
    return auction.offer(c.user, c.params.id, parse(z.object({ price: money.optional() }), c.body).price);
  });
  r.delete('/api/orders/:id/offers', performerRoles, (c: AuthedCtx) => auction.withdraw(c.user, c.params.id));
  r.post('/api/orders/:id/offers/:offerId/choose', true, (c: AuthedCtx) => auction.choose(c.user, c.params.id, c.params.offerId));
  r.get('/api/performer/auctions', performerRoles, (c: AuthedCtx) => auction.open(c.user));
  r.get('/api/orders/:id/messages', true, (c: AuthedCtx) => chat.list(c.user, c.params.id, Number(c.query.get('after') ?? 0)));
  r.post('/api/orders/:id/messages', true, (c: AuthedCtx) => {
    const b = parse(z.object({ body: z.string().min(1).max(2000), kind: z.enum(['text', 'quick']).default('text') }), c.body);
    return chat.post(c.user, c.params.id, b.body, b.kind);
  });
  r.get('/api/orders/:id/reviews', true, (c: AuthedCtx) => reviews.forOrder(c.user, c.params.id));
  r.post('/api/orders/:id/review', true, (c: AuthedCtx) => reviews.leave(c.user, c.params.id, parse(z.object({
    stars: z.number().int().min(1).max(5), tags: z.array(z.string().max(60)).max(10).optional(), text: z.string().max(1000).optional(),
  }), c.body)));
  r.get('/api/orders/:id/payments', true, (c: AuthedCtx) => payments.forOrder(c.user, c.params.id));
  // Отзывы об исполнителе видят все; о клиенте — только исполнители, модераторы и он сам
  r.get('/api/users/:id/reviews', true, async (c: AuthedCtx) => {
    const t = await d.db.one<{ roles: string[] }>('select roles from users where id=$1', [c.params.id]);
    if (!t) throw notFound();
    const targetIsPerformer = t.roles.some((x) => (performerRoles as readonly string[]).includes(x));
    const meSees = c.user.id === c.params.id || c.user.roles.some((x) => (performerRoles as readonly string[]).includes(x) || x === 'admin' || x === 'moderator');
    if (!targetIsPerformer && !meSees) throw forbidden();
    return reviews.about(c.params.id);
  });

  // Платёжный сервис ---------------------------------------------------------
  r.post('/api/payments/webhook', false, (c: Ctx) => payments.handleWebhook(c.body));
  if (!isProd) {
    // Тестовая «страница оплаты»: GET показывает кнопку, POST проводит платёж
    r.post('/api/dev/mock-pay/:id', false, async (c: Ctx) => {
      if (!(d.payments instanceof MockProvider)) throw notFound();
      const pay = await d.db.one('select capture_kind from (select kind as capture_kind from payments where provider_payment_id=$1) s', [c.params.id]);
      if (!pay) throw notFound();
      d.payments.simulate(c.params.id, pay.capture_kind === 'call_out' ? 'held' : 'captured');
      return payments.handleWebhook({ paymentId: c.params.id });
    });
  }

  // Модератор и админ -----------------------------------------------------------
  r.get('/api/admin/insurance-access', ['admin'], async () => {
    const policy = await settings.get('insurancePartners');
    const counts = await d.db.one<{ count: string }>(
      "select count(*)::text as count from users where 'insurer'=any(roles) and status='active'");
    return { primaryConfigured: !!config.insurerPrimaryPhone,
      registrationOpen: policy.registrationOpen, registeredCount: Number(counts?.count ?? 0) };
  });
  r.get('/api/admin/settings', ['admin'], () => settings.all());
  r.put('/api/admin/settings/:key', ['admin'], (c: AuthedCtx) => {
    if (!(c.params.key in defaultSettings)) throw notFound('Нет такой настройки');
    if (c.params.key === 'insurancePartners') {
      const input = parse(z.object({ registrationOpen: z.boolean() }).strict(), c.body);
      if (input.registrationOpen && !config.insurerPrimaryPhone)
        throw bad('insurer_number_missing', 'Сначала закрепите номер первого страхового агента в настройках сервера.');
      return settings.set('insurancePartners', input, c.user.id);
    }
    return settings.set(c.params.key as any, c.body ?? {}, c.user.id);
  });
  r.get('/api/admin/users', ['admin'], (c: AuthedCtx) => {
    const q = `%${(c.query.get('q') ?? '').replace(/[%_]/g, '')}%`;
    return d.db.query(
      `select u.id, u.phone, u.name, u.roles, u.status, u.rating::float as rating, u.rating_count, u.created_at,
              p.kind, p.verification, p.line_status, p.tax_status, p.is_priority
         from users u left join performer_profiles p on p.user_id = u.id
        where u.phone ilike $1 or coalesce(u.name,'') ilike $1 order by u.created_at desc limit 100`, [q]);
  });
  r.post('/api/admin/users/:id/roles', ['admin'], (c: AuthedCtx) =>
    admin.setRoles(c.user, c.params.id, parse(z.object({ roles: z.array(z.enum(ROLES as [string, ...string[]])).min(1) }), c.body).roles));
  r.get('/api/admin/users/:id', ['admin'], (c: AuthedCtx) => admin.userCard(c.params.id));
  r.get('/api/admin/search', ['admin'], (c: AuthedCtx) => admin.search(c.query.get('q') ?? ''));
  r.post('/api/admin/payments/:id/refund', ['admin'], (c: AuthedCtx) => admin.refund(c.user, c.params.id, parse(z.object({
    amount: money.positive(), from: z.enum(['platform', 'performer']), reason: z.string().min(3).max(300),
  }), c.body)));
  r.post('/api/admin/performers/:id/adjust', ['admin'], (c: AuthedCtx) => admin.adjust(c.user, c.params.id, parse(z.object({
    amount: z.number().int(), reason: z.string().min(3).max(300), orderId: z.string().uuid().optional(),
  }), c.body)));
  r.post('/api/admin/users/:id/fee', ['admin'], (c: AuthedCtx) => {
    const b = parse(z.object({ pct: z.number().min(0).max(30).nullable(), reason: z.string().min(3).max(300) }), c.body);
    return admin.setClientFee(c.user, c.params.id, b.pct, b.reason);
  });
  r.post('/api/admin/users/:id/bonus', ['admin'], (c: AuthedCtx) => {
    const b = parse(z.object({ amount: z.number().int(), reason: z.string().min(3).max(300) }), c.body);
    return admin.bonus(c.user, c.params.id, b.amount, b.reason);
  });
  r.post('/api/admin/orders/:id/discount', ['admin'], (c: AuthedCtx) => {
    const b = parse(z.object({ amount: money, reason: z.string().min(3).max(300) }), c.body);
    return admin.discount(c.user, c.params.id, b.amount, b.reason);
  });
  r.post('/api/admin/performers/:id/offline', staff, (c: AuthedCtx) =>
    admin.forceOffline(c.user, c.params.id, parse(z.object({ reason: z.string().min(3).max(300) }), c.body).reason));
  r.post('/api/admin/orders/:id/resolve', ['admin'], (c: AuthedCtx) => admin.resolve(c.user, c.params.id, parse(z.object({
    action: z.enum(['complete', 'cancel']), workAmount: money.optional(), reason: z.string().min(3).max(300),
    stage: z.enum(['searching', 'accepted', 'en_route_first_half', 'en_route_second_half', 'arrived', 'performer_fault']).optional(),
  }), c.body)));
  r.post('/api/admin/users/:id/block', staff, async (c: AuthedCtx) => {
    const b = parse(z.object({ blocked: z.boolean(), reason: z.string().max(300).optional() }), c.body);
    // A moderator may help with abuse cases, but cannot disable a privileged account.
    if (!c.user.roles.includes('admin')) {
      const target = await d.db.one<{ roles: string[] }>('select roles from users where id=$1', [c.params.id]);
      if (!target || target.roles.some(r => r === 'admin' || r === 'moderator'))
        throw forbidden('Модератор не может блокировать сотрудников площадки');
    }
    await d.db.query('update users set status=$2 where id=$1', [c.params.id, b.blocked ? 'blocked' : 'active']);
    if (b.blocked) await d.db.query('delete from sessions where user_id=$1', [c.params.id]);
    await audit(c.user.id, b.blocked ? 'user.block' : 'user.unblock', c.params.id, b);
    return { ok: true };
  });
  r.post('/api/admin/performers/:id/verify', staff, async (c: AuthedCtx) => {
    const b = parse(z.object({ decision: z.enum(['approved', 'rejected', 'pending']), note: z.string().max(300).optional() }), c.body);
    return documents.decide(c.user, c.params.id, b.decision, b.note);
  });
  r.get('/api/admin/verification', staff, () => documents.queue());
  r.post('/api/admin/documents/:id', staff, (c: AuthedCtx) =>
    documents.review(c.user, c.params.id, parse(z.object({ status: z.enum(['approved', 'rejected']), note: z.string().max(300).optional() }), c.body)));
  r.post('/api/admin/performers/:id/priority', ['admin'], async (c: AuthedCtx) => {
    const b = parse(z.object({ isPriority: z.boolean() }), c.body);
    await d.db.query('update performer_profiles set is_priority=$2 where user_id=$1', [c.params.id, b.isPriority]);
    await audit(c.user.id, 'performer.priority', c.params.id, b);
    return { ok: true };
  });
  r.get('/api/admin/orders', ['admin'], (c: AuthedCtx) => d.db.query(
    `select o.id, o.number, o.status, o.service, o.is_sos, o.address, o.created_at, o.payment_method,
            o.call_out_amount, o.work_amount, c.phone as client_phone, p.name as performer_name
       from orders o join users c on c.id=o.client_id left join users p on p.id=o.performer_id
      where ($1::text is null or o.status=$1) order by o.created_at desc limit 200`, [c.query.get('status')]));
  r.get('/api/admin/chat/flagged', staff, () => d.db.query(
    `select m.id::int as id, m.order_id, m.body, m.created_at, u.phone from chat_messages m left join users u on u.id=m.sender_id
      where m.flagged order by m.id desc limit 200`));
  r.post('/api/admin/reviews/:id', staff, (c: AuthedCtx) =>
    reviews.moderate(c.user, c.params.id, parse(z.object({ disputed: z.boolean().optional(), hidden: z.boolean().optional() }), c.body)));
  r.post('/api/admin/offers', ['admin'], (c: AuthedCtx) => offers.publish(c.user, parse(z.object({
    audience: z.enum(['client', 'performer', 'privacy']), version: z.string().min(1).max(20), body: z.string().min(50).max(200_000),
    summary: z.string().max(500).optional(), effectiveAt: z.string().optional(),
  }), c.body)));
  r.get('/api/admin/offers', ['admin'], () => offers.history());
  r.post('/api/admin/payouts/run', ['admin'], (c: AuthedCtx) => payments.runPayouts(c.user));
  r.post('/api/admin/payments/:id/invoice-paid', ['admin'], (c: AuthedCtx) => payments.markInvoicePaid(c.user, c.params.id));
  r.post('/api/admin/performers/:id/cash-debt-paid', ['admin'], (c: AuthedCtx) =>
    payments.cashDebtPaid(c.user, c.params.id, parse(z.object({ amount: money }), c.body).amount));
  r.get('/api/admin/agent-report', ['admin'], (c: AuthedCtx) => payments.agentReport(c.query.get('period') ?? '', c.query.get('performer') ?? undefined));
  r.get('/api/admin/audit', ['admin'], () => d.db.query('select * from audit_log order by id desc limit 200'));

  async function audit(actorId: string, action: string, target: string, data: unknown) {
    await d.db.query('insert into audit_log(actor_id, action, target, data) values ($1,$2,$3,$4)', [actorId, action, target, data]);
  }

  // Обработчик HTTP ------------------------------------------------------------
  async function handle(req: http.IncomingMessage, res: http.ServerResponse) {
    const origin = req.headers.origin;
    const cors: Record<string, string> = {};
    if (origin && (config.corsOrigins.includes('*') || config.corsOrigins.includes(origin))) {
      cors['access-control-allow-origin'] = origin;
      cors['access-control-allow-headers'] = 'authorization, content-type';
      cors['access-control-allow-methods'] = 'GET, POST, PUT, PATCH, DELETE, OPTIONS';
      cors['vary'] = 'origin';
    }
    if (req.method === 'OPTIONS') return send(res, 204, undefined, cors);
    const url = new URL(req.url ?? '/', 'http://x');
    try {
      const m = r.match(req.method ?? 'GET', url.pathname);
      if (!m) throw notFound('Нет такого адреса');
      const limit = url.pathname === '/api/performer/documents' || /^\/api\/insurance\/requests\/[^/]+\/policy$/.test(url.pathname) ? 8_000_000 : 1_000_000;
      const rawBody = ['POST', 'PUT', 'PATCH'].includes(req.method!) ? await readBody(req, limit) : '';
      let body: any = {};
      if (rawBody) {
        try { body = JSON.parse(rawBody); } catch { throw bad('bad_json', 'Тело запроса — JSON'); }
      }
      const user = await auth.authenticate(bearer(req));
      if (user?.roles.includes('insurer') && !user.roles.some((r) => r === 'admin' || r === 'moderator') &&
          /^\/api\/(orders|vehicles|fleet|performer|base|services|bookings|qr)(?:\/|$)/.test(url.pathname))
        throw forbidden('Страховой аккаунт не является клиентским или рабочим кабинетом');
      const a = m.route.auth;
      if (a !== false) {
        if (!user) return send(res, 401, { error: 'unauthorized', message: 'Войдите по номеру телефона' }, cors);
        if (Array.isArray(a) && !a.some((role) => user.roles.includes(role)) && !user.roles.includes('admin')) throw forbidden();
      }
      const ctx: Ctx = { req, params: m.params, query: url.searchParams, body, user, ip: clientIp(req), rawBody, headers: req.headers };
      const out = await m.route.handler(ctx);
      send(res, 200, out === undefined ? { ok: true } : out, cors);
    } catch (e) {
      const { status, body } = errorBody(e);
      if (status >= 500) console.error(e);
      send(res, status, body, cors);
    }
  }

  return { handle, hub, auth, settings, orders, payments, auction, documents, admin, profiles, chat, reviews, offers, notifier, privacy, ops, router: r };
}

export type App = ReturnType<typeof createApp>;

export function bearer(req: http.IncomingMessage) {
  const h = req.headers.authorization;
  if (h?.startsWith('Bearer ')) return h.slice(7);
  const u = new URL(req.url ?? '/', 'http://x');
  return u.searchParams.get('token');
}

function clientIp(req: http.IncomingMessage) {
  const remote = req.socket.remoteAddress ?? '';
  // Forwarded IPs may affect security controls and SMS spending.
  // Trust them only from our private reverse proxy, and only when explicitly enabled.
  const privatePeer = /^(::1|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::ffff:(127|10|192\.168)\.|fc|fd)/i.test(remote);
  if (config.trustProxy && privatePeer) {
    const f = req.headers['x-forwarded-for'];
    const forwarded = (Array.isArray(f) ? f[0] : f)?.split(',')[0].trim();
    if (forwarded && isIP(forwarded)) return forwarded;
  }
  return remote;
}
