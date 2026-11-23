// Модератор: очередь (споры, обжалования, отзывы), решения с последствиями, журнал решений, «вернуть в очередь».

import type { Db, Queryable } from '../db/index.ts';
import type { Notifier } from './notify.ts';
import type { ReviewsService } from './reviews.ts';
import type { SmsProvider } from '../providers/sms.ts';
import { bad, conflict, forbidden, notFound, type AuthUser } from '../http/router.ts';

export const DECISIONS: Record<string, Record<string, string>> = {
  dispute: { client: 'В пользу клиента', performer: 'В пользу исполнителя', partial: 'Частично', agreed: 'Стороны договорились' },
  appeal: { upheld: 'Обжалование принято — ограничение снято', rejected: 'Ограничение остаётся' },
  review: { hide: 'Отзыв скрыт', keep: 'Отзыв остаётся' },
};
const KIND_NAME: Record<string, string> = { dispute: 'Спор', appeal: 'Обжалование', review: 'Отзыв' };

type NewModerationCase = {
  kind:'dispute'|'appeal'|'review';title:string;text?:string|null;
  openedBy?:string|null;targetId?:string|null;orderId?:string|null;
  bookingId?:string|null;reviewId?:string|null;ticketId?:string|null;priority?:number;
};

export class ModerationService {
  constructor(private db: Db, private notifier: Notifier, private reviews: ReviewsService, private now: () => Date, private sms?: SmsProvider) {}

  private async staff(linkedSupportTicket = false, q: Queryable = this.db) {
    // A support-linked dispute belongs to moderators until the SLA escalation.
    if (linkedSupportTicket) {
      const moderators=await q.query<{id:string}>(
        `select id from users where roles && '{moderator}'::text[]`);
      if (moderators.length) return moderators.map(r=>r.id);
      return (await q.query<{id:string}>(
        `select id from users where roles && '{admin}'::text[]`)).map(r=>r.id);
    }
    return (await q.query<{id:string}>(
      `select id from users where roles && '{admin,moderator}'::text[]`)).map(r=>r.id);
  }

  /** Reusable locked case creation; callers may keep their other changes in
   * the exact same SQL transaction instead of leaving partial review effects. */
  private async openLocked(q: Queryable, p: NewModerationCase) {
    const key=JSON.stringify([p.kind,p.openedBy??null,p.orderId??null,
      p.bookingId??null,p.reviewId??null]);
    await q.query('select pg_advisory_xact_lock(hashtext($1))',['mod_case:'+key]);
    const same=await q.one<{id:string}>(
      `select id from mod_cases where status='open' and kind=$1
          and opened_by is not distinct from $2
          and order_id is not distinct from $3
          and booking_id is not distinct from $4
          and review_id is not distinct from $5`,
      [p.kind,p.openedBy??null,p.orderId??null,p.bookingId??null,p.reviewId??null]);
    if(same) {
      if(p.text)await q.query(
        `update mod_cases set text=coalesce(text || E'\\\\n— ', '') || $2 where id=$1`,
        [same.id,p.text]);
      return {id:same.id,number:0,created:false,staff:[] as string[]};
    }
    const created=await q.one<{id:string;number:number}>(
      `insert into mod_cases(kind,title,text,opened_by,target_id,
          order_id,booking_id,review_id,ticket_id,priority)
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id,number`,
      [p.kind,p.title,p.text??null,p.openedBy??null,p.targetId??null,
       p.orderId??null,p.bookingId??null,p.reviewId??null,p.ticketId??null,p.priority??2]);
    if(!created)throw bad('mod_case_create','Не удалось создать обращение');
    const staff=await this.staff(!!p.ticketId,q);
    const title=`${KIND_NAME[p.kind]} №${created.number}`;
    // The staff inbox is durable in the same commit as the new case; retries
    // never create phantom new-case alerts.
    for(const userId of staff){
      await q.query(`insert into notifications(user_id,kind,title,body,data)
        values ($1,'mod_case',$2,$3,$4)`,[userId,title,p.title,{caseId:created.id}]);
    }
    return {id:created.id,number:created.number,created:true,staff,title};
  }

  private async announceNew(p: NewModerationCase, result: Awaited<ReturnType<ModerationService['openLocked']>>) {
    if(!result.created)return;
    await this.notifier.deliverStored(result.staff,
      {type:'mod_case',caseId:result.id},
      {kind:'normal',title:`${KIND_NAME[p.kind]} №${result.number}`,
       body:p.title,data:{caseId:result.id}});
  }

  async open(p: NewModerationCase) {
    const result=await this.db.tx(q=>this.openLocked(q,p));
    await this.announceNew(p,result);
    return result.id;
  }

  /** Исполнитель или клиент: «Оспорить нарушение или блокировку» — открыто всегда */
  async appeal(user: AuthUser, text: string) {
    const t = text.trim();
    if (t.length < 10) throw bad('short', 'Опишите подробнее — хотя бы пару предложений');
    const id = await this.open({ kind: 'appeal', title: 'Оспорить нарушение', text: t, openedBy: user.id, targetId: user.id, priority: 2 });
    return this.caseView(id);
  }

  /** Заблокированный: номер подтверждён кодом, пропуск выдан при входе */
  async appealBlocked(userId: string, text: string) {
    const t = text.trim();
    if (t.length < 10) throw bad('short', 'Опишите подробнее — хотя бы пару предложений');
    await this.open({ kind: 'appeal', title: 'Оспорить блокировку', text: t, openedBy: userId, targetId: userId, priority: 1 });
    return { ok: true };
  }

  /** Оспорить отзыв о себе: до решения он не влияет на рейтинг */
  async contestReview(user: AuthUser, reviewId: string, text: string) {
    const p: NewModerationCase = {
      kind:'review',title:'Оспорен отзыв',text:text.trim(),
      openedBy:user.id,targetId:null,reviewId,priority:3,
    };
    const result=await this.db.tx(async q=>{
      const r=await q.one<any>(`select r.*,o.number from reviews r
        join orders o on o.id=r.order_id where r.id=$1 for update`,[reviewId]);
      if(!r || r.target_id!==user.id)throw notFound('Отзыв не найден');
      if(r.hidden)throw conflict('hidden','Отзыв уже скрыт');
      p.title=`Оспорен отзыв ${r.stars}★ по заявке №${r.number}`;
      p.targetId=r.author_id;
      p.orderId=r.order_id;
      await q.query('update reviews set disputed=true where id=$1',[reviewId]);
      await this.reviews.recompute(user.id,q);
      return this.openLocked(q,p);
    });
    await this.announceNew(p,result);
    return this.caseView(result.id);
  }

  async mine(user: AuthUser) {
    return (await this.db.query(`select * from mod_cases where opened_by=$1 order by created_at desc limit 50`, [user.id])).map((c: any) => this.short(c));
  }

  private short(c: any) {
    return { id: c.id, number: c.number, kind: c.kind, kindName: KIND_NAME[c.kind], status: c.status, priority: c.priority, title: c.title, text: c.text,
      decision: c.decision, decisionName: c.decision ? DECISIONS[c.kind]?.[c.decision] : null, decisionNote: c.decision_note, decidedAt: c.decided_at, createdAt: c.created_at };
  }

  async queue(status: 'open' | 'resolved', kind?: string) {
    const rows = await this.db.query(
      `select c.*, a.name as opened_name, a.phone as opened_phone, t.name as target_name, m.name as decided_name, o.number as order_number
         from mod_cases c left join users a on a.id=c.opened_by left join users t on t.id=c.target_id
         left join users m on m.id=c.decided_by left join orders o on o.id=c.order_id
        where c.status=$1 ${kind ? 'and c.kind=$2' : ''}
        order by ${status === 'open' ? 'c.priority, c.created_at' : 'c.decided_at desc'} limit 200`, kind ? [status, kind] : [status]);
    const counts = await this.db.query<{ kind: string; n: number }>(`select kind, count(*)::int as n from mod_cases where status='open' group by kind`);
    return {
      counts: Object.fromEntries(counts.map((c) => [c.kind, c.n])),
      items: rows.map((c: any) => ({ ...this.short(c), openedBy: c.opened_name || c.opened_phone, target: c.target_name, decidedBy: c.decided_name, orderId: c.order_id, orderNumber: c.order_number, bookingId: c.booking_id })),
    };
  }

  /** Материалы случая: заявка, суммы, чат, отзыв, запись в сервис */
  async caseView(id: string) {
    const c = await this.db.one<any>('select * from mod_cases where id=$1', [id]);
    if (!c) throw notFound('Случай не найден');
    const order = c.order_id ? await this.db.one(
      `select o.id, o.number, o.service, o.status, o.description, o.call_out_amount, o.work_amount, o.result_note, o.created_at,
              cl.name as client_name, pf.name as performer_name
         from orders o left join users cl on cl.id=o.client_id left join users pf on pf.id=o.performer_id where o.id=$1`, [c.order_id]) : null;
    const chat = c.order_id ? await this.db.query(
      `select m.body, m.kind, m.created_at, u.name as sender from chat_messages m left join users u on u.id=m.sender_id where m.order_id=$1 order by m.created_at limit 200`, [c.order_id]) : [];
    const review = c.review_id ? await this.db.one('select stars, tags, text, created_at, disputed, hidden from reviews where id=$1', [c.review_id]) : null;
    const booking = c.booking_id ? await this.db.one(
      `select b.number, b.need, b.works, b.amount, b.discount, b.status, s.name as center from service_bookings b join service_centers s on s.id=b.center_id where b.id=$1`, [c.booking_id]) : null;
    const target = c.target_id ? await this.db.one('select id, name, phone, status, rating::float as rating from users where id=$1', [c.target_id]) : null;
    const log = await this.db.query(`select action, data, created_at from audit_log where target=$1 order by created_at`, [id]);
    return { ...this.short(c), decisions: DECISIONS[c.kind], order, chat, review, booking, target, log, ticketId: c.ticket_id };
  }

  async decide(actor: AuthUser, id: string, decision: string, note?: string) {
    // Serialize the decision AND its business consequences. Two moderators
    // cannot both resolve an open case, or commit a half-resolved dispute.
    const result = await this.db.tx(async q => {
      const c = await q.one<any>('select * from mod_cases where id=$1 for update', [id]);
      if (!c) throw notFound('Случай не найден');
      if (c.status !== 'open') throw conflict('resolved', 'Решение уже принято — сначала верните в очередь');
      if (!DECISIONS[c.kind]?.[decision]) throw bad('bad_decision', 'Нет такого решения');
      if (c.opened_by === actor.id) throw forbidden('Свой случай решает другой модератор');
      await q.query(
        `update mod_cases set status='resolved', decision=$2, decision_note=$3,
           decided_by=$4, decided_at=$5 where id=$1`,
        [id, decision, note?.trim() || null, actor.id, this.now()]);
      if (c.kind === 'review' && c.review_id) {
        await q.query('update reviews set hidden=$2, disputed=false where id=$1',
          [c.review_id, decision === 'hide']);
        // Rating recomputation belongs to THIS transaction. A failed rating
        // update must also undo the moderation decision.
        if (c.opened_by) await this.reviews.recompute(c.opened_by, q);
      }
      if (c.kind === 'appeal' && decision === 'upheld' && c.target_id) {
        await q.query(`update users set status='active'
          where id=$1 and status='blocked' and deleted_at is null`, [c.target_id]);
      }
      if (c.kind === 'dispute' && c.booking_id) {
        await q.query(`update service_bookings set status='closed', closed_at=now(), updated_at=now()
          where id=$1 and status='disputed'`, [c.booking_id]);
      }
      await q.query('insert into audit_log(actor_id, action, target, data) values ($1,$2,$3,$4)',
        [actor.id, 'mod.decide', id, { decision, note }]);
      const body = `${DECISIONS[c.kind][decision]}${note?.trim() ? `: ${note.trim()}` : ''}`;
      const parties: (string|null|undefined)[] = [c.opened_by, c.target_id];
      let revokedDriver: string|null=null;
      if (c.order_id) {
        const o = await q.one<any>(`select o.client_id,o.created_by,o.performer_id,
            case when o.created_by<>o.client_id
               and v.owner_id=o.client_id and v.driver_id=o.created_by
               then o.created_by else null end as current_driver_id
          from orders o left join vehicles v on v.id=o.vehicle_id where o.id=$1`, [c.order_id]);
        if (o) {
          // Even opened_by/target_id can refer to the historical driver.
          // Remove them from ALL recipient origins if fleet access was revoked.
          if (o.created_by!==o.client_id && !o.current_driver_id)
            revokedDriver=o.created_by;
          parties.push(o.client_id, o.performer_id, o.current_driver_id);
        }
      }
      const recipients = [...new Set(
        parties.filter((p):p is string=>!!p && p!==revokedDriver))];
      const title = `Решение модератора по случаю №${c.number}`;
      // Inbox + audit + decision + financial/review effects commit together.
      for (const recipient of recipients) {
        await q.query(`insert into notifications(user_id,kind,title,body,data)
          values ($1,'mod_case',$2,$3,$4)`,
          [recipient, title, body, { caseId: id }]);
      }
      return { c, recipients, title, body };
    });
    // Everything here is post-commit delivery, NOT another business write.
    // Failure of optional SMS/push cannot make the client retry a committed
    // decision and cannot leave partial data changes behind.
    if (result.c.kind === 'appeal' && result.c.title === 'Оспорить блокировку' &&
        result.c.target_id && this.sms) {
      try {
        const u = await this.db.one<{ phone: string }>(
          'select phone from users where id=$1 and deleted_at is null', [result.c.target_id]);
        if (u?.phone.startsWith('+')) await this.sms.send(u.phone,
          `TrakSOS: ${decision === 'upheld' ? 'блокировка снята — можно входить' : 'блокировка остаётся'}${note?.trim() ? `. ${note.trim().slice(0, 100)}` : ''}`);
      } catch (error) {
        console.warn('[mod] appeal SMS delivery failed',
          error instanceof Error ? error.message : String(error));
      }
    }
    await this.notifier.deliverStored(result.recipients,
      { type: 'mod_case', caseId: id },
      { kind: 'normal', title: result.title, body: result.body, data: { caseId: id } });
    return this.caseView(id);
  }

  async reopen(actor: AuthUser, id: string) {
    await this.db.tx(async q => {
      const c = await q.one<any>('select * from mod_cases where id=$1 for update', [id]);
      if (!c) throw notFound('Случай не найден');
      if (c.status !== 'resolved') throw conflict('open', 'Случай уже в очереди');
      await q.query(`update mod_cases set status='open', decision=null, decision_note=null,
        decided_by=null, decided_at=null where id=$1`, [id]);
      if (c.kind === 'review' && c.review_id) {
        // An appealed review is disputed again. A previously hidden review
        // stays hidden until a new explicit moderator decision.
        await q.query('update reviews set disputed=true where id=$1', [c.review_id]);
        if (c.opened_by) await this.reviews.recompute(c.opened_by, q);
      }
      await q.query('insert into audit_log(actor_id, action, target, data) values ($1,$2,$3,$4)',
        [actor.id, 'mod.reopen', id, {}]);
    });
    return this.caseView(id);
  }

  async setPriority(actor: AuthUser, id: string, priority: number) {
    if (!Number.isInteger(priority) || priority < 1 || priority > 3)
      throw bad('bad_priority', 'Приоритет должен быть от 1 до 3');
    await this.db.tx(async q => {
      const c = await q.one<{ status: string; priority: number }>(
        'select status, priority from mod_cases where id=$1 for update', [id]);
      if (!c) throw notFound('Случай не найден');
      if (c.status !== 'open') throw conflict('resolved', 'Приоритет меняется у открытых случаев');
      if (c.priority === priority) return;
      await q.query('update mod_cases set priority=$2 where id=$1', [id, priority]);
      await q.query('insert into audit_log(actor_id, action, target, data) values ($1,$2,$3,$4)',
        [actor.id, 'mod.priority', id, { priority }]);
    });
    return this.caseView(id);
  }

  /** A moderator chat entry and its audit must succeed or fail together. */
  async enterChat(actor: AuthUser, id: string) {
    const orderId = await this.db.tx(async q => {
      const c = await q.one<{ order_id: string | null }>(
        'select order_id from mod_cases where id=$1 for update', [id]);
      if (!c?.order_id) throw bad('no_order', 'У этого случая нет заявки');
      await q.query('insert into audit_log(actor_id, action, target, data) values ($1,$2,$3,$4)',
        [actor.id, 'mod.chat_open', id, { orderId: c.order_id }]);
      await q.query(`insert into chat_messages(order_id, sender_id, kind, body)
        values ($1, null, 'system', $2)`, [c.order_id, 'Модератор подключился к чату']);
      return c.order_id;
    });
    return { orderId };
  }

}
