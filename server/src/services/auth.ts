import type { Db } from '../db/index.ts';
import type { SmsProvider } from '../providers/sms.ts';
import { HttpError, bad, type AuthUser } from '../http/router.ts';
import { hmac, newCode, newToken, normalizePhone, sha256 } from '../util.ts';
import { config, isProd } from '../config.ts';

const CODE_TTL_MS = 5 * 60_000;
const RESEND_MS = 60_000;
const MAX_ATTEMPTS = 5;
const SESSION_DAYS = 90;

export const SELF_ROLES = ['client', 'master', 'tow', 'service'] as const;

/** Защита от накрутки SMS: не больше N кодов на номер в сутки и на один адрес в час */
const PER_PHONE_DAY = 8;
const PER_IP_HOUR = 15;

export class AuthService {
  private sentByPhone = new Map<string, number[]>();
  private sentByIp = new Map<string, number[]>();
  private bump(map: Map<string, number[]>, key: string, windowMs: number, max: number, now: number) {
    const list = (map.get(key) ?? []).filter((t) => now - t < windowMs);
    if (list.length >= max) return false;
    list.push(now); map.set(key, list);
    if (map.size > 50_000) map.clear();
    return true;
  }
  constructor(private db: Db, private sms: SmsProvider, private now: () => Date = () => new Date()) {}

  async requestCode(rawPhone: string, ip = '') {
    const phone = normalizePhone(rawPhone);
    if (!phone) throw bad('bad_phone', 'Номер в формате +7 9XX XXX-XX-XX');
    const prev = await this.db.one<{ sent_at: Date }>('select sent_at from auth_codes where phone=$1', [phone]);
    if (prev && this.now().getTime() - new Date(prev.sent_at).getTime() < RESEND_MS) {
      throw new HttpError(429, 'too_often', 'Новый код можно запросить через минуту');
    }
    const t = this.now().getTime();
    // Локальные и внутренние адреса не считаем: за прокси без X-Forwarded-For все были бы «одним устройством»
    const publicIp = ip && !/^(::1|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::ffff:(127|10|192\.168)\.|fc|fd)/i.test(ip);
    if (publicIp && !this.bump(this.sentByIp, ip, 3_600_000, PER_IP_HOUR, t)) throw new HttpError(429, 'too_many_codes', 'Слишком много кодов с этого устройства — попробуйте через час');
    if (!this.bump(this.sentByPhone, phone, 86_400_000, PER_PHONE_DAY, t)) throw new HttpError(429, 'too_many_codes', 'На этот номер сегодня отправлено слишком много кодов — напишите в поддержку');
    const code = newCode();
    await this.db.query(
      `insert into auth_codes(phone, code_hash, expires_at, attempts, sent_at) values ($1,$2,$3,0,$4)
       on conflict (phone) do update set code_hash=excluded.code_hash, expires_at=excluded.expires_at, attempts=0, sent_at=excluded.sent_at`,
      [phone, hmac(phone + ':' + code), new Date(this.now().getTime() + CODE_TTL_MS), this.now()],
    );
    await this.sms.send(phone, `ТракSOS: код входа ${code}. Никому его не сообщайте.`);
    return { phone, sent: true, devCode: this.sms.exposesCode && !isProd ? code : undefined };
  }

  async verify(rawPhone: string, code: string, role: (typeof SELF_ROLES)[number] = 'client', device?: string) {
    const phone = normalizePhone(rawPhone);
    if (!phone) throw bad('bad_phone', 'Неверный номер');
    const row = await this.db.one<{ code_hash: string; expires_at: Date; attempts: number }>(
      'select code_hash, expires_at, attempts from auth_codes where phone=$1', [phone],
    );
    if (!row || new Date(row.expires_at) < this.now()) throw bad('code_expired', 'Код устарел, запросите новый');
    if (row.attempts >= MAX_ATTEMPTS) throw new HttpError(429, 'too_many_attempts', 'Слишком много попыток, запросите новый код');
    if (row.code_hash !== hmac(phone + ':' + code.trim())) {
      await this.db.query('update auth_codes set attempts = attempts + 1 where phone=$1', [phone]);
      throw bad('wrong_code', 'Неверный код');
    }
    await this.db.query('delete from auth_codes where phone=$1', [phone]);

    const extra = config.adminPhones.includes(phone) ? ['admin'] : [];
    const user = await this.db.one<AuthUser & { created_at: Date }>(
      `insert into users(phone, roles) values ($1, $2)
       on conflict (phone) do update set
         roles = (select array(select distinct unnest(users.roles || excluded.roles))),
         last_seen_at = now()
       returning id, phone, name, roles, status, owner_id, created_at`,
      [phone, [role, ...extra]],
    );
    if (!user || user.status !== 'active') {
      // Заблокированный может оспорить блокировку — номер подтверждён кодом, выдаём одноразовый пропуск на обжалование
      throw new HttpError(403, 'blocked', 'Аккаунт заблокирован. Можно оспорить блокировку — ответ придёт по SMS.', { appealToken: appealToken(phone, this.now()) });
    }

    const token = newToken();
    await this.db.query('insert into sessions(token_hash, user_id, expires_at, device) values ($1,$2,$3,$4)', [
      sha256(token), user.id, new Date(this.now().getTime() + SESSION_DAYS * 86_400_000), device ?? null,
    ]);
    return { token, user };
  }

  async authenticate(token: string | null | undefined): Promise<AuthUser | null> {
    if (!token) return null;
    const u = await this.db.one<AuthUser>(
      `select u.id, u.phone, u.name, u.roles, u.status, u.owner_id
         from sessions s join users u on u.id = s.user_id
        where s.token_hash = $1 and s.expires_at > now()`,
      [sha256(token)],
    );
    if (!u || u.status !== 'active') return null;
    return u;
  }

  async logout(token: string) {
    await this.db.query('delete from sessions where token_hash=$1', [sha256(token)]);
  }
}

/** Пропуск на обжалование блокировки: действует 2 часа после входа по коду */
export function appealToken(phone: string, now: Date, shift = 0) {
  return hmac(`${phone}:appeal:${Math.floor(now.getTime() / 3_600_000) - shift}`);
}
export function checkAppealToken(phone: string, token: string, now: Date) {
  return [0, 1].some((k) => appealToken(phone, now, k) === token);
}
