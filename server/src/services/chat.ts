import type { Db, Queryable } from '../db/index.ts';
import type { SettingsService } from './settings.ts';
import type { Notifier } from './notify.ts';
import type { OrdersService } from './orders.ts';
import { bad, conflict, forbidden, notFound, type AuthUser } from '../http/router.ts';
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
  // Once the specialist has finished, only confirmation-related prompts
  // remain, including after a *telephone* consultation.
  if (status === 'awaiting_confirmation') return actor === 'client'
    ? ['Есть вопрос по сумме', 'Позвоните мне через приложение']
    : ['Проверьте, пожалуйста, сумму', 'Позвоните мне через приложение'];
  if (service === 'consult') return CONSULT_QUICK_REPLIES;
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

  private async liveActor(q: Queryable, user: AuthUser, o: {
    client_id: string; created_by: string; performer_id: string | null; vehicle_id: string | null;
  }): Promise<'admin'|'client'|'performer'|null> {
    const current = await q.one<{roles:string[]}>(
      "select roles from users where id=$1 and status='active' for share", [user.id]);
    if (!current) return null;
    const roles = user.roles.filter(role => current.roles.includes(role));
    if (roles.includes('admin') || roles.includes('moderator')) return 'admin';
    if (o.client_id === user.id) return 'client';
    if (o.performer_id === user.id) return 'performer';
    if (o.created_by !== user.id || !roles.includes('driver')) return null;
    const assignment = await q.one<{ok:number}>(`
      select 1 as ok from users u join vehicles v
        on v.owner_id=u.owner_id and v.driver_id=u.id
      where u.id=$1 and u.owner_id=$2 and 'driver'=any(u.roles)
        and ($3::uuid is null or v.id=$3)
      limit 1 for share of v`, [user.id,o.client_id,o.vehicle_id]);
    return assignment ? 'client' : null;
  }

  async list(user: AuthUser, orderId: string, afterId = 0) {
    if (!Number.isSafeInteger(afterId) || afterId < 0) throw bad('bad_cursor', 'Некорректная позиция переписки');
    return this.db.tx(async q => {
      const order = await q.one<{
        client_id:string; created_by:string; performer_id:string|null; vehicle_id:string|null;
        service:string; status:string;
      }>('select client_id,created_by,performer_id,vehicle_id,service,status from orders where id=$1 for share',[orderId]);
      if (!order) throw notFound('Заявка не найдена');
      // Invitation grants a redacted order preview, never private history.
      const role = await this.liveActor(q,user,order);
      if (!role) throw forbidden('Переписка доступна только участникам заявки');
      const msgs = await q.query(
        `select m.id::int as id, m.sender_id, u.name as sender_name, m.kind, m.body, m.masked, m.created_at,
                case when m.sender_id is null then 'system'
                     when m.sender_id = o.performer_id then 'performer'
                     when m.sender_id in (o.client_id, o.created_by) then 'client'
                     else 'support' end as sender_role
           from chat_messages m join orders o on o.id = m.order_id left join users u on u.id = m.sender_id
          where m.order_id=$1 and m.id > $2 order by m.id limit 500`,
        [orderId, afterId],
      );
      // Legacy shared system messages sometimes contained the customer's surcharge and final bill.
      // Never return those amounts to a performer/candidate, including old archived messages.
      const visibleMessages = role === 'performer' || role === null ? (msgs as any[]).map(m => {
        if (m.sender_role !== 'system') return m;
        const body = String(m.body ?? '');
        if (body.startsWith('Исполнитель закрыл выезд:') || /^Сумма\s+[\d\s,.]+\s*₽/.test(body))
          return { ...m, body: 'Клиенту доступен подробный расчёт. Свои удержания и выплаты смотрите в разделе «Финансы».' };
        return m;
      }) : msgs;
      // Кто в чате: владелец, водитель (если заказывал он), исполнитель, поддержка — если подключалась
      const people = await q.query<{ id: string; name: string | null; who: string }>(
        `select u.id, u.name, x.who from (values ($1::uuid, 'owner'), ($2::uuid, 'driver'), ($3::uuid, 'performer')) x(id, who) join users u on u.id = x.id
          where x.id is not null`, [order.client_id, order.created_by !== order.client_id ? order.created_by : null, order.performer_id]);
      const support = await q.one<{ n: number }>(
        `select count(*)::int as n from chat_messages m join orders o on o.id=m.order_id
          where m.order_id=$1 and m.sender_id is not null and m.sender_id not in (o.client_id, o.created_by) and m.sender_id is distinct from o.performer_id`, [orderId]);
      const ticket = await q.one('select 1 from support_tickets where order_id=$1 limit 1', [orderId]);
      // A revoked fleet driver's old ID may remain in orders.created_by as
      // historical evidence, but must not be a *current* chat participant.
      const activePeople = new Set([order.client_id,order.performer_id]);
      if (order.created_by !== order.client_id) {
        const currentDriver = await q.one<{ok:number}>(`
          select 1 as ok from users u join vehicles v on v.owner_id=u.owner_id and v.driver_id=u.id
          where u.id=$1 and u.owner_id=$2 and 'driver'=any(u.roles) and u.status='active'
            and ($3::uuid is null or v.id=$3) limit 1`,
          [order.created_by,order.client_id,order.vehicle_id]);
        if (currentDriver) activePeople.add(order.created_by);
      }
      const participants = people.filter(p => activePeople.has(p.id))
        .map(p => ({ who: p.who, name: p.name, you: p.id === user.id }));
      if ((support?.n ?? 0) > 0 || ticket) participants.push({ who: 'support', name: 'Поддержка TrakSOS', you: false });
      return { messages: visibleMessages, participants, quickReplies: quickRepliesFor(order.service, order.status, role) };
    });
  }

  async post(user: AuthUser, orderId: string, body: string, kind: 'text' | 'quick' = 'text') {
    // This initial check preserves the existing useful "not found/forbidden"
    // contract for outsiders and invited performers. The real write authority
    // is re-evaluated under the order row lock below.
    await this.orders.mustSee(user, orderId);
    const text = body.trim().slice(0, 2000);
    if (!text) throw bad('empty', 'Пустое сообщение');
    const { text: safe, masked } = maskPhones(text);
    const words = (await this.settings.get('chat')).suspiciousWords;
    const lower = safe.toLowerCase();
    const flagged = masked || words.some((w) => lower.includes(w));

    const { message, number } = await this.db.tx(async q => {
      // Status, performer and customer authority are checked in one snapshot.
      // A previous owner/driver/performer check in another pooled connection
      // is not sufficient while reassignments and closures are concurrent.
      const o = await q.one<{
        id: string; number: number; status: string; service: string;
        client_id: string; created_by: string; performer_id: string | null;
        vehicle_id: string | null;
      }>(`select id,number,status,service,client_id,created_by,performer_id,vehicle_id
            from orders where id=$1 for update`, [orderId]);
      if (!o) throw forbidden('Заявка недоступна');
      const actor = await this.liveActor(q,user,o);
      if (!actor) throw forbidden('Переписка доступна только участникам заявки');
      if (['completed', 'cancelled', 'no_performer'].includes(o.status))
        throw conflict('chat_closed', 'Диалог завершён. История доступна для просмотра, новое сообщение отправить нельзя');
      // A quick reply is not a stale action: its eligibility is checked against
      // the CURRENT, row-locked service, status and actor.
      if (kind === 'quick' && !quickRepliesFor(o.service, o.status, actor).includes(text))
        throw bad('invalid_quick_reply', 'Этот быстрый ответ недоступен на текущем этапе заявки');
      const m = await q.one<{
        id: number; order_id: string; sender_id: string;
        kind: string; body: string; masked: boolean; created_at: string;
      }>(`insert into chat_messages(order_id, sender_id, kind, body, masked, flagged)
          values ($1,$2,$3,$4,$5,$6)
          returning id::int as id,order_id,sender_id,kind,body,masked,created_at`,
        [orderId, user.id, kind, safe, masked, flagged]);
      return { message: m!, number: o.number };
    });

    const rendered = { ...message, sender_name: user.name };
    // Never notify a former fleet driver merely because created_by was once
    // associated with an order. The recipients helper checks the CURRENT link.
    try {
      const ids = await this.orders.participants(orderId);
      this.notifier.live(ids, { type: 'chat', message: rendered });
      const others = ids.filter(id => id !== user.id);
      await this.notifier.notify(others, { type: 'chat_push', orderId }, {
        kind: 'normal', title: `Заявка №${number}`, body: safe.slice(0, 120), data: { orderId },
      });
    } catch (error) {
      // The message is already committed. Reporting a POST failure here would
      // make mobile retries duplicate messages; the chat itself stays readable.
      console.warn('[chat-notify]', error instanceof Error ? error.message : 'delivery failed');
    }
    if (masked) {
      try {
        await this.orders.systemMessage(orderId,
          'Номера телефонов в чате скрываются. Звоните через кнопку в заявке — так безопаснее для обеих сторон.');
      } catch (error) {
        // A secondary system tip is never a reason to lose the confirmed user
        // message or ask the client to send it again.
        console.warn('[chat-mask-tip]', error instanceof Error ? error.message : 'delivery failed');
      }
    }
    return rendered;

  }
}
