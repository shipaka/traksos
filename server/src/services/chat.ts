import type { Db } from '../db/index.ts';
import type { SettingsService } from './settings.ts';
import type { Notifier } from './notify.ts';
import type { OrdersService } from './orders.ts';
import { bad, conflict, type AuthUser } from '../http/router.ts';
import { maskPhones } from '../util.ts';

// Text-only shortcuts. «Я на месте» changes the order status; it must never be
// offered as a chat message (especially after completion).
export const QUICK_REPLIES = [
  'Буду через 10 минут',
  'Нет связи, пишите сюда',
  'Задерживаюсь, извините',
  'Жду у машины',
  'Позвоните мне через приложение',
];

export function quickRepliesFor(service: string, status: string, actor: string | null): string[] {
  if (['completed', 'cancelled', 'no_performer'].includes(status) || !actor || actor === 'admin') return [];
  if (service === 'consult') return CONSULT_QUICK_REPLIES;
  if (status === 'awaiting_confirmation') return actor === 'client'
    ? ['Есть вопрос по сумме', 'Позвоните мне через приложение']
    : ['Проверьте, пожалуйста, сумму', 'Позвоните мне через приложение'];
  if (actor === 'performer') return ['accepted', 'en_route'].includes(status)
    ? ['Буду через 10 минут', 'Задерживаюсь, извините', 'Позвоните мне через приложение']
    : ['Нет связи, пишите сюда', 'Позвоните мне через приложение'];
  return ['Жду у машины', 'Нет связи, пишите сюда', 'Позвоните мне через приложение'];
}

/** Консультация — разговор по телефону: «на месте» и «буду через 10 минут» тут ни к чему */
export const CONSULT_QUICK_REPLIES = [
  'Позвоните мне через приложение',
  'Нет связи, пишите сюда',
  'Сейчас пришлю фото',
  'Какой код ошибки?',
  'Спасибо, помогло',
];

export class ChatService {
  constructor(private db: Db, private settings: SettingsService, private notifier: Notifier, private orders: OrdersService) {}

  async list(user: AuthUser, orderId: string, afterId = 0) {
    const order = await this.orders.mustSee(user, orderId);
    const msgs = await this.db.query(
      `select m.id::int as id, m.sender_id, u.name as sender_name, m.kind, m.body, m.masked, m.created_at,
              case when m.sender_id is null then 'system'
                   when m.sender_id = o.performer_id then 'performer'
                   when m.sender_id in (o.client_id, o.created_by) then 'client'
                   else 'support' end as sender_role
         from chat_messages m join orders o on o.id = m.order_id left join users u on u.id = m.sender_id
        where m.order_id=$1 and m.id > $2 order by m.id limit 500`,
      [orderId, afterId],
    );
    // Кто в чате: владелец, водитель (если заказывал он), исполнитель, поддержка — если подключалась
    const people = await this.db.query<{ id: string; name: string | null; who: string }>(
      `select u.id, u.name, x.who from (values ($1::uuid, 'owner'), ($2::uuid, 'driver'), ($3::uuid, 'performer')) x(id, who) join users u on u.id = x.id
        where x.id is not null`, [order.client_id, order.created_by !== order.client_id ? order.created_by : null, order.performer_id]);
    const support = await this.db.one<{ n: number }>(
      `select count(*)::int as n from chat_messages m join orders o on o.id=m.order_id
        where m.order_id=$1 and m.sender_id is not null and m.sender_id not in (o.client_id, o.created_by) and m.sender_id is distinct from o.performer_id`, [orderId]);
    const ticket = await this.db.one('select 1 from support_tickets where order_id=$1 limit 1', [orderId]);
    const participants = people.map((p) => ({ who: p.who, name: p.name, you: p.id === user.id }));
    if ((support?.n ?? 0) > 0 || ticket) participants.push({ who: 'support', name: 'Поддержка ТракSOS', you: false });
    return { messages: msgs, participants, quickReplies: quickRepliesFor(order.service, order.status, this.orders.actorOf(user, order)) };
  }

  async post(user: AuthUser, orderId: string, body: string, kind: 'text' | 'quick' = 'text') {
    const o = await this.orders.mustSee(user, orderId);
    const actor = this.orders.actorOf(user, o);
    if (!actor) throw bad('not_participant', 'Писать могут только участники заявки');
    if (['completed', 'cancelled'].includes(o.status))
      throw conflict('chat_closed', 'Диалог завершён. История доступна для просмотра, новое сообщение отправить нельзя');
    const text = body.trim().slice(0, 2000);
    if (!text) throw bad('empty', 'Пустое сообщение');
    if (kind === 'quick' && !quickRepliesFor(o.service, o.status, actor).includes(text))
      throw bad('invalid_quick_reply', 'Этот быстрый ответ недоступен на текущем этапе заявки');
    const { text: safe, masked } = maskPhones(text);
    const words = (await this.settings.get('chat')).suspiciousWords;
    const lower = safe.toLowerCase();
    const flagged = masked || words.some((w) => lower.includes(w));
    const m = await this.db.one(
      `insert into chat_messages(order_id, sender_id, kind, body, masked, flagged)
       select o.id, $2, $3, $4, $5, $6 from orders o
       where o.id=$1 and o.status not in ('completed', 'cancelled')
       for update of o
       returning id::int as id, order_id, sender_id, kind, body, masked, created_at`,
      [orderId, user.id, kind, safe, masked, flagged],
    );
    // The locked order row is rechecked when a concurrent confirmation commits.
    // Never insert a message after an order has become terminal.
    if (!m) throw conflict('chat_closed', 'Диалог завершён. Новые сообщения недоступны');
    const message = { ...m, sender_name: user.name };
    const ids = await this.orders.participants(orderId);
    this.notifier.live(ids, { type: 'chat', message });
    const others = ids.filter((id) => id !== user.id);
    await this.notifier.notify(others, { type: 'chat_push', orderId }, {
      kind: 'normal', title: `Заявка №${o.number}`, body: safe.slice(0, 120), data: { orderId },
    });
    if (masked) {
      await this.orders.systemMessage(orderId, 'Номера телефонов в чате скрываются. Звоните через кнопку в заявке — так безопаснее для обеих сторон.');
    }
    return message;
  }
}
