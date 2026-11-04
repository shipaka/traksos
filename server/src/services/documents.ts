// Проверка исполнителей: фото документов и машины, очередь модератора.

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import type { Db } from '../db/index.ts';
import type { Notifier } from './notify.ts';
import type { SettingsService } from './settings.ts';
import { bad, conflict, forbidden, notFound, type AuthUser } from '../http/router.ts';
import { config } from '../config.ts';

export const DOC_KINDS: Record<string, { name: string; hint: string; camera: 'environment' | 'user' }> = {
  passport: { name: 'Паспорт', hint: 'Разворот с фото, всё читается, без бликов', camera: 'environment' },
  selfie: { name: 'Селфи с паспортом', hint: 'Лицо и разворот паспорта в кадре', camera: 'user' },
  car_front: { name: 'Машина спереди', hint: 'Госномер читается', camera: 'environment' },
  car_side: { name: 'Машина сбоку', hint: 'Видно машину целиком', camera: 'environment' },
  equipment: { name: 'Оборудование', hint: 'Сканер и инструмент для диагностики', camera: 'environment' },
  tow_front: { name: 'Эвакуатор спереди', hint: 'Госномер читается', camera: 'environment' },
  tow_side: { name: 'Эвакуатор сбоку', hint: 'Видна платформа', camera: 'environment' },
  sts: { name: 'СТС эвакуатора', hint: 'Обе стороны или разворот', camera: 'environment' },
};

export function requiredKinds(p: { kind?: string; specialties?: string[]; tier?: string }) {
  if (p.kind === 'tow') return ['passport', 'selfie', 'tow_front', 'tow_side', 'sts'];
  const base = ['passport', 'selfie', 'car_front', 'car_side'];
  if (p.tier === 'pro' || p.specialties?.includes('diag')) base.push('equipment');
  return base;
}

const MIMES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_BYTES = 4 * 1024 * 1024;
const FRESH_MS = 24 * 3600_000;

const key = () => createHash('sha256').update('traksos-docs:' + (process.env.DOCS_KEY ?? config.secret)).digest();

function encrypt(buf: Buffer) {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([c.update(buf), c.final()]);
  return { iv, tag: c.getAuthTag(), data };
}

function decrypt(row: { iv: Buffer; tag: Buffer; data: Buffer }) {
  const d = createDecipheriv('aes-256-gcm', key(), row.iv);
  d.setAuthTag(row.tag);
  return Buffer.concat([d.update(row.data), d.final()]);
}

/** bytea из драйвера: Buffer (pg) или строка '\x…' (встроенный клиент) */
function asBuf(v: unknown): Buffer {
  if (Buffer.isBuffer(v)) return v;
  if (typeof v === 'string' && v.startsWith('\\x')) return Buffer.from(v.slice(2), 'hex');
  throw new Error('bytea: неизвестный формат');
}

export class DocumentsService {
  constructor(private db: Db, private notifier: Notifier, private settings: SettingsService, private now: () => Date) {}

  async upload(user: AuthUser, p: { kind: string; dataUrl: string; takenAt?: string }) {
    if (!DOC_KINDS[p.kind]) throw bad('bad_kind', 'Неизвестный тип документа');
    const prof = await this.db.one('select verification from performer_profiles where user_id=$1', [user.id]);
    if (!prof) throw bad('no_profile', 'Сначала заполните профиль исполнителя');
    const m = /^data:([\w/+.-]+);base64,(.+)$/s.exec(p.dataUrl);
    if (!m || !MIMES.includes(m[1])) throw bad('bad_image', 'Нужна фотография JPEG, PNG или WEBP');
    const buf = Buffer.from(m[2], 'base64');
    if (buf.length > MAX_BYTES) throw bad('too_large', 'Фото больше 4 МБ — снимите ещё раз');
    if (buf.length < 5_000) throw bad('too_small', 'Фото слишком маленькое — снимите ещё раз');
    const sha = createHash('sha256').update(buf).digest('hex');
    const enc = encrypt(buf);
    // Новое фото того же типа заменяет прежнее, ещё не одобренное
    await this.db.query(`delete from documents where user_id=$1 and kind=$2 and status <> 'approved'`, [user.id, p.kind]);
    const row = await this.db.one(
      `insert into documents(user_id, kind, mime, size, sha256, iv, tag, data, taken_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id, kind, status, created_at`,
      [user.id, p.kind, m[1], buf.length, sha, '\\x' + enc.iv.toString('hex'), '\\x' + enc.tag.toString('hex'), '\\x' + enc.data.toString('hex'),
        p.takenAt ? new Date(p.takenAt) : null]);
    // Повторная проверка нужна после смены машины или документов
    if (prof.verification === 'approved' && !['equipment'].includes(p.kind)) {
      await this.db.query(`update performer_profiles set verification='pending', submitted_at=$2 where user_id=$1`, [user.id, this.now()]);
    }
    return row;
  }

  async mine(user: AuthUser) {
    const prof = await this.db.one('select kind, specialties, tier, verification, submitted_at, verification_note from performer_profiles where user_id=$1', [user.id]);
    if (!prof) throw notFound('Сначала заполните профиль исполнителя');
    const docs = await this.db.query(
      `select id, kind, status, note, created_at from documents where user_id=$1 order by created_at`, [user.id]);
    const required = requiredKinds(prof);
    return {
      verification: prof.verification, submittedAt: prof.submitted_at, note: prof.verification_note,
      required: required.map((k) => ({ kind: k, ...DOC_KINDS[k], doc: docs.find((d: any) => d.kind === k) ?? null })),
      complete: required.every((k) => docs.some((d: any) => d.kind === k && d.status !== 'rejected')),
    };
  }

  async submit(user: AuthUser) {
    const st = await this.mine(user);
    if (!st.complete) throw bad('incomplete', 'Загрузите все фото из списка');
    await this.db.query(`update performer_profiles set submitted_at=$2, verification='pending', verification_note=null where user_id=$1`, [user.id, this.now()]);
    const staff = (await this.db.query<{ id: string }>(`select id from users where roles && '{admin,moderator}'::text[]`)).map((r) => r.id);
    await this.notifier.notify(staff, { type: 'verification_queue', userId: user.id },
      { kind: 'normal', title: 'Новый исполнитель на проверке', body: `${user.name ?? user.phone} отправил документы`, data: { userId: user.id } });
    return this.mine(user);
  }

  /** Файл: владельцу — всегда, модератору — с записью в журнал */
  async file(user: AuthUser, id: string) {
    const row = await this.db.one('select * from documents where id=$1', [id]);
    if (!row) throw notFound();
    const staff = user.roles.includes('admin') || user.roles.includes('moderator');
    if (row.user_id !== user.id && !staff) throw forbidden();
    if (row.user_id !== user.id) {
      await this.db.query('insert into audit_log(actor_id, action, target, data) values ($1,$2,$3,$4)',
        [user.id, 'document.view', id, { owner: row.user_id, kind: row.kind }]);
    }
    return { mime: row.mime as string, body: decrypt({ iv: asBuf(row.iv), tag: asBuf(row.tag), data: asBuf(row.data) }) };
  }

  /** Очередь модератора: кто отправил на проверку, с автоотметками */
  async queue() {
    const people = await this.db.query(
      `select u.id, u.name, u.phone, p.kind, p.specialties, p.tier, p.tax_status, p.inn, p.car, p.submitted_at, p.verification
         from performer_profiles p join users u on u.id=p.user_id
        where p.verification='pending' and p.submitted_at is not null order by p.submitted_at`);
    const out = [];
    for (const u of people) {
      const docs = await this.db.query(
        `select d.id, d.kind, d.status, d.note, d.taken_at, d.created_at, d.size,
                (select count(*)::int from documents x where x.sha256=d.sha256 and x.user_id<>d.user_id) as duplicates
           from documents d where d.user_id=$1 order by d.created_at`, [u.id]);
      const flags: string[] = [];
      for (const d of docs) {
        if (d.duplicates > 0) flags.push(`${DOC_KINDS[d.kind]?.name}: такое же фото есть в другом профиле`);
        if (d.taken_at && new Date(d.created_at).getTime() - new Date(d.taken_at).getTime() > FRESH_MS) {
          flags.push(`${DOC_KINDS[d.kind]?.name}: снято давно — возможно, из галереи`);
        }
      }
      if (!u.tax_status || !u.inn) flags.push('Не указан статус самозанятого/ИП или ИНН');
      const req = requiredKinds(u);
      out.push({ ...u, docs: docs.map((d: any) => ({ ...d, name: DOC_KINDS[d.kind]?.name })), missing: req.filter((k) => !docs.some((d: any) => d.kind === k)).map((k) => DOC_KINDS[k].name), flags });
    }
    return out;
  }

  async review(admin: AuthUser, id: string, p: { status: 'approved' | 'rejected'; note?: string }) {
    if (p.status === 'rejected' && !p.note) throw bad('note_required', 'Напишите, что переснять');
    const d = await this.db.one(
      `update documents set status=$2, note=$3, reviewed_by=$4, reviewed_at=$5 where id=$1 returning user_id, kind`,
      [id, p.status, p.note ?? null, admin.id, this.now()]);
    if (!d) throw notFound();
    await this.db.query('insert into audit_log(actor_id, action, target, data) values ($1,$2,$3,$4)', [admin.id, 'document.review', id, p]);
    if (p.status === 'rejected') {
      await this.notifier.notify([d.user_id], { type: 'verification', decision: 'retake' }, {
        kind: 'normal', title: 'Переснимите фото', body: `${DOC_KINDS[d.kind]?.name}: ${p.note}`, data: {},
      });
    }
    return { ok: true };
  }

  /** Одобрить исполнителя целиком: все обязательные фото должны быть приняты (если в настройках не выключено) */
  async decide(admin: AuthUser, userId: string, decision: 'approved' | 'rejected' | 'pending', note?: string) {
    const prof = await this.db.one('select kind, specialties, tier from performer_profiles where user_id=$1', [userId]);
    if (!prof) throw notFound();
    if (decision === 'approved' && (await this.settings.get('verification')).requireDocs) {
      const ok = await this.db.query<{ kind: string }>(`select kind from documents where user_id=$1 and status='approved'`, [userId]);
      const missing = requiredKinds(prof).filter((k) => !ok.some((x) => x.kind === k));
      if (missing.length) throw conflict('docs_missing', `Сначала примите фото: ${missing.map((k) => DOC_KINDS[k].name).join(', ')}`);
    }
    if (decision === 'rejected' && !note) throw bad('note_required', 'Напишите причину — исполнитель увидит её');
    await this.db.query(`update performer_profiles set verification=$2, verification_note=$3, verified_at = case when $2='approved' then $4::timestamptz else verified_at end
                          where user_id=$1`, [userId, decision, note ?? null, this.now()]);
    if (decision !== 'approved') await this.db.query(`update performer_profiles set line_status='offline' where user_id=$1 and line_status <> 'on_job'`, [userId]);
    await this.db.query('insert into audit_log(actor_id, action, target, data) values ($1,$2,$3,$4)', [admin.id, 'performer.verify', userId, { decision, note }]);
    await this.notifier.notify([userId], { type: 'verification', decision }, {
      kind: 'normal', title: decision === 'approved' ? 'Проверка пройдена' : 'Проверка не пройдена',
      body: decision === 'approved' ? 'Выходите на линию — заявки начнут приходить.' : note ?? 'Подробности в профиле', data: {},
    });
    return { ok: true };
  }
}
