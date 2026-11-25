import { createHash } from 'node:crypto';
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

export type ChatWindow = {mode:'latest'|'before'|'after';limit:number;cursor?:number};

export class ChatService {
  constructor(private db: Db, private settings: SettingsService, private notifier: Notifier, private orders: OrdersService) {}

  private async liveActor(q: Queryable, user: AuthUser, o: {
    client_id: string; created_by: string; performer_id: string | null; vehicle_id: string | null;
  }): Promise<'admin'|'client'|'performer'|null> {
    if (user.status !== 'active') return null;
    const current = await q.one<{roles:string[];owner_id:string|null}>(
      "select roles,owner_id from users where id=$1 and status='active' and deleted_at is null for share", [user.id]);
    if (!current) return null;
    const roles = user.roles.filter(role => current.roles.includes(role));
    if (roles.includes('admin') || roles.includes('moderator')) return 'admin';
    if (o.client_id === user.id && roles.includes('client') && !current.owner_id) return 'client';
    if (o.performer_id === user.id && roles.some(r=>['master','tow','service'].includes(r))) return 'performer';
    if (o.created_by !== user.id || !roles.includes('driver')) return null;
    const assignment = await q.one<{ok:number}>(`
      select 1 as ok from users u join vehicles v
        on v.owner_id=u.owner_id and v.driver_id=u.id
      join users owner on owner.id=u.owner_id
      where u.id=$1 and u.owner_id=$2 and 'driver'=any(u.roles)
        and u.status='active' and u.deleted_at is null
        and owner.status='active' and owner.deleted_at is null
        and 'client'=any(owner.roles) and owner.owner_id is null
        and ($3::uuid is null or v.id=$3)
      limit 1 for share of v,owner`, [user.id,o.client_id,o.vehicle_id]);
    return assignment ? 'client' : null;
  }

  // Same live role/link predicate for the participant roster and new human
  // chat delivery. Historical sender labels in stored messages remain intact.
  private async currentPeople(q:Queryable,orderId:string) {
    return q.query<{id:string;name:string|null;who:string}>(`
      select distinct u.id,u.name,x.who from orders o
      cross join lateral (values (o.client_id,'owner'),
        (case when o.created_by<>o.client_id then o.created_by end,'driver'),
        (o.performer_id,'performer')) x(id,who)
      join users u on u.id=x.id
      where o.id=$1 and u.status='active' and u.deleted_at is null and (
        (x.who='owner' and 'client'=any(u.roles) and u.owner_id is null)
        or (x.who='performer' and u.roles && array['master','tow','service']::text[])
        or (x.who='driver' and 'driver'=any(u.roles) and u.owner_id=o.client_id
          and exists(select 1 from users owner where owner.id=o.client_id
            and owner.status='active' and owner.deleted_at is null
            and 'client'=any(owner.roles) and owner.owner_id is null)
          and exists(select 1 from vehicles v where v.owner_id=o.client_id and v.driver_id=u.id
            and (o.vehicle_id is null or v.id=o.vehicle_id)))
      ) order by x.who,u.id`,[orderId]);
  }

  async list(user: AuthUser, orderId: string, afterId = 0, window?: ChatWindow) {
    if (!Number.isSafeInteger(afterId) || afterId < 0) throw bad('bad_cursor', 'Некорректная позиция переписки');
    if (window && (!['latest','before','after'].includes(window.mode) ||
      !Number.isSafeInteger(window.limit) || window.limit < 1 || window.limit > 500 ||
      (window.mode === 'latest' ? window.cursor !== undefined :
        !Number.isSafeInteger(window.cursor) || window.cursor! < (window.mode === 'before' ? 1 : 0))))
      throw bad('bad_cursor', 'Некорректное окно переписки');
    return this.db.tx(async q => {
      const order = await q.one<{
        client_id:string; created_by:string; performer_id:string|null; vehicle_id:string|null;
        service:string; status:string;
      }>('select client_id,created_by,performer_id,vehicle_id,service,status from orders where id=$1 for share',[orderId]);
      if (!order) throw notFound('Заявка не найдена');
      // Invitation grants a redacted order preview, never private history.
      const role = await this.liveActor(q,user,order);
      if (!role) throw forbidden('Переписка доступна только участникам заявки');
      const descending = !!window && window.mode !== 'after';
      const filter = window?.mode === 'latest' ? '' : window?.mode === 'before' ? 'and m.id < $2' : 'and m.id > $2';
      const params = window?.mode === 'latest' ? [orderId, window.limit+1] : [orderId, window?.cursor ?? afterId, window ? window.limit+1 : 500];
      const fetched = await q.query<{id:number;[key:string]:any}>(
        `select m.id::int as id, m.sender_id, u.name as sender_name, m.kind, m.body, m.masked, m.created_at,
                case when m.sender_id is null then 'system'
                     when m.sender_id = o.performer_id then 'performer'
                     when m.sender_id in (o.client_id, o.created_by) then 'client'
                     else 'support' end as sender_role
           from chat_messages m join orders o on o.id = m.order_id left join users u on u.id = m.sender_id
          where m.order_id=$1 ${filter} order by m.id ${descending ? 'desc' : 'asc'} limit ${window?.mode === 'latest' ? '$2' : '$3'}`,
        params,
      );
      const hasMore = !!window && fetched.length > window.limit;
      const msgs = window ? fetched.slice(0,window.limit) : fetched;
      if (descending) msgs.reverse();
      const page = window ? { mode:window.mode, hasMore, oldestId:msgs[0]?.id ?? null,
        newestId:msgs[msgs.length-1]?.id ?? null,
        nextCursor:hasMore ? (descending ? msgs[0].id : msgs[msgs.length-1].id) : null } : undefined;
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
      const people = await this.currentPeople(q,orderId);
      const support = await q.one<{ n: number }>(
        `select count(*)::int as n from chat_messages m join orders o on o.id=m.order_id
          where m.order_id=$1 and m.sender_id is not null and m.sender_id not in (o.client_id, o.created_by) and m.sender_id is distinct from o.performer_id`, [orderId]);
      const ticket = await q.one('select 1 from support_tickets where order_id=$1 limit 1', [orderId]);
      const participants = people
        .map(p => ({ who: p.who, name: p.name, you: p.id === user.id }));
      if ((support?.n ?? 0) > 0 || ticket) participants.push({ who: 'support', name: 'Поддержка TrakSOS', you: false });
      return { messages: visibleMessages, participants, quickReplies: quickRepliesFor(order.service, order.status, role), ...(page ? {page} : {}) };
    });
  }

  async post(user: AuthUser, orderId: string, body: string, kind: 'text' | 'quick' = 'text', requestId?:string) {
    // This initial check preserves the existing useful "not found/forbidden"
    // contract for outsiders and invited performers. The real write authority
    // is re-evaluated under the order row lock below.
    await this.orders.mustSee(user, orderId);
    const text = body.trim().slice(0, 2000);
    if (!text) throw bad('empty', 'Пустое сообщение');
    if(requestId!==undefined&&!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestId))
      throw bad('bad_request_id','Некорректный идентификатор отправки');
    const fingerprint=requestId===undefined?null:createHash('sha256').update(JSON.stringify([kind,text])).digest('hex');
    const { text: safe, masked } = maskPhones(text);
    const words = (await this.settings.get('chat')).suspiciousWords;
    const lower = safe.toLowerCase();
    const flagged = masked || words.some((w) => lower.includes(w));

    const { message, number, created } = await this.db.tx(async q => {
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
      // The order row lock serializes duplicate attempts; authorization is
      // checked first even for replay. A committed message can be acknowledged
      // after closure, but a new message can never be added to an archive.
      if(requestId!==undefined){
        const prior=await q.one<{id:number;order_id:string;sender_id:string;kind:string;body:string;masked:boolean;created_at:string;client_request_fingerprint:string}>(
          `select id::int as id,order_id,sender_id,kind,body,masked,created_at,client_request_fingerprint
            from chat_messages where order_id=$1 and sender_id=$2 and client_request_id=$3`,[orderId,user.id,requestId]);
        if(prior){
          if(prior.client_request_fingerprint!==fingerprint)
            throw conflict('request_id_conflict','Этот идентификатор уже использован для другого сообщения');
          const {client_request_fingerprint:_,...message}=prior;
          return {message,number:o.number,created:false};
        }
      }
      if (['completed', 'cancelled', 'no_performer'].includes(o.status))
        throw conflict('chat_closed', 'Диалог завершён. История доступна для просмотра, новое сообщение отправить нельзя');
      // A quick reply is not a stale action: its eligibility is checked against
      // the CURRENT, row-locked service, status and actor.
      if (kind === 'quick' && !quickRepliesFor(o.service, o.status, actor).includes(text))
        throw bad('invalid_quick_reply', 'Этот быстрый ответ недоступен на текущем этапе заявки');
      const m = await q.one<{
        id: number; order_id: string; sender_id: string;
        kind: string; body: string; masked: boolean; created_at: string;
      }>(`insert into chat_messages(order_id, sender_id, kind, body, masked, flagged, client_request_id, client_request_fingerprint)
          values ($1,$2,$3,$4,$5,$6,$7,$8)
          returning id::int as id,order_id,sender_id,kind,body,masked,created_at`,
        [orderId, user.id, kind, safe, masked, flagged, requestId??null,fingerprint]);
      return { message: m!, number: o.number, created:true };
    });

    const rendered = { ...message, sender_name: user.name };
    if(!created)return rendered;
    // Never notify a former fleet driver merely because created_by was once
    // associated with an order. The recipients helper checks the CURRENT link.
    try {
      const ids = [...new Set((await this.currentPeople(this.db,orderId)).map(p=>p.id))];
      this.notifier.live(ids, { type: 'chat', message: rendered });
      const others = ids.filter(id => id !== user.id);
      await this.notifier.notify(others, { type: 'chat_push', orderId }, {
        kind: 'normal', title: `Заявка №${number}`, body: 'Новое сообщение. Откройте переписку в заявке.', data: { orderId },
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
