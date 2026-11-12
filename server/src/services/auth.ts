import type { Db } from '../db/index.ts';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { SmsProvider } from '../providers/sms.ts';
import { HttpError, bad, type AuthUser } from '../http/router.ts';
import { hmac, newCode, newToken, normalizePhone, sha256 } from '../util.ts';
import { config, isProd } from '../config.ts';
import { SELF_ROLES, requestedRoles, validateRoles, type AccountChoice, type SelfRole } from '../domain/roles.ts';

const CODE_TTL_MS = 5 * 60_000;
const RESEND_MS = 60_000;
const MAX_ATTEMPTS = 5;
const SESSION_DAYS = 90;
const passwordValid = (p: string) => p.length >= 10 && p.length <= 128;
function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex');
  return `scrypt:${salt}:${scryptSync(password, Buffer.from(salt,'hex'), 64).toString('hex')}`;
}
function verifyPassword(password: string, stored: string | null) {
  if (!stored) return false;
  const [algorithm, salt, expected] = stored.split(':');
  if (algorithm !== 'scrypt' || !salt || !expected || expected.length !== 128) return false;
  const actual = scryptSync(password, Buffer.from(salt,'hex'),64);
  return timingSafeEqual(actual, Buffer.from(expected,'hex'));
}


export { SELF_ROLES } from '../domain/roles.ts';

/** Защита от накрутки SMS: не больше N кодов на номер в сутки и на один адрес в час */
const PER_PHONE_DAY = 8;
const PER_IP_HOUR = 15;

export class AuthService {
  private sentByPhone = new Map<string, number[]>();
  private passwordAttempts = new Map<string, { count: number; since: number }>();
  private sentByIp = new Map<string, number[]>();
  private bump(map: Map<string, number[]>, key: string, windowMs: number, max: number, now: number) {
    const list = (map.get(key) ?? []).filter((t) => now - t < windowMs);
    if (list.length >= max) return false;
    list.push(now); map.set(key, list);
    if (map.size > 50_000) map.clear();
    return true;
  }
  constructor(private db: Db, private sms: SmsProvider, private now: () => Date = () => new Date()) {}

  async requestCode(rawPhone: string, ip = '', purpose: 'register' | 'reset' = 'register') {
    const phone = normalizePhone(rawPhone);
    if (!phone) throw bad('bad_phone', 'Номер в формате +7 9XX XXX-XX-XX');
    const existing = await this.db.one<{ id: string }>('select id from users where phone=$1', [phone]);
    if (isProd && purpose === 'register' && existing) throw bad('already_registered', 'Аккаунт существует. Войдите по паролю или восстановите доступ.');
    if (purpose === 'reset' && !existing) throw bad('not_registered', 'Такой аккаунт не найден — выберите регистрацию.');
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
      `insert into auth_codes(phone, code_hash, expires_at, attempts, sent_at, purpose) values ($1,$2,$3,0,$4,$5)
       on conflict (phone) do update set code_hash=excluded.code_hash, expires_at=excluded.expires_at, attempts=0, sent_at=excluded.sent_at, purpose=excluded.purpose`,
      [phone, hmac(phone + ':' + code), new Date(this.now().getTime() + CODE_TTL_MS), this.now(), purpose],
    );
    await this.sms.send(phone, `ТракSOS: код ${purpose === 'reset' ? 'восстановления доступа' : 'регистрации'} ${code}. Никому его не сообщайте.`);
    return { phone, sent: true, devCode: this.sms.exposesCode && !isProd ? code : undefined };
  }

  /** role не передан — вход «как есть»: новый номер становится клиентом, у существующего роли не меняются */
  async verify(rawPhone: string, code: string, role?: SelfRole, device?: string, accountType?: AccountChoice, password?: string, purpose: 'register' | 'reset' = 'register') {
    const phone = normalizePhone(rawPhone);
    if (!phone) throw bad('bad_phone', 'Неверный номер');
    const row = await this.db.one<{ code_hash: string; expires_at: Date; attempts: number; purpose: string }>(
      'select code_hash, expires_at, attempts, purpose from auth_codes where phone=$1', [phone],
    );
    if (!row || new Date(row.expires_at) < this.now()) throw bad('code_expired', 'Код устарел, запросите новый');
    if (row.purpose !== purpose && isProd) throw bad('wrong_purpose', 'Запросите код для выбранной операции');
    if (isProd && !passwordValid(password ?? '')) throw bad('weak_password', 'Пароль — от 10 до 128 символов');
    if (row.attempts >= MAX_ATTEMPTS) throw new HttpError(429, 'too_many_attempts', 'Слишком много попыток, запросите новый код');
    if (row.code_hash !== hmac(phone + ':' + code.trim())) {
      await this.db.query('update auth_codes set attempts = attempts + 1 where phone=$1', [phone]);
      throw bad('wrong_code', 'Неверный код');
    }
    await this.db.query('delete from auth_codes where phone=$1', [phone]);

    const extra = config.adminPhones.includes(phone) ? ['admin'] : [];
    const requested = purpose === 'reset' ? [] : accountType ? requestedRoles(accountType) : role ? [role] : [];
    if (role && accountType && !requested.includes(role)) {
      throw bad('invalid_role', 'Указанная специализация не соответствует типу регистрации');
    }
    // Serialize per-phone account creation/role changes, so two simultaneous requests
    // cannot bypass the mutually exclusive role policy.
    const user = await this.db.tx(async (q) => {
      await q.query('select pg_advisory_xact_lock(hashtext($1))', [phone]);
      const previous = await q.one<AuthUser>('select id, phone, name, roles, status, owner_id from users where phone=$1 for update', [phone]);
      // A plain login never grants additional privileges. The legacy client default
      // applies only to a genuinely new account without a selected category.
      if (purpose === 'reset' && !previous) throw bad('not_registered', 'Такой аккаунт не найден');
      if (previous && purpose === 'register' && isProd) throw bad('already_registered', 'Аккаунт уже зарегистрирован');
      if (previous) {
        const roles = requested.length ? validateRoles(previous.roles, requested) : previous.roles;
        const normalized = [...new Set([...roles, ...extra])];
        return await q.one<AuthUser>('update users set roles=$2::text[], password_hash=coalesce($3,password_hash), last_seen_at=now() where id=$1 returning id,phone,name,roles,status,owner_id',
          [previous.id, normalized, password ? hashPassword(password) : null]);
      }
      const roles = [...new Set([...(requested.length ? requested : ['client']), ...extra])];
      validateRoles([], roles);
      return await q.one<AuthUser>('insert into users(phone,roles,registration_kind,password_hash) values ($1,$2::text[],$3,$4) returning id,phone,name,roles,status,owner_id',
        [phone, roles, accountType ?? (role === 'driver' ? 'driver' : role === 'master' || role === 'tow' || role === 'service' || role === 'insurer' ? role : 'owner'), password ? hashPassword(password) : null]);
    });
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

  /** Normal login: never sends SMS and never changes roles. */
  async loginPassword(rawPhone: string, password: string, device?: string) {
    const phone = normalizePhone(rawPhone);
    if (!phone) throw bad('bad_phone', 'Неверный номер');
    const key = phone;
    const now = this.now().getTime();
    const attempt = this.passwordAttempts.get(key);
    if (attempt && now - attempt.since < 15 * 60_000 && attempt.count >= 10)
      throw new HttpError(429, 'too_many_attempts', 'Слишком много попыток. Повторите позже.');
    const user = await this.db.one<AuthUser & { password_hash: string | null }>(
      'select id, phone, name, roles, status, owner_id, password_hash from users where phone=$1', [phone]);
    if (!user || user.status !== 'active' || !verifyPassword(password, user.password_hash)) {
      this.passwordAttempts.set(key, { since: attempt && now - attempt.since < 15*60_000 ? attempt.since : now,
        count: (attempt && now - attempt.since < 15*60_000 ? attempt.count : 0) + 1 });
      throw new HttpError(401, 'bad_credentials', 'Неверный номер или пароль');
    }
    this.passwordAttempts.delete(key);
    const token = newToken();
    await this.db.query('insert into sessions(token_hash, user_id, expires_at, device) values ($1,$2,$3,$4)',
      [sha256(token), user.id, new Date(now + SESSION_DAYS * 86_400_000), device ?? null]);
    const { password_hash: _hidden, ...safe } = user;
    return { token, user: safe };
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
