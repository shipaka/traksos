import type { Db, Queryable } from '../db/index.ts';
import type { AuthUser } from '../http/router.ts';
import { bad, forbidden, notFound } from '../http/router.ts';

export type RepairCaseInput = {
  make: string; model?: string; productionYear?: number; ecu?: string; code?: string;
  symptoms: string; checksPerformed: string; verifiedFix: string; provenanceNote?: string;
};

// Cases are shared with other verified specialists. Reject obvious customer
// identifiers in EVERY free-text field before a record enters moderation.
const contact = /(?:[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})|(?:\+?7|8)[\s().-]*\d{3}[\s().-]*\d{3}[\s().-]*\d{2}[\s().-]*\d{2}|\b[A-HJ-NPR-Z0-9]{17}\b|(?:^|[^\p{L}\p{N}])[АВЕКМНОРСТУХABEKMHOPCTYX]\s*\d{3}\s*[АВЕКМНОРСТУХABEKMHOPCTYX]{2}\s*\d{2,3}(?![\p{L}\p{N}])|(?:госномер|гос\.номер|телефон|vin[:\s]|e-?mail[:\s]|паспорт[:\s])/iu;
const normalized = (value: string) => value.normalize('NFKC')
  .replace(/[\u200B-\u200D\u2060\uFEFF]/g, '').replace(/\s+/g, ' ').trim();

function clean(data: RepairCaseInput): RepairCaseInput {
  const trimmed = {
    make: normalized(data.make), model: normalized(data.model ?? ''), productionYear: data.productionYear,
    ecu: normalized(data.ecu ?? ''), code: normalized(data.code ?? '').toUpperCase(),
    symptoms: normalized(data.symptoms), checksPerformed: normalized(data.checksPerformed),
    verifiedFix: normalized(data.verifiedFix), provenanceNote: normalized(data.provenanceNote ?? ''),
  };
  if (Object.values(trimmed).some((v) => typeof v === 'string' && contact.test(v)))
    throw bad('personal_data', 'Не указывай VIN, номера телефонов, госномера и персональные данные клиентов');
  if (!trimmed.make || trimmed.symptoms.length < 15 || trimmed.checksPerformed.length < 15 ||
      trimmed.verifiedFix.length < 15)
    throw bad('incomplete_case', 'Нужны марка, симптомы, проведённые проверки и подтверждённое решение');
  return trimmed;
}

export class TechnicalCasesService {
  constructor(private db: Db) {}

  private async liveRoles(q: Queryable, user: AuthUser): Promise<string[]> {
    const current = await q.one<{roles:string[]}>(
      "select roles from users where id=$1 and status='active' for share", [user.id]);
    return current ? user.roles.filter(role => current.roles.includes(role)) : [];
  }

  private async canReadIn(q: Queryable, user: AuthUser): Promise<boolean> {
    const roles = await this.liveRoles(q, user);
    if (roles.some(r => ['admin','moderator'].includes(r))) return true;
    if (!roles.some(r => ['master','service'].includes(r))) return false;
    const p = await q.one<{verification:string}>(
      'select verification from performer_profiles where user_id=$1 for share', [user.id]);
    return p?.verification === 'approved';
  }

  async canRead(user: AuthUser): Promise<boolean> {
    return this.db.tx(q => this.canReadIn(q,user));
  }

  async submit(user: AuthUser, data: RepairCaseInput) {
    return this.db.tx(async q => {
      if (!(await this.canReadIn(q,user))) throw forbidden('Добавлять кейсы могут проверенные специалисты');
      const value = clean(data);
      const saved = await q.one<{ id: string }>(
        'insert into technical_repair_cases (author_id,make,model,production_year,ecu,code,symptoms,checks_performed,verified_fix,provenance_note) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id::text as id',
        [user.id, value.make, value.model, value.productionYear ?? null, value.ecu, value.code,
         value.symptoms, value.checksPerformed, value.verifiedFix, value.provenanceNote],
      );
      return { id: saved?.id, reviewState: 'pending', published: false };
    });
  }

  async approved(user: AuthUser, term: string) {
    return this.db.tx(async q => {
      if (!(await this.canReadIn(q,user))) throw forbidden('Техническая база доступна проверенным специалистам');
      const value = normalized(term).toLowerCase().slice(0,80);
      const rows = await q.query(
        `select id::text as id, make,model,production_year,ecu,code,symptoms,checks_performed,verified_fix,provenance_note,reviewed_at
           from technical_repair_cases where review_state='approved' and
             ($1='' or strpos(lower(coalesce(code,'')),$1)>0
                    or strpos(lower(coalesce(make,'')),$1)>0
                    or strpos(lower(coalesce(model,'')),$1)>0
                    or strpos(lower(coalesce(ecu,'')),$1)>0)
          order by id desc limit 30`,[value],
      );
      return { items: rows };
    });
  }

  async pending(user: AuthUser) {
    return this.db.tx(async q => {
      if (!(await this.liveRoles(q,user)).includes('admin')) throw forbidden('Проверка кейсов доступна администратору');
      return { items: await q.query(
        "select id::text as id,author_id,make,model,production_year,ecu,code,symptoms,checks_performed,verified_fix,provenance_note,created_at from technical_repair_cases where review_state='pending' order by id limit 100",
      ) };
    });
  }

  async decide(user: AuthUser, id: string, approve: boolean, note: string) {
    return this.db.tx(async q => {
      if (!(await this.liveRoles(q,user)).includes('admin')) throw forbidden('Проверка кейсов доступна администратору');
      // An oversized numeric path must not turn a missing case into PostgreSQL
      // bigint overflow (HTTP 500). A reviewer cannot approve their own case.
      if (!/^\d{1,19}$/.test(id) || BigInt(id) > 9223372036854775807n) throw notFound();
      const reason = normalized(note).slice(0,1000);
      if (approve && reason.length < 10)
        throw bad('review_note_required', 'Укажи основание технической проверки — не менее 10 символов');
      const own = await q.one<{author_id:string}>(
        'select author_id from technical_repair_cases where id=$1::bigint', [id]);
      if (own?.author_id === user.id)
        throw forbidden('Проверку собственного технического кейса проводит другой администратор');
      const row = await q.one(
        "update technical_repair_cases set review_state=$2,reviewed_by=$3,reviewed_at=now(),review_note=$4 where id=$1::bigint and review_state='pending' and author_id<>$3 returning id::text as id,review_state",
        [id, approve ? 'approved' : 'rejected', user.id, reason],
      );
      if (!row) throw notFound('Кейс не найден или уже проверен');
      return row;
    });
  }
}
