// Поддержка: обращения по заявке или без неё. Пишут пользователь и сотрудники; закрыть может любой из них.

import { createHash } from 'node:crypto';
import type { Db, Queryable } from '../db/index.ts';
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

  // Never authorize private support from a cached role snapshot alone.
  private async liveActor(q: Queryable, user: AuthUser): Promise<AuthUser> {
    const current = await q.one<AuthUser>(
      "select id,phone,name,roles,status,owner_id from users where id=$1 and status='active' and deleted_at is null for share",
      [user.id]);
    if (!current) throw forbidden();
    const roles = current.roles.filter(role => user.roles.includes(role));
    if (!roles.length) throw forbidden();
    return { ...current, roles };
  }

  private async authorizeTicket(q: Queryable, user: AuthUser, ticket: {user_id: string}) {
    const actor = await this.liveActor(q,user);
    if (ticket.user_id !== actor.id && !isStaff(actor)) throw forbidden();
    return actor;
  }

  private async activeRecipient(q: Queryable, id: string): Promise<string[]> {
    const row = await q.one<{id:string}>(
      "select id from users where id=$1 and status='active' and deleted_at is null for share",[id]);
    return row ? [row.id] : [];
  }


  // Moderators own the first response. Admin receives intake only when no
  // moderator exists; otherwise admin is alerted once the SLA is breached.
  private intakeStaffIds = async (q: Queryable = this.db, requestedRole?: 'admin' | 'moderator' | null) => {
    const moderators = await q.query<{ id: string }>(
      `select id from users where status='active' and deleted_at is null and roles && '{moderator}'::text[] order by id for share`);
    if (requestedRole !== 'admin' && moderators.length) return moderators.map(r => r.id);
    const admins = await q.query<{ id: string }>(
      `select id from users where status='active' and deleted_at is null and roles && '{admin}'::text[] order by id for share`);
    return admins.length ? admins.map(r => r.id) : moderators.map(r => r.id);
  };

  /**
   * Durable, idempotent 60-minute escalation. Calls are safe across multiple
   * server instances: the locked rows, event and admin inbox all commit together.
   * A late human reply does not erase the historical SLA breach.
   */
  async tickSla() {
    const now = this.now();
    const { overdue, adminIds } = await this.db.tx(async q => {
      const overdue = await q.query<{ id: string; number: number; sla_deadline_at: Date }>(
        `select id, number, sla_deadline_at from support_tickets
          where sla_deadline_at is not null and sla_deadline_at <= $1
            and sla_overdue_at is null
            and (first_staff_reply_at is null or first_staff_reply_at > sla_deadline_at)
          order by sla_deadline_at limit 100 for update skip locked`, [now]);
      if (!overdue.length) return { overdue, adminIds: [] as string[] };
      const admins = await q.query<{ id: string }>(
        `select id from users where status='active' and deleted_at is null and roles && '{admin}'::text[] order by id for share`);
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
              '60 минут без своевременного ответа. Откройте личное обращение.',
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
        body: '60 минут без своевременного ответа. Откройте личное обращение.',
        data: { ticketId: ticket.id, sla: 'first_reply_overdue' },
      });
    }
    return overdue.length;
  }


  // Standalone intake has no linked order or ledger side effects. Persist
  // the initial message and staff inbox in the same transaction as its ticket.
  private async openStandalone(user: AuthUser, p: {
    topic: string; text: string; requestKey?: string; requestedRole?: 'admin' | 'moderator';
  }, text: string) {
    const safeText = maskPhones(text).text;
    const fingerprint = createHash('sha256').update(JSON.stringify([p.topic, text, p.requestedRole ?? null])).digest('hex');
    const result = await this.db.tx(async q => {
      await this.liveActor(q,user);
      if (p.requestKey) {
        await q.query('select pg_advisory_xact_lock(hashtext($1))', ['support:standalone:' + user.id + ':' + p.requestKey]);
        const prior = await q.one<{id:string;client_request_hash:string}>(
          'select id,client_request_hash from support_tickets where user_id=$1 and client_request_key=$2',
          [user.id,p.requestKey]);
        if (prior) {
          if (prior.client_request_hash !== fingerprint)
            throw conflict('support_request_changed','Этот запрос уже использован с другим текстом. Проверьте историю обращений.');
          return { id:prior.id, delivery:null };
        }
      }
      const ticket = await q.one<{id:string;number:number}>(
        `insert into support_tickets(user_id,topic,sla_deadline_at,client_request_key,client_request_hash,requested_staff_role)
         values($1,$2,$3,$4,$5,$6) returning id,number`,
        [user.id,p.topic.slice(0,80),new Date(this.now().getTime()+3_600_000),
          p.requestKey??null,p.requestKey?fingerprint:null,p.requestedRole??null]);
      if (!ticket) throw Error('Support ticket insert failed');
      await q.query('insert into support_messages(ticket_id,sender_id,body) values($1,$2,$3)',
        [ticket.id,user.id,safeText]);
      const ids = await this.intakeStaffIds(q,p.requestedRole);
      const msg = { kind:'normal' as const, title:`Новое обращение №${ticket.number}`,
        body:'Откройте личное обращение, чтобы прочитать сообщение.', data:{ticketId:ticket.id} };
      for(const id of ids) await q.query(
        "insert into notifications(user_id,kind,title,body,data) values($1,'support',$2,$3,$4)",
        [id,msg.title,msg.body,msg.data]);
      return {id:ticket.id,delivery:{ids,msg}};
    });
    if(result.delivery) await this.notifier.deliverStored(result.delivery.ids,
      {type:'support',ticketId:result.id},result.delivery.msg).catch(()=>{});
    return this.thread(user,result.id);
  }

  async open(user: AuthUser, p: { topic: string; text: string; orderId?: string; ledgerEntryId?: number;
    requestKey?: string; requestedRole?: 'admin' | 'moderator' }) {
    const text = p.text.trim();
    if (text.length < 3) throw bad('empty', 'Опишите, что случилось');
    if (!p.orderId && !p.ledgerEntryId) return this.openStandalone(user,p,text);
    if (p.requestKey || p.requestedRole) throw bad('support_context','Этот способ доступен только для личного обращения без привязки к заявке.');
    // Only the stored thread contains the redacted text, never notice previews.
    const safeText = maskPhones(text).text;
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
        // Never commit an empty support ticket if its initial message fails.
        await q.query('insert into support_messages(ticket_id, sender_id, body) values ($1,$2,$3)',
          [created!.id, user.id, safeText]);
        return { id: created!.id, number: created!.number, created: true };
      });
      if (!result.created) {
        await this.post(user, result.id, text);
        return this.thread(user, result.id);
      }
      const t = result;
      await this.notifier.notify(await this.intakeStaffIds(), { type: 'support', ticketId: t!.id }, {
        kind: 'normal', title: `Новое обращение №${t!.number}`,
        body: 'Откройте личное обращение, чтобы прочитать сообщение.',
        data: { ticketId: t!.id },
      });
      return this.thread(user, t!.id);
    }
    let uniqueTicket: { id: string; number: number } | null = null;
    if (p.orderId) {
      const o = await this.orders.mustSee(user, p.orderId);
      if (!this.orders.actorOf(user, o)) throw forbidden('Позвать поддержку могут участники заявки');
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
        // Never commit an empty support ticket if its initial message fails.
        await q.query('insert into support_messages(ticket_id, sender_id, body) values ($1,$2,$3)',
          [created!.id, user.id, safeText]);
        return { id: created!.id, number: created!.number, created: true };
      });
      if (!result.created) {
        await this.post(user, result.id, text);
        return this.thread(user, result.id);
      }
      uniqueTicket = { id: result.id, number: result.number };
    }
    const t = uniqueTicket ?? await this.db.tx(async q => {
      const created = await q.one<{ id: string; number: number }>(
        `insert into support_tickets(user_id, order_id, topic, sla_deadline_at)
           values ($1,$2,$3,$4) returning id, number`,
        [user.id, null, p.topic.slice(0, 80), new Date(this.now().getTime() + 3_600_000)]);
      await q.query('insert into support_messages(ticket_id, sender_id, body) values ($1,$2,$3)',
        [created!.id, user.id, safeText]);
      return created!;
    });
    if (p.orderId) {
      await this.orders.event(this.db, p.orderId, user.id, 'support_called', { ticket: t!.number, topic: p.topic });
      await this.orders.systemMessage(p.orderId, `Подключили поддержку (обращение №${t!.number}). Первый ответ специалиста — в течение часа.`);
    }
    if (/спор|не согласен/i.test(p.topic) && this.onDispute) await this.onDispute({ userId: user.id, orderId: p.orderId ?? null, ticketId: t!.id, text, topic: p.topic });
    await this.notifier.notify(await this.intakeStaffIds(), { type: 'support', ticketId: t!.id }, {
      kind: 'normal', title: `Новое обращение №${t!.number}`,
      body: 'Откройте личное обращение, чтобы прочитать сообщение.',
      data: { ticketId: t!.id },
    });
    return this.thread(user, t!.id);
  }

  async post(user: AuthUser, ticketId: string, body: string, requestKey?: string) {
    const text = body.trim();
    if (!text) throw bad('empty', 'Пустое сообщение');
    const safeText = maskPhones(text).text;
    const fingerprint = requestKey ? createHash('sha256').update(text).digest('hex') : null;
    const delivery = await this.db.tx(async q => {
      const locked = await q.one<{ status: string; user_id: string; number: number; assignee_id: string | null; requested_staff_role: 'admin'|'moderator'|null }>(
        'select status, user_id, number, assignee_id, requested_staff_role from support_tickets where id=$1 for update', [ticketId]);
      if (!locked) throw notFound('Обращение не найдено');
      const actor = await this.authorizeTicket(q,user,locked);
      // Ticket lock serializes keyed replies with each other and with close.
      // Replay is allowed only after current ACL, even if the ticket closed.
      if (requestKey) {
        const prior = await q.one<{client_request_hash:string}>(
          'select client_request_hash from support_messages where ticket_id=$1 and sender_id=$2 and client_request_key=$3',
          [ticketId,actor.id,requestKey]);
        if (prior) {
          if (prior.client_request_hash !== fingerprint)
            throw conflict('support_reply_changed','Этот запрос уже использован с другим текстом.');
          return null;
        }
      }
      if (locked.status === 'closed')
        throw conflict('closed', 'Обращение закрыто — создайте новое');
      const staff = locked.user_id !== actor.id;
      // A former or blocked employee must not receive a new private reply.
      const assignee = locked.assignee_id ? await q.one<{ id: string }>(
        "select id from users where id=$1 and status='active' and deleted_at is null and roles && '{admin,moderator}'::text[] for share",
        [locked.assignee_id]) : null;
      const postedAt = this.now();
      await q.query(`insert into support_messages(ticket_id, sender_id, from_staff, body, client_request_key, client_request_hash)
        values ($1,$2,$3,$4,$5,$6)`, [ticketId, actor.id, staff, staff ? text : safeText, requestKey??null, fingerprint]);
      await q.query(`update support_tickets
        set updated_at=$2, assignee_id=$3,
            first_staff_reply_at=case when $4::boolean then coalesce(first_staff_reply_at,$2::timestamptz)
               else first_staff_reply_at end where id=$1`,
        [ticketId, postedAt, assignee?.id ?? (staff ? user.id : null), staff]);
      const ids = staff ? await this.activeRecipient(q,locked.user_id) :
        assignee ? [assignee.id] : await this.intakeStaffIds(q,locked.requested_staff_role);
      const title = staff ? `Поддержка ответила · №${locked.number}` : `Новое сообщение · №${locked.number}`;
      const msg = { kind: 'normal' as const, title, body: 'Откройте личное обращение, чтобы прочитать сообщение.', data: { ticketId } };
      // Persist the message, first-response timestamp and inbox in one commit.
      for (const id of ids) {
        await q.query(`insert into notifications(user_id,kind,title,body,data)
          values ($1,'support',$2,$3,$4)`, [id, msg.title, msg.body, msg.data]);
      }
      return { ids, msg };
    });
    // The inbox is durable even when an optional live delivery fails.
    if (delivery) await this.notifier.deliverStored(delivery.ids, { type: 'support', ticketId }, delivery.msg)
      .catch(() => {});
    return this.thread(user, ticketId);
  }

  async close(user: AuthUser, ticketId: string) {
    // The same lock as post() serializes closure and reply. Check live
    // authorization before even returning the idempotent closed state.
    const delivery = await this.db.tx(async q => {
      const locked = await q.one<{ status: string; user_id: string; number: number }>(
        'select status,user_id,number from support_tickets where id=$1 for update', [ticketId]);
      if (!locked) throw notFound('Обращение не найдено');
      const actor = await this.authorizeTicket(q,user,locked);
      if (locked.status === 'closed') return null;
      const at = this.now();
      await q.query(`update support_tickets set status='closed', closed_at=$2, closed_by=$3, updated_at=$2 where id=$1`,
        [ticketId, at, actor.id]);
      const staff = locked.user_id !== actor.id;
      await q.query(`insert into support_messages(ticket_id, sender_id, from_staff, body) values ($1,null,false,$2)`,
        [ticketId, staff
          ? 'Поддержка закрыла обращение. Если вопрос остался — напишите новое.' : 'Обращение закрыто.']);
      const ids = staff ? await this.activeRecipient(q,locked.user_id) : [];
      const msg = {kind:'normal' as const,title:`Обращение №${locked.number} закрыто`,
        body:'Если вопрос остался — напишите новое',data:{ticketId}};
      for (const id of ids) await q.query(
        `insert into notifications(user_id,kind,title,body,data) values ($1,'support',$2,$3,$4)`,
        [id,msg.title,msg.body,msg.data]);
      return {ids,msg};
    });
    if (delivery) await this.notifier.deliverStored(delivery.ids,{type:'support',ticketId},delivery.msg).catch(()=>{});
    return this.thread(user,ticketId);
  }

  async mine(user: AuthUser) {
    return this.db.tx(async q => {
      const actor = await this.liveActor(q,user);
      return q.query(
      `select t.id, t.number, t.topic, t.status, t.order_id, o.number as order_number, t.created_at, t.updated_at,
              (select body from support_messages m where m.ticket_id=t.id order by m.id desc limit 1) as last
         from support_tickets t left join orders o on o.id=t.order_id where t.user_id=$1 order by t.updated_at desc limit 50`, [actor.id]);
    });
  }

  /** Очередь: сначала открытые, где последнее слово за пользователем */
  async queue(user: AuthUser, status: 'open' | 'closed' = 'open') {
    return this.db.tx(async q => {
      const actor = await this.liveActor(q,user);
      if (!isStaff(actor)) throw forbidden();
      return q.query(
      `select t.id, t.number, t.topic, t.status, t.order_id, o.number as order_number, t.created_at, t.updated_at,
              u.id as user_id, u.name, u.phone, a.name as assignee_name,
              t.sla_deadline_at, t.first_staff_reply_at, t.sla_overdue_at,
              (select body from support_messages m where m.ticket_id=t.id order by m.id desc limit 1) as last,
              (select not from_staff from support_messages m where m.ticket_id=t.id and m.sender_id is not null order by m.id desc limit 1) as waiting
         from support_tickets t join users u on u.id=t.user_id left join orders o on o.id=t.order_id left join users a on a.id=t.assignee_id
        where t.status=$1 order by waiting desc nulls last, t.updated_at desc limit 200`, [status]);
    });
  }

  async thread(user: AuthUser, ticketId: string) {
    return this.db.tx(async q => {
    const t = await q.one<{
      id: string; user_id: string; number: number; topic: string; status: string;
      order_id: string | null; ledger_entry_id: number | string | null;
      created_at: Date; requested_staff_role: 'admin' | 'moderator' | null;
      sla_deadline_at: Date | null; first_staff_reply_at: Date | null; sla_overdue_at: Date | null;
    }>(`select id,user_id,number,topic,status,order_id,ledger_entry_id,created_at,
              requested_staff_role,sla_deadline_at,first_staff_reply_at,sla_overdue_at
         from support_tickets where id=$1 for share`,[ticketId]);
    if (!t) throw notFound('Обращение не найдено');
    const actor = await this.authorizeTicket(q,user,t);
    const messages = await q.query(
      `select m.id::int as id, m.body, m.from_staff, m.created_at, m.sender_id, u.name as sender_name
         from support_messages m left join users u on u.id=m.sender_id where m.ticket_id=$1 order by m.id`, [ticketId]);
    const order = t.order_id ? await q.one('select id, number, status, service from orders where id=$1', [t.order_id]) : null;
    const author = isStaff(actor) ? await q.one('select id, name, phone from users where id=$1', [t.user_id]) : null;
    // A moderator may answer a user's ticket but must not receive that user's
    // private ledger entry. The ticket owner and an administrator retain their
    // existing right to inspect the linked operation.
    const canReadLedger = t.user_id === actor.id || actor.roles.includes('admin');
    const entry = canReadLedger && t.ledger_entry_id ? await q.one(
      `select l.id::int as id, l.kind, l.amount, l.note, l.account, l.created_at, o.number as order_number
         from ledger_entries l left join orders o on o.id=l.order_id where l.id=$1`, [t.ledger_entry_id]) : null;
    return { id: t.id, number: t.number, topic: t.topic, status: t.status,
      createdAt: t.created_at, requestedRole: t.requested_staff_role ?? null, slaDeadlineAt: t.sla_deadline_at,
      firstStaffReplyAt: t.first_staff_reply_at, slaOverdueAt: t.sla_overdue_at,
      order, author, messages, entry };
    });
  }

}
