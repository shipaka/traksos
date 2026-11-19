// Unified administrative registry. Identity and operational data are always live from their
// source tables; only annotations are stored in admin_crm_profiles.
import type { Db } from '../db/index.ts';
import { notFound, type AuthUser } from '../http/router.ts';

export interface RegistryFilters {
  q?: string; role?: string; region?: string; city?: string; status?: string;
  verification?: string; specialty?: string; activity?: string;
  company?: string; tag?: string; kind?: string; ratingMin?: number;
  from?: string; to?: string; page?: number; pageSize?: number;
}

export interface RegistryMetadata {
  region?: string | null; city?: string | null; tags?: string[]; note?: string;
}

const csvHeader = [
  'ID', 'Имя', 'Компания', 'ИНН', 'Телефон', 'Роли', 'Статус',
  'Регион', 'Источник региона', 'Город', 'Адрес СТО', 'Категория исполнителя',
  'Специализации', 'Проверка', 'На линии', 'Рейтинг', 'Кол-во отзывов',
  'ТС в парке', 'Заявок клиента', 'Выездов исполнителя', 'Счетов СТО',
  'Дата регистрации', 'Последняя активность', 'Теги', 'Заметка администратора',
];

/** Excel should not interpret arbitrary user input as a formula or lose UTF-8. */
export function safeCsvCell(value: unknown) {
  let s = value == null ? '' : Array.isArray(value) ? value.join(', ') : String(value);
  // Includes phone +7...; leading apostrophe makes it literal spreadsheet text.
  if (/^[\s\uFEFF]*[=+@\-\t\r]/u.test(s)) s = "'" + s;
  return '"' + s.replace(/"/g, '""') + '"';
}
export function registryCsv(rows: any[]) {
  const cell = (v: unknown) => safeCsvCell(v);
  const head = csvHeader.map(cell).join(';');
  return '\uFEFF' + [head, ...rows.map(r => [
    r.id, r.name, r.company_name || r.center_name, r.company_inn || r.center_inn,
    r.phone, r.roles, r.status, r.region, r.region_source, r.city, r.center_address,
    r.kind, r.specialties, r.verification, r.line_status,
    r.rating, r.rating_count, r.vehicles_count, r.orders_client_count,
    r.orders_performer_count, r.bookings_service_count, r.created_at, r.last_seen_at,
    r.tags, r.note,
  ].map(cell).join(';'))].join('\r\n');
}

function cleanText(s: string | undefined, max = 100) {
  return String(s ?? '').trim().slice(0, max);
}

export class AdminRegistry {
  constructor(private db: Db) {}

  private args(f: RegistryFilters) {
    const q = cleanText(f.q, 120).replace(/[%_\\]/g, '');
    const region = cleanText(f.region, 80);
    const page = Math.max(1, Math.min(100_000, Math.trunc(f.page ?? 1)));
    const pageSize = Math.max(1, Math.min(100, Math.trunc(f.pageSize ?? 30)));
    return {
      values: [
        q ? '%' + q + '%' : '',
        cleanText(f.role, 60), cleanText(f.status, 30),
        cleanText(f.verification, 30), region, cleanText(f.city, 120),
        cleanText(f.specialty, 60), cleanText(f.activity, 30),
        cleanText(f.company, 10), cleanText(f.tag, 50),
        Math.max(0, Math.min(5, Number(f.ratingMin ?? 0))),
        f.from || null, f.to || null, cleanText(f.kind, 30),
      ] as unknown[],
      page, pageSize,
    };
  }

  private baseSql() {
    return `
      with registry as (
        select u.id, u.phone, u.name, u.roles, u.status, u.owner_id,
               u.company_name, u.company_inn, u.rating::float as rating,
               u.rating_count, u.created_at, u.last_seen_at,
               p.kind, p.specialties, p.verification as worker_verification,
               p.line_status, p.tax_status, p.tier, p.inn as worker_inn,
               sc.name as center_name, sc.address as center_address, sc.inn as center_inn,
               sc.verification as center_verification,
               coalesce(p.verification, sc.verification) as verification,
               c.tags, c.note, c.city,
               coalesce(nullif(c.region,''), case
                 when sc.address ~* 'санкт[- ]?петербург|спб' then 'spb'
                 when sc.address ~* 'ленинградск.{0,12}област|ленобласт' then 'lo'
                 else recent.location_region end) as region,
               case
                 when nullif(c.region,'') is not null then 'указан администратором'
                 when sc.address ~* 'санкт[- ]?петербург|спб|ленинградск.{0,12}област|ленобласт' then 'адрес СТО'
                 when recent.location_region is not null then 'регион последней заявки'
                 else 'не определён' end as region_source
          from users u
          left join performer_profiles p on p.user_id=u.id
          left join service_centers sc on sc.owner_id=u.id
          left join admin_crm_profiles c on c.user_id=u.id
          left join lateral (
            select o.location_region from orders o
             where (o.client_id=u.id or o.created_by=u.id or o.performer_id=u.id)
               and o.location_region is not null
             order by o.created_at desc limit 1
          ) recent on true
      ), filtered as (
        select r.* from registry r where
          ($1::text='' or r.phone ilike $1 or coalesce(r.name,'') ilike $1
            or coalesce(r.company_name,'') ilike $1 or coalesce(r.company_inn,'') ilike $1
            or coalesce(r.center_name,'') ilike $1 or coalesce(r.center_address,'') ilike $1
            or coalesce(r.worker_inn,'') ilike $1 or r.id::text ilike $1
            or exists (select 1 from vehicles v where v.owner_id=r.id
                       and (coalesce(v.plate,'') ilike $1 or coalesce(v.trailer_plate,'') ilike $1)))
          and ($2::text='' or $2=any(r.roles))
          and ($3::text='' or r.status=$3)
          and ($4::text='' or coalesce(r.verification,'')=$4)
          and ($5::text='' or
               ($5='unassigned' and r.region is null) or
               (r.region is not null and lower(r.region)=lower($5)))
          and ($6::text='' or coalesce(r.city,'') ilike '%' || $6 || '%'
               or coalesce(r.center_address,'') ilike '%' || $6 || '%')
          and ($7::text='' or $7=any(coalesce(r.specialties,'{}'::text[])))
          and ($8::text='' or
               ($8='with_orders' and exists (select 1 from orders o where o.client_id=r.id or o.performer_id=r.id or o.created_by=r.id))
               or ($8='without_orders' and not exists (select 1 from orders o where o.client_id=r.id or o.performer_id=r.id or o.created_by=r.id))
               or ($8='recent_30' and exists (select 1 from orders o where
                     (o.client_id=r.id or o.performer_id=r.id or o.created_by=r.id)
                     and o.created_at >= now()-interval '30 days')))
          and ($9::text='' or ($9='yes' and (nullif(r.company_name,'') is not null or r.center_name is not null))
                 or ($9='no' and nullif(r.company_name,'') is null and r.center_name is null))
          and ($10::text='' or $10=any(coalesce(r.tags,'{}'::text[])))
          and ($11::float8=0 or coalesce(r.rating,0) >= $11)
          and ($12::date is null or r.created_at >= $12::date)
          and ($13::date is null or r.created_at < $13::date + interval '1 day')
          and ($14::text='' or r.kind=$14 or ($14='service' and 'service'=any(r.roles)))
      )`;
  }

  private async query(f: RegistryFilters, limit: number, offset: number) {
    const {values} = this.args(f);
    const sql = this.baseSql();
    const rows = await this.db.query(`${sql}
      select r.*,
         (select count(*)::int from vehicles v where v.owner_id=r.id) as vehicles_count,
         (select count(*)::int from orders o where o.client_id=r.id or o.created_by=r.id) as orders_client_count,
         (select count(*)::int from orders o where o.performer_id=r.id) as orders_performer_count,
         (select count(*)::int from service_bookings b join service_centers sc2 on sc2.id=b.center_id
            where sc2.owner_id=r.id) as bookings_service_count
      from filtered r order by r.created_at desc, r.id desc limit $15 offset $16`,
      [...values, limit, offset]);
    return rows;
  }

  async list(f: RegistryFilters) {
    const {values,page,pageSize} = this.args(f);
    const [totalRow,rows] = await Promise.all([
      this.db.one<{total: number}>(this.baseSql() + ' select count(*)::int as total from filtered',values),
      this.query(f,pageSize,(page-1)*pageSize),
    ]);
    return { total: totalRow?.total ?? 0, page, pageSize, items: rows };
  }

  /** Only the logged-in administrator may export; the route owns the role guard. */
  async exportCsv(actor: AuthUser, f: RegistryFilters) {
    const {values} = this.args(f);
    const row = await this.db.one<{total:number}>(this.baseSql() + ' select count(*)::int as total from filtered',values);
    const total = row?.total ?? 0;
    const limit = 5000;
    const rows = await this.query(f, limit, 0);
    await this.db.query(
      'insert into audit_log(actor_id,action,target,data) values($1,$2,$3,$4::jsonb)',
      [actor.id,'crm.export',actor.id,JSON.stringify({filters:f,rows:rows.length,total,truncated:total>limit})],
    );
    return {filename:'traksos-registry-'+new Date().toISOString().slice(0,10)+'.csv',
      csv:registryCsv(rows),count:rows.length,total,truncated:total>limit};
  }

  async saveMetadata(actor: AuthUser, userId: string, input: RegistryMetadata) {
    const exists = await this.db.one('select id from users where id=$1', [userId]);
    if(!exists) throw notFound('Участник не найден');
    const region = cleanText(input.region ?? undefined,80) || null;
    const city = cleanText(input.city ?? undefined,120) || null;
    const note = cleanText(input.note,2000);
    const tags = [...new Set((input.tags??[]).map(s=>cleanText(s,40)).filter(Boolean))].slice(0,12);
    await this.db.tx(async q=>{
      await q.query(`
        insert into admin_crm_profiles(user_id,region,city,tags,note,updated_by)
        values($1,$2,$3,$4::text[],$5,$6)
        on conflict(user_id) do update set region=excluded.region, city=excluded.city,
          tags=excluded.tags, note=excluded.note, updated_by=excluded.updated_by,updated_at=now()`,
        [userId,region,city,tags,note,actor.id]);
      await q.query('insert into audit_log(actor_id,action,target,data) values($1,$2,$3,$4::jsonb)',
        [actor.id,'crm.update',userId,JSON.stringify({region,city,tags,notesChanged:true})]);
    });
    return {ok:true};
  }
}
