// Оферты и согласия. Админ публикует новую редакцию в приложении — она сразу (или с даты вступления)
// становится обязательной: пока человек не отметит «Принимаю», клиент не создаст заявку,
// исполнитель не выйдет на линию и не откликнется. Каждое согласие — с версией, датой и IP.
// Закон о платформенной экономике (289-ФЗ): условия для исполнителей меняются с уведомлением
// не позже чем за 15 дней.

import type { Db } from '../db/index.ts';
import type { Notifier } from './notify.ts';
import { HttpError, bad, notFound, type AuthUser } from '../http/router.ts';

const PERFORMER_NOTICE_DAYS = 15;

export const AUDIENCE_NAMES: Record<string, string> = {
  client: 'Оферта для клиентов',
  performer: 'Агентский договор для исполнителей',
  privacy: 'Согласие на обработку персональных данных',
};

const isPerformer = (roles: string[]) => roles.some((r) => ['master', 'tow', 'service'].includes(r));

export class OffersService {
  constructor(private db: Db, private notifier: Notifier, private now: () => Date = () => new Date()) {}

  audiences(user: AuthUser) {
    const a = ['client', 'privacy'];
    if (isPerformer(user.roles)) a.push('performer');
    return a;
  }

  async current(audience: string) {
    return this.db.one(
      `select id, audience, version, url, summary, body, published_at, effective_at
         from offers where audience=$1 and effective_at <= $2 order by effective_at desc, published_at desc limit 1`, [audience, this.now()]);
  }

  /** По каждой нужной человеку оферте: действующая редакция, принял ли он её, что вступит позже */
  async status(user: AuthUser) {
    const out = [];
    for (const a of this.audiences(user)) {
      const cur = await this.current(a);
      const upcoming = await this.db.one(
        `select id, version, summary, effective_at from offers where audience=$1 and effective_at > $2 order by effective_at limit 1`, [a, this.now()]);
      const accepted = cur ? !!(await this.db.one('select 1 from consents where user_id=$1 and offer_id=$2', [user.id, cur.id])) : true;
      out.push({ audience: a, name: AUDIENCE_NAMES[a], current: cur, accepted, upcoming });
    }
    return out;
  }

  /** Есть ли непринятые действующие редакции из списка — тогда действие запрещено */
  async require(user: AuthUser, audiences: string[]) {
    const pending = [];
    for (const a of audiences) {
      const cur = await this.current(a);
      if (!cur) continue; // оферта ещё не опубликована — не блокируем
      const ok = await this.db.one('select 1 from consents where user_id=$1 and offer_id=$2', [user.id, cur.id]);
      if (!ok) pending.push({ audience: a, name: AUDIENCE_NAMES[a], version: cur.version, id: cur.id });
    }
    if (pending.length) {
      throw new HttpError(403, 'offer_required', `Примите новые условия: ${pending.map((p) => p.name.toLowerCase()).join(', ')}`, { pending });
    }
  }

  requireClient = (user: AuthUser) => this.require(user, ['client', 'privacy']);
  requirePerformer = (user: AuthUser) => this.require(user, ['performer', 'privacy']);

  async accept(user: AuthUser, offerId: string, ip: string) {
    const o = await this.db.one('select id, effective_at from offers where id=$1', [offerId]);
    if (!o) throw notFound();
    await this.db.query('insert into consents(user_id, offer_id, ip) values ($1,$2,$3) on conflict do nothing', [user.id, offerId, ip]);
    return this.status(user);
  }

  /** Галочка при входе: принять все действующие редакции, нужные этому человеку */
  async acceptCurrent(user: AuthUser, ip: string) {
    for (const a of this.audiences(user)) {
      const cur = await this.current(a);
      if (cur) await this.db.query('insert into consents(user_id, offer_id, ip) values ($1,$2,$3) on conflict do nothing', [user.id, cur.id, ip]);
    }
  }

  async publish(admin: AuthUser, p: { audience: 'client' | 'performer' | 'privacy'; version: string; body: string; summary?: string; effectiveAt?: string }) {
    const hasPrev = await this.db.one('select 1 from offers where audience=$1', [p.audience]);
    const minDate = p.audience === 'performer' && hasPrev ? new Date(this.now().getTime() + PERFORMER_NOTICE_DAYS * 86_400_000) : this.now();
    const eff = p.effectiveAt ? new Date(p.effectiveAt) : minDate;
    if (Number.isNaN(eff.getTime())) throw bad('bad_date', 'Неверная дата');
    if (eff.getTime() < minDate.getTime() - 60_000) {
      throw bad('notice_too_short', `Новые условия для исполнителей — не раньше ${minDate.toLocaleDateString('ru-RU')} (за ${PERFORMER_NOTICE_DAYS} дней)`);
    }
    const dup = await this.db.one('select 1 from offers where audience=$1 and version=$2', [p.audience, p.version]);
    if (dup) throw bad('version_exists', `Редакция ${p.version} уже есть — укажите новый номер`);
    const offer = await this.db.one(
      `insert into offers(audience, version, body, summary, effective_at, published_at) values ($1,$2,$3,$4,$5,$6) returning *`,
      [p.audience, p.version, p.body, p.summary ?? null, eff, this.now()]);
    await this.db.query('insert into audit_log(actor_id, action, target, data) values ($1,$2,$3,$4)',
      [admin.id, 'offer.publish', offer!.id, { audience: p.audience, version: p.version, effectiveAt: eff }]);

    // Уведомляем всех, кого касается
    const who = p.audience === 'performer'
      ? `select id from users where roles && '{master,tow,service}'::text[]`
      : `select id from users`;
    const ids = (await this.db.query<{ id: string }>(who)).map((r) => r.id);
    const when = eff.getTime() <= this.now().getTime() + 60_000 ? 'с сегодняшнего дня' : `с ${eff.toLocaleDateString('ru-RU')}`;
    await this.notifier.notify(ids, { type: 'offer', offerId: offer!.id, audience: p.audience }, {
      kind: 'normal', title: 'Меняются условия ТракSOS',
      body: `${AUDIENCE_NAMES[p.audience]}, редакция ${p.version} — действует ${when}. ${p.summary ?? ''}`.trim(),
      data: { offerId: offer!.id },
    });
    return offer;
  }

  async history() {
    return this.db.query(
      `select o.id, o.audience, o.version, o.summary, o.published_at, o.effective_at,
              (select count(*)::int from consents c where c.offer_id=o.id) as accepted
         from offers o order by o.published_at desc`);
  }

  async byId(id: string) {
    const o = await this.db.one('select id, audience, version, summary, body, url, effective_at, published_at from offers where id=$1', [id]);
    if (!o) throw notFound();
    return { ...o, name: AUDIENCE_NAMES[o.audience] };
  }
}
