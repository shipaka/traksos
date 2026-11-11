// Реферальные баллы. 1 балл = 1 ₽ скидки на сбор клиента или комиссию исполнителя/рембазы.
// Баллы не выводятся деньгами — это скидка на услуги площадки. Гасят не больше spendCapPct
// сбора/комиссии с одной заявки, живут ttlDays (начисленные в бесплатный месяц — от его конца).
//
// За что начисляются (суммы — в настройках «referral»):
//  · пригласил клиента (кто угодно) — clientSharePct от его оплаченных заявок, days дней;
//  · приглашённому клиенту — welcome на первую заявку;
//  · мастер пригласил мастера — performerReward, когда новичок выполнит performerJobs заявок;
//  · пригласил рембазу — serviceReward после её первого закрытого счёта.
// Начисление — только за оплаченное, не за регистрацию.

import { randomBytes } from 'node:crypto';
import type { Db, Queryable } from '../db/index.ts';
import type { SettingsService } from './settings.ts';
import type { Notifier } from './notify.ts';
import type { AuthUser } from '../http/router.ts';
import { pct, commissionPct } from '../domain/money.ts';
import { rub } from '../util.ts';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const DAY = 86_400_000;

type Entry = { amount: number; expires_at: Date | null; created_at: Date };

/** Остаток с учётом сгорания: траты гасят самые старые начисления (FIFO) */
export function pointsBalance(entries: Entry[], at: Date) {
  const lots: { left: number; exp: number }[] = [];
  for (const e of [...entries].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())) {
    const t = new Date(e.created_at).getTime();
    if (e.amount > 0) { lots.push({ left: e.amount, exp: e.expires_at ? new Date(e.expires_at).getTime() : Infinity }); continue; }
    let need = -e.amount;
    for (const l of lots) {
      if (need <= 0) break;
      if (l.exp <= t || l.left <= 0) continue;
      const take = Math.min(l.left, need);
      l.left -= take; need -= take;
    }
  }
  const now = at.getTime();
  const live = lots.filter((l) => l.exp > now && l.left > 0);
  const soon = live.filter((l) => l.exp - now < 30 * DAY).reduce((s, l) => s + l.left, 0);
  return { balance: live.reduce((s, l) => s + l.left, 0), expiringSoon: soon };
}

export class ReferralService {
  /** Проводки по счёту исполнителя — из платёжного сервиса */
  ledger: ((q: Queryable, orderId: string | null, paymentId: string | null, e: { account: string; performerId?: string; amount: number; kind: string; note?: string }[]) => Promise<void>) | null = null;

  constructor(private db: Db, private settings: SettingsService, private notifier: Notifier, private now: () => Date = () => new Date()) {}

  async code(userId: string) {
    const u = await this.db.one<{ ref_code: string | null }>('select ref_code from users where id=$1', [userId]);
    if (u?.ref_code) return u.ref_code;
    for (let i = 0; i < 5; i++) {
      const c = [...randomBytes(6)].map((b) => ALPHABET[b % ALPHABET.length]).join('');
      const r = await this.db.one<{ ref_code: string }>(
        `update users set ref_code=$2 where id=$1 and ref_code is null and not exists (select 1 from users where ref_code=$2) returning ref_code`, [userId, c]);
      if (r) return r.ref_code;
      const again = await this.db.one<{ ref_code: string | null }>('select ref_code from users where id=$1', [userId]);
      if (again?.ref_code) return again.ref_code;
    }
    throw new Error('Не удалось выдать код');
  }

  private async expiresAt() {
    const r = await this.settings.get('referral');
    const fees = await this.settings.get('fees');
    const freeEnd = fees.freeUntil ? new Date(fees.freeUntil + 'T23:59:59+03:00').getTime() : 0;
    return new Date(Math.max(this.now().getTime(), freeEnd) + r.ttlDays * DAY);
  }

  async balance(userId: string, q: Queryable = this.db) {
    const rows = await q.query<Entry>('select amount, expires_at, created_at from points_entries where user_id=$1', [userId]);
    return pointsBalance(rows, this.now());
  }

  async grant(q: Queryable, p: { userId: string; amount: number; kind: string; orderId?: string | null; bookingId?: string | null; refUserId?: string | null; note: string }) {
    if (p.amount <= 0) return 0;
    await q.query(
      `insert into points_entries(user_id, amount, kind, order_id, booking_id, ref_user_id, note, expires_at, created_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [p.userId, p.amount, p.kind, p.orderId ?? null, p.bookingId ?? null, p.refUserId ?? null, p.note, await this.expiresAt(), this.now()]);
    await this.notifier.notify([p.userId], { type: 'points' }, { kind: 'normal', title: `+${rub(p.amount).replace(' ₽', '')} баллов`, body: p.note, data: {} });
    return p.amount;
  }

  /** Погасить баллами не больше cap% от суммы. Возвращает, сколько списали */
  /** Сколько можно погасить баллами с этой суммы: min(остаток, cap% от суммы) */
  async available(userId: string, base: number, q: Queryable = this.db) {
    const r = await this.settings.get('referral');
    const cap = Math.max(0, Math.floor((base * r.spendCapPct) / 100));
    const { balance } = await this.balance(userId, q);
    return { balance, cap, max: Math.min(balance, cap) };
  }

  async spend(q: Queryable, userId: string, base: number, note: string, orderId?: string | null, bookingId?: string | null, want?: number | null) {
    const a = await this.available(userId, base, q);
    const use = Math.max(0, Math.min(a.max, want ?? a.max));
    if (use <= 0) return 0;
    await q.query(`insert into points_entries(user_id, amount, kind, order_id, booking_id, note, created_at) values ($1,$2,'spend',$3,$4,$5,$6)`,
      [userId, -use, orderId ?? null, bookingId ?? null, note, this.now()]);
    return use;
  }

  /** Вход по ссылке: только новый номер, не сам себя. Новому клиенту — приветственные баллы */
  async attach(user: AuthUser & { inserted?: boolean }, code: string) {
    if (!user.inserted) return false;
    const ref = await this.db.one<{ id: string }>('select id from users where ref_code=$1', [code.trim().toUpperCase()]);
    if (!ref || ref.id === user.id) return false;
    const ok = await this.db.one('update users set referred_by=$2, referred_at=$3 where id=$1 and referred_by is null returning id', [user.id, ref.id, this.now()]);
    if (!ok) return false;
    const r = await this.settings.get('referral');
    if (user.roles.includes('client')) await this.grant(this.db, { userId: user.id, amount: r.welcome, kind: 'welcome', refUserId: ref.id, note: 'Подарок за вход по приглашению — гасит сервисный сбор' });
    return true;
  }

  /** Заявка подтверждена: клиент гасит баллами сбор (до cap) — в момент подтверждения, как бонусы */
  async spendClientFee(q: Queryable, order: any, clientFee: number, want: number) {
    if (want <= 0) return 0;
    const used = await this.spend(q, order.client_id, clientFee, `Сервисный сбор по заявке №${order.number}`, order.id, null, want);
    if (used > 0) await q.query(`update orders set points_fee=$2, discount_amount = discount_amount + $2,
        discount_reason = coalesce(discount_reason, 'Баллы') where id=$1`, [order.id, used]);
    return used;
  }

  /** После расчётов по заявке: исполнитель гасит баллами комиссию, пригласившим — их доля */
  async afterOrder(q: Queryable, order: any, amount: number) {
    const r = await this.settings.get('referral');
    const fees = await this.settings.get('fees');
    const perf = order.performer_id ? await q.one<{ is_priority: boolean }>('select is_priority from performer_profiles where user_id=$1', [order.performer_id]) : null;
    const commission = pct(amount, commissionPct(fees, { isPriority: !!perf?.is_priority, at: this.now() }));
    // 1. Комиссия исполнителя баллами — возвращаем ему на счёт (наличные — уменьшаем долг)
    // Исполнитель сам решает в «Финансах»: гасить ли комиссию баллами и сколько максимум с заявки
    const pref = order.performer_id ? await q.one<{ extras: any }>('select extras from performer_profiles where user_id=$1', [order.performer_id]) : null;
    const auto = pref?.extras?.pointsAuto !== false;
    if (auto && commission > 0 && order.performer_id && this.ledger) {
      const used = await this.spend(q, order.performer_id, commission, `Комиссия по заявке №${order.number}`, order.id, null, pref?.extras?.pointsMax ?? null);
      if (used > 0) {
        await this.ledger(q, order.id, null, [
          { account: 'performer', performerId: order.performer_id, amount: used, kind: order.payment_method === 'cash' ? 'cash_commission_paid' : 'points', note: `Комиссия оплачена баллами: ${rub(used)}` },
          { account: 'platform', amount: -used, kind: order.payment_method === 'cash' ? 'cash_commission_paid' : 'points' },
        ]);
        await q.query('update orders set points_commission=$2 where id=$1', [order.id, used]);
      }
    }
    // 2. Пригласивший клиента — доля от оплаченной заявки, пока не прошло days дней
    const c = await q.one<{ referred_by: string | null; referred_at: Date | null; name: string | null }>('select referred_by, referred_at, name from users where id=$1', [order.client_id]);
    if (commission > 0 && c?.referred_by && c.referred_at && this.now().getTime() - new Date(c.referred_at).getTime() <= r.days * DAY) {
      await this.grant(q, { userId: c.referred_by, amount: pct(commission, r.clientSharePct), kind: 'ref_client', orderId: order.id, refUserId: order.client_id,
        note: `${r.clientSharePct}% от комиссии ТракSOS по заявке №${order.number} приглашённого клиента` });
    }
    // 3. Мастер пригласил мастера — разово, когда новичок выполнит performerJobs заявок
    if (order.performer_id) {
      const p = await q.one<{ referred_by: string | null; n: number }>(
        `select u.referred_by, (select count(*)::int from orders o where o.performer_id=u.id and o.status='completed') as n from users u where u.id=$1`, [order.performer_id]);
      if (p?.referred_by && p.n >= r.performerJobs) {
        const done = await q.one(`select 1 from points_entries where kind='ref_performer' and ref_user_id=$1`, [order.performer_id]);
        if (!done) await this.grant(q, { userId: p.referred_by, amount: r.performerReward, kind: 'ref_performer', refUserId: order.performer_id,
          note: `Приглашённый исполнитель выполнил ${r.performerJobs} заявок` });
      }
    }
  }

  /** Рембаза: гасит баллами комиссию счёта; пригласившему — разово после первого закрытого счёта */
  async spendServiceCommission(q: Queryable, ownerId: string, commission: number, bookingId: string, number: number, want: number) {
    if (want <= 0) return 0;
    return this.spend(q, ownerId, commission, `Комиссия по счёту №${number}`, null, bookingId, want);
  }

  async afterBookingClosed(ownerId: string, bookingId: string) {
    const r = await this.settings.get('referral');
    const o = await this.db.one<{ referred_by: string | null; n: number }>(
      `select u.referred_by, (select count(*)::int from service_bookings b join service_centers c on c.id=b.center_id where c.owner_id=u.id and b.status='closed') as n
         from users u where u.id=$1`, [ownerId]);
    if (!o?.referred_by || o.n < 1) return;
    const done = await this.db.one(`select 1 from points_entries where kind='ref_service' and ref_user_id=$1`, [ownerId]);
    if (!done) await this.grant(this.db, { userId: o.referred_by, amount: r.serviceReward, kind: 'ref_service', bookingId, refUserId: ownerId, note: 'Приглашённая рембаза закрыла первый счёт' });
  }

  /** Экран «Пригласить»: код, остаток, история, кого пригласили, правила */
  async mine(user: AuthUser) {
    const code = await this.code(user.id);
    const b = await this.balance(user.id);
    const entries = await this.db.query(
      `select id::int as id, amount, kind, note, expires_at, created_at from points_entries where user_id=$1 order by created_at desc limit 50`, [user.id]);
    const invited = await this.db.query(
      `select coalesce(nullif(u.company_name,''), nullif(u.name,''), 'Без имени') as name, u.referred_at as at,
              case when u.roles && '{master,tow}'::text[] then 'performer' when 'service' = any(u.roles) then 'service' else 'client' end as who,
              coalesce((select sum(p.amount) from points_entries p where p.user_id=$1 and p.ref_user_id=u.id and p.amount > 0), 0)::int as earned
         from users u where u.referred_by=$1 order by u.referred_at desc limit 100`, [user.id]);
    return { code, ...b, entries, invited, rules: await this.settings.get('referral') };
  }
}
