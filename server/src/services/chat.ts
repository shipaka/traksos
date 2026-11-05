import type { Db } from '../db/index.ts';
import type { SettingsService } from './settings.ts';
import type { Notifier } from './notify.ts';
import type { OrdersService } from './orders.ts';
import { bad, type AuthUser } from '../http/router.ts';
import { maskPhones } from '../util.ts';

export const QUICK_REPLIES = [
  'Я на месте',
  'Буду через 10 минут',
  'Нет связи, пишите сюда',
  'Задерживаюсь, извините',
  'Жду у машины',
  'Позвоните мне через приложение',
];

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
    return { messages: msgs, quickReplies: order.service === 'consult' ? CONSULT_QUICK_REPLIES : QUICK_REPLIES };
  }

  async post(user: AuthUser, orderId: string, body: string, kind: 'text' | 'quick' = 'text') {
    const o = await this.orders.mustSee(user, orderId);
    if (!this.orders.actorOf(user, o)) throw bad('not_participant', 'Писать могут только участники заявки');
    const text = body.trim().slice(0, 2000);
    if (!text) throw bad('empty', 'Пустое сообщение');
    const { text: safe, masked } = maskPhones(text);
    const words = (await this.settings.get('chat')).suspiciousWords;
    const lower = safe.toLowerCase();
    const flagged = masked || words.some((w) => lower.includes(w));
    const m = await this.db.one(
      `insert into chat_messages(order_id, sender_id, kind, body, masked, flagged) values ($1,$2,$3,$4,$5,$6)
       returning id::int as id, order_id, sender_id, kind, body, masked, created_at`,
      [orderId, user.id, kind, safe, masked, flagged],
    );
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
