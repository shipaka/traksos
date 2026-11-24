// Рембаза (сервис-партнёр): карточка сервиса, входящие запросы, машины в ремонте, «Машина готова → счёт».
// Клиент: сервисы на карте, запись, статус ремонта, сверка работ и отзыв. Записи попадают в историю машины.

import type { Db } from '../db/index.ts';
import { assertRoleExtension } from '../domain/roles.ts';
import type { Notifier } from './notify.ts';
import type { SettingsService } from './settings.ts';
import type { SupportService } from './support.ts';
import { haversineKm } from '../domain/geo.ts';
import { maskPhones } from '../util.ts';
import { bad, conflict, forbidden, notFound, type AuthUser } from '../http/router.ts';

export const NEEDS: Record<string, string> = {
  electric: 'Электрика', air: 'Пневматика', engine: 'Двигатель', gearbox: 'КПП', brakes: 'Тормоза',
  chassis: 'Ходовая', tires: 'Шины', hydraulics: 'Гидравлика', ecu: 'Блоки управления', heater: 'Автономка', other: 'Другое',
};
export const REPAIR_STATUSES = ['arrived', 'diagnostics', 'in_work', 'waiting_part', 'agreeing'] as const;
export const STATUS_NAME: Record<string, string> = {
  new: 'Новый запрос', clarify: 'Сервис уточняет', declined: 'Сервис не может', expected: 'Ожидаем',
  arrived: 'Машина приехала', diagnostics: 'Диагностика', in_work: 'В работе', waiting_part: 'Ждём запчасть',
  agreeing: 'Согласуем с клиентом', ready: 'Готова', invoiced: 'Счёт выставлен', closed: 'Закрыто',
  disputed: 'Спор по работам', cancelled: 'Отменено',
};
// A recommendation may contain free-text contact information. The selected
// workshop receives a technical diagnosis, not personal contact details.
const publicHandoff = (text:string) => maskPhones(text
 .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g,'[email скрыт]')
 .replace(/\b[A-HJ-NPR-Z0-9]{17}\b/gi,'[VIN скрыт]')
 .replace(/[АВЕКМНОРСТУХABEKMHOPCTYX]\s?\d{3}\s?[АВЕКМНОРСТУХABEKMHOPCTYX]{2}\s?\d{2,3}/gi,'[госномер скрыт]')
).text.trim();
export const WORKS = ['Диагностика', 'Электрика', 'Пневматика', 'Двигатель', 'КПП', 'Тормоза', 'Ходовая', 'Шины', 'Гидравлика', 'Сварка', 'Замена масла и фильтров'];
export const DECLINE = ['Нет такого специалиста', 'Нет мест', 'Не работаем с этой маркой'];

const msk = (d: Date) => new Date(d.getTime() + 3 * 3600_000).toISOString().slice(0, 10);
/** Открыто ли сейчас по строке часов: «08:00–21:00», «22:00–06:00», «круглосуточно», «24/7» */
export function openAt(hours: string | null | undefined, at: Date): boolean | null {
  if (!hours) return null;
  if (/кругл|24\s*\/\s*7|24 ч/i.test(hours)) return true;
  const m = hours.match(/(\d{1,2})[:.](\d{2})\s*[–—-]\s*(\d{1,2})[:.](\d{2})/);
  if (!m) return null;
  const t = new Date(at.getTime() + 3 * 3600_000);
  const now = t.getUTCHours() * 60 + t.getUTCMinutes();
  const a = +m[1] * 60 + +m[2], b = +m[3] * 60 + +m[4];
  return a <= b ? now >= a && now < b : now >= a || now < b;
}

export interface CenterInput {
  name?: string; address?: string; lat?: number | null; lng?: number | null; hours?: string; inn?: string | null;
  brands?: string[]; staff?: Record<string, 'own' | 'invite' | 'none'>; conditions?: string[]; accepts?: string[];
  closedDays?: string[]; paused?: boolean;
}

export class ServiceCenters {
  onDispute: ((p: { userId: string; bookingId: string; ticketId: string | null; text: string; targetId: string; title: string }) => Promise<unknown>) | null = null;
  referral: import('./referral.ts').ReferralService | null = null;
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
    const existingRoles = (await this.db.one<{ roles: string[] }>('select roles from users where id=$1', [user.id]))?.roles ?? user.roles;
    assertRoleExtension(existingRoles, 'service');
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
        // Nullable coordinates are a real edit: undefined means "leave alone",
        // while an explicit null must delete the old public stationary location.
        // Evaluate the old row in THIS UPDATE (not a stale pre-transaction
        // snapshot), and revoke consent and moderator geo proof atomically.
        const locationChanged = `(
          ($2::text is not null and name is distinct from $2::text)
          or ($3::text is not null and address is distinct from $3::text)
          or ($4::boolean and lat is distinct from $5::float8)
          or ($6::boolean and lng is distinct from $7::float8)
        )`;
        await q.query(
          `update service_centers set
             name=coalesce($2::text,name), address=coalesce($3::text,address),
             lat=case when $4::boolean then $5::float8 else lat end,
             lng=case when $6::boolean then $7::float8 else lng end,
             hours=coalesce($8::text,hours), inn=coalesce($9::text,inn),
             brands=coalesce($10::text[],brands), staff=coalesce($11::jsonb,staff),
             conditions=coalesce($12::text[],conditions), accepts=coalesce($13::text[],accepts),
             closed_days=coalesce($14::date[],closed_days),
             paused=coalesce($15::boolean,paused),
             -- A form save is not the explicit weekly service attestation.
             -- Full accepts/closedDays arrays are sent for ANY edited field;
             -- only POST /api/base/confirm-accepts may renew this timestamp.

             public_map_opt_in=case when ${locationChanged} then false else public_map_opt_in end,
             public_map_opted_at=case when ${locationChanged} then null else public_map_opted_at end,
             public_map_location_verified_at=case when ${locationChanged} then null else public_map_location_verified_at end
           where owner_id=$1`,
          [user.id, v(p.name?.trim()), v(p.address?.trim()),
           p.lat!==undefined, v(p.lat), p.lng!==undefined, v(p.lng),
           v(p.hours), v(p.inn), v(p.brands), v(p.staff), v(p.conditions),
           v(p.accepts), v(p.closedDays), v(p.paused)]);
      }
    });
    return this.cabinet(user);
  }

  /** Раз в неделю: «приём всё так же?» — одна кнопка */
  async confirmAccepts(user: AuthUser) {
    await this.mustMine(user);
    // The public map validates evidence against PostgreSQL time. Record
    // confirmation using that same clock, never a simulated booking clock.
    await this.db.query('update service_centers set accepts_confirmed_at=now() where owner_id=$1',
      [user.id]);
    return this.cabinet(user);
  }

  // ——— Кабинет рембазы ———
  async cabinet(user: AuthUser) {
    const c = await this.db.one(
      `select *, coalesce(accepts_confirmed_at between now()-interval '7 days' and now(),false) as accepts_current
         from service_centers where owner_id=$1`,[user.id]);
    if (!c) return { center: null, groups: null };
    const { accepts_current, ...center } = c;
    const rows = await this.db.query(
      `select b.*, u.name as client_name, u.company_name, u.rating::float as client_rating
         from service_bookings b join users u on u.id=b.client_id
        where b.center_id=$1 and (b.status not in ('closed','declined','cancelled') or b.updated_at > now() - interval '30 days')
        order by b.created_at desc`, [c.id]);
    const today = msk(this.now());
    const weekAgo = this.now().getTime() - 7 * 86400_000;
    const view = (b: any) => this.bookingView(b, 'service', weekAgo);
    const confirmDue = !accepts_current;
    const rt = await this.db.one<{ r: number | null; n: number }>(
      `select round(avg(review_stars)::numeric, 1)::float as r, count(review_stars)::int as n from service_bookings where center_id=$1`, [c.id]);
    return {
      center: { ...center, closedToday: (c.closed_days ?? []).some((d: any) => msk(new Date(d)) === today), confirmDue, rating: rt?.r ?? null, reviews: rt?.n ?? 0 },
      groups: {
        requests: rows.filter((b) => ['new', 'clarify'].includes(b.status)).map(view),
        expected: rows.filter((b) => b.status === 'expected').map(view),
        repair: rows.filter((b) => (REPAIR_STATUSES as readonly string[]).includes(b.status)).map(view),
        ready: rows.filter((b) => ['ready', 'invoiced', 'disputed'].includes(b.status)).map(view),
        done: rows.filter((b) => ['closed', 'declined', 'cancelled'].includes(b.status)).map(view),
      },
    };
  }

  /** Immutable invoice snapshot. Legacy invoices deliberately keep their zero customer fee. */
  private settlement(b: any) {
    const total = b.amount == null ? null : Math.max(0, Number(b.amount) + Number(b.client_fee ?? 0) - Number(b.discount ?? 0));
    const received = Number(b.received_amount ?? 0);
    const refunded = Number(b.refunded_amount ?? 0);
    const netReceived = received - refunded;
    const required = !!b.payment_required;
    return {
      total, netReceived, outstanding: total == null ? null : Math.max(0,total-netReceived),
      paymentRequired: required,
      paymentStatus: total == null ? 'not_invoiced'
        : !required ? 'legacy_not_verified'
        : netReceived >= total ? 'received'
        : netReceived > 0 ? 'partial'
        : refunded > 0 ? 'refunded'
        : 'awaiting_payment',
      recoveryNeeded: required && b.paid_out_at != null && total != null && netReceived < total,
    };
  }

  private bookingView(b: any, as: 'service' | 'client', weekAgo = 0) {
    const repair = (REPAIR_STATUSES as readonly string[]).includes(b.status);
    const notes = as === 'client' && !b.notes_public ? [] : b.notes;
    return {
      id: b.id, number: b.number, status: b.status, statusName: STATUS_NAME[b.status], need: b.need, needName: NEEDS[b.need] ?? b.need,
      whenDay: b.when_day, whenTime: b.when_time, acceptTime: b.accept_time, arrival: b.arrival, comment: b.comment,
      vehicle: b.vehicle, vehicleId: b.vehicle_id, clarifyQ: b.clarify_q, clientAnswer: b.client_answer, declineReason: b.decline_reason,
      partsAmount: b.amount == null ? null : Number(b.parts_amount ?? 0),
      feeBaseAmount: b.amount == null ? null : (b.payment_required ? Number(b.fee_base_amount ?? 0) : Number(b.amount)-Number(b.parts_amount ?? 0)),
      notes, notesPublic: b.notes_public, works: b.works, amount: b.amount, discount: b.discount,
      // Never include the customer's separately charged service fee in the service owner's JSON.
      clientFee: as === 'client' ? Number(b.client_fee ?? 0) : undefined,
      clientFeePct: as === 'client' ? Number(b.client_fee_pct ?? 0) : undefined,
      commission: as === 'service' ? b.commission : undefined, points: as === 'service' ? b.points ?? 0 : undefined, paidOutAt: as === 'service' ? b.paid_out_at ?? null : undefined,
      payout: as === 'service' && b.amount != null ? b.amount - b.commission : undefined,
      toPay: as === 'client' ? this.settlement(b).total : undefined,
      paymentStatus: this.settlement(b).paymentStatus,
      paymentConfirmed: this.settlement(b).paymentStatus === 'received',
      fromOrder: !!b.from_order_id, fromOrderId: as === 'client' ? b.from_order_id : undefined,
      caseRootId: as === 'client' ? b.case_root_id ?? null : undefined, arrivedAt: b.arrived_at, readyAt: b.ready_at, createdAt: b.created_at,
      daysInRepair: b.arrived_at ? Math.max(1, Math.ceil((this.now().getTime() - new Date(b.arrived_at).getTime()) / 86400_000)) : null,
      stillHereDue: as === 'service' && repair && !!b.from_order_id && new Date(b.still_here_at ?? b.arrived_at ?? b.created_at).getTime() < weekAgo,
      client: as === 'service' ? { name: b.company_name || b.client_name || 'Клиент', rating: b.client_rating } : undefined,
      reviewStars: b.review_stars, reviewText: b.review_text,
    };
  }

  /** A booking creator is NOT a permanent fleet participant. Owners retain
   * their own history, but an ex-driver must still be assigned to THIS truck
   * in THIS fleet, including when an old bearer token carries stale owner_id. */
  private async canSeeCustomerBooking(user: AuthUser, b: any): Promise<boolean> {
    if (!user.roles.some(role => role === 'client' || role === 'driver')) return false;
    if (!user.owner_id) return b.client_id === user.id;
    if (b.client_id !== user.owner_id || b.created_by !== user.id || !b.vehicle_id)
      return false;
    const current = await this.db.one<{ id: string }>(
      `select v.id from vehicles v join users u on u.id=$3
        where v.id=$1 and v.owner_id=$2 and v.driver_id=$3
          and u.owner_id=v.owner_id
          and 'driver'=any(u.roles)`,
      [b.vehicle_id, b.client_id, user.id]);
    return !!current;
  }

  private async mineBooking(user: AuthUser, id: string) {
    const c = await this.mustMine(user);
    const b = await this.db.one('select * from service_bookings where id=$1 and center_id=$2', [id, c.id]);
    if (!b) throw notFound('Запрос не найден');
    return { c, b };
  }

  /** Push recipients are LIVE participants, never a permanent created_by
   * list. A revoked driver must not receive old fleet plates or repairs. */
  private async currentCustomerRecipients(b: any): Promise<string[]> {
    const recipients: string[] = [b.client_id];
    if (b.created_by && b.created_by !== b.client_id && b.vehicle_id) {
      const current = await this.db.one<{ id: string }>(
        `select v.id from vehicles v join users u on u.id=$3
          where v.id=$1 and v.owner_id=$2 and v.driver_id=$3
            and u.owner_id=v.owner_id and 'driver'=any(u.roles)`,
        [b.vehicle_id, b.client_id, b.created_by]);
      if (current) recipients.push(b.created_by);
    }
    return recipients;
  }

  private async tell(b: any, title: string, body: string) {
    await this.notifier.notify(await this.currentCustomerRecipients(b),
      { type: 'booking', bookingId: b.id, status: b.status },
      { kind: 'normal', title, body, data: { bookingId: b.id } });
  }

  async booking(user: AuthUser, id: string) {
    const b = await this.db.one(
      `select b.*, u.name as client_name, u.company_name, u.rating::float as client_rating,
              c.owner_id, c.name as center_name, c.address as center_address,
              r.summary as continuation_summary, src.number as continuation_source_number,
              author.name as continuation_author_name
         from service_bookings b
         join users u on u.id=b.client_id join service_centers c on c.id=b.center_id
         left join order_continuation_recommendations r on r.id=b.continuation_recommendation_id
         left join orders src on src.id=r.source_order_id
         left join users author on author.id=r.suggested_by
        where b.id=$1`, [id]);
    if (!b) throw notFound('Запись не найдена');
    const asService = b.owner_id === user.id && user.roles.includes('service');
    const isStaff = user.roles.some(role => role === 'admin' || role === 'moderator');
    if (!asService && !isStaff && !(await this.canSeeCustomerBooking(user, b)))
      throw forbidden('Запись другого автопарка недоступна');
    const v = this.bookingView(b, asService ? 'service' : 'client', this.now().getTime() - 7 * 86400_000);
    const linkedTow = b.arrival === 'tow' && b.case_root_id
      ? await this.db.one<{number:number;status:string}>(
        "select number,status from orders where (id=$1 or case_root_id=$1)" +
        " and service='tow' and status not in ('cancelled','no_performer')" +
        ' order by created_at desc limit 1',[b.case_root_id])
      : null;
    return { ...v,
      handoff: b.continuation_summary ? {
        sourceNumber: b.continuation_source_number,
        suggestedBy: b.continuation_author_name || 'Предыдущий исполнитель',
        summary: publicHandoff(String(b.continuation_summary)),
      } : null,
      transport: linkedTow ? {
        orderNumber:linkedTow.number, status:linkedTow.status,
        deliveryReported:['awaiting_confirmation','completed'].includes(linkedTow.status),
      } : null,
      center: { id: b.center_id, name: b.center_name, address: b.center_address },
      mine: asService, history: asService && b.vehicle_id ? await this.carHistory(b.vehicle_id, b.id) : [] };
  }

  /** Вся история машины на TrakSOS для сервиса — чужие работы тоже, без сумм */
  private async carHistory(vehicleId: string, except: string) {
    const orders = await this.db.query(
      `select o.service, o.problem, o.description, o.result, o.completed_at as at, 'mobile' as src from orders o
        where o.vehicle_id=$1 and o.status='completed' order by o.completed_at desc limit 30`, [vehicleId]);
    const bookings = await this.db.query(
      `select b.need, b.works, b.closed_at as at, c.name as center from service_bookings b join service_centers c on c.id=b.center_id
        where b.vehicle_id=$1 and b.status='closed' and b.id<>$2 order by b.closed_at desc limit 30`, [vehicleId, except]);
    return [
      ...orders.map((o: any) => ({ at: o.at, what: o.problem || o.description || o.service, who: 'Выездной мастер TrakSOS' })),
      ...bookings.map((b: any) => ({ at: b.at, what: (b.works?.length ? b.works.join(', ') : NEEDS[b.need]) as string, who: `Рембаза «${b.center}»` })),
    ].sort((a, b) => +new Date(b.at) - +new Date(a.at));
  }

  async respond(user: AuthUser, id: string, p: { action: 'accept' | 'clarify' | 'decline' | 'undo'; time?: string; q?: string; reason?: string }) {
    const { b } = await this.mineBooking(user, id);
    if (p.action === 'undo') {
      const updated = await this.db.one<any>(
        `update service_bookings set status='new', accept_time=null, updated_at=now()
          where id=$1 and status='expected' returning *`, [id]);
      if (!updated) throw conflict('bad_status', 'Отменить можно, пока машина не приехала');
      return this.booking(user, id);
    }
    const allowed = "status in ('new','clarify')";
    if (p.action === 'accept') {
      const time = p.time?.trim() || b.when_time || null;
      const updated = await this.db.one<any>(
        `update service_bookings set status='expected', accept_time=$2, updated_at=now()
          where id=$1 and ${allowed} returning *`, [id, time]);
      if (!updated) throw conflict('bad_status', 'На запрос уже ответили');
      await this.tell(updated, 'Сервис ждёт вас',
        `Ждём вас ${fmtDay(updated.when_day)}${time ? ` в ${time}` : ''}`);
    } else if (p.action === 'clarify') {
      const q = p.q?.trim();
      if (!q) throw bad('empty', 'Что уточнить?');
      const updated = await this.db.one<any>(
        `update service_bookings set status='clarify', clarify_q=$2,
              client_answer=null, updated_at=now()
          where id=$1 and ${allowed}
            and (status <> 'clarify' or clarify_q is distinct from $2::text)
          returning *`, [id, q]);
      if (!updated) throw conflict('bad_status', 'На запрос уже ответили');
      await this.tell(updated, 'Сервис уточняет', q);
    } else {
      const reason = p.reason?.trim();
      if (!reason) throw bad('empty', 'Укажите причину');
      const updated = await this.db.one<any>(
        `update service_bookings set status='declined', decline_reason=$2, updated_at=now()
          where id=$1 and ${allowed} returning *`, [id, reason]);
      if (!updated) throw conflict('bad_status', 'На запрос уже ответили');
      await this.tell(updated, 'Сервис не может принять',
        `${reason} — посмотрите другие сервисы рядом`);
    }
    return this.booking(user, id);
  }

  async setStatus(user: AuthUser, id: string, status: string) {
    const { b } = await this.mineBooking(user, id);
    if (!(REPAIR_STATUSES as readonly string[]).includes(status)) throw bad('bad_status', 'Нет такого статуса');
    if (!['expected', ...REPAIR_STATUSES].includes(b.status)) throw conflict('bad_status', 'Статус уже не поменять');
    // A prebooked workshop cannot jump to "arrived" OR "in_work" while a
    // linked tow is still searching, driving to pickup or transporting.
    // "awaiting_confirmation" is the tow's reported delivery, not an
    // automatic physical receipt; the workshop must still mark receipt.
    if (b.case_root_id && b.arrival === 'tow' && !b.arrived_at) {
      const movingTow = await this.db.one<{number:number;status:string}>(
        "select number,status from orders where (id=$1 or case_root_id=$1)" +
        " and service='tow' and status in ('searching','accepted','en_route','arrived','working')" +
        ' order by created_at desc limit 1',[b.case_root_id]);
      if(movingTow)throw conflict('tow_not_delivered',
        `Эвакуатор №${movingTow.number} ещё не сообщил о доставке. СТО может подтвердить запись, но не отмечать приезд машины.`);
    }
    const updated = await this.db.one<any>(
      `update service_bookings set status=$2,
              arrived_at=coalesce(arrived_at, now()), updated_at=now()
        where id=$1 and status=any($3::text[]) and status<>$2
        returning *`,
      [id, status, ['expected', ...REPAIR_STATUSES]]);
    if (!updated) throw conflict('bad_status', 'Статус изменился. Обновите карточку ремонта.');
    await this.tell(updated, `Ремонт: ${STATUS_NAME[status]}`,
      `${updated.vehicle?.brand ?? ''} ${updated.vehicle?.plate ?? ''}`.trim());
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
    const changed = await this.db.one<any>(
      'update service_bookings set still_here_at=now() where id=$1 and status=any($2::text[]) returning id',
      [id, REPAIR_STATUSES]);
    if (!changed) throw conflict('bad_status', 'Машина уже не отмечена в ремонте');
    return this.booking(user, id);
  }

  /** «Машина готова» — галочками, что делали */
  async ready(user: AuthUser, id: string, works: string[]) {
    const { b } = await this.mineBooking(user, id);
    if (!(REPAIR_STATUSES as readonly string[]).includes(b.status)) throw conflict('bad_status', 'Сначала отметьте, что машина приехала');
    const clean = [...new Set(works.map((w) => w.trim()).filter(Boolean))].slice(0, 20);
    if (!clean.length) throw bad('no_works', 'Отметьте, что делали');
    const updated = await this.db.one<any>(
      `update service_bookings set status='ready', works=$2, ready_at=now(), updated_at=now()
        where id=$1 and status=any($3::text[]) returning *`,
      [id, clean, REPAIR_STATUSES]);
    if (!updated) throw conflict('bad_status', 'Состояние ремонта изменилось. Обновите карточку.');
    await this.tell(updated, 'Машина готова', `Сделано: ${clean.join(', ')}`);
    return this.booking(user, id);
  }

  /** New invoices snapshot BOTH independent caps. Financial and points writes are atomic. */
  async invoice(user: AuthUser, id: string, amount: number, points = 0, partsAmount = 0) {
    if(!Number.isSafeInteger(partsAmount) || partsAmount<0 || partsAmount>amount)
      throw bad('bad_parts_amount','Запчасти не могут стоить больше общей суммы счёта');
    const feeBase = amount - partsAmount;
    const c = await this.mustMine(user);
    const fees = await this.settings.get('fees');
    const clientPct = Math.max(0, Math.min(5, fees.clientFeePct)); // approved ceiling: 5% and max 5,000 RUB.
    const clientFee = Math.min(Math.round(feeBase * clientPct / 100), 500_000);
    const b = await this.db.tx(async q => {
      const row = await q.one<any>('select * from service_bookings where id=$1 and center_id=$2 for update', [id, c.id]);
      if (!row) throw notFound('Запрос не найден');
      if (row.status !== 'ready') throw conflict('bad_status', 'Сначала «Машина готова»');
      let commission = Math.min(Math.round(feeBase * Math.max(0, Math.min(5,fees.serviceCommissionPct)) / 100), fees.serviceCommissionMax ?? 500_000, 500_000);
      const discount = row.from_order_id ? Math.min(commission, Math.round(feeBase * fees.serviceReferralDiscountPct / 100)) : 0;
      // Points and the new invoice must commit together; never spend points twice on a retry.
      const pts = this.referral
        ? await this.referral.spendServiceCommission(q, user.id, commission - discount, id, row.number, points) : 0;
      commission -= pts;
      await q.query(
        `update service_bookings
            set status='invoiced', amount=$2, commission=$3, discount=$4, points=$5,
                client_fee=$6, client_fee_pct=$7, parts_amount=$8, fee_base_amount=$9,
                payment_required=true, invoiced_at=now(), updated_at=now()
          where id=$1`,
        [id, amount, commission, discount, pts, clientFee, clientPct, partsAmount, feeBase]);
      return {...row, client_fee:clientFee, discount, amount, parts_amount:partsAmount, fee_base_amount:feeBase};
    });
    await this.tell({ ...b, status: 'invoiced' }, 'Счёт за ремонт', 'Работы завершены. Проверьте в личном кабинете состав счёта и итог к оплате.');
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

  // ——— Финансы рембазы ———
  /** Сводка, по месяцам и по каждому счёту: работы, скидка клиенту, комиссия, погашено баллами, к выплате, выплачено */
  async money(user: AuthUser) {
    const c = await this.mustMine(user);
    const rows = await this.db.query<any>(
      `select b.id, b.number, b.status, b.works, b.amount, b.discount, b.commission, b.points, b.invoiced_at, b.closed_at, b.paid_out_at, b.vehicle,
              b.payment_required, b.client_fee, b.received_amount, b.refunded_amount,
              coalesce(nullif(u.company_name,''), u.name, 'Клиент') as client_name, b.from_order_id is not null as from_order
         from service_bookings b join users u on u.id=b.client_id
        where b.center_id=$1 and b.amount is not null and b.status in ('invoiced','closed','disputed')
        order by coalesce(b.invoiced_at, b.created_at) desc limit 300`, [c.id]);
    const item = (b: any) => ({
      id: b.id, number: b.number, status: b.status, works: b.works ?? [], vehicle: b.vehicle, client: b.client_name, fromOrder: b.from_order,
      amount: b.amount, discount: b.discount, commission: b.commission, points: b.points ?? 0,
      commissionFull: b.commission + (b.points ?? 0), payout: b.amount - b.commission,
      invoicedAt: b.invoiced_at, closedAt: b.closed_at, paidOutAt: b.paid_out_at,
      // Only boolean status is sent to service owner, not client fee or client invoice total.
      state: b.paid_out_at ? 'paid'
        : b.status === 'disputed' ? 'disputed'
        : b.status === 'closed'
          ? (!b.payment_required ||
             b.received_amount-b.refunded_amount >= b.amount+b.client_fee-b.discount ? 'to_pay' : 'unpaid')
          : 'awaiting',
    });
    const items = rows.map(item);
    const sum = (f: (x: any) => boolean, k: string) => items.filter(f).reduce((s, x: any) => s + x[k], 0);
    const months = new Map<string, any>();
    for (const x of items.filter((i) => i.state !== 'awaiting' && i.state !== 'disputed' && i.state !== 'unpaid')) {
      const m = new Date(new Date(x.closedAt ?? x.invoicedAt).getTime() + 3 * 3600_000).toISOString().slice(0, 7);
      const r = months.get(m) ?? { month: m, count: 0, amount: 0, discount: 0, commission: 0, points: 0, payout: 0 };
      r.count++; r.amount += x.amount; r.discount += x.discount; r.commission += x.commission; r.points += x.points; r.payout += x.payout;
      months.set(m, r);
    }
    const fees = await this.settings.get('fees');
    return {
      summary: {
        toPay: sum((x) => x.state === 'to_pay', 'payout'), awaiting: sum((x) => x.state === 'awaiting', 'payout'),
        unpaid: sum((x) => x.state === 'unpaid', 'payout'),
        disputed: sum((x) => x.state === 'disputed', 'payout'), paid: sum((x) => x.state === 'paid', 'payout'),
        points: sum(() => true, 'points'),
      },
      months: [...months.values()],
      items,
      rule: { pct: Math.min(5,fees.serviceCommissionPct), max: Math.min(500_000,fees.serviceCommissionMax ?? 500_000), referralPct: fees.serviceReferralDiscountPct },
    };
  }

  /** Админ: подтверждённые счета, которые ещё не выплачены сервисам */
  async payoutsDue() {
    return this.db.query(
      `select b.id, b.number, b.amount, b.client_fee, b.discount, b.commission,
              b.received_amount, b.refunded_amount, b.payment_required,
              b.amount - b.commission as payout, b.closed_at, c.name as center_name, c.inn,
              (not b.payment_required or b.received_amount-b.refunded_amount >= b.amount+b.client_fee-b.discount) as payout_ready
         from service_bookings b join service_centers c on c.id=b.center_id
        where b.status='closed' and b.amount is not null and b.paid_out_at is null order by b.closed_at`);
  }

  async markPaidOut(admin: AuthUser, id: string, reference?: string) {
    if (!admin.roles.includes('admin')) throw forbidden();
    const ref = reference?.trim() || null;
    const b = await this.db.tx(async q => {
      const paid = await q.one<any>(`update service_bookings
           set paid_out_at=now(),payout_reference=case when payment_required then $2::text else payout_reference end
         where id=$1 and status='closed' and paid_out_at is null
           and (not payment_required or
                (length(coalesce($2::text,'')) between 4 and 200 and
                 received_amount-refunded_amount >= amount+client_fee-discount))
          returning id, number, center_id, amount - commission as payout`, [id,ref]).catch((e:any)=>{
        if(e?.code==='23505') throw conflict('duplicate_payout_reference','Эта банковская выплата уже отмечена');
        throw e;
      });
      if (!paid) throw conflict('payout_not_ready',
        'Нужны: подтверждение работ, проверенное поступление всей суммы и номер фактически отправленной выплаты СТО (для новых счетов). Повторную выплату отметить нельзя.');
      await q.query('insert into audit_log(actor_id, action, target, data) values ($1,$2,$3,$4::jsonb)',
        [admin.id, 'service.paid_out', id, JSON.stringify({reference:ref,payout:paid.payout})]);
      return paid;
    });
    const c = await this.db.one<{ owner_id: string }>('select owner_id from service_centers where id=$1', [b.center_id]);
    if (c) await this.notifier.notify([c.owner_id], { type: 'booking', bookingId: id, status: 'paid' },
      { kind: 'normal', title: 'Выплата отправлена', body: `Счёт №${b.number}: ${(b.payout / 100).toLocaleString('ru-RU')} ₽`, data: { bookingId: id } });
    return { ok: true };
  }

  // ——— Клиент ———
  async list(_user: AuthUser, p: { lat?: number; lng?: number; need?: string; brand?: string }) {
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
      .filter((c: any) => !p.need || (Object.hasOwn(NEEDS,p.need) && c.staff?.[p.need] !== 'none'))
      .map((c: any) => ({
        id: c.id, name: c.name, address: c.address, lat: c.lat, lng: c.lng, hours: c.hours, brands: c.brands, staff: c.staff,
        conditions: c.conditions, accepts: c.accepts, rating: c.rating, reviews: c.reviews_n, load: c.load_n,
        popularity: c.closed_n === 0 ? 'new' : c.closed_n / max > 0.66 ? 'top' : c.closed_n / max > 0.33 ? 'often' : 'rare',
        closedToday: (c.closed_days ?? []).some((d: any) => msk(new Date(d)) === today),
        openNow: (c.closed_days ?? []).some((d: any) => msk(new Date(d)) === today) ? false : openAt(c.hours, this.now()),
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

  async book(user: AuthUser, centerId: string, p: { vehicleId?: string | null; need: string; day: string; time?: string | null; arrival: 'self' | 'tow'; comment?: string | null; fromOrderId?: string | null; caseOrderId?: string | null; recommendationId?: string | null }) {
    if (!user.roles.some(role => role === 'client' || role === 'driver'))
      throw forbidden('Для записи в СТО нужен клиентский аккаунт');
    // A driver can book only their CURRENT assigned truck; a stale fleet
    // session must never submit a phantom or previous-owner booking.
    if (user.owner_id && !p.vehicleId && !p.caseOrderId)
      throw forbidden('Выберите назначенную вам машину для записи');
    const c = await this.db.one(`select * from service_centers where id=$1 and verification='approved' and not paused`, [centerId]);
    if (!c) throw notFound('Сервис не найден');
    if (c.owner_id === user.id) throw bad('self', 'Это ваш сервис');
    if (!Object.hasOwn(NEEDS, p.need)) throw bad('bad_need', 'Выберите существующую работу');
    // Route-level YYYY-MM-DD shape is not enough: 2026-02-31 is not a day.
    const parsedDay=new Date(p.day+'T00:00:00Z');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(p.day) ||
        !Number.isFinite(parsedDay.getTime()) ||
        parsedDay.toISOString().slice(0,10)!==p.day)
      throw bad('bad_day','Выберите действительную дату записи');
    if (p.day < msk(this.now())) throw bad('past', 'Выберите сегодня или позже');
    if ((c.closed_days ?? []).some((d: any) => msk(new Date(d)) === p.day)) throw bad('closed', 'В этот день сервис не работает');
    const clientId = user.owner_id ?? user.id;
    if (user.owner_id) {
      const f = (await this.db.one<any>('select fleet from users where id=$1', [user.owner_id]))?.fleet;
      if (f?.allow?.service === false) throw forbidden('Владелец не разрешил записываться в сервис');
    }
    let vehicle: any = {};
    if (p.vehicleId) {
      const v = await this.db.one(
        `select v.* from vehicles v
          left join users current_driver on current_driver.id=$3
         where v.id=$1 and v.owner_id=$2
           and ($3::uuid=v.owner_id or
             (v.driver_id=$3 and current_driver.owner_id=v.owner_id
              and 'driver'=any(current_driver.roles)))`,
        [p.vehicleId, clientId, user.id]);
      if (!v) throw notFound('Машина не найдена');
      vehicle = { brand: v.brand, model: v.model, year: v.year, plate: v.plate, trailerPlate: v.trailer_plate };
    }
    // A case link is NOT a referral. Do not use from_order_id for tow->STO
    // or the old workshop referral discount would be applied incorrectly.
    if (p.caseOrderId && p.fromOrderId) throw bad('bad_link', 'Выберите одно продолжение обращения');
    // Owner-approved STO recommendation may link an in-progress consultation,
    // master visit or tow to a future workshop booking. The booking is still
    // an independent service contract and produces no immediate payment.
    let approvedRecommendation=false;
    if (p.recommendationId) {
      if (!p.caseOrderId || p.fromOrderId || user.owner_id)
        throw forbidden('Запись по рекомендации подтверждает владелец автопарка');
      const rec=await this.db.one<{id:string}>(
        "select id from order_continuation_recommendations where id=$1 and source_order_id=$2 and client_id=$3 and target_kind='sto' and status='approved'",
        [p.recommendationId,p.caseOrderId,user.id]);
      if(!rec)throw forbidden('Сначала согласуйте рекомендацию СТО');
      approvedRecommendation=true;
    }
    let caseRootId: string | null = null;
    if (p.caseOrderId) {
      const previous = await this.db.one<any>('select id, case_root_id, client_id, created_by, vehicle_id, brand, model, year, status, result, service from orders where id=$1', [p.caseOrderId]);
      if (!previous || previous.client_id !== clientId || (user.owner_id && previous.created_by !== user.id))
        throw forbidden('Продолжить можно только собственное обращение');
      const canPreBookTow=approvedRecommendation && previous.service==='tow' &&
        p.arrival==='tow' && ['accepted','en_route'].includes(previous.status);
      if ((approvedRecommendation
            ? !canPreBookTow && !['arrived','working','awaiting_confirmation','completed'].includes(previous.status)
            : previous.status !== 'completed' ||
              !(previous.service === 'tow' || ['cause_found','not_found'].includes(previous.result))))
        throw conflict('stage_not_ready', 'Сначала завершите текущий этап помощи');
      if (previous.vehicle_id && p.vehicleId && previous.vehicle_id !== p.vehicleId)
        throw bad('different_vehicle', 'Запись должна относиться к тому же грузовику');
      if (!previous.vehicle_id && p.vehicleId)
        throw bad('different_vehicle', 'Для продолжения используйте грузовик из исходного обращения');
      if (previous.vehicle_id && !p.vehicleId) {
        // Link the exact same garage vehicle, even if the user never reopened the picker.
        const v = await this.db.one<any>(
          `select v.* from vehicles v left join users current_driver on current_driver.id=$3
            where v.id=$1 and v.owner_id=$2
              and ($3::uuid=v.owner_id or
                (v.driver_id=$3 and current_driver.owner_id=v.owner_id
                 and 'driver'=any(current_driver.roles)))`,
          [previous.vehicle_id, clientId, user.id]);
        if (!v) throw forbidden('Машина этого обращения недоступна для записи');
        p = { ...p, vehicleId: previous.vehicle_id };
        vehicle = { brand: v.brand, model: v.model, year: v.year, plate: v.plate, trailerPlate: v.trailer_plate };
      }
      if (!previous.vehicle_id) {
        if (user.owner_id)
          throw forbidden('Водителю нужна действующая привязка к автомобилю исходного обращения');
        // Incidents created before the truck was added to a garage still retain
        // the brand/model/year snapshot in the following workshop booking.
        vehicle = { brand: previous.brand ?? null, model: previous.model ?? null, year: previous.year ?? null };
      }
      caseRootId = previous.case_root_id ?? previous.id;
    }
    let fromOrderId: string | null = null;
    if (p.fromOrderId) {
      const o = await this.db.one<any>(
        `select id,vehicle_id,created_by,recommended_center_id
          from orders where id=$1 and client_id=$2`, [p.fromOrderId, clientId]);
      if (!o || o.recommended_center_id !== centerId)
        throw forbidden('Скидка действует только для рекомендованного мастером сервиса');
      if (user.owner_id && (o.created_by !== user.id || !o.vehicle_id ||
          o.vehicle_id !== p.vehicleId))
        throw forbidden('Доступ к рекомендации есть только у действующего водителя этой машины');
      if (o.vehicle_id && p.vehicleId && o.vehicle_id !== p.vehicleId)
        throw bad('different_vehicle', 'Рекомендация относится к другому автомобилю');
      if (o.vehicle_id && !p.vehicleId) {
        // A referral is tied to this specific fleet truck. Never create a
        // no-vehicle discounted booking while referencing another truck.
        const sourceVehicle=await this.db.one<any>(
          'select * from vehicles where id=$1 and owner_id=$2', [o.vehicle_id,clientId]);
        if (!sourceVehicle) throw notFound('Машина рекомендованного обращения больше не доступна');
        p={...p,vehicleId:sourceVehicle.id};
        vehicle={brand:sourceVehicle.brand,model:sourceVehicle.model,year:sourceVehicle.year,
          plate:sourceVehicle.plate,trailerPlate:sourceVehicle.trailer_plate};
      }
      fromOrderId = o.id;
    }
    const b = await this.db.one(
      `insert into service_bookings(center_id, client_id, created_by, vehicle_id, vehicle, need, when_day, when_time, arrival, comment, from_order_id, case_root_id, continuation_recommendation_id)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) returning *`,
      [centerId, clientId, user.id, p.vehicleId ?? null, vehicle, p.need, p.day, p.time?.trim() || null, p.arrival, p.comment?.trim() || null, fromOrderId, caseRootId, approvedRecommendation ? p.recommendationId : null]
    ).catch((e: any) => {
      if(e?.code==='23505' && e?.constraint==='service_booking_recommendation_once')
        throw conflict('continuation_exists','Эта рекомендация уже оформлена как запись на СТО');
      if (e?.code === '23505' && e?.constraint === 'service_bookings_one_open_case_idx')
        throw conflict('continuation_exists', 'В этом обращении уже есть незакрытая запись на СТО');
      throw e;
    }) as any;
    await this.notifier.notify([c.owner_id], { type: 'booking', bookingId: b.id, status: 'new' },
      { kind: 'normal', title: 'Новый запрос в сервис', body: `${NEEDS[p.need]} · ${vehicle.brand ?? 'машина'} ${vehicle.plate ?? ''} · ${fmtDay(p.day)}${p.time ? `, к ${p.time}` : ''}`, data: { bookingId: b.id } });
    return this.booking(user, b.id);
  }

  async myBookings(user: AuthUser) {
    if (!user.roles.some(role => role === 'client' || role === 'driver')) throw forbidden();
    // A driver may have made the booking, but leaving/reassigning the truck
    // ends their access to its notes, repair status and financial history.
    const filter = user.owner_id
      ? `and b.created_by=$2 and b.vehicle_id is not null
         and exists (
           select 1 from vehicles v join users current_driver on current_driver.id=$2
           where v.id=b.vehicle_id and v.owner_id=b.client_id
             and v.driver_id=$2 and current_driver.owner_id=v.owner_id
             and 'driver'=any(current_driver.roles)
         )`
      : '';
    const rows = await this.db.query(
      `select b.*, c.name as center_name, c.address as center_address
         from service_bookings b join service_centers c on c.id=b.center_id
        where b.client_id=$1 ${filter} order by b.created_at desc limit 100`,
      user.owner_id ? [user.owner_id, user.id] : [user.id]);
    return rows.map((b: any) => ({ ...this.bookingView(b, 'client'),
      center: { id: b.center_id, name: b.center_name, address: b.center_address } }));
  }

  /** Keep a current-fleet predicate in the write itself, not only in GET. */
  private customerWriteAcl(param: number): string {
    const id = '$' + param + '::uuid';
    return `(client_id=${id} or (created_by=${id} and vehicle_id is not null
      and exists (
        select 1 from vehicles v join users current_driver on current_driver.id=${id}
         where v.id=service_bookings.vehicle_id and v.owner_id=service_bookings.client_id
           and v.driver_id=${id} and current_driver.owner_id=v.owner_id
           and 'driver'=any(current_driver.roles)
      )))`;
  }

  private async clientBooking(user: AuthUser, id: string) {
    const b = await this.db.one('select b.*, c.owner_id from service_bookings b join service_centers c on c.id=b.center_id where b.id=$1', [id]);
    if (!b || !(await this.canSeeCustomerBooking(user, b)))
      throw notFound('Запись не найдена');
    return b;
  }

  async answer(user: AuthUser, id: string, text: string) {
    const b = await this.clientBooking(user, id);
    if (b.status !== 'clarify') throw conflict('bad_status', 'Сервис ничего не спрашивал');
    const updated = await this.db.one<any>(
      `update service_bookings set status='new', client_answer=$2, updated_at=now()
        where id=$1 and status='clarify' and ${this.customerWriteAcl(3)} returning id`, [id, text.trim(), user.id]);
    if (!updated) throw conflict('bad_status', 'Ответ по этой записи уже обработан');
    await this.notifier.notify([b.owner_id], { type: 'booking', bookingId: id, status: 'new' },
      { kind: 'normal', title: 'Клиент ответил', body: text.trim().slice(0, 120), data: { bookingId: id } });
    return this.booking(user, id);
  }

  async cancel(user: AuthUser, id: string) {
    const b = await this.clientBooking(user, id);
    if (!['new', 'clarify', 'expected'].includes(b.status)) throw conflict('bad_status', 'Машина уже в сервисе — отменить нельзя, напишите сервису');
    const updated = await this.db.one<any>(
      `update service_bookings set status='cancelled', updated_at=now()
        where id=$1 and status in ('new','clarify','expected') and ${this.customerWriteAcl(2)} returning id`, [id, user.id]);
    if (!updated) throw conflict('bad_status', 'Запись уже перешла в следующий этап');
    await this.notifier.notify([b.owner_id], { type: 'booking', bookingId: id, status: 'cancelled' },
      { kind: 'normal', title: 'Клиент отменил запись', body: `${b.vehicle?.brand ?? ''} ${b.vehicle?.plate ?? ''}`.trim() || 'Запись отменена', data: { bookingId: id } });
    return this.booking(user, id);
  }

  /** Сверка работ: «всё верно» + отзыв, или «не согласен» — спор в поддержку */
  async confirm(user: AuthUser, id: string, p: { agree: boolean; stars?: number; text?: string; why?: string }) {
    const b = await this.clientBooking(user, id);
    if (b.status !== 'invoiced') throw conflict('bad_status', 'Счёта ещё нет');
    if (p.agree) {
      const updated = await this.db.one<any>(
        `update service_bookings set status='closed', closed_at=now(),
                review_stars=$2, review_text=$3, updated_at=now()
          where id=$1 and status='invoiced' and ${this.customerWriteAcl(4)} returning id`,
        [id, p.stars ?? null, p.text?.trim() || null, user.id]);
      if (!updated) throw conflict('bad_status', 'Работы уже подтверждены либо открыт спор');
      // New agreements award post-payment bonuses only after a recorded receipt.
      if (!b.payment_required) await this.referral?.afterBookingClosed(b.owner_id, id);
      else if (this.settlement(b).paymentStatus === 'received') await this.referral?.afterBookingClosed(b.owner_id, id);
      await this.notifier.notify([b.owner_id], { type: 'booking', bookingId: id, status: 'closed' },
        { kind: 'normal', title: 'Клиент подтвердил работы', body: `Счёт №${b.number} — деньги придут после оплаты`, data: { bookingId: id } });
    } else {
      const why = p.why?.trim();
      if (!why || why.length < 5) throw bad('empty', 'Напишите, с чем не согласны');
      const updated = await this.db.one<any>(
        `update service_bookings set status='disputed', updated_at=now()
          where id=$1 and status='invoiced' and ${this.customerWriteAcl(2)} returning id`, [id, user.id]);
      if (!updated) throw conflict('bad_status', 'По этому счёту уже принято решение');
      const t = await this.support.open(user, { topic: 'Ремонт в сервисе', text: `Ремонт в сервисе, счёт №${b.number}: ${why}` }) as any;
      await this.onDispute?.({ userId: user.id, bookingId: id, ticketId: t?.id ?? null, text: why, targetId: b.owner_id, title: `Спор по ремонту в сервисе, счёт №${b.number}` });
      await this.notifier.notify([b.owner_id], { type: 'booking', bookingId: id, status: 'disputed' },
        { kind: 'normal', title: 'Клиент не согласен с работами', body: 'Модератор свяжется с обеими сторонами', data: { bookingId: id } });
    }
    return this.booking(user, id);
  }

  // ——— Сверка оплаченных счетов СТО: only staff attest bank/cash movements ———
  /** These are immutable external-receipt attestations, NEVER a payment gateway operation. */
  async paymentEvents(user: AuthUser, id: string) {
    if (!user.roles.includes('admin')) throw forbidden();
    const b = await this.db.one<any>(
      `select b.*, c.name as center_name from service_bookings b
         join service_centers c on c.id=b.center_id where b.id=$1`,[id]);
    if (!b) throw notFound('Счёт не найден');
    const events = await this.db.query(
      `select e.id::int as id,e.kind,e.amount,e.method,e.reference,e.created_at,
              u.phone as verified_by from service_payment_events e
         join users u on u.id=e.confirmed_by where e.booking_id=$1
         order by e.id desc`,[id]);
    return {invoice:{id:b.id,number:b.number,centerName:b.center_name,amount:b.amount,
      clientFee:b.client_fee,discount:b.discount,partsAmount:b.parts_amount,feeBaseAmount:b.fee_base_amount,commission:b.commission,payout:b.amount==null?null:b.amount-b.commission,
      received:b.received_amount,refunded:b.refunded_amount,paidOutAt:b.paid_out_at,payoutReference:b.payout_reference,
      ...this.settlement(b)},events};
  }

  async financialRegister(user: AuthUser) {
    if (!user.roles.includes('admin')) throw forbidden();
    const rows = await this.db.query<any>(
      `select b.id,b.number,b.status,b.amount,b.parts_amount,b.fee_base_amount,b.client_fee,b.discount,b.commission,b.points,
              b.payment_required,b.received_amount,b.refunded_amount,b.paid_out_at,b.payout_reference,b.invoiced_at,
              c.name as center_name, coalesce(u.company_name,u.name,u.phone) as client_name
         from service_bookings b
         join service_centers c on c.id=b.center_id
         join users u on u.id=b.client_id
         where b.amount is not null order by b.invoiced_at desc limit 300`);
    return rows.map(b=>({...b,toPay:this.settlement(b).total,
      netReceived:this.settlement(b).netReceived,
      outstanding:this.settlement(b).outstanding,paymentStatus:this.settlement(b).paymentStatus,
      recoveryNeeded:this.settlement(b).recoveryNeeded,
      payout:b.amount-b.commission,
      payoutReady:b.status==='closed' && b.paid_out_at==null &&
        (!b.payment_required || this.settlement(b).paymentStatus==='received')}));
  }

  async recordTransfer(admin: AuthUser, id: string, entry: {
    kind:'receipt'|'refund';amount:number;method:'invoice'|'online'|'cash'|'other';reference:string;
  }) {
    if (!admin.roles.includes('admin')) throw forbidden();
    if (!Number.isSafeInteger(entry.amount) || entry.amount <= 0)
      throw bad('bad_amount','Сумма внешней операции должна быть положительной и целой');
    const reference=entry.reference.trim();
    if (reference.length<4 || reference.length>200) throw bad('bad_reference','Укажите номер подтверждённой банковской или кассовой операции');
    const updated=await this.db.tx(async q=>{
      const b=await q.one<any>('select * from service_bookings where id=$1 for update',[id]);
      if (!b) throw notFound('Счёт не найден');
      if (!b.payment_required || b.amount==null) throw conflict('legacy_invoice','Для старого счёта нужна отдельная ручная сверка; данные не изменяем');
      if (!['invoiced','closed','disputed'].includes(b.status)) throw conflict('bad_status','Счёт не выставлен');
      const total=this.settlement(b).total!;
      const current=Number(b.received_amount)-Number(b.refunded_amount);
      if (entry.kind==='receipt' && current+entry.amount>total)
        throw conflict('overpayment','Сумма подтверждённых поступлений не может превышать согласованный счёт');
      if (entry.kind==='refund' && entry.amount>current)
        throw conflict('refund_exceeds_receipts','Возврат не может превышать действительно полученные средства');
      try {
        await q.query(
          `insert into service_payment_events(booking_id,kind,amount,method,reference,confirmed_by)
           values ($1,$2,$3,$4,$5,$6)`,
          [id,entry.kind,entry.amount,entry.method,reference,admin.id]);
      } catch(e:any) {
        if(e?.code==='23505') throw conflict('duplicate_bank_reference','Эта внешняя операция уже зарегистрирована');
        throw e;
      }
      const field=entry.kind==='receipt' ? 'received_amount' : 'refunded_amount';
      await q.query(`update service_bookings set ${field}=${field}+$2,updated_at=now() where id=$1`,
        [id,entry.amount]);
      await q.query('insert into audit_log(actor_id,action,target,data) values($1,$2,$3,$4::jsonb)',
        [admin.id,'service.payment.'+entry.kind,id,JSON.stringify({...entry})]);
      return {...b,received_amount:Number(b.received_amount)+(entry.kind==='receipt'?entry.amount:0),
        refunded_amount:Number(b.refunded_amount)+(entry.kind==='refund'?entry.amount:0)};
    });
    if (updated.status==='closed' && entry.kind==='receipt' && this.settlement(updated).paymentStatus==='received')
      await this.referral?.afterBookingClosed((await this.db.one<{owner_id:string}>(
        'select owner_id from service_centers where id=$1',[updated.center_id]))!.owner_id,id);
    return this.paymentEvents(admin,id);
  }

  // ——— Модерация ———
  async pending() {
    return this.db.query(`select c.*, u.phone from service_centers c join users u on u.id=c.owner_id order by (c.verification='pending') desc, c.created_at desc limit 100`);
  }
  async verify(actor: AuthUser, id: string, decision: 'approved' | 'rejected') {
    if (!actor.roles.some(role => role === 'admin' || role === 'moderator')) throw forbidden();
    // Business approval is NOT evidence that self-entered coordinates are real.
    // Fail closed on every standard verification; only a separate documented
    // stationary location review may enable the yellow public map pin.
    const c = await this.db.one(`update service_centers
      set verification=$2,
          public_map_location_verified_at=null,
          public_map_opt_in=false,
          public_map_opted_at=null
      where id=$1 returning *`, [id, decision]);
    if (!c) throw notFound();
    await this.db.query('insert into audit_log(actor_id, action, target, data) values ($1,$2,$3,$4)', [actor.id, 'service.verify', id, { decision, locationVerified:false }]);
    await this.notifier.notify([c.owner_id], { type: 'verification', decision },
      { kind: 'normal', title: decision === 'approved' ? 'Сервис проверен' : 'Проверка не пройдена',
        body: decision === 'approved'
          ? 'СТО одобрена для работы. Публичная карта требует отдельной проверки адреса и вашего согласия.'
          : 'Напишите в поддержку', data: {} });
    return c;
  }

  /** Explicit evidence-based review of FIXED station location, separate from
   * ordinary business approval. Requires a human staff member's affirmative
   * match against an actual independent source; audit records source and the
   * exact address/coords approved, never mobile master GPS.
   */
  async verifyPublicLocation(actor:AuthUser,id:string,proof:{
    kind:'official_registry'|'site_visit'|'verified_document';
    reference:string;
    confirmed:true;
  }){
    if (!actor.roles.some(role => role === 'admin' || role === 'moderator')) throw forbidden();
    if (!['official_registry','site_visit','verified_document'].includes(proof.kind))
      throw bad('public_location_evidence_required','Укажите вид подтверждённого документа или проверки');
    return this.db.tx(async q=>{
      const center=await q.one<any>('select * from service_centers where id=$1 for update',[id]);
      if(!center)throw notFound();
      const lat=Number(center.lat),lng=Number(center.lng);
      if(center.verification!=='approved' || center.paused ||
         center.lat==null || center.lng==null ||
         !Number.isFinite(lat)||!Number.isFinite(lng)||
         lat < -90 || lat > 90 || lng < -180 || lng > 180 ||
         (lat===0&&lng===0) ||
         typeof center.address!=='string' || center.address.trim().length<8)
        throw bad('public_location_not_ready',
          'Сначала одобрите действующую СТО и убедитесь, что указан её настоящий стационарный адрес.');
      const reference=proof.reference.trim();
      if(reference.length<8 || proof.confirmed!==true)
        throw bad('public_location_evidence_required',
          'Для геопроверки нужны подтверждённые документы/источник и явное подтверждение сверки.');
      const row=await q.one(`update service_centers
         set public_map_location_verified_at=now(),
             public_map_opt_in=false,public_map_opted_at=null
         where id=$1 returning *`,[id]);
      await q.query(`insert into audit_log(actor_id,action,target,data)
        values($1,$2,$3,$4::jsonb)`,
        [actor.id,'service.public_location.verify',id,JSON.stringify({
          kind:proof.kind,reference,address:center.address,
          lat,lng,confirmed:true,verifiedAt:new Date().toISOString()
        })]);
      return row;
    });
  }
}

function fmtDay(d: string | Date) {
  const s = typeof d === 'string' ? d : msk(d);
  const [y, m, day] = s.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, day)).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', timeZone: 'UTC' });
}
