// Персональные данные: что собираем, выгрузка «всё о себе», запрос на удаление.
// Удаление — через 30 дней: аккаунт обезличивается; заявки и деньги остаются для бухгалтерии, как требует закон.

import type { Db, Queryable } from '../db/index.ts';
import type { Notifier } from './notify.ts';
import { conflict, type AuthUser } from '../http/router.ts';

const GRACE_DAYS = 30;

export class PrivacyService {
  constructor(private db: Db, private notifier: Notifier, private now: () => Date) {}

  async status(user: AuthUser) {
    const u = await this.db.one<{ delete_requested_at: Date | null }>('select delete_requested_at from users where id=$1', [user.id]);
    const at = u?.delete_requested_at ?? null;
    return { deleteRequestedAt: at, deleteAt: at ? new Date(new Date(at).getTime() + GRACE_DAYS * 86400_000) : null, graceDays: GRACE_DAYS };
  }

  /** Account-scoped export; bounded sections explicitly describe their coverage. */
  async export(user: AuthUser) {
    const id = user.id;
    const q = (sql: string) => this.db.query(sql, [id]);
    // Counts and rows come from the same statement, including deterministic
    // ordering when several records have identical timestamps.
    const notifications = await this.db.query<{ title: string; body: string; created_at: Date; total: number }>(
      'select title, body, created_at, (count(*) over ())::int as total from notifications where user_id=$1 order by created_at desc, id desc limit 500', [id]);
    const air = await this.db.query<{ body: string; created_at: Date; hidden: boolean; total: number }>(
      `select body, created_at, hidden_at is not null as hidden, (count(*) over ())::int as total
         from driver_air_messages where user_id=$1 and origin='human'
         order by created_at desc, id desc limit 500`, [id]);
    const scope = (rows: {total: number}[]) => ({
      total: rows[0]?.total ?? 0, included: rows.length, limit: 500,
      truncated: (rows[0]?.total ?? 0) > rows.length,
    });
    return {
      exportedAt: this.now(),
      account: await this.db.one(`select id, phone, name, roles, status, company_name, company_inn, edo_operator, edo_id, created_at from users where id=$1`, [id]),
      sessions: await q('select created_at, expires_at, device from sessions where user_id=$1 order by created_at desc'),
      consents: await q(`select o.audience, o.version, c.accepted_at from consents c join offers o on o.id=c.offer_id where c.user_id=$1 order by c.accepted_at`),
      vehicles: await q('select brand, model, year, plate, trailer_plate, created_at from vehicles where owner_id=$1 or driver_id=$1'),
      orders: await q(`select number, service, status, description, address, created_at, completed_at, call_out_amount, work_amount
                         from orders where client_id=$1 or created_by=$1 or performer_id=$1 order by created_at`),
      messages: await q('select o.number as order_number, m.body, m.created_at from chat_messages m join orders o on o.id=m.order_id where m.sender_id=$1 order by m.created_at'),
      reviewsWritten: await q('select stars, tags, text, created_at from reviews where author_id=$1'),
      reviewsAboutYou: await q('select stars, tags, text, created_at from reviews where target_id=$1'),
      performerProfile: await this.db.one(`select kind, specialties, brands, tax_status, inn, cars, schedule, updated_at from performer_profiles where user_id=$1`, [id]),
      serviceBookings: await q('select number, need, status, when_day, works, amount, created_at from service_bookings where client_id=$1 or created_by=$1'),
      // Export only the account's own purchases/requests. An insurer or
      // courier must NOT receive the customer's personal files merely because
      // they were assigned to process someone else's work.
      shopOrders: await q(`select number, status, items, goods_total, delivery, delivery_price,
                total, payment, created_at, updated_at
           from shop_orders where client_id=$1 or created_by=$1 order by created_at`),
      vehicleServiceRequests: await q(`select kind, status, comment, staff_note, policy_expires_on,
                created_at, updated_at
           from vehicle_service_requests where owner_id=$1 or requested_by=$1 order by created_at`),
      support: await q('select t.number, t.topic, t.status, t.created_at from support_tickets t where t.user_id=$1'),
      supportMessagesWritten: await q(`select t.number as ticket_number, m.body, m.created_at
           from support_messages m join support_tickets t on t.id=m.ticket_id
          where m.sender_id=$1 and t.user_id=$1 order by m.created_at`),
      // The courier may export the history of their own actions, never
      // somebody else's receipt code, phone, address or order contents.
      courierDeliveries: await q(`select id, status, created_at, updated_at
           from shop_courier_deliveries where courier_id=$1 order by created_at`),
      courierPresence: await this.db.one(`select online, updated_at from shop_courier_presence
           where courier_id=$1`, [id]),
      // Only the account's own stored, already-filtered human messages.
      // Never include other authors, bot replies or the moderator's identity.
      driverAirMessages: air.map(({ total: _total, ...row }) => row),
      notifications: notifications.map(({ total: _total, ...row }) => row),
      exportLimits: {
        notifications: scope(notifications),
        driverAirMessages: scope(air),
      },
    };
  }

  /** A deletion must not strand another participant's active work.
   * Keep all role checks centralized for both request and background erasure.
   * Each query uses the immutable user id; no client-supplied owner/role. */
  private async activeObligation(q: Queryable, userId: string):
    Promise<{ code: string; message: string } | null> {
    const checks = [
      {
        code: 'active_orders',
        message: 'Сначала завершите или отмените открытые заявки',
        sql: `select exists(
          select 1 from orders
          where (client_id=$1 or created_by=$1 or performer_id=$1)
            and status in ('awaiting_owner','searching','accepted','en_route',
                           'arrived','working','awaiting_confirmation')
        ) as active`,
      },
      {
        code: 'active_service_bookings',
        message: 'Сначала завершите или отмените текущие записи и ремонты СТО',
        sql: `select exists(
          select 1 from service_bookings b
          left join service_centers c on c.id=b.center_id
          where (b.client_id=$1 or b.created_by=$1 or c.owner_id=$1)
            and b.status not in ('closed','declined','cancelled')
        ) as active`,
      },
      {
        code: 'active_shop_orders',
        message: 'Сначала получите или отмените незавершённые заказы запчастей',
        sql: `select exists(
          select 1 from shop_orders
          where (client_id=$1 or created_by=$1)
            and status in ('new','confirmed','ready','shipped')
        ) as active`,
      },
      {
        code: 'active_vehicle_requests',
        message: 'Сначала завершите или отмените заявки на страхование и техосмотр',
        sql: `select exists(
          select 1 from vehicle_service_requests
          where (owner_id=$1 or requested_by=$1 or assigned_to=$1)
            and status in ('submitted','in_review','need_documents','sent_to_partner')
        ) as active`,
      },
      {
        code: 'active_courier_deliveries',
        message: 'Сначала завершите или передайте назначенные курьерские доставки',
        sql: `select exists(
          select 1 from shop_courier_deliveries
          where courier_id=$1
            and status not in ('received','cancelled')
        ) as active`,
      },
    ];
    for (const check of checks) {
      const result = await q.one<{ active: boolean }>(check.sql, [userId]);
      if (result?.active) return { code: check.code, message: check.message };
    }
    return null;
  }

  async requestDelete(user: AuthUser) {
    // Lock the user row so repeated requests (and the scheduled eraser) cannot
    // generate duplicate audits/alerts. Consent state belongs to this account.
    const created = await this.db.tx(async (q) => {
      const current = await q.one<{ delete_requested_at: Date | null; deleted_at: Date | null }>(
        'select delete_requested_at, deleted_at from users where id=$1 for update', [user.id]);
      if (!current || current.deleted_at) throw conflict('account_unavailable', 'Аккаунт уже закрыт');
      if (current.delete_requested_at) return false;
      const active = await this.activeObligation(q, user.id);
      if (active) throw conflict(active.code, active.message);
      await q.query('update users set delete_requested_at=$2 where id=$1', [user.id, this.now()]);
      await q.query('insert into audit_log(actor_id, action, target, data) values ($1,$2,$3,$4)',
        [user.id, 'privacy.delete_requested', user.id, {}]);
      return true;
    });
    if (created) {
      // Notification delivery is secondary to the durable consent/audit change.
      // A temporary delivery error must not tell the client the request failed,
      // causing a retry that would otherwise duplicate it.
      try {
        const staff = (await this.db.query<{ id: string }>(
          `select id from users where roles && '{admin}'::text[]`)).map((r) => r.id);
        await this.notifier.notify(staff, { type: 'privacy' }, {
          kind: 'normal', title: 'Запрос на удаление данных',
          body: `Пользователь ${user.phone}: запрос на удаление не ранее ${GRACE_DAYS} дней; активные обязательства должны быть завершены`, data: {},
        });
      } catch (error) {
        console.warn('[privacy] delete request notification delivery failed',
          error instanceof Error ? error.message : 'unknown error');
      }
    }
    return this.status(user);
  }

  async cancelDelete(user: AuthUser) {
    await this.db.tx(async (q) => {
      const current = await q.one<{ delete_requested_at: Date | null; deleted_at: Date | null }>(
        'select delete_requested_at, deleted_at from users where id=$1 for update', [user.id]);
      if (!current || current.deleted_at) throw conflict('account_unavailable', 'Аккаунт уже закрыт');
      if (!current.delete_requested_at) return;
      await q.query('update users set delete_requested_at=null where id=$1', [user.id]);
      await q.query('insert into audit_log(actor_id, action, target, data) values ($1,$2,$3,$4)',
        [user.id, 'privacy.delete_cancelled', user.id, {}]);
    });
    return this.status(user);
  }

  /** Раз в тик: срок вышел — обезличиваем. Номер, имя, компания, сессии, токены — убираем. */
  async processDeletions() {
    const now = this.now();
    const due = await this.db.query<{ id: string }>(
      `select id from users where delete_requested_at is not null and deleted_at is null and delete_requested_at < $1::timestamptz - interval '${GRACE_DAYS} days'`, [now]);
    let processed = 0;
    for (const { id } of due) {
      // Recheck the deadline in the UPDATE while holding the row lock.
      // Another worker may have deleted this user, or the user may have
      // cancelled the request after the initial due-list was read.
      const erased = await this.db.tx(async (q) => {
        const current = await q.one<{ delete_requested_at: Date | null; deleted_at: Date | null }>(
          'select delete_requested_at, deleted_at from users where id=$1 for update', [id]);
        if (!current || current.deleted_at || !current.delete_requested_at ||
            new Date(current.delete_requested_at).getTime() >= now.getTime() - GRACE_DAYS * 86400_000)
          return false;
        // Active work may have been created during the 30-day grace period.
        // Keep the deletion request pending until all work has settled.
        if (await this.activeObligation(q, id)) return false;
        const updated = await q.one<{ id: string }>(
          `update users set phone='deleted-' || id, name=null, company_name=null, company_inn=null,
              edo_operator=null, edo_id=null, status='blocked', deleted_at=$2, owner_id=null
             where id=$1 and deleted_at is null and delete_requested_at is not null
               and delete_requested_at < $2::timestamptz - interval '${GRACE_DAYS} days'
             returning id`, [id, now]);
        if (!updated) return false;
        await q.query('delete from sessions where user_id=$1', [id]);
        await q.query('delete from push_tokens where user_id=$1', [id]);
        await q.query('update vehicles set driver_id=null where driver_id=$1', [id]);
        await q.query('delete from notifications where user_id=$1', [id]);
        await q.query(`update performer_profiles set inn=null, cars='[]', car=null, paused=true where user_id=$1`, [id]);
        await q.query('insert into audit_log(actor_id, action, target, data) values (null,$1,$2,$3)', ['privacy.deleted', id, {}]);
        return true;
      });
      if (erased) processed++;
    }
    return processed;
  }
}
