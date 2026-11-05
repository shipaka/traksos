import http from 'node:http';
import { z } from 'zod';
import type { Db } from './db/index.ts';
import { Router, parse, readBody, send, errorBody, forbidden, bad, notFound, type Ctx, type AuthedCtx } from './http/router.ts';
import { Hub } from './realtime/hub.ts';
import type { SmsProvider } from './providers/sms.ts';
import type { PushProvider } from './providers/push.ts';
import type { PaymentProvider } from './payments/provider.ts';
import { MockProvider } from './payments/provider.ts';
import { SettingsService } from './services/settings.ts';
import { Notifier } from './services/notify.ts';
import { AuthService, SELF_ROLES } from './services/auth.ts';
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
const ROLES = ['client', 'driver', 'master', 'tow', 'service', 'moderator', 'admin'];

export function createApp(d: Deps) {
  const now = d.now ?? (() => new Date());
  const hub = new Hub();
  const settings = new SettingsService(d.db);
  const notifier = new Notifier(d.db, hub, d.push);
  const auth = new AuthService(d.db, d.sms, now);
  const profiles = new ProfilesService(d.db, settings);
  const orders = new OrdersService(d.db, settings, notifier, now);
  const payments = new PaymentsService(d.db, settings, d.payments, notifier, orders);
  orders.payments = payments;
  const auction = new AuctionService(d.db, settings, notifier, orders, now);
  orders.auction = auction;
  profiles.onUnavailable = async (userId) => orders.afterRelease(await orders.release(d.db, userId, null));
  const chat = new ChatService(d.db, settings, notifier, orders);
  const reviews = new ReviewsService(d.db, settings, orders);
  const offers = new OffersService(d.db, notifier, now);
  const documents = new DocumentsService(d.db, notifier, settings, now);
  const admin = new AdminService(d.db, notifier, orders, payments, profiles, settings, now);
  const support = new SupportService(d.db, notifier, orders, now);
  const stats = new StatsService(d.db, now);

  const r = new Router();
  const staff = ['admin', 'moderator'];
  const performerRoles = ['master', 'tow', 'service'];

  // Служебное ----------------------------------------------------------------
  r.get('/api/health', false, async () => ({ ok: true, db: (await d.db.one('select 1 as ok'))?.ok === 1, time: now() }));

  // Вход ---------------------------------------------------------------------
  r.post('/api/auth/code', false, (c: Ctx) => auth.requestCode(parse(z.object({ phone: z.string() }), c.body).phone));
  r.post('/api/auth/verify', false, async (c: Ctx) => {
    const b = parse(z.object({ phone: z.string(), code: z.string().min(4).max(6), role: z.enum(SELF_ROLES).optional(),
      device: z.string().max(200).optional(), acceptOffers: z.boolean().optional() }), c.body);
    const r = await auth.verify(b.phone, b.code, b.role, b.device);
    // Галочка «Согласен с офертой» на экране входа — записываем согласие на действующие редакции
    if (b.acceptOffers) await offers.acceptCurrent(r.user as any, c.ip);
    return r;
  });
  r.post('/api/auth/logout', true, async (c: AuthedCtx) => {
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
    await d.db.query(`insert into push_tokens(user_id, provider, token) values ($1,$2,$3)
                      on conflict (user_id, provider, token) do update set updated_at=now()`, [c.user.id, b.provider, b.token]);
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
  r.get('/api/admin/stats', staff, (c: AuthedCtx) => stats.overview(Math.min(365, Math.max(1, Number(c.query.get('days') ?? 30)))));
  r.get('/api/admin/support', staff, (c: AuthedCtx) => support.queue(c.query.get('status') === 'closed' ? 'closed' : 'open'));
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
      clientFeePct: all.fees.clientFeePct, reviewTags: REVIEW_TAGS };
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
  r.post('/api/orders', true, async (c: AuthedCtx) => (await offers.requireClient(c.user), orders.create(c.user, parse(z.object({
    service: z.string(), isSos: z.boolean().optional(), problem: z.string().max(40).optional(), description: z.string().max(1000).optional(),
    address: z.string().max(300).optional(), lat: z.number().optional(), lng: z.number().optional(), zoneId: z.string().default('spb'),
    tier: z.enum(['eco', 'comfort', 'pro']).optional(), vehicleId: z.string().uuid().optional(), brand: z.string().max(40).optional(),
    model: z.string().max(40).optional(), year: z.number().int().min(1950).max(2100).optional(),
    groupTrip: z.boolean().optional(), night: z.boolean().optional(), paymentMethod: z.enum(['cash', 'online', 'invoice']).optional(),
    destination: z.string().max(300).optional(), cargo: z.enum(['tractor', 'semitrailer', 'coupling', 'truck12']).optional(),
    loaded: z.enum(['empty', 'loaded', 'adr']).optional(), driverOnSite: z.boolean().optional(), fromConsult: z.string().uuid().optional(),
  }), c.body))));
  r.get('/api/orders', true, (c: AuthedCtx) =>
    orders.list(c.user, c.query.get('as') === 'performer' ? 'performer' : 'client', c.query.get('status') ?? undefined));
  r.get('/api/orders/:id', true, (c: AuthedCtx) => orders.view(c.user, c.params.id));
  r.post('/api/orders/:id/accept', performerRoles, async (c: AuthedCtx) => (await offers.requirePerformer(c.user), orders.accept(c.user, c.params.id)));
  r.post('/api/orders/:id/decline', performerRoles, (c: AuthedCtx) => orders.decline(c.user, c.params.id));
  r.post('/api/orders/:id/drop', performerRoles, (c: AuthedCtx) => orders.drop(c.user, c.params.id, parse(z.object({ reason: z.string().min(2).max(300) }), c.body).reason));
  r.post('/api/orders/:id/step', performerRoles, (c: AuthedCtx) =>
    orders.performerStep(c.user, c.params.id, parse(z.object({ action: z.enum(['depart', 'arrive', 'start_work']) }), c.body).action));
  r.post('/api/orders/:id/amount', performerRoles, (c: AuthedCtx) => orders.proposeAmount(c.user, c.params.id, parse(z.object({
    workAmount: money, result: z.enum(['solved', 'cause_found', 'not_found']).optional(), note: z.string().max(300).optional(),
  }), c.body)));
  r.post('/api/orders/:id/consult-finish', performerRoles, (c: AuthedCtx) => orders.finishConsult(c.user, c.params.id, parse(z.object({
    hints: z.array(z.string().min(1).max(40)).min(1).max(3), confidence: z.enum(['sure', 'likely', 'guess']), note: z.string().max(300).optional(),
  }), c.body)));
  r.post('/api/orders/:id/confirm', true, (c: AuthedCtx) => orders.confirmAmount(c.user, c.params.id, parse(z.object({ total: money.optional() }), c.body).total));
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
  r.post('/api/orders/:id/review', true, (c: AuthedCtx) => reviews.leave(c.user, c.params.id, parse(z.object({
    stars: z.number().int().min(1).max(5), tags: z.array(z.string().max(60)).max(10).optional(), text: z.string().max(1000).optional(),
  }), c.body)));
  r.get('/api/orders/:id/payments', true, (c: AuthedCtx) => payments.forOrder(c.user, c.params.id));
  r.get('/api/users/:id/reviews', true, (c: AuthedCtx) => reviews.about(c.params.id));

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
  r.get('/api/admin/settings', staff, () => settings.all());
  r.put('/api/admin/settings/:key', ['admin'], (c: AuthedCtx) => {
    if (!(c.params.key in defaultSettings)) throw notFound('Нет такой настройки');
    return settings.set(c.params.key as any, c.body ?? {}, c.user.id);
  });
  r.get('/api/admin/users', staff, (c: AuthedCtx) => {
    const q = `%${(c.query.get('q') ?? '').replace(/[%_]/g, '')}%`;
    return d.db.query(
      `select u.id, u.phone, u.name, u.roles, u.status, u.rating::float as rating, u.rating_count, u.created_at,
              p.kind, p.verification, p.line_status, p.tax_status, p.is_priority
         from users u left join performer_profiles p on p.user_id = u.id
        where u.phone ilike $1 or coalesce(u.name,'') ilike $1 order by u.created_at desc limit 100`, [q]);
  });
  r.post('/api/admin/users/:id/roles', ['admin'], (c: AuthedCtx) =>
    admin.setRoles(c.user, c.params.id, parse(z.object({ roles: z.array(z.enum(ROLES as [string, ...string[]])).min(1) }), c.body).roles));
  r.get('/api/admin/users/:id', staff, (c: AuthedCtx) => admin.userCard(c.params.id));
  r.get('/api/admin/search', staff, (c: AuthedCtx) => admin.search(c.query.get('q') ?? ''));
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
  r.get('/api/admin/orders', staff, (c: AuthedCtx) => d.db.query(
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
  r.get('/api/admin/offers', staff, () => offers.history());
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
      const limit = url.pathname === '/api/performer/documents' ? 8_000_000 : 1_000_000;
      const rawBody = ['POST', 'PUT', 'PATCH'].includes(req.method!) ? await readBody(req, limit) : '';
      let body: any = {};
      if (rawBody) {
        try { body = JSON.parse(rawBody); } catch { throw bad('bad_json', 'Тело запроса — JSON'); }
      }
      const user = await auth.authenticate(bearer(req));
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

  return { handle, hub, auth, settings, orders, payments, auction, documents, admin, profiles, chat, reviews, offers, notifier, router: r };
}

export type App = ReturnType<typeof createApp>;

export function bearer(req: http.IncomingMessage) {
  const h = req.headers.authorization;
  if (h?.startsWith('Bearer ')) return h.slice(7);
  const u = new URL(req.url ?? '/', 'http://x');
  return u.searchParams.get('token');
}

function clientIp(req: http.IncomingMessage) {
  const f = req.headers['x-forwarded-for'];
  return (Array.isArray(f) ? f[0] : f)?.split(',')[0].trim() ?? req.socket.remoteAddress ?? '';
}
