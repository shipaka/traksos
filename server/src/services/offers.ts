// Оферты и согласия. По закону о платформенной экономике (289-ФЗ) условия для исполнителей
// меняются с уведомлением заранее; здесь — не раньше чем через 15 дней после публикации.

import type { Db } from '../db/index.ts';
import type { Notifier } from './notify.ts';
import { bad, notFound, type AuthUser } from '../http/router.ts';

const PERFORMER_NOTICE_DAYS = 15;

export class OffersService {
  constructor(private db: Db, private notifier: Notifier, private now: () => Date = () => new Date()) {}

  audiences(user: AuthUser) {
    const a = ['client', 'privacy'];
    if (user.roles.some((r) => ['master', 'tow', 'service'].includes(r))) a.push('performer');
    return a;
  }

  async current(audience: string) {
    return this.db.one(
      `select * from offers where audience=$1 and effective_at <= $2 order by effective_at desc limit 1`, [audience, this.now()]);
  }

  /** Что пользователь ещё не принял (действующие версии) + что вступит в силу позже */
  async status(user: AuthUser) {
    const out = [];
    for (const a of this.audiences(user)) {
      const cur = await this.current(a);
      const upcoming = await this.db.one(`select * from offers where audience=$1 and effective_at > $2 order by effective_at limit 1`, [a, this.now()]);
      const accepted = cur ? !!(await this.db.one('select 1 from consents where user_id=$1 and offer_id=$2', [user.id, cur.id])) : true;
      out.push({ audience: a, current: cur, accepted, upcoming });
    }
    return out;
  }

  async accept(user: AuthUser, offerId: string, ip: string) {
    const o = await this.db.one('select id from offers where id=$1', [offerId]);
    if (!o) throw notFound();
    await this.db.query('insert into consents(user_id, offer_id, ip) values ($1,$2,$3) on conflict do nothing', [user.id, offerId, ip]);
    return { ok: true };
  }

  async publish(admin: AuthUser, p: { audience: 'client' | 'performer' | 'privacy'; version: string; url: string; summary?: string; effectiveAt: string }) {
    const eff = new Date(p.effectiveAt);
    if (Number.isNaN(eff.getTime())) throw bad('bad_date');
    const hasPrev = await this.db.one('select 1 from offers where audience=$1', [p.audience]);
    if (p.audience === 'performer' && hasPrev && eff.getTime() < this.now().getTime() + PERFORMER_NOTICE_DAYS * 86_400_000) {
      throw bad('notice_too_short', `Новые условия для исполнителей — не раньше чем через ${PERFORMER_NOTICE_DAYS} дней`);
    }
    const offer = await this.db.one(
      `insert into offers(audience, version, url, summary, effective_at) values ($1,$2,$3,$4,$5) returning *`,
      [p.audience, p.version, p.url, p.summary ?? null, eff]);
    await this.db.query('insert into audit_log(actor_id, action, target, data) values ($1,$2,$3,$4)', [admin.id, 'offer.publish', offer!.id, p]);
    if (p.audience === 'performer' && hasPrev) {
      const ids = (await this.db.query<{ id: string }>(`select id from users where roles && '{master,tow,service}'::text[]`)).map((r) => r.id);
      await this.notifier.notify(ids, { type: 'offer', offerId: offer!.id }, {
        kind: 'normal', title: 'Меняются условия площадки',
        body: `Новая редакция оферты ${p.version} действует с ${eff.toLocaleDateString('ru-RU')}. ${p.summary ?? ''}`.trim(),
        data: { offerId: offer!.id },
      });
    }
    return offer;
  }
}
