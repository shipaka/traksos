// Поддержка: обращения по заявке или без неё. Пишут пользователь и сотрудники; закрыть может любой из них.

import type { Db } from '../db/index.ts';
import type { Notifier } from './notify.ts';
import type { OrdersService } from './orders.ts';
import { bad, conflict, forbidden, notFound, type AuthUser } from '../http/router.ts';
import { maskPhones } from '../util.ts';

export const TOPICS = ['Мастер не приехал', 'Не согласен с суммой', 'Проблема с оплатой', 'Отказ от оплаты', 'Вернуть деньги', 'Жалоба на исполнителя', 'Жалоба на клиента', 'Не работает приложение', 'Другое'];

const isStaff = (u: AuthUser) => u.roles.includes('admin') || u.roles.includes('moderator');

export class SupportService {
  /** Споры уходят и в очередь модератора — ставится при сборке приложения */
  onDispute: ((p: { userId: string; orderId: string | null; ticketId: string; text: string; topic: string }) => Promise<unknown>) | null = null;
  constructor(private db: Db, private notifier: Notifier, private orders: OrdersService, private now: () => Date) {}

  // Moderators own the first response. Admin receives intake only when no
  // moderator exists; otherwise admin is alerted once the SLA is breached.
  private intakeStaffIds = async () => {
    const moderators = await this.db.query<{ id: string }>(
      `select id from users where roles && '{moderator}'::text[]`);
    if (moderators.length) return moderators.map(r => r.id);
    const admins = await this.db.query<{ id: string }>(
      `select id from users where roles && '{admin}'::text[]`);
    return admins.map(r => r.id);
  };

  /**
   * Durable, idempotent 60-minute escalation. Calls are safe across multiple
   * server instances: the locked rows, event and admin inbox all commit together.
   * A late human reply does not erase the historical SLA breach.
   */
  async tickSla() {
    const now = this.now();
    const { overdue, adminIds } = await this.db.tx(async q => {
      const overdue = await q.query<{ id: string; number: number; topic: string; sla_deadline_at: Date }>(
        `select id, number, topic, sla_deadline_at from support_tickets
          where sla_deadline_at is not null and sla_deadline_at <= $1
            and sla_overdue_at is null
            and (first_staff_reply_at is null or first_staff_reply_at > sla_deadline_at)
          order by sla_deadline_at limit 100 for update skip locked`, [now]);
      if (!overdue.length) return { overdue, adminIds: [] as string[] };
      const admins = await q.query<{ id: string }>(
        `select id from users where roles && '{admin}'::text[]`);
      for (const ticket of overdue) {
        await q.query(`update support_tickets set sla_overdue_at=$2 where id=$1`, [ticket.id, now]);
        await q.query(
          `insert into support_sla_events(ticket_id,kind,deadline_at)
             values ($1,'first_reply_overdue',$2)
             on conflict (ticket_id,kind) do nothing`,
          [ticket.id, ticket.sla_deadline_at]);
        for (const admin of admins) {
          await q.query(
            `insert into notifications(user_id,kind,title,body,data) values ($1,'support',$2,$3,$4)`,
            [admin.id, `Поддержка: просрочка №${ticket.number}`,
              `60 минут без своевременного ответа: ${ticket.topic}`,
              { ticketId: ticket.id, sla: 'first_reply_overdue' }]);
        }
      }
      return { overdue, adminIds: admins.map(a => a.id) };
    });
    // Inbox is already durable. Push/websocket can fail without losing the alert.
    for (const ticket of overdue) {
      await this.notifier.deliverStored(adminIds, {
        type: 'support', ticketId: ticket.id, sla: 'first_reply_overdue',
      }, {
        kind: 'normal', title: `Поддержка: просрочка №${ticket.number}`,
        body: `60 минут без своевременного ответа: ${ticket.topic}`,
        data: { ticketId: ticket.id, sla: 'first_reply_overdue' },
      });
    }
    return overdue.length;
  }


  async open(user: AuthUser, p: { topic: string; text: string; orderId?: string; ledgerEntryId?: number }) {
    const text = p.text.trim();
    if (text.length < 3) throw bad('empty', 'Опишите, что случилось');
    let number: number | null = null;
    // Вопрос по конкретной операции: начисление, списание, выплата — поддержка увидит её целиком
    if (p.ledgerEntryId) {
      const e = await this.db.one<{ id: number; order_id: string | null }>(
        `select id, order_id from ledger_entries where id=$1 and performer_id=$2`, [p.ledgerEntryId, user.id]);
      if (!e) throw notFound('Операция не найдена');
      // A repeated tap, browser retry or a second app instance may race with
      // the first request. The existence check and INSERT must be serialized.
      const result = await this.db.tx(async (q) => {
        await q.query('select pg_advisory_xact_lock(hashtext($1))', ['support:ledger:' + user.id + ':' + e.id]);
        const existing = await q.one<{ id: string }>(
          'select id from support_tickets where user_id=$1 and ledger_entry_id=$2 and status=$3',
          [user.id, e.id, 'open']);
        if (existing) return { id: existing.id, number: 0, created: false };
        const created = await q.one<{ id: string; number: number }>(
          `insert into support_tickets(user_id, order_id, topic, ledger_entry_id, sla_deadline_at)
             values ($1,$2,$3,$4,$5) returning id, number`,
          [user.id, e.order_id, p.topic.slice(0, 80), e.id,
            new Date(this.now().getTime() + 3_600_000)]);
        return { id: created!.id, number: created!.number, created: true };
      });
      if (!result.created) {
        await this.post(user, result.id, text);
        return this.thread(user, result.id);
      }
      const t = result;
      await this.db.query(`insert into support_messages(ticket_id, sender_id, body) values ($1,$2,$3)`, [t!.id, user.id, maskPhones(text).text]);
      await this.notifier.notify(await this.intakeStaffIds(), { type: 'support', ticketId: t!.id }, {
        kind: 'normal', title: `Обращение №${t!.number}: вопрос по операции`, body: `${user.name ?? user.phone}: ${text.slice(0, 100)}`, data: { ticketId: t!.id },
      });
      return this.thread(user, t!.id);
    }
    let uniqueTicket: { id: string; number: number } | null = null;
    if (p.orderId) {
      const o = await this.orders.mustSee(user, p.orderId);
      if (!this.orders.actorOf(user, o)) throw forbidden('Позвать поддержку могут участники заявки');
      number = o.number;
      // One open thread per customer + order. All concurrent requests serialize
      // before the SELECT/INSERT; no silent duplicate conversations are created.
      const result = await this.db.tx(async (q) => {
        await q.query('select pg_advisory_xact_lock(hashtext($1))', ['support:order:' + user.id + ':' + p.orderId]);
        const existing = await q.one<{ id: string }>(
          'select id from support_tickets where user_id=$1 and order_id=$2 and status=$3',
          [user.id, p.orderId, 'open']);
        if (existing) return { id: existing.id, number: 0, created: false };
        const created = await q.one<{ id: string; number: number }>(
          `insert into support_tickets(user_id, order_id, topic, sla_deadline_at)
             values ($1,$2,$3,$4) returning id, number`,
          [user.id, p.orderId, p.topic.slice(0, 80),
            new Date(this.now().getTime() + 3_600_000)]);
        return { id: created!.id, number: created!.number, created: true };
      });
      if (!result.created) {
        await this.post(user, result.id, text);
        return this.thread(user, result.id);
      }
      uniqueTicket = { id: result.id, number: result.number };
    }
    const t = uniqueTicket ?? await this.db.one<{ id: string; number: number }>(
      `insert into support_tickets(user_id, order_id, topic, sla_deadline_at)
         values ($1,$2,$3,$4) returning id, number`,
      [user.id, null, p.topic.slice(0, 80), new Date(this.now().getTime() + 3_600_000)]);
    await this.db.query(`insert into support_messages(ticket_id, sender_id, body) values ($1,$2,$3)`, [t!.id, user.id, maskPhones(text).text]);
    if (p.orderId) {
      await this.orders.event(this.db, p.orderId, user.id, 'support_called', { ticket: t!.number, topic: p.topic });
      await this.orders.systemMessage(p.orderId, `Подключили поддержку (обращение №${t!.number}). Первый ответ специалиста — в течение часа.`);
    }
    if (/спор|не согласен/i.test(p.topic) && this.onDispute) await this.onDispute({ userId: user.id, orderId: p.orderId ?? null, ticketId: t!.id, text, topic: p.topic });
    await this.notifier.notify(await this.intakeStaffIds(), { type: 'support', ticketId: t!.id }, {
      kind: 'normal', title: `Обращение №${t!.number}: ${p.topic}`, body: `${user.name ?? user.phone}${number ? ` · заявка №${number}` : ''}: ${text.slice(0, 100)}`,
      data: { ticketId: t!.id },
    });
    return this.thread(user, t!.id);
  }

  async post(user: AuthUser, ticketId: string, body: string) {
    const t = await this.mustSee(user, ticketId);
    if (t.status === 'closed') throw conflict('closed', 'Обращение закрыто — создайте новое');
    const text = body.trim();
    if (!text) throw bad('empty', 'Пустое сообщение');
    const staff = isStaff(user) && t.user_id !== user.id;
    await this.db.tx(async q => {
      const locked = await q.one<{ status: string }>(
        'select status from support_tickets where id=$1 for update', [ticketId]);
      if (!locked || locked.status === 'closed')
        throw conflict('closed', 'Обращение закрыто — создайте новое');
      const postedAt = this.now();
      await q.query(`insert into support_messages(ticket_id, sender_id, from_staff, body)
        values ($1,$2,$3,$4)`, [ticketId, user.id, staff, staff ? text : maskPhones(text).text]);
      await q.query(`update support_tickets
        set updated_at=$2, assignee_id=coalesce(assignee_id,$3),
            first_staff_reply_at=case when $4::boolean then coalesce(first_staff_reply_at,$2::timestamptz)
               else first_staff_reply_at end where id=$1`,
        [ticketId, postedAt, staff ? user.id : null, staff]);
    });
    if (staff) {
      await this.notifier.notify([t.user_id], { type: 'support', ticketId }, {
        kind: 'normal', title: `Поддержка ответила · №${t.number}`, body: text.slice(0, 120), data: { ticketId },
      });
    } else {
      const to = t.assignee_id ? [t.assignee_id] : await this.intakeStaffIds();
      await this.notifier.notify(to, { type: 'support', ticketId }, {
        kind: 'normal', title: `Новое сообщение · №${t.number}`, body: text.slice(0, 120), data: { ticketId },
      });
    }
    return this.thread(user, ticketId);
  }

  async close(user: AuthUser, ticketId: string) {
    const t = await this.mustSee(user, ticketId);
    if (t.status === 'closed') return this.thread(user, ticketId);
    await this.db.query(`update support_tickets set status='closed', closed_at=$2, closed_by=$3, updated_at=$2 where id=$1`, [ticketId, this.now(), user.id]);
    await this.db.query(`insert into support_messages(ticket_id, sender_id, from_staff, body) values ($1,null,false,$2)`,
      [ticketId, isStaff(user) && t.user_id !== user.id ? 'Поддержка закрыла обращение. Если вопрос остался — напишите новое.' : 'Обращение закрыто.']);
    if (t.user_id !== user.id) {
      await this.notifier.notify([t.user_id], { type: 'support', ticketId }, { kind: 'normal', title: `Обращение №${t.number} закрыто`, body: 'Если вопрос остался — напишите новое', data: { ticketId } });
    }
    return this.thread(user, ticketId);
  }

  async mine(user: AuthUser) {
    return this.db.query(
      `select t.id, t.number, t.topic, t.status, t.order_id, o.number as order_number, t.created_at, t.updated_at,
              (select body from support_messages m where m.ticket_id=t.id order by m.id desc limit 1) as last
         from support_tickets t left join orders o on o.id=t.order_id where t.user_id=$1 order by t.updated_at desc limit 50`, [user.id]);
  }

  /** Очередь: сначала открытые, где последнее слово за пользователем */
  async queue(status: 'open' | 'closed' = 'open') {
    return this.db.query(
      `select t.id, t.number, t.topic, t.status, t.order_id, o.number as order_number, t.created_at, t.updated_at,
              u.id as user_id, u.name, u.phone, a.name as assignee_name,
              t.sla_deadline_at, t.first_staff_reply_at, t.sla_overdue_at,
              (select body from support_messages m where m.ticket_id=t.id order by m.id desc limit 1) as last,
              (select not from_staff from support_messages m where m.ticket_id=t.id and m.sender_id is not null order by m.id desc limit 1) as waiting
         from support_tickets t join users u on u.id=t.user_id left join orders o on o.id=t.order_id left join users a on a.id=t.assignee_id
        where t.status=$1 order by waiting desc nulls last, t.updated_at desc limit 200`, [status]);
  }

  async thread(user: AuthUser, ticketId: string) {
    const t = await this.mustSee(user, ticketId);
    const messages = await this.db.query(
      `select m.id::int as id, m.body, m.from_staff, m.created_at, m.sender_id, u.name as sender_name
         from support_messages m left join users u on u.id=m.sender_id where m.ticket_id=$1 order by m.id`, [ticketId]);
    const order = t.order_id ? await this.db.one('select id, number, status, service from orders where id=$1', [t.order_id]) : null;
    const author = isStaff(user) ? await this.db.one('select id, name, phone from users where id=$1', [t.user_id]) : null;
    const entry = t.ledger_entry_id ? await this.db.one(
      `select l.id::int as id, l.kind, l.amount, l.note, l.account, l.created_at, o.number as order_number
         from ledger_entries l left join orders o on o.id=l.order_id where l.id=$1`, [t.ledger_entry_id]) : null;
    return { id: t.id, number: t.number, topic: t.topic, status: t.status,
      createdAt: t.created_at, slaDeadlineAt: t.sla_deadline_at,
      firstStaffReplyAt: t.first_staff_reply_at, slaOverdueAt: t.sla_overdue_at,
      order, author, messages, entry };
  }

  private async mustSee(user: AuthUser, ticketId: string) {
    const t = await this.db.one('select * from support_tickets where id=$1', [ticketId]);
    if (!t) throw notFound('Обращение не найдено');
    if (t.user_id !== user.id && !isStaff(user)) throw forbidden();
    return t;
  }
}
