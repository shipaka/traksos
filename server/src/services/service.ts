// Рембаза (сервис-партнёр): карточка сервиса, входящие запросы, машины в ремонте, «Машина готова → счёт».
// Клиент: сервисы на карте, запись, статус ремонта, сверка работ и отзыв. Записи попадают в историю машины.

import type { Db } from '../db/index.ts';
import type { Notifier } from './notify.ts';
import type { SettingsService } from './settings.ts';
import type { SupportService } from './support.ts';
import { haversineKm } from '../domain/geo.ts';
import { bad, conflict, forbidden, notFound, type AuthUser } from '../http/router.ts';

export const NEEDS: Record<string, string> = {
  electric: 'Электрика', air: 'Пневматика', engine: 'Двигатель', gearbox: 'КПП', brakes: 'Тормоза',
  chassis: 'Ходовая', tires: 'Шины', ecu: 'Блоки управления', heater: 'Автономка', other: 'Другое',
};
export const REPAIR_STATUSES = ['arrived', 'diagnostics', 'in_work', 'waiting_part', 'agreeing'] as const;
export const STATUS_NAME: Record<string, string> = {
  new: 'Новый запрос', clarify: 'Сервис уточняет', declined: 'Сервис не может', expected: 'Ожидаем',
  arrived: 'Машина приехала', diagnostics: 'Диагностика', in_work: 'В работе', waiting_part: 'Ждём запчасть',
  agreeing: 'Согласуем с клиентом', ready: 'Готова', invoiced: 'Счёт выставлен', closed: 'Закрыто',
  disputed: 'Спор по работам', cancelled: 'Отменено',
};
export const WORKS = ['Диагностика', 'Электрика', 'Пневматика', 'Двигатель', 'КПП', 'Тормоза', 'Ходовая', 'Шины', 'Сварка', 'Замена масла и фильтров'];
export const DECLINE = ['Нет такого специалиста', 'Нет мест', 'Не работаем с этой маркой'];

const msk = (d: Date) => new Date(d.getTime() + 3 * 3600_000).toISOString().slice(0, 10);

export interface CenterInput {
  name?: string; address?: string; lat?: number | null; lng?: number | null; hours?: string; inn?: string | null;
  brands?: string[]; staff?: Record<string, 'own' | 'invite' | 'none'>; conditions?: string[]; accepts?: string[];
  closedDays?: string[]; paused?: boolean;
}

export class ServiceCenters {
  constructor(private db: Db, private notifier: Notifier, private settings: SettingsService, private support: SupportService, private now: () => Date) {}

  // ——— Карточка сервиса ———
  async mine(user: AuthUser) {
    return this.db.one('select * from service_centers where owner_id=$1', [user.id]);
  }
  private async mustMine(user: AuthUser) {
    const c = await this.mine(user);
    if (!c) throw notFound('Сначала заполните карточку сервиса');
    return c;
  }

  async save(user: AuthUser, p: CenterInput) {
    const cur = await this.mine(user);
    if (!cur && (!p.name?.trim() || !p.address?.trim())) throw bad('need_name', 'Укажите название и адрес');
    if (p.inn && !/^(\d{10}|\d{12})$/.test(p.inn)) throw bad('bad_inn', 'ИНН — 10 или 12 цифр');
    const v = (x: unknown) => (x === undefined ? null : x);
    await this.db.tx(async (q) => {
      await q.query(`update users set roles = (select array(select distinct unnest(roles || '{service}'::text[]))) where id=$1`, [user.id]);
      if (!cur) {
        await q.query(
          `insert into service_centers(owner_id, name, address, lat, lng, hours, inn, brands, staff, conditions, accepts, closed_days, accepts_confirmed_at)
           values ($1,$2,$3,$4::float8,$5::float8,coalesce($6::text,'08:00–20:00'),$7::text,coalesce($8::text[],'{}'),coalesce($9::jsonb,'{}'),coalesce($10::text[],'{}'),coalesce($11::text[],'{quick,day}'),coalesce($12::date[],'{}'),now())`,
          [user.id, p.name!.trim(), p.address!.trim(), v(p.lat), v(p.lng), v(p.hours), v(p.inn), v(p.brands), v(p.staff), v(p.conditions), v(p.accepts), v(p.closedDays)]);
      } else {
        await q.query(
          `update service_centers set name=coalesce($2::text,name), address=coalesce($3::text,address), lat=coalesce($4::float8,lat), lng=coalesce($5::float8,lng),
             hours=coalesce($6::text,hours), inn=coalesce($7::text,inn), brands=coalesce($8::text[],brands), staff=coalesce($9::jsonb,staff),
             conditions=coalesce($10::text[],conditions), accepts=coalesce($11::text[],accepts), closed_days=coalesce($12::date[],closed_days),
             paused=coalesce($13::boolean,paused), accepts_confirmed_at = case when $11::text[] is not null or $12::date[] is not null then now() else accepts_confirmed_at end
           where owner_id=$1`,
          [user.id, v(p.name?.trim()), v(p.address?.trim()), v(p.lat), v(p.lng), v(p.hours), v(p.inn), v(p.brands), v(p.staff), v(p.conditions), v(p.accepts), v(p.closedDays), v(p.paused)]);
      }
    });
    return this.cabinet(user);
  }

  /** Раз в неделю: «приём всё так же?» — одна кнопка */
  async confirmAccepts(user: AuthUser) {
    await this.mustMine(user);
    await this.db.query('update service_centers set accepts_confirmed_at=now() where owner_id=$1', [user.id]);
    return this.cabinet(user);
  }

  // ——— Кабинет рембазы ———
  async cabinet(user: AuthUser) {
    const c = await this.mine(user);
    if (!c) return { center: null, groups: null };
    const rows = await this.db.query(
      `select b.*, u.name as client_name, u.company_name, u.rating::float as client_rating
         from service_bookings b join users u on u.id=b.client_id
        where b.center_id=$1 and (b.status not in ('closed','declined','cancelled') or b.updated_at > now() - interval '30 days')
        order by b.created_at desc`, [c.id]);
    const today = msk(this.now());
    const weekAgo = this.now().getTime() - 7 * 86400_000;
    const view = (b: any) => this.bookingView(b, 'service', weekAgo);
    const confirmDue = !c.accepts_confirmed_at || new Date(c.accepts_confirmed_at).getTime() < weekAgo;
    return {
      center: { ...c, closedToday: (c.closed_days ?? []).some((d: any) => msk(new Date(d)) === today), confirmDue },
      groups: {
        requests: rows.filter((b) => ['new', 'clarify'].includes(b.status)).map(view),
        expected: rows.filter((b) => b.status === 'expected').map(view),
        repair: rows.filter((b) => (REPAIR_STATUSES as readonly string[]).includes(b.status)).map(view),
        ready: rows.filter((b) => ['ready', 'invoiced', 'disputed'].includes(b.status)).map(view),
        done: rows.filter((b) => ['closed', 'declined', 'cancelled'].includes(b.status)).map(view),
      },
    };
  }

  private bookingView(b: any, as: 'service' | 'client', weekAgo = 0) {
    const repair = (REPAIR_STATUSES as readonly string[]).includes(b.status);
    const notes = as === 'client' && !b.notes_public ? [] : b.notes;
    return {
      id: b.id, number: b.number, status: b.status, statusName: STATUS_NAME[b.status], need: b.need, needName: NEEDS[b.need] ?? b.need,
      whenDay: b.when_day, whenTime: b.when_time, acceptTime: b.accept_time, arrival: b.arrival, comment: b.comment,
      vehicle: b.vehicle, vehicleId: b.vehicle_id, clarifyQ: b.clarify_q, clientAnswer: b.client_answer, declineReason: b.decline_reason,
      notes, notesPublic: b.notes_public, works: b.works, amount: b.amount, discount: b.discount,
      commission: as === 'service' ? b.commission : undefined,
      payout: as === 'service' && b.amount != null ? b.amount - b.commission : undefined,
      toPay: b.amount != null ? b.amount - b.discount : null,
      fromOrder: !!b.from_order_id, arrivedAt: b.arrived_at, readyAt: b.ready_at, createdAt: b.created_at,
      daysInRepair: b.arrived_at ? Math.max(1, Math.ceil((this.now().getTime() - new Date(b.arrived_at).getTime()) / 86400_000)) : null,
      stillHereDue: as === 'service' && repair && !!b.from_order_id && new Date(b.still_here_at ?? b.arrived_at ?? b.created_at).getTime() < weekAgo,
      client: as === 'service' ? { name: b.company_name || b.client_name || 'Клиент', rating: b.client_rating } : undefined,
      reviewStars: b.review_stars, reviewText: b.review_text,
    };
  }

  private async mineBooking(user: AuthUser, id: string) {
    const c = await this.mustMine(user);
    const b = await this.db.one('select * from service_bookings where id=$1 and center_id=$2', [id, c.id]);
    if (!b) throw notFound('Запрос не найден');
    return { c, b };
  }

  private async tell(b: any, title: string, body: string) {
    await this.notifier.notify([b.client_id, b.created_by], { type: 'booking', bookingId: b.id, status: b.status },
      { kind: 'normal', title, body, data: { bookingId: b.id } });
  }

  async booking(user: AuthUser, id: string) {
    const b = await this.db.one(
      `select b.*, u.name as client_name, u.company_name, u.rating::float as client_rating, c.owner_id, c.name as center_name, c.address as center_address
         from service_bookings b join users u on u.id=b.client_id join service_centers c on c.id=b.center_id where b.id=$1`, [id]);
    if (!b) throw notFound('Запись не найдена');
    const asService = b.owner_id === user.id;
    const clientId = user.owner_id ?? user.id;
    if (!asService && b.client_id !== clientId && b.created_by !== user.id && !user.roles.some((r) => r === 'admin' || r === 'moderator')) throw forbidden();
    const v = this.bookingView(b, asService ? 'service' : 'client', this.now().getTime() - 7 * 86400_000);
    return { ...v, center: { id: b.center_id, name: b.center_name, address: b.center_address }, mine: asService, history: asService && b.vehicle_id ? await this.carHistory(b.vehicle_id, b.id) : [] };
  }

  /** Вся история машины на ТракSOS для сервиса — чужие работы тоже, без сумм */
  private async carHistory(vehicleId: string, except: string) {
    const orders = await this.db.query(
      `select o.service, o.problem, o.description, o.result, o.completed_at as at, 'mobile' as src from orders o
        where o.vehicle_id=$1 and o.status='completed' order by o.completed_at desc limit 30`, [vehicleId]);
    const bookings = await this.db.query(
      `select b.need, b.works, b.closed_at as at, c.name as center from service_bookings b join service_centers c on c.id=b.center_id
        where b.vehicle_id=$1 and b.status='closed' and b.id<>$2 order by b.closed_at desc limit 30`, [vehicleId, except]);
    return [
      ...orders.map((o: any) => ({ at: o.at, what: o.problem || o.description || o.service, who: 'Выездной мастер ТракSOS' })),
      ...bookings.map((b: any) => ({ at: b.at, what: (b.works?.length ? b.works.join(', ') : NEEDS[b.need]) as string, who: `Рембаза «${b.center}»` })),
    ].sort((a, b) => +new Date(b.at) - +new Date(a.at));
  }

  async respond(user: AuthUser, id: string, p: { action: 'accept' | 'clarify' | 'decline' | 'undo'; time?: string; q?: string; reason?: string }) {
    const { b } = await this.mineBooking(user, id);
    if (p.action === 'undo') {
      if (b.status !== 'expected') throw conflict('bad_status', 'Отменить можно, пока машина не приехала');
      await this.db.query(`update service_bookings set status='new', accept_time=null, updated_at=now() where id=$1`, [id]);
      return this.booking(user, id);
    }
    if (!['new', 'clarify'].includes(b.status)) throw conflict('bad_status', 'На запрос уже ответили');
    if (p.action === 'accept') {
      const time = p.time?.trim() || b.when_time || null;
      await this.db.query(`update service_bookings set status='expected', accept_time=$2, updated_at=now() where id=$1`, [id, time]);
      await this.tell({ ...b, status: 'expected' }, 'Сервис ждёт вас', `Ждём вас ${fmtDay(b.when_day)}${time ? ` в ${time}` : ''}`);
    } else if (p.action === 'clarify') {
      const q = p.q?.trim();
      if (!q) throw bad('empty', 'Что уточнить?');
      await this.db.query(`update service_bookings set status='clarify', clarify_q=$2, client_answer=null, updated_at=now() where id=$1`, [id, q]);
      await this.tell({ ...b, status: 'clarify' }, 'Сервис уточняет', q);
    } else {
      const reason = p.reason?.trim();
      if (!reason) throw bad('empty', 'Укажите причину');
      await this.db.query(`update service_bookings set status='declined', decline_reason=$2, updated_at=now() where id=$1`, [id, reason]);
      await this.tell({ ...b, status: 'declined' }, 'Сервис не может принять', `${reason} — посмотрите другие сервисы рядом`);
    }
    return this.booking(user, id);
  }

  async setStatus(user: AuthUser, id: string, status: string) {
    const { b } = await this.mineBooking(user, id);
    if (!(REPAIR_STATUSES as readonly string[]).includes(status)) throw bad('bad_status', 'Нет такого статуса');
    if (!['expected', ...REPAIR_STATUSES].includes(b.status)) throw conflict('bad_status', 'Статус уже не поменять');
    await this.db.query(
      `update service_bookings set status=$2, arrived_at=coalesce(arrived_at, now()), updated_at=now() where id=$1`, [id, status]);
    await this.tell({ ...b, status }, `Ремонт: ${STATUS_NAME[status]}`, `${b.vehicle?.brand ?? ''} ${b.vehicle?.plate ?? ''}`.trim());
    return this.booking(user, id);
  }

  async note(user: AuthUser, id: string, p: { text?: string; notesPublic?: boolean }) {
    const { b } = await this.mineBooking(user, id);
    if (p.text?.trim()) {
      await this.db.query(`update service_bookings set notes = notes || $2::jsonb, updated_at=now() where id=$1`,
        [id, JSON.stringify([{ text: p.text.trim().slice(0, 500), at: this.now().toISOString() }])]);
      if (b.notes_public || p.notesPublic) await this.tell(b, 'Сервис: заметка по ремонту', p.text.trim().slice(0, 120));
    }
    if (p.notesPublic !== undefined) await this.db.query('update service_bookings set notes_public=$2 where id=$1', [id, p.notesPublic]);
    return this.booking(user, id);
  }

  /** Долгий ремонт по совету мастера: раз в неделю — «ещё у нас», бонус мастера не сгорает */
  async stillHere(user: AuthUser, id: string) {
    const { b } = await this.mineBooking(user, id);
    if (!(REPAIR_STATUSES as readonly string[]).includes(b.status)) throw conflict('bad_status', 'Машина не в ремонте');
    await this.db.query('update service_bookings set still_here_at=now() where id=$1', [id]);
    return this.booking(user, id);
  }

  /** «Машина готова» — галочками, что делали */
  async ready(user: AuthUser, id: string, works: string[]) {
    const { b } = await this.mineBooking(user, id);
    if (!(REPAIR_STATUSES as readonly string[]).includes(b.status)) throw conflict('bad_status', 'Сначала отметьте, что машина приехала');
    const clean = [...new Set(works.map((w) => w.trim()).filter(Boolean))].slice(0, 20);
    if (!clean.length) throw bad('no_works', 'Отметьте, что делали');
    await this.db.query(`update service_bookings set status='ready', works=$2, ready_at=now(), updated_at=now() where id=$1`, [id, clean]);
    await this.tell({ ...b, status: 'ready' }, 'Машина готова', `Сделано: ${clean.join(', ')}`);
    return this.booking(user, id);
  }

  /** Агентский счёт: клиент платит через ТракSOS, сервису — за вычетом комиссии; скидка по совету мастера — из комиссии */
  async invoice(user: AuthUser, id: string, amount: number) {
    const { b } = await this.mineBooking(user, id);
    if (b.status !== 'ready') throw conflict('bad_status', 'Сначала «Машина готова»');
    const fees = await this.settings.get('fees');
    const commission = Math.round(amount * fees.serviceCommissionPct / 100);
    const discount = b.from_order_id ? Math.min(commission, Math.round(amount * fees.serviceReferralDiscountPct / 100)) : 0;
    await this.db.query(
      `update service_bookings set status='invoiced', amount=$2, commission=$3, discount=$4, invoiced_at=now(), updated_at=now() where id=$1`,
      [id, amount, commission, discount]);
    await this.tell({ ...b, status: 'invoiced' }, 'Счёт за ремонт', `${((amount - discount) / 100).toLocaleString('ru-RU')} ₽ — сверьте работы`);
    return this.booking(user, id);
  }

  async companyCard(user: AuthUser, id: string) {
    const { c, b } = await this.mineBooking(user, id);
    const u = await this.db.one(
      `select u.name, u.company_name, u.company_inn, u.rating::float as rating, u.rating_count, u.created_at,
              (select count(*)::int from vehicles v where v.owner_id=u.id) as park
         from users u where u.id=$1`, [b.client_id]) as any;
    const cars = await this.db.query(
      `select b.id, b.vehicle, b.status, b.need, b.created_at from service_bookings b
        where b.center_id=$1 and b.client_id=$2 order by b.created_at desc limit 20`, [c.id, b.client_id]);
    const closed = await this.db.one<{ n: number; disputes: number }>(
      `select count(*) filter (where status='closed')::int as n, count(*) filter (where status='disputed')::int as disputes
         from service_bookings where client_id=$1`, [b.client_id]);
    return {
      name: u.company_name || u.name || 'Клиент', inn: u.company_inn, rating: u.rating, ratingCount: u.rating_count, since: u.created_at,
      park: u.park, closedRepairs: closed?.n ?? 0, disputes: closed?.disputes ?? 0,
      cars: cars.map((x: any) => ({ id: x.id, vehicle: x.vehicle, status: x.status, statusName: STATUS_NAME[x.status], needName: NEEDS[x.need], at: x.created_at })),
    };
  }

  // ——— Клиент ———
  async list(user: AuthUser, p: { lat?: number; lng?: number; need?: string; brand?: string }) {
    const rows = await this.db.query(
      `select c.*,
              (select count(*)::int from service_bookings b where b.center_id=c.id and b.status='closed') as closed_n,
              (select count(*)::int from service_bookings b where b.center_id=c.id and b.status in ('expected','arrived','diagnostics','in_work','waiting_part','agreeing')) as load_n,
              (select round(avg(review_stars)::numeric, 1)::float from service_bookings b where b.center_id=c.id and review_stars is not null) as rating,
              (select count(*)::int from service_bookings b where b.center_id=c.id and review_stars is not null) as reviews_n
         from service_centers c where c.verification='approved' and not c.paused`);
    const today = msk(this.now());
    const max = Math.max(1, ...rows.map((r: any) => r.closed_n));
    return rows
      .filter((c: any) => !p.need || c.staff?.[p.need] !== 'none')
      .map((c: any) => ({
        id: c.id, name: c.name, address: c.address, lat: c.lat, lng: c.lng, hours: c.hours, brands: c.brands, staff: c.staff,
        conditions: c.conditions, accepts: c.accepts, rating: c.rating, reviews: c.reviews_n, load: c.load_n,
        popularity: c.closed_n === 0 ? 'new' : c.closed_n / max > 0.66 ? 'top' : c.closed_n / max > 0.33 ? 'often' : 'rare',
        closedToday: (c.closed_days ?? []).some((d: any) => msk(new Date(d)) === today),
        knowsBrand: p.brand ? (c.brands ?? []).includes(p.brand) : null,
        distanceKm: p.lat != null && p.lng != null && c.lat != null && c.lng != null ? Math.round(haversineKm({ lat: p.lat, lng: p.lng }, { lat: c.lat, lng: c.lng }) * 10) / 10 : null,
      }))
      .sort((a: any, b: any) => (b.knowsBrand ? 1 : 0) - (a.knowsBrand ? 1 : 0) || (a.distanceKm ?? 1e9) - (b.distanceKm ?? 1e9));
  }

  async center(user: AuthUser, id: string) {
    const c = (await this.list(user, {})).find((x) => x.id === id);
    if (!c) throw notFound('Сервис не найден');
    const reviews = await this.db.query(
      `select b.review_stars as stars, b.review_text as text, b.closed_at as at, coalesce(u.company_name, u.name) as who
         from service_bookings b join users u on u.id=b.client_id
        where b.center_id=$1 and b.review_stars is not null order by length(coalesce(b.review_text,'')) desc, b.closed_at desc limit 20`, [id]);
    return { ...c, reviews: reviews };
  }

  async book(user: AuthUser, centerId: string, p: { vehicleId?: string | null; need: string; day: string; time?: string | null; arrival: 'self' | 'tow'; comment?: string | null; fromOrderId?: string | null }) {
    const c = await this.db.one(`select * from service_centers where id=$1 and verification='approved' and not paused`, [centerId]);
    if (!c) throw notFound('Сервис не найден');
    if (c.owner_id === user.id) throw bad('self', 'Это ваш сервис');
    if (!(p.need in NEEDS)) throw bad('bad_need', 'Что нужно?');
    if (p.day < msk(this.now())) throw bad('past', 'Выберите сегодня или позже');
    if ((c.closed_days ?? []).some((d: any) => msk(new Date(d)) === p.day)) throw bad('closed', 'В этот день сервис не работает');
    const clientId = user.owner_id ?? user.id;
    if (user.owner_id) {
      const f = (await this.db.one<any>('select fleet from users where id=$1', [user.owner_id]))?.fleet;
      if (f?.allow?.service === false) throw forbidden('Владелец не разрешил записываться в сервис');
    }
    let vehicle: any = {};
    if (p.vehicleId) {
      const v = await this.db.one('select * from vehicles where id=$1 and owner_id=$2', [p.vehicleId, clientId]);
      if (!v || (user.owner_id && v.driver_id !== user.id)) throw notFound('Машина не найдена');
      vehicle = { brand: v.brand, model: v.model, year: v.year, plate: v.plate, trailerPlate: v.trailer_plate };
    }
    let fromOrderId: string | null = null;
    if (p.fromOrderId) {
      const o = await this.db.one('select id from orders where id=$1 and client_id=$2', [p.fromOrderId, clientId]);
      fromOrderId = o?.id ?? null;
    }
    const b = await this.db.one(
      `insert into service_bookings(center_id, client_id, created_by, vehicle_id, vehicle, need, when_day, when_time, arrival, comment, from_order_id)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning *`,
      [centerId, clientId, user.id, p.vehicleId ?? null, vehicle, p.need, p.day, p.time?.trim() || null, p.arrival, p.comment?.trim() || null, fromOrderId]) as any;
    await this.notifier.notify([c.owner_id], { type: 'booking', bookingId: b.id, status: 'new' },
      { kind: 'normal', title: 'Новый запрос в сервис', body: `${NEEDS[p.need]} · ${vehicle.brand ?? 'машина'} ${vehicle.plate ?? ''} · ${fmtDay(p.day)}${p.time ? `, к ${p.time}` : ''}`, data: { bookingId: b.id } });
    return this.booking(user, b.id);
  }

  async myBookings(user: AuthUser) {
    const clientId = user.owner_id ?? user.id;
    const rows = await this.db.query(
      `select b.*, c.name as center_name, c.address as center_address from service_bookings b join service_centers c on c.id=b.center_id
        where b.client_id=$1 ${user.owner_id ? 'and b.created_by=$2' : ''} order by b.created_at desc limit 100`,
      user.owner_id ? [clientId, user.id] : [clientId]);
    return rows.map((b: any) => ({ ...this.bookingView(b, 'client'), center: { id: b.center_id, name: b.center_name, address: b.center_address } }));
  }

  private async clientBooking(user: AuthUser, id: string) {
    const b = await this.db.one('select b.*, c.owner_id from service_bookings b join service_centers c on c.id=b.center_id where b.id=$1', [id]);
    if (!b || (b.client_id !== (user.owner_id ?? user.id))) throw notFound('Запись не найдена');
    if (user.owner_id && b.created_by !== user.id) throw notFound('Запись не найдена');
    return b;
  }

  async answer(user: AuthUser, id: string, text: string) {
    const b = await this.clientBooking(user, id);
    if (b.status !== 'clarify') throw conflict('bad_status', 'Сервис ничего не спрашивал');
    await this.db.query(`update service_bookings set status='new', client_answer=$2, updated_at=now() where id=$1`, [id, text.trim()]);
    await this.notifier.notify([b.owner_id], { type: 'booking', bookingId: id, status: 'new' },
      { kind: 'normal', title: 'Клиент ответил', body: text.trim().slice(0, 120), data: { bookingId: id } });
    return this.booking(user, id);
  }

  async cancel(user: AuthUser, id: string) {
    const b = await this.clientBooking(user, id);
    if (!['new', 'clarify', 'expected'].includes(b.status)) throw conflict('bad_status', 'Машина уже в сервисе — отменить нельзя, напишите сервису');
    await this.db.query(`update service_bookings set status='cancelled', updated_at=now() where id=$1`, [id]);
    await this.notifier.notify([b.owner_id], { type: 'booking', bookingId: id, status: 'cancelled' },
      { kind: 'normal', title: 'Клиент отменил запись', body: `${b.vehicle?.brand ?? ''} ${b.vehicle?.plate ?? ''}`.trim() || 'Запись отменена', data: { bookingId: id } });
    return this.booking(user, id);
  }

  /** Сверка работ: «всё верно» + отзыв, или «не согласен» — спор в поддержку */
  async confirm(user: AuthUser, id: string, p: { agree: boolean; stars?: number; text?: string; why?: string }) {
    const b = await this.clientBooking(user, id);
    if (b.status !== 'invoiced') throw conflict('bad_status', 'Счёта ещё нет');
    if (p.agree) {
      await this.db.query(
        `update service_bookings set status='closed', closed_at=now(), review_stars=$2, review_text=$3, updated_at=now() where id=$1`,
        [id, p.stars ?? null, p.text?.trim() || null]);
      await this.notifier.notify([b.owner_id], { type: 'booking', bookingId: id, status: 'closed' },
        { kind: 'normal', title: 'Клиент подтвердил работы', body: `Счёт №${b.number} — деньги придут после оплаты`, data: { bookingId: id } });
    } else {
      const why = p.why?.trim();
      if (!why || why.length < 5) throw bad('empty', 'Напишите, с чем не согласны');
      await this.db.query(`update service_bookings set status='disputed', updated_at=now() where id=$1`, [id]);
      await this.support.open(user, { topic: 'Не согласен с суммой', text: `Ремонт в сервисе, счёт №${b.number}: ${why}` });
      await this.notifier.notify([b.owner_id], { type: 'booking', bookingId: id, status: 'disputed' },
        { kind: 'normal', title: 'Клиент не согласен с работами', body: 'Модератор свяжется с обеими сторонами', data: { bookingId: id } });
    }
    return this.booking(user, id);
  }

  // ——— Модерация ———
  async pending() {
    return this.db.query(`select c.*, u.phone from service_centers c join users u on u.id=c.owner_id order by (c.verification='pending') desc, c.created_at desc limit 100`);
  }
  async verify(actor: AuthUser, id: string, decision: 'approved' | 'rejected') {
    const c = await this.db.one('update service_centers set verification=$2 where id=$1 returning *', [id, decision]);
    if (!c) throw notFound();
    await this.db.query('insert into audit_log(actor_id, action, target, data) values ($1,$2,$3,$4)', [actor.id, 'service.verify', id, { decision }]);
    await this.notifier.notify([c.owner_id], { type: 'verification', decision },
      { kind: 'normal', title: decision === 'approved' ? 'Сервис проверен' : 'Проверка не пройдена', body: decision === 'approved' ? 'Клиенты видят вас на карте' : 'Напишите в поддержку', data: {} });
    return c;
  }
}

function fmtDay(d: string | Date) {
  const s = typeof d === 'string' ? d : msk(d);
  const [y, m, day] = s.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, day)).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', timeZone: 'UTC' });
}
