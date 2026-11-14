// Персональные данные: что собираем, выгрузка «всё о себе», запрос на удаление.
// Удаление — через 30 дней: аккаунт обезличивается; заявки и деньги остаются для бухгалтерии, как требует закон.

import type { Db } from '../db/index.ts';
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

  /** Всё, что TrakSOS хранит о человеке, одним файлом */
  async export(user: AuthUser) {
    const id = user.id;
    const q = (sql: string) => this.db.query(sql, [id]);
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
      support: await q('select t.number, t.topic, t.status, t.created_at from support_tickets t where t.user_id=$1'),
      notifications: await q('select title, body, created_at from notifications where user_id=$1 order by created_at desc limit 500'),
    };
  }

  async requestDelete(user: AuthUser) {
    const busy = await this.db.one<{ n: number }>(
      `select count(*)::int as n from orders where (client_id=$1 or created_by=$1 or performer_id=$1)
         and status in ('awaiting_owner','searching','accepted','en_route','arrived','working','awaiting_confirmation')`, [user.id]);
    if (busy?.n) throw conflict('active_orders', 'Сначала завершите или отмените открытые заявки');
    await this.db.query('update users set delete_requested_at=coalesce(delete_requested_at, $2) where id=$1', [user.id, this.now()]);
    await this.db.query('insert into audit_log(actor_id, action, target, data) values ($1,$2,$3,$4)', [user.id, 'privacy.delete_requested', user.id, {}]);
    const staff = (await this.db.query<{ id: string }>(`select id from users where roles && '{admin}'::text[]`)).map((r) => r.id);
    await this.notifier.notify(staff, { type: 'privacy' }, { kind: 'normal', title: 'Запрос на удаление данных', body: `Пользователь ${user.phone}: удалим через ${GRACE_DAYS} дней`, data: {} });
    return this.status(user);
  }

  async cancelDelete(user: AuthUser) {
    await this.db.query('update users set delete_requested_at=null where id=$1', [user.id]);
    await this.db.query('insert into audit_log(actor_id, action, target, data) values ($1,$2,$3,$4)', [user.id, 'privacy.delete_cancelled', user.id, {}]);
    return this.status(user);
  }

  /** Раз в тик: срок вышел — обезличиваем. Номер, имя, компания, сессии, токены, машины — убираем. */
  async processDeletions() {
    const due = await this.db.query<{ id: string }>(
      `select id from users where delete_requested_at is not null and deleted_at is null and delete_requested_at < $1::timestamptz - interval '${GRACE_DAYS} days'`, [this.now()]);
    for (const { id } of due) {
      await this.db.tx(async (q) => {
        await q.query(`update users set phone='deleted-' || id, name=null, company_name=null, company_inn=null, edo_operator=null, edo_id=null,
                         status='blocked', deleted_at=$2, owner_id=null where id=$1`, [id, this.now()]);
        await q.query('delete from sessions where user_id=$1', [id]);
        await q.query('delete from push_tokens where user_id=$1', [id]);
        await q.query('update vehicles set driver_id=null where driver_id=$1', [id]);
        await q.query('delete from notifications where user_id=$1', [id]);
        await q.query(`update performer_profiles set inn=null, cars='[]', car=null, paused=true where user_id=$1`, [id]);
        await q.query('insert into audit_log(actor_id, action, target, data) values (null,$1,$2,$3)', ['privacy.deleted', id, {}]);
      });
    }
    return due.length;
  }
}
