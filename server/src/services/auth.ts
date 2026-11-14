import type { Db } from '../db/index.ts';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { SmsRejectedError, type SmsProvider } from '../providers/sms.ts';
import { HttpError, bad, type AuthUser } from '../http/router.ts';
import { hmac, newCode, newToken, normalizePhone, sha256 } from '../util.ts';
import { config, isProd } from '../config.ts';
import type { SettingsService } from './settings.ts';
import { insuranceRegistrationError, insuranceRegistrationMessage } from '../domain/insuranceRegistration.ts';
import { SELF_ROLES, requestedRoles, validateRoles, type AccountChoice, type SelfRole } from '../domain/roles.ts';

const CODE_TTL_MS = 5 * 60_000;
const RESEND_MS = 60_000;
const MAX_ATTEMPTS = 5;
const SESSION_DAYS = 90;
/** Fail closed for staff roles if protected VPS phone allowlists do not match. */
function staffRoleAllowed(phone: string, roles: string[]): boolean {
  if (roles.includes('admin') && (config.adminPhones.length !== 1 || !config.adminPhones.includes(phone))) return false;
  if (roles.includes('moderator') && !config.moderatorPhones.includes(phone)) return false;
  if (roles.includes('admin') && roles.includes('moderator')) return false;
  // The initial insurance agent can NEVER be repurposed into a client/performer.
  if (config.insurerPrimaryPhone && phone === config.insurerPrimaryPhone &&
      (roles.length !== 1 || roles[0] !== 'insurer')) return false;
  return true;
}

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

/** Persistent limits: no SMS flood after deployment restart or on multi-instance hosting. */
const PER_PHONE_DAY = 8;
const PER_IP_HOUR = 15;

export class AuthService {
  constructor(private db: Db, private sms: SmsProvider,
    private now: () => Date = () => new Date(), private settings?: SettingsService) {}

  private async ensureInsuranceRegistration(phone: string, choice?: AccountChoice) {
    // Legacy local CI fixtures remain supported without any partner configuration.
    if (!isProd && !config.insurerPrimaryPhone) return;
    const registrationOpen = (await this.settings?.get('insurancePartners'))?.registrationOpen ?? false;
    const error = insuranceRegistrationError(phone, choice, config.insurerPrimaryPhone, registrationOpen);
    if (error) throw new HttpError(403, error, insuranceRegistrationMessage(error));
  }

  async requestCode(rawPhone: string, ip = '', purpose: 'register' | 'reset' = 'register', accountType?: AccountChoice) {
    const phone = normalizePhone(rawPhone);
    if (!phone) throw bad('bad_phone', 'Номер в формате +7 9XX XXX-XX-XX');
    // Reject a wrong registration BEFORE reserving a code or contacting SMS.ru.
    if (purpose === 'register') await this.ensureInsuranceRegistration(phone, accountType);
    const existing = await this.db.one<{ id: string; roles: string[] }>('select id, roles from users where phone=$1', [phone]);
    if (isProd && purpose === 'register' && config.recoveryContactPhone && phone === config.recoveryContactPhone)
      throw new HttpError(403, 'reserved_recovery_contact', 'Этот резервный контакт зарезервирован и не используется для обычной регистрации.');
    if (isProd && purpose === 'register' && existing) throw bad('already_registered', 'Аккаунт существует. Войдите по паролю или восстановите доступ.');
    if (purpose === 'reset' && !existing) throw bad('not_registered', 'Такой аккаунт не найден — выберите регистрацию.');
    if (purpose === 'reset' && (existing?.roles.some(r => r === 'admin' || r === 'moderator') || config.adminPhones.includes(phone) || config.moderatorPhones.includes(phone) || (config.insurerPrimaryPhone && phone === config.insurerPrimaryPhone)))
      throw new HttpError(403, 'staff_recovery_protected', 'Служебный аккаунт восстанавливается только через защищённую процедуру администратора.');
    const now = this.now();
    const ttl = new Date(now.getTime() + CODE_TTL_MS);
    // Local and proxy-internal IPs are not a reliable individual identifier.
    const publicIp = ip && !/^(::1|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::ffff:(127|10|192\.168)\.|fc|fd)/i.test(ip);
    const code = newCode();
    const hash = hmac(phone + ':' + code);

    await this.db.tx(async (q) => {
      // Prevent two parallel code requests from bypassing the 60-second cooldown.
      await q.query('select pg_advisory_xact_lock(hashtext($1))', ['sms:' + phone]);
      const prev = await q.one<{ sent_at: Date }>('select sent_at from auth_codes where phone=$1 for update', [phone]);
      if (prev && now.getTime() - new Date(prev.sent_at).getTime() < RESEND_MS) {
        throw new HttpError(429, 'too_often', 'Новый код можно запросить через минуту');
      }
      const reserve = async (scope: 'phone_day' | 'ip_hour', identity: string, bucket: Date, cap: number) => {
        const row = await q.one<{ used: number }>(
          `insert into auth_sms_limits(scope, identity, bucket, used) values ($1,$2,$3,1)
           on conflict (scope, identity, bucket) do update
             set used=auth_sms_limits.used + 1
           where auth_sms_limits.used < $4
           returning used`,
          [scope, identity, bucket, cap],
        );
        if (!row) {
          throw new HttpError(429, 'too_many_codes',
            scope === 'phone_day' ? 'На этот номер сегодня отправлено слишком много кодов — напишите в поддержку'
              : 'Слишком много кодов с этого устройства — попробуйте через час');
        }
      };
      const day = new Date(Math.floor(now.getTime() / 86_400_000) * 86_400_000);
      const hour = new Date(Math.floor(now.getTime() / 3_600_000) * 3_600_000);
      await reserve('phone_day', phone, day, PER_PHONE_DAY);
      if (publicIp) await reserve('ip_hour', ip, hour, PER_IP_HOUR);
      await q.query(
        `insert into auth_codes(phone, code_hash, expires_at, attempts, sent_at, purpose) values ($1,$2,$3,0,$4,$5)
         on conflict (phone) do update set code_hash=excluded.code_hash, expires_at=excluded.expires_at,
           attempts=0, sent_at=excluded.sent_at, purpose=excluded.purpose`,
        [phone, hash, ttl, now, purpose],
      );
    });
    try {
      await this.sms.send(phone, `TrakSOS: код ${purpose === 'reset' ? 'восстановления доступа' : 'регистрации'} ${code}. Никому его не сообщайте.`);
    } catch (error) {
      if (error instanceof SmsRejectedError) {
        // Only a coarse, non-sensitive reason is logged. Do not log the number,
        // API key, requested code or raw (possibly identifying) provider text.
        const reason = error.message.toLowerCase();
        const category = /баланс|balance|недостаточно|funds/.test(reason) ? 'баланс'
          : /api_id|авторизац|api key/.test(reason) ? 'авторизация'
          : /отправител|sender|подпись/.test(reason) ? 'отправитель'
          : /лимит|quota|limit/.test(reason) ? 'лимит'
          : /номер|phone|recipient/.test(reason) ? 'получатель' : 'другая причина';
        console.warn('SMS.ru не принял сообщение: ' + category);
        // SMS.ru explicitly refused the message: the code was never delivered.
        // Remove only this exact pending code, never one from a newer request.
        // Keep hourly/daily quotas to prevent repeated rejected requests being abused.
        await this.db.query('delete from auth_codes where phone=$1 and code_hash=$2', [phone, hash]);
        throw new HttpError(502, 'sms_rejected',
          'SMS.ru отклонил отправку. Проверьте баланс и ограничения SMS.ru; повторить можно после исправления.');
      }
      // Unknown network error: do NOT remove the pending code. SMS.ru may
      // have accepted it despite a lost response; keep the 60-second cooldown.
      throw error;
    }
    return { phone, sent: true, devCode: this.sms.exposesCode && !isProd ? code : undefined };
  }

  /** role не передан — вход «как есть»: новый номер становится клиентом, у существующего роли не меняются */
  async verify(rawPhone: string, code: string, role?: SelfRole, device?: string, accountType?: AccountChoice, password?: string, purpose: 'register' | 'reset' = 'register') {
    const phone = normalizePhone(rawPhone);
    if (!phone) throw bad('bad_phone', 'Неверный номер');
    // Re-check on verification: users may forge accountType or re-use an old SMS.
    if (purpose === 'register') await this.ensureInsuranceRegistration(phone, accountType ?? (role as AccountChoice | undefined));
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

    // Production never grants administrator privileges from control of an SMS number alone.
    // Historical development fixtures retain the old behavior solely outside production.
    const extra = !isProd && config.adminPhones.includes(phone) ? ['admin'] : [];
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
      if (purpose === 'reset' && (previous?.roles.some(r => r === 'admin' || r === 'moderator') || config.adminPhones.includes(phone) || config.moderatorPhones.includes(phone) || (config.insurerPrimaryPhone && phone === config.insurerPrimaryPhone)))
        throw new HttpError(403, 'staff_recovery_protected', 'Нельзя сбросить служебный пароль только по SMS.');
      if (previous && purpose === 'register' && isProd) throw bad('already_registered', 'Аккаунт уже зарегистрирован');
      if (previous) {
        const roles = requested.length ? validateRoles(previous.roles, requested) : previous.roles;
        const normalized = [...new Set([...roles, ...extra])];
        return await q.one<AuthUser>('update users set roles=$2::text[], password_hash=coalesce($3,password_hash), last_seen_at=now() where id=$1 returning id,phone,name,roles,status,owner_id,false as inserted',
          [previous.id, normalized, password ? hashPassword(password) : null]);
      }
      const roles = [...new Set([...(requested.length ? requested : ['client']), ...extra])];
      validateRoles([], roles);
      return await q.one<AuthUser>('insert into users(phone,roles,registration_kind,password_hash) values ($1,$2::text[],$3,$4) returning id,phone,name,roles,status,owner_id,true as inserted',
        [phone, roles, accountType ?? (role === 'driver' ? 'driver' : role === 'master' || role === 'tow' || role === 'service' || role === 'insurer' ? role : 'owner'), password ? hashPassword(password) : null]);
    });
    if (!user || user.status !== 'active') {
      // Заблокированный может оспорить блокировку — номер подтверждён кодом, выдаём одноразовый пропуск на обжалование
      throw new HttpError(403, 'blocked', 'Аккаунт заблокирован. Можно оспорить блокировку — ответ придёт по SMS.', { appealToken: appealToken(phone, this.now()) });
    }

    // Password reset invalidates every prior session; a stolen token cannot survive recovery.
    if (purpose === 'reset') {
      // Legacy tokens are not session-bound; clear them too when credentials change.
      await this.db.query('delete from push_tokens where user_id=$1', [user.id]);
      await this.db.query('delete from sessions where user_id=$1', [user.id]);
      if (!staffRoleAllowed(phone, user.roles))
      throw new HttpError(403, 'staff_phone_mismatch', 'Доступ к служебному аккаунту ограничен.');
    await this.db.query("delete from auth_login_attempts where scope='phone' and identity=$1", [phone]);
    }
    const token = newToken();
    await this.db.query('insert into sessions(token_hash, user_id, expires_at, device) values ($1,$2,$3,$4)', [
      sha256(token), user.id, new Date(this.now().getTime() + SESSION_DAYS * 86_400_000), device ?? null,
    ]);
    return { token, user };
  }

  /** Normal login: never sends SMS and never changes roles. */
  /** Password-only login. Counters are shared by all processes and survive restart. */
  async loginPassword(rawPhone: string, password: string, device?: string, ip = '') {
    const phone = normalizePhone(rawPhone);
    if (!phone) throw bad('bad_phone', 'Неверный номер');
    if (password.length > 128) throw new HttpError(401, 'bad_credentials', 'Неверный номер или пароль');
    const now = this.now();
    const externalIp = ip && !/^(::1|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::ffff:(127|10|192\.168)\.|fc|fd)/i.test(ip);
    await this.db.tx(async q => {
      const reserve = async (scope: 'phone' | 'ip', identity: string, limit: number) => {
        const row = await q.one<{ attempts: number }>(
          `insert into auth_login_attempts(scope,identity,window_start,attempts)
           values ($1,$2,$3,1)
           on conflict (scope, identity) do update
             set window_start=case when auth_login_attempts.window_start <= $3::timestamptz - interval '15 minutes'
                   then $3::timestamptz else auth_login_attempts.window_start end,
                 attempts=case when auth_login_attempts.window_start <= $3::timestamptz - interval '15 minutes'
                   then 1 else auth_login_attempts.attempts + 1 end
           where auth_login_attempts.window_start <= $3::timestamptz - interval '15 minutes'
              or auth_login_attempts.attempts < $4
           returning attempts`, [scope, identity, now, limit]);
        if (!row) throw new HttpError(429, 'too_many_attempts',
          'Слишком много попыток входа. Попробуйте позже или восстановите пароль.');
      };
      await reserve('phone', phone, 10);
      if (externalIp) await reserve('ip', ip, 120);
    });
    const user = await this.db.one<AuthUser & { password_hash: string | null; admin_preview_until: Date | null }>(
      'select id, phone, name, roles, status, owner_id, password_hash, admin_preview_until from users where phone=$1', [phone]);
    if (!user || user.status !== 'active' || !verifyPassword(password, user.password_hash) ||
        (user.admin_preview_until !== null && new Date(user.admin_preview_until) <= now)) {
      throw new HttpError(401, 'bad_credentials', 'Неверный номер или пароль');
    }
    if (!staffRoleAllowed(phone, user.roles))
      throw new HttpError(403, 'account_role_restricted', 'Для этого номера доступен только закреплённый кабинет. Обратитесь в поддержку.');
    await this.db.query("delete from auth_login_attempts where scope='phone' and identity=$1", [phone]);
    const token = newToken();
    await this.db.query('insert into sessions(token_hash, user_id, expires_at, device) values ($1,$2,$3,$4)',
      [sha256(token), user.id, new Date(now.getTime() + SESSION_DAYS * 86_400_000), device ?? null]);
    const { password_hash: _hidden, admin_preview_until: _previewUntil, ...safe } = user;
    return { token, user: safe };
  }

  async authenticate(token: string | null | undefined): Promise<AuthUser | null> {
    if (!token) return null;
    const u = await this.db.one<AuthUser>(
      `select u.id, u.phone, u.name, u.roles, u.status, u.owner_id
         from sessions s join users u on u.id = s.user_id
        where s.token_hash = $1 and s.expires_at > now()
          and (u.admin_preview_until is null or u.admin_preview_until > now())`,
      [sha256(token)],
    );
    if (!u || u.status !== 'active' || !staffRoleAllowed(u.phone, u.roles)) return null;
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
