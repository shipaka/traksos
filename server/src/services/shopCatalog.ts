// Offline-friendly reference catalog for heavy trucks and trailers.
// Records have no sale price. Bulk imports are never published automatically.
import type { Db } from '../db/index.ts';
import type { SettingsService } from './settings.ts';
import { bad, notFound, type AuthUser } from '../http/router.ts';
import { SHOP_CATEGORIES } from './shop.ts';

export interface CatalogEntryInput {
  brand: string;
  article: string;
  name: string;
  category: string;
  searchTerms?: string | null;
}
export interface CatalogBatchInput {
  sourceNote: string;
  rightsConfirmed: boolean;
  dryRun: boolean;
  rows: CatalogEntryInput[];
}
interface Validated extends CatalogEntryInput {
  brandKey: string;
  articleKey: string;
  searchTerms: string | null;
}

const key = (text: string) => text.trim().replace(/\s+/g, ' ').toLocaleUpperCase('ru-RU');

function validateEntries(batch: CatalogBatchInput): Validated[] {
  if (!batch.rightsConfirmed) throw bad('rights_not_confirmed', 'Подтвердите право на использование данных');
  if (batch.sourceNote.trim().length < 3) throw bad('source_required', 'Укажите происхождение каталога');
  if (!batch.rows.length || batch.rows.length > 200) throw bad('batch_size', 'От 1 до 200 позиций за запрос');
  const seen = new Set<string>();
  return batch.rows.map((r, index) => {
    const brand = r.brand.trim().replace(/\s+/g, ' ');
    const article = r.article.trim().replace(/\s+/g, ' ');
    const name = r.name.trim().replace(/\s+/g, ' ');
    const searchTerms = r.searchTerms?.trim() || null;
    if (!brand || brand.length > 80 || article.length < 2 || article.length > 100 ||
        name.length < 2 || name.length > 120 || (searchTerms?.length ?? 0) > 400 ||
        !Object.prototype.hasOwnProperty.call(SHOP_CATEGORIES, r.category)) {
      throw bad('invalid_catalog_entry', `Проверьте бренд, артикул, название и категорию в строке ${index + 1}`);
    }
    const brandKey = key(brand);
    const articleKey = key(article);
    const identity = JSON.stringify([brandKey, articleKey]);
    if (seen.has(identity)) throw bad('duplicate_catalog_entry', `Повтор артикула в загружаемой партии: ${brand} / ${article}`);
    seen.add(identity);
    return { brand, article, name, category: r.category, searchTerms, brandKey, articleKey };
  });
}

export class ShopCatalogService {
  constructor(private db: Db, private settings: SettingsService) {}

  async importBatch(actor: AuthUser, batch: CatalogBatchInput) {
    const rows = validateEntries(batch);
    const sourceNote = batch.sourceNote.trim();
    return this.db.tx(async (q) => {
      const args: string[] = [];
      const params: string[] = [];
      for (const row of rows) {
        params.push(row.brandKey, row.articleKey);
        const n = params.length;
        args.push(`($${n - 1},$${n})`);
      }
      const existing = await q.query<{ brand_key: string; article_key: string }>(
        `select brand_key, article_key from shop_catalog_entries
          where (brand_key, article_key) in (values ${args.join(',')})`, params);
      const present = new Set(existing.map((r) => JSON.stringify([r.brand_key, r.article_key])));
      const newRows = rows.filter((r) => !present.has(JSON.stringify([r.brandKey, r.articleKey]))).length;
      if (batch.dryRun) return { dryRun: true, processed: rows.length, newRows,
        existingRows: rows.length - newRows, published: 0 };

      // Keep each batch atomic. Repeated identical file uploads do not undo prior review.
      // Changes to the reference (including its provenance) invalidate old verification.
      for (const r of rows) {
        await q.query(`insert into shop_catalog_entries(
          brand, article, brand_key, article_key, name, category, search_terms, source_note, updated_by)
          values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
          on conflict (brand_key, article_key) do update set
            brand=excluded.brand, article=excluded.article, name=excluded.name,
            category=excluded.category, search_terms=excluded.search_terms,
            source_note=excluded.source_note, reviewed=false, reviewed_by=null,
            reviewed_at=null, updated_by=excluded.updated_by, updated_at=now()
          where (shop_catalog_entries.brand, shop_catalog_entries.article,
                 shop_catalog_entries.name, shop_catalog_entries.category,
                 shop_catalog_entries.search_terms, shop_catalog_entries.source_note)
             is distinct from
                (excluded.brand, excluded.article, excluded.name, excluded.category,
                 excluded.search_terms, excluded.source_note)`,
          [r.brand, r.article, r.brandKey, r.articleKey, r.name, r.category,
            r.searchTerms, sourceNote, actor.id]);
      }
      await q.query('insert into audit_log(actor_id, action, target, data) values ($1,$2,$3,$4)',
        [actor.id, 'shop.catalog_import', null, { count: rows.length, newRows, sourceNote }]);
      return { dryRun: false, processed: rows.length, newRows,
        existingRows: rows.length - newRows, published: 0 };
    });
  }

  /** Small revision check for the reviewed, reference-only catalog. */
  async indexManifest() {
    const settings = await this.settings.get('shop');
    if (!settings.enabled) return { enabled: false, revision: '0', count: 0 };
    const count = await this.db.one<{ n: number }>(
      'select count(*)::int as n from shop_catalog_entries where reviewed=true');
    const latest = await this.db.one<{ revision: string }>(
      'select coalesce(max(seq),0)::text as revision from shop_catalog_reference_changes');
    return { enabled: true, revision: latest?.revision ?? '0', count: count?.n ?? 0 };
  }

  /** Snapshot: six small strings per entry, ordered by UUID for cursor paging. */
  async indexPage(after: string | null, limit = 750) {
    const settings = await this.settings.get('shop');
    if (!settings.enabled) return { enabled: false, rows: [], next: null };
    const take = Number.isFinite(limit) ? Math.max(1, Math.min(1000, Math.floor(limit))) : 750;
    const pages = await this.db.query<any>(
      `select id, category, brand, article, name, search_terms from shop_catalog_entries
       where reviewed=true and ($1::uuid is null or id>$1::uuid)
       order by id limit $2`, [after, take + 1]);
    const chunks = pages.slice(0, take);
    const next = pages.length > take ? chunks[chunks.length - 1].id : null;
    return {
      enabled: true,
      rows: chunks.map((p: any) => [p.id, p.category, p.brand, p.article, p.name, p.search_terms]),
      next,
    };
  }

  /** Deltas include explicit tombstones for revoked or deleted references. */
  async indexChanges(after: string, limit = 750) {
    const settings = await this.settings.get('shop');
    if (!settings.enabled) return { enabled: false, rows: [], next: null, revision: '0' };
    if (!/^\d{1,19}$/.test(after) || BigInt(after) > 9223372036854775807n)
      throw bad('bad_cursor', 'Неверная версия справочника');
    const take = Number.isFinite(limit) ? Math.max(1, Math.min(1000, Math.floor(limit))) : 750;
    const latest = await this.db.one<{ revision: string }>(
      'select coalesce(max(seq),0)::text as revision from shop_catalog_reference_changes');
    const revision = latest?.revision ?? '0';
    const events = await this.db.query<any>(
      `select c.seq::text as seq, c.entry_id, c.removed,
        p.id, p.reviewed, p.category, p.brand, p.article, p.name, p.search_terms
       from shop_catalog_reference_changes c
       left join shop_catalog_entries p on p.id=c.entry_id
       where c.seq>$1::bigint and c.seq<=$2::bigint
       order by c.seq limit $3`, [after, revision, take + 1]);
    const page = events.slice(0, take);
    return {
      enabled: true,
      rows: page.map((p: any) => p.removed || !p.reviewed || !p.id
        ? [p.seq, p.entry_id]
        : [p.seq, p.entry_id, p.category, p.brand, p.article, p.name, p.search_terms]),
      next: events.length > take ? page[page.length - 1].seq : null,
      revision,
    };
  }

  async stats() {
    const s = await this.db.one<{ total: number; approved: number; pending: number }>(
      `select count(*)::int as total, count(*) filter (where reviewed)::int as approved,
       count(*) filter (where not reviewed)::int as pending from shop_catalog_entries`);
    return s ?? { total: 0, approved: 0, pending: 0 };
  }

  async adminList(query: string, state: string, page = 0) {
    const take = 40;
    const offset = Number.isFinite(page) ? Math.min(1000, Math.max(0, Math.floor(page))) * take : 0;
    const filters: string[] = [];
    const params: unknown[] = [];
    if (state === 'pending' || state === 'approved') {
      params.push(state === 'approved');
      filters.push(`reviewed=$${params.length}`);
    }
    const terms = query.trim().slice(0, 100).split(/\s+/).filter(Boolean).slice(0, 5);
    for (const term of terms) {
      params.push(term);
      const p = '$' + params.length;
      filters.push(`(position(lower(${p}) in lower(name))>0
        or position(lower(${p}) in lower(brand))>0
        or position(lower(${p}) in lower(article))>0)`);
    }
    const where = filters.length ? 'where ' + filters.join(' and ') : '';
    const count = await this.db.one<{ n: number }>(
      `select count(*)::int as n from shop_catalog_entries ${where}`, params);
    const rows = await this.db.query(
      `select id, brand, article, name, category, search_terms as "searchTerms",
        source_note as "sourceNote", reviewed, updated_at as "updatedAt"
        from shop_catalog_entries ${where}
        order by reviewed asc, updated_at desc, id limit $${params.length + 1} offset $${params.length + 2}`,
      [...params, take, offset]);
    return { items: rows, total: count?.n ?? 0, page: offset / take, limit: take };
  }

  async review(actor: AuthUser, id: string, approved: boolean) {
    const row = await this.db.one<{ id: string; source_note: string }>(
      'select id, source_note from shop_catalog_entries where id=$1', [id]);
    if (!row) throw notFound('Позиция каталога не найдена');
    if (approved && row.source_note.trim().length < 3)
      throw bad('missing_provenance', 'Для публикации необходим источник проверки');
    await this.db.tx(async (q) => {
      await q.query(`update shop_catalog_entries set reviewed=$2,
        reviewed_by=case when $2 then $3::uuid else null end,
        reviewed_at=case when $2 then now() else null end,
        updated_at=now() where id=$1`, [id, approved, actor.id]);
      await q.query('insert into audit_log(actor_id, action, target, data) values ($1,$2,$3,$4)',
        [actor.id, 'shop.catalog_review', id, { reviewed: approved }]);
    });
    return { ok: true, reviewed: approved };
  }

  /** Confirmed catalog-only results are informational, never directly purchasable.
   * Storefront closure still blocks public discovery. */
  async search(query: string, category: string, page = 0) {
    const setting = await this.settings.get('shop');
    if (!setting.enabled) return { enabled: false, items: [], total: 0, page: 0, limit: 24 };
    if (category && category !== 'all' && !SHOP_CATEGORIES[category])
      throw bad('bad_category', 'Неизвестный раздел каталога');
    const params: unknown[] = [];
    const filters = ['reviewed=true'];
    if (category && category !== 'all') {
      params.push(category);
      filters.push(`category=$${params.length}`);
    }
    const terms = query.trim().slice(0, 100).split(/\s+/).filter(Boolean).slice(0, 8);
    for (const term of terms) {
      params.push(term);
      const p = '$' + params.length;
      filters.push(`(position(lower(${p}) in lower(name))>0 or
        position(lower(${p}) in lower(brand))>0 or
        position(lower(${p}) in lower(article))>0 or
        position(lower(${p}) in lower(coalesce(search_terms,'')))>0)`);
    }
    const where = filters.join(' and ');
    const safePage = Number.isFinite(page) ? Math.min(1000, Math.max(0, Math.floor(page))) : 0;
    const total = await this.db.one<{ n: number }>(
      `select count(*)::int as n from shop_catalog_entries where ${where}`, params);
    const items = await this.db.query(
      `select id, brand, article, name, category from shop_catalog_entries
       where ${where} order by name, brand, article, id limit $${params.length + 1}
       offset $${params.length + 2}`, [...params, 24, safePage * 24]);
    return { enabled: true, items, total: total?.n ?? 0, page: safePage, limit: 24 };
  }
}
