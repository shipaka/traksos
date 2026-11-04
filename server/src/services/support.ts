// Поддержка: обращения по заявке или без неё. Пишут пользователь и сотрудники; закрыть может любой из них.

import type { Db } from '../db/index.ts';
import type { Notifier } from './notify.ts';
import type { OrdersService } from './orders.ts';
import { bad, conflict, forbidden, notFound, type AuthUser } from '../http/router.ts';
import { maskPhones } from '../util.ts';

export const TOPICS = ['Мастер не приехал', 'Не согласен с суммой', 'Проблема с оплатой', 'Вернуть деньги', 'Жалоба на исполнителя', 'Жалоба на клиента', 'Не работает приложение', 'Другое'];

const isStaff = (u: AuthUser) => u.roles.includes('admin') || u.roles.includes('moderator');

export class SupportService {
  constructor(private db: Db, private notifier: Notifier, private orders: OrdersService, private now: () => Date) {}

  private staffIds = async () => (await this.db.query<{ id: string }>(`select id from users where roles && '{admin,moderator}'::text[]`)).map((r) => r.id);

  async open(user: AuthUser, p: { topic: string; text: string; orderId?: string }) {
    const text = p.text.trim();
    if (text.length < 3) throw bad('empty', 'Опишите, что случилось');
    let number: number | null = null;
    if (p.orderId) {
      const o = await this.orders.mustSee(user, p.orderId);
      if (!this.orders.actorOf(user, o)) throw forbidden('Позвать поддержку могут участники заявки');
      number = o.number;
      // По одной заявке у человека одно открытое обращение — новое сообщение уходит в него
      const existing = await this.db.one('select id from support_tickets where user_id=$1 and order_id=$2 and status=$3', [user.id, p.orderId, 'open']);
      if (existing) {
        await this.post(user, existing.id, text);
        return this.thread(user, existing.id);
      }
    }
    const t = await this.db.one(
      `insert into support_tickets(user_id, order_id, topic) values ($1,$2,$3) returning id, number`, [user.id, p.orderId ?? null, p.topic.slice(0, 80)]);
    await this.db.query(`insert into support_messages(ticket_id, sender_id, body) values ($1,$2,$3)`, [t!.id, user.id, maskPhones(text).text]);
    if (p.orderId) {
      await this.orders.event(this.db, p.orderId, user.id, 'support_called', { ticket: t!.number, topic: p.topic });
      await this.orders.systemMessage(p.orderId, `Подключили поддержку (обращение №${t!.number}). Ответим в течение 15 минут.`);
    }
    await this.notifier.notify(await this.staffIds(), { type: 'support', ticketId: t!.id }, {
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
    await this.db.query(`insert into support_messages(ticket_id, sender_id, from_staff, body) values ($1,$2,$3,$4)`,
      [ticketId, user.id, staff, staff ? text : maskPhones(text).text]);
    await this.db.query(`update support_tickets set updated_at=$2, assignee_id = coalesce(assignee_id, $3) where id=$1`,
      [ticketId, this.now(), staff ? user.id : null]);
    if (staff) {
      await this.notifier.notify([t.user_id], { type: 'support', ticketId }, {
        kind: 'normal', title: `Поддержка ответила · №${t.number}`, body: text.slice(0, 120), data: { ticketId },
      });
    } else {
      const to = t.assignee_id ? [t.assignee_id] : await this.staffIds();
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
    return { id: t.id, number: t.number, topic: t.topic, status: t.status, createdAt: t.created_at, order, author, messages };
  }

  private async mustSee(user: AuthUser, ticketId: string) {
    const t = await this.db.one('select * from support_tickets where id=$1', [ticketId]);
    if (!t) throw notFound('Обращение не найдено');
    if (t.user_id !== user.id && !isStaff(user)) throw forbidden();
    return t;
  }
}
