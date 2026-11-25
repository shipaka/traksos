// Ручная регистрация — исключительно администраторский процесс, без выдачи
// пароля, обхода SMS, чужой сессии или несанкционированных штатных ролей.
import type { Db } from '../db/index.ts';
import type { AuthUser } from '../http/router.ts';
import { bad, conflict, forbidden, notFound } from '../http/router.ts';
import { config } from '../config.ts';
import { normalizePhone } from '../util.ts';
import { validateRoles } from '../domain/roles.ts';
import { createInsurerInvitation, isInsurerInvitation } from './auth.ts';

export const MANUAL_ROLES = [
  'client', 'driver', 'master', 'tow', 'service', 'insurer', 'inspection_operator', 'courier',
] as const;
export type ManualRole = typeof MANUAL_ROLES[number];

export const REPORT_CATEGORIES = ['registration','roles','login','cabinet','other'] as const;
export type ReportCategory = typeof REPORT_CATEGORIES[number];

function registrationKind(roles: readonly ManualRole[]) {
  if (roles.includes('client')) return 'owner';
  if (roles.includes('driver')) return 'driver';
  if (roles.includes('master') && roles.includes('service')) return 'master_service';
  if (roles.includes('master')) return 'master';
  if (roles.includes('tow')) return 'tow';
  if (roles.includes('service')) return 'service';
  if (roles.includes('insurer')) return 'insurer';
  return null; // inspection_operator has no self-service registration kind.
}

export class AdminAccessService {
  constructor(private db: Db, private now: () => Date = () => new Date()) {}

  // Explicit owner-approved alternative to SMS for the ONE private VPS allowlist
  // number. No general registration bypass, role grants or existing password reset.
  async invitePrimaryInsurer(actor: AuthUser, input: { phone: string; name?: string; reason: string }) {
    if (!actor.roles.includes('admin') || !config.adminPhones.includes(actor.phone) || config.sandboxInstance)
      throw forbidden();
    const phone = normalizePhone(input.phone);
    if (!phone || !config.insurerPrimaryPhone || phone !== config.insurerPrimaryPhone ||
        config.adminPhones.includes(phone) || config.moderatorPhones.includes(phone) || phone === config.recoveryContactPhone)
      throw forbidden('Доступно только для закреплённого номера страхового агента.');
    const reason = input.reason.trim();
    if (reason.length < 10) throw bad('reason_required','Укажите причину и подтверждение личности агента.');
    return this.db.tx(async q => {
      await q.query('select pg_advisory_xact_lock(hashtext($1))',[phone]);
      const existing = await q.one<{id:string;phone:string;name:string|null;roles:string[];status:string;password_hash:string|null;admin_preview_until:Date|null}>(
        'select id,phone,name,roles,status,password_hash,admin_preview_until from users where phone=$1 for update',[phone]);
      if (existing && (existing.status !== 'active' || existing.roles.length !== 1 || existing.roles[0] !== 'insurer' ||
          existing.admin_preview_until !== null || !isInsurerInvitation(existing.password_hash)))
        throw conflict('phone_registered','Аккаунт уже существует. Действующий пароль не изменён.');
      const invite = createInsurerInvitation(this.now());
      const user = existing
        ? await q.one<{id:string;phone:string;name:string|null;roles:string[]}>(
          'update users set password_hash=$2 where id=$1 returning id,phone,name,roles',[existing.id,invite.passwordHash])
        : await q.one<{id:string;phone:string;name:string|null;roles:string[]}>(
          "insert into users(phone,name,roles,registration_kind,password_hash) values ($1,$2,array['insurer']::text[],'insurer',$3) returning id,phone,name,roles",
          [phone,input.name?.trim()||null,invite.passwordHash]);
      if (!user) throw Error('Failed to save insurance invitation');
      await q.query('delete from push_tokens where user_id=$1',[user.id]);
      await q.query('delete from sessions where user_id=$1',[user.id]);
      await q.query('insert into audit_log(actor_id,action,target,data) values ($1,$2,$3,$4)',
        [actor.id,existing?'insurer.invite_reissued':'insurer.invite_created',user.id,{reason,expiresAt:invite.expiresAt.toISOString()}]);
      return {user,temporaryPassword:invite.temporaryPassword,expiresAt:invite.expiresAt.toISOString()};
    });
  }

  async register(actor: AuthUser, input: { phone: string; name?: string; roles: ManualRole[]; reason: string }) {
    const phone = normalizePhone(input.phone);
    if (!phone) throw bad('bad_phone', 'Введите корректный номер телефона РФ.');
    if (config.adminPhones.includes(phone) || config.moderatorPhones.includes(phone) ||
        phone === config.recoveryContactPhone || phone === config.insurerPrimaryPhone) {
      throw forbidden('Служебные или закреплённые номера оформляются по отдельному защищённому порядку.');
    }
    const roles = [...new Set(input.roles)];
    if (!roles.length || roles.length !== input.roles.length ||
        roles.some(r => !MANUAL_ROLES.includes(r))) throw bad('bad_roles', 'Выберите допустимые роли.');
    validateRoles([], roles);
    const name = input.name?.trim() || null;
    const reason = input.reason.trim();
    if (reason.length < 10) throw bad('reason_required', 'Укажите причину ручной регистрации (не менее 10 символов).');
    return this.db.tx(async q => {
      // A simultaneous SMS registration and administrative creation must not
      // race into silent role replacement for the same phone.
      await q.query('select pg_advisory_xact_lock(hashtext($1))', [phone]);
      const existing = await q.one<{ id: string }>('select id from users where phone=$1', [phone]);
      if (existing) throw conflict('phone_registered', 'Этот номер уже зарегистрирован. Найдите его в списке пользователей и измените роли в карточке.');
      const created = await q.one<{ id: string; phone: string; name: string | null; roles: string[] }>(
        `insert into users(phone,name,roles,registration_kind,password_hash)
           values ($1,$2,$3::text[],$4,null) returning id,phone,name,roles`,
        [phone, name, roles, registrationKind(roles)]);
      if (!created) throw new Error('Failed to create manual account');
      await q.query(
        'insert into audit_log(actor_id,action,target,data) values ($1,$2,$3,$4)',
        [actor.id, 'user.admin_registered', created.id, { phone, roles, reason, activation: 'sms_reset' }],
      );
      // No session or temporary password: user verifies their OWN number through
      // the existing reset-code flow and creates a private password themselves.
      return { user: created, activation: 'sms_reset' as const };
    });
  }

  async fileReport(actor: AuthUser, input: {
    phone?: string; userId?: string; category: ReportCategory; details: string;
  }) {
    const details = input.details.trim();
    if (details.length < 10) throw bad('details_required', 'Опишите проблему подробнее (от 10 символов).');
    const normalized = input.phone?.trim() ? normalizePhone(input.phone) : null;
    if (input.phone?.trim() && !normalized) throw bad('bad_phone', 'Неверный номер телефона.');
    const user = input.userId
      ? await this.db.one<{ id: string; phone: string }>('select id,phone from users where id=$1', [input.userId])
      : null;
    if (input.userId && !user) throw notFound('Пользователь не найден.');
    if (normalized && user && normalized !== user.phone)
      throw bad('phone_mismatch', 'Указанный номер не принадлежит выбранному пользователю.');
    return this.db.tx(async q => {
      const report = await q.one<{ id:string; status:string; created_at: Date }>(
        `insert into admin_developer_reports(created_by,user_id,phone,category,details)
           values ($1,$2,$3,$4,$5) returning id,status,created_at`,
        [actor.id, user?.id ?? null, normalized ?? user?.phone ?? null, input.category, details]);
      if (!report) throw new Error('Failed to create developer report');
      await q.query('insert into audit_log(actor_id,action,target,data) values ($1,$2,$3,$4)',
        [actor.id, 'developer_report.create', report.id, { category: input.category, userId: user?.id ?? null }]);
      return report;
    });
  }

  listReports() {
    return this.db.query(
      `select r.id, r.phone, r.category, r.details, r.status, r.user_id, r.created_at,
              r.resolved_at, r.delivery_sent_at, r.delivery_attempts, r.delivery_next_at,
              r.delivery_last_error, u.name as user_name
         from admin_developer_reports r left join users u on u.id=r.user_id
        order by case when r.status='queued' then 0 else 1 end, r.created_at desc limit 100`);
  }

  async resolveReport(actor: AuthUser, id: string) {
    return this.db.tx(async q => {
      const report = await q.one<{ id:string; status:string }>(
        'select id,status from admin_developer_reports where id=$1 for update', [id]);
      if (!report) throw notFound('Обращение разработчику не найдено.');
      if (report.status === 'resolved') return { ok: true };
      await q.query("update admin_developer_reports set status='resolved',resolved_at=now() where id=$1", [id]);
      await q.query('insert into audit_log(actor_id,action,target,data) values ($1,$2,$3,$4)',
        [actor.id, 'developer_report.resolve', id, {}]);
      return { ok: true };
    });
  }
}
