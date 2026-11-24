import type { Db, Queryable } from '../db/index.ts';
import { bad, conflict, forbidden, notFound, type AuthUser } from '../http/router.ts';
import {
  normalizeCatalog, normalizeAlias, vehicleCategoriesForContext, validateReferenceSelection,
  type CatalogSnapshotInput, type CatalogRoleContext, type VehicleCategory,
  type ReferenceBrand, type ReferenceModel, type ReferenceSelection,
} from '../domain/vehicleReference.ts';

interface SourceInput {
  key: string;
  name: string;
  originUrl: string;
  licenseName: string;
  licenseUrl: string;
  rightsEvidence: string;
}
interface SourceRow {
  source_key: string;
  source_name: string;
  origin_url: string;
  license_name: string;
  license_url: string;
  rights_evidence: string;
  redistribution_approved: boolean;
  state: 'pending' | 'approved' | 'revoked';
}
interface SnapshotRow {
  id: string; source_key: string; revision: string; content_sha256: string;
  brand_count: number; model_count: number; state: 'staged' | 'active' | 'retired';
}
interface BrandRow {
  category: VehicleCategory; key: string; name: string; aliases: string[]; source_key: string;
}
interface ModelRow {
  category: VehicleCategory; brand_key: string; key: string; name: string;
  aliases: string[]; year_from: number | null; year_to: number | null; source_key: string;
}

function requireAdmin(actor: AuthUser) {
  if (!actor?.roles?.includes('admin')) throw forbidden('Справочник транспорта редактирует только администратор');
}
async function requireLiveAdmin(q: Queryable, actor: AuthUser) {
  const row = await q.one<{id:string}>(
    "select id from users where id=$1 and status='active' and deleted_at is null "+
    "and 'admin'=any(roles) for share", [actor.id]);
  if (!row) throw forbidden('Справочник транспорта редактирует только администратор');
}
function slug(v: string) {
  if (typeof v !== 'string' || !/^[a-z0-9][a-z0-9_-]{1,63}$/.test(v))
    throw bad('vehicle_ref_key', 'Недопустимый идентификатор источника');
  return v;
}
function plain(v: string, min: number, max: number) {
  if (typeof v !== 'string' || !v.trim() || v.trim().length < min ||
      v.trim().length > max || /[\u0000-\u001f\u007f]/.test(v))
    throw bad('vehicle_ref_text', 'Недопустимые сведения об источнике');
  return v.trim();
}
function httpsUrl(v: string) {
  const raw = plain(v, 9, 500);
  let url: URL;
  try { url = new URL(raw); } catch { throw bad('vehicle_ref_url', 'Укажите HTTPS-адрес первоисточника и лицензии'); }
  if (url.protocol !== 'https:' || !url.hostname || url.username || url.password ||
      /^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.0\.0\.0)/.test(url.hostname))
    throw bad('vehicle_ref_url', 'Источники и лицензии должны ссылаться на публичный HTTPS-ресурс');
  return url.toString();
}
function permissionReason(s: string) {
  return plain(s, 10, 2000);
}
async function audit(q: Queryable, actor: AuthUser, action: string, target: string, data: object) {
  await q.query('insert into audit_log(actor_id,action,target,data) values ($1,$2,$3,$4)',
    [actor.id, action, target, data]);
}
async function history(q: Queryable, actor: AuthUser, sourceKey: string, snapshotId: string | null,
  eventKind: string, reason: string) {
  await q.query('insert into vehicle_ref_registry_events ' +
    '(source_key,snapshot_id,event_kind,reason,actor_id) values ($1,$2,$3,$4,$5)',
    [sourceKey, snapshotId, eventKind, reason, actor.id]);
}
function sourcePayload(source: SourceInput) {
  return {
    key: slug(source.key),
    name: plain(source.name, 2, 150),
    originUrl: httpsUrl(source.originUrl),
    licenseName: plain(source.licenseName, 2, 120),
    licenseUrl: httpsUrl(source.licenseUrl),
    rightsEvidence: plain(source.rightsEvidence, 20, 2000),
  };
}

/**
 * Admin-curated vehicle reference foundation. No public routes, VIN assertions,
 * stock matching, license presumptions or changes to existing garage records.
 * Uses PostgreSQL row locks to serialize publish/rollback per source.
 */
export class VehicleReferenceService {
  constructor(private readonly db: Db) {}

  async registerSource(actor: AuthUser, source: SourceInput) {
    requireAdmin(actor);
    const s = sourcePayload(source);
    return this.db.tx(async (q) => {
      await requireLiveAdmin(q, actor);
      const created = await q.one<SourceRow>(
        'insert into vehicle_ref_sources ' +
        '(source_key,source_name,origin_url,license_name,license_url,rights_evidence,created_by) ' +
        'values ($1,$2,$3,$4,$5,$6,$7) on conflict (source_key) do nothing returning *',
        [s.key, s.name, s.originUrl, s.licenseName, s.licenseUrl, s.rightsEvidence, actor.id]);
      const row = created ?? await q.one<SourceRow>(
        'select * from vehicle_ref_sources where source_key=$1', [s.key]);
      if (!row || row.source_name !== s.name || row.origin_url !== s.originUrl ||
          row.license_name !== s.licenseName || row.license_url !== s.licenseUrl ||
          row.rights_evidence !== s.rightsEvidence)
        throw conflict('vehicle_ref_source_collision', 'Такой источник уже зарегистрирован с другими условиями');
      if (created) {
        await history(q, actor, s.key, null, 'source_registered',
          'Источник зарегистрирован; импорт и публикация запрещены до проверки прав');
        await audit(q, actor, 'vehicle_ref_source_registered', s.key, { licenseName: s.licenseName });
      }
      return row;
    });
  }

  async approveSource(actor: AuthUser, sourceKey: string, approvalReason: string) {
    requireAdmin(actor);
    const key = slug(sourceKey);
    const reason = permissionReason(approvalReason);
    return this.db.tx(async (q) => {
      await requireLiveAdmin(q, actor);
      const row = await q.one<SourceRow>(
        'select * from vehicle_ref_sources where source_key=$1 for update', [key]);
      if (!row) throw notFound('Источник не зарегистрирован');
      if (row.state === 'revoked') throw conflict('vehicle_ref_source_revoked', 'Отозванный источник нельзя включить повторно');
      if (row.state === 'approved') return row;
      // The approving administrator attests review; code cannot grant rights by itself.
      const approved = await q.one<SourceRow>(
        "update vehicle_ref_sources set state='approved',redistribution_approved=true," +
        'approved_by=$2,approved_at=now() where source_key=$1 returning *', [key, actor.id]);
      await history(q, actor, key, null, 'source_approved', reason);
      await audit(q, actor, 'vehicle_ref_source_approved', key, { rightsEvidenceReviewed: true, reason });
      return approved;
    });
  }

  async revokeSource(actor: AuthUser, sourceKey: string, reasonInput: string) {
    requireAdmin(actor);
    const key = slug(sourceKey);
    const reason = permissionReason(reasonInput);
    return this.db.tx(async (q) => {
      await requireLiveAdmin(q, actor);
      const source = await q.one<SourceRow>(
        'select * from vehicle_ref_sources where source_key=$1 for update', [key]);
      if (!source) throw notFound('Источник не зарегистрирован');
      if (source.state === 'revoked') return { revoked: true, alreadyRevoked: true };
      await q.query("update vehicle_ref_snapshots set state='retired', retired_at=now() " +
        "where source_key=$1 and state='active'", [key]);
      await q.query("update vehicle_ref_sources set state='revoked', redistribution_approved=false," +
        'revoked_by=$2,revoked_at=now(),revoked_reason=$3 where source_key=$1',
      [key, actor.id, reason]);
      await history(q, actor, key, null, 'source_revoked', reason);
      await audit(q, actor, 'vehicle_ref_source_revoked', key, { reason });
      return { revoked: true, alreadyRevoked: false };
    });
  }

  async stageSnapshot(actor: AuthUser, sourceKey: string, sourceInput: CatalogSnapshotInput) {
    requireAdmin(actor);
    const key = slug(sourceKey);
    let normalized: ReturnType<typeof normalizeCatalog>;
    try { normalized = normalizeCatalog(sourceInput); }
    catch (error) { throw bad('vehicle_ref_invalid_snapshot', (error as Error).message); }
    return this.db.tx(async (q) => {
      await requireLiveAdmin(q, actor);
      const source = await q.one<SourceRow>(
        'select * from vehicle_ref_sources where source_key=$1 for update', [key]);
      if (!source || source.state !== 'approved' || !source.redistribution_approved)
        throw forbidden('Источник не допущен к хранению и распространению справочных данных');
      const created = await q.one<SnapshotRow>(
        'insert into vehicle_ref_snapshots ' +
        '(source_key,revision,content_sha256,brand_count,model_count,created_by) ' +
        'values ($1,$2,$3,$4,$5,$6) on conflict (source_key,revision) do nothing returning *',
        [key, normalized.sourceRevision, normalized.sha256, normalized.brandCount, normalized.modelCount, actor.id]);
      const row = created ?? await q.one<SnapshotRow>(
        'select * from vehicle_ref_snapshots where source_key=$1 and revision=$2',
        [key, normalized.sourceRevision]);
      if (!row) throw conflict('vehicle_ref_import_missing', 'Импорт не был сохранён');
      if (row.content_sha256 !== normalized.sha256)
        throw conflict('vehicle_ref_revision_collision', 'Эта версия уже существует с другим содержимым');
      if (created) {
        const brands = normalized.brands.map((b) => ({
          category: b.category, brand_key: b.key, display_name: b.name, aliases: b.aliases,
        }));
        const models = normalized.brands.flatMap((b) => b.models.map((m) => ({
          category: b.category, brand_key: b.key, model_key: m.key,
          display_name: m.name, aliases: m.aliases, year_from: m.yearFrom, year_to: m.yearTo,
        })));
        // PostgreSQL bulk insert. Each catalogue revision is immutable.
        await q.query('insert into vehicle_ref_brands(snapshot_id,category,brand_key,display_name,aliases) ' +
          'select $1::uuid,x.category,x.brand_key,x.display_name,x.aliases ' +
          'from jsonb_to_recordset($2::jsonb) as x(category text,brand_key text,display_name text,aliases text[])',
          [row.id, JSON.stringify(brands)]);
        await q.query('insert into vehicle_ref_models ' +
          '(snapshot_id,category,brand_key,model_key,display_name,aliases,year_from,year_to) ' +
          'select $1::uuid,x.category,x.brand_key,x.model_key,x.display_name,x.aliases,x.year_from,x.year_to ' +
          'from jsonb_to_recordset($2::jsonb) as x(' +
          'category text,brand_key text,model_key text,display_name text,aliases text[],year_from int,year_to int)',
          [row.id, JSON.stringify(models)]);
        await history(q, actor, key, row.id, 'revision_staged',
          'Импорт подготовлен в закрытой базе без публикации');
        await audit(q, actor, 'vehicle_ref_revision_staged', row.id,
          { sourceKey: key, revision: normalized.sourceRevision, digest: normalized.sha256,
            brandCount: brands.length, modelCount: models.length });
      }
      return { id: row.id, sourceKey: key, revision: row.revision,
        contentSha256: row.content_sha256, state: row.state,
        brandCount: Number(row.brand_count), modelCount: Number(row.model_count) };
    });
  }

  /** A count check alone cannot detect changed names, aliases, year ranges
   * or substituted models. Rebuild the exact canonical import and verify the
   * stored SHA-256 BEFORE publishing or accepting an already active revision.
   */
  private async assertSnapshotIntegrity(q: Queryable, selected: SnapshotRow) {
    type StoredBrand = { category: VehicleCategory; key:string; name:string; aliases:string[] };
    type StoredModel = { category:VehicleCategory; brand_key:string; key:string; name:string;
      aliases:string[]; year_from:number|null; year_to:number|null };
    const [brands,models] = await Promise.all([
      q.query<StoredBrand>(
        'select category,brand_key as key,display_name as name,aliases ' +
        'from vehicle_ref_brands where snapshot_id=$1 order by category,brand_key',
        [selected.id]),
      q.query<StoredModel>(
        'select category,brand_key,model_key as key,display_name as name,aliases,year_from,year_to ' +
        'from vehicle_ref_models where snapshot_id=$1 order by category,brand_key,model_key',
        [selected.id]),
    ]);
    if (brands.length!==Number(selected.brand_count) || models.length!==Number(selected.model_count))
      throw conflict('vehicle_ref_integrity','Количество строк снимка отличается от утверждённого');
    const byBrand=new Map<string, StoredModel[]>();
    for (const model of models) {
      const id=model.category+':'+model.brand_key;
      const group=byBrand.get(id)??[];
      group.push(model);
      byBrand.set(id,group);
    }
    let rebuilt:ReturnType<typeof normalizeCatalog>;
    try {
      rebuilt=normalizeCatalog({
        sourceRevision:selected.revision,
        brands:brands.map((b)=>({
          category:b.category,key:b.key,name:b.name,aliases:b.aliases,
          models:(byBrand.get(b.category+':'+b.key)??[]).map((m)=>({
            key:m.key,name:m.name,aliases:m.aliases,
            yearFrom:m.year_from,yearTo:m.year_to,
          })),
        })),
      });
    } catch {
      throw conflict('vehicle_ref_integrity','Содержимое снимка повреждено или нарушает формат');
    }
    if (rebuilt.sha256!==selected.content_sha256 ||
        rebuilt.brandCount!==brands.length || rebuilt.modelCount!==models.length)
      throw conflict('vehicle_ref_integrity','SHA-256 снимка не совпадает с сохранёнными строками');
  }

  async activateSnapshot(actor: AuthUser, sourceKey: string, revision: string, reasonInput: string) {
    requireAdmin(actor);
    const key = slug(sourceKey);
    const reason = permissionReason(reasonInput);
    const rev = plain(revision, 1, 100);
    return this.db.tx(async (q) => {
      await requireLiveAdmin(q, actor);
      const source = await q.one<SourceRow>(
        'select * from vehicle_ref_sources where source_key=$1 for update', [key]);
      if (!source || source.state !== 'approved' || !source.redistribution_approved)
        throw forbidden('Источник не допущен к публикации');
      const selected = await q.one<SnapshotRow>(
        'select * from vehicle_ref_snapshots where source_key=$1 and revision=$2 for update', [key, rev]);
      if (!selected) throw notFound('Версия справочника не найдена');
      await this.assertSnapshotIntegrity(q, selected);
      if (selected.state === 'active') return { revision: rev, unchanged: true };
      await q.query("update vehicle_ref_snapshots set state='retired',retired_at=now() " +
        "where source_key=$1 and state='active'", [key]);
      await q.query("update vehicle_ref_snapshots set state='active',published_by=$2," +
        "published_at=now(),retired_at=null where id=$1", [selected.id, actor.id]);
      await history(q, actor, key, selected.id,
        selected.state === 'retired' ? 'revision_restored' : 'revision_published', reason);
      await audit(q, actor, 'vehicle_ref_revision_activated', selected.id,
        { sourceKey: key, revision: rev, restored: selected.state === 'retired', reason });
      return { revision: rev, id: selected.id, unchanged: false };
    });
  }

  async listSources(actor: AuthUser) {
    requireAdmin(actor);
    return this.db.tx(async q => {
      await requireLiveAdmin(q, actor);
      return q.query<SourceRow>('select * from vehicle_ref_sources order by source_key');
    });
  }
  async listVersions(actor: AuthUser, sourceKey: string) {
    requireAdmin(actor);
    const key = slug(sourceKey);
    return this.db.tx(async q => {
      await requireLiveAdmin(q, actor);
      return q.query<SnapshotRow>(
        'select * from vehicle_ref_snapshots where source_key=$1 order by created_at desc,id', [key]);
    });
  }

  private checkContext(actor: AuthUser, context: CatalogRoleContext) {
    if (!actor || !actor.roles?.length ||
        (!actor.roles.includes('admin') && !actor.roles.includes(context))) {
      throw forbidden('Выбранная роль не принадлежит учётной записи');
    }
  }

  async brands(actor: AuthUser, context: CatalogRoleContext,
    options: { includeHeavy?: boolean; workflow?: 'garage' | 'parts' | 'insurance' | 'inspection' | 'repair'; q?: string } = {}, db: Queryable = this.db) {
    this.checkContext(actor, context);
    const categories = vehicleCategoriesForContext(context, options);
    const q = normalizeAlias((options.q ?? '').normalize('NFKC').trim().slice(0, 80));
    const records = await db.query<BrandRow>(
      'select b.category,b.brand_key as key,b.display_name as name,b.aliases,s.source_key ' +
      'from vehicle_ref_brands b join vehicle_ref_snapshots v on v.id=b.snapshot_id ' +
      'join vehicle_ref_sources s on s.source_key=v.source_key ' +
      "where v.state='active' and s.state='approved' and s.redistribution_approved=true " +
      'and b.category=any($1::text[]) order by b.category,b.brand_key,s.source_key limit 10000',
      [categories]);
    const map = new Map<string, BrandRow & { sources: string[]; conflict: boolean }>();
    const matches = new Set<string>();
    for (const r of records) {
      const id = r.category + ':' + r.key;
      if (!q || [r.name, ...r.aliases].some((name) => normalizeAlias(name).includes(q))) matches.add(id);
      const found = map.get(id);
      if (!found) map.set(id, { ...r, sources: [r.source_key], conflict: false });
      else {
        found.sources.push(r.source_key);
        if (found.name !== r.name) found.conflict = true;
      }
    }
    return [...map.entries()].filter(([id]) => matches.has(id)).map(([, value]) => value).sort((a, b) =>
      a.category.localeCompare(b.category) || a.name.localeCompare(b.name, 'ru'));
  }

  async models(actor: AuthUser, context: CatalogRoleContext, category: VehicleCategory,
    brandKey: string, options: { includeHeavy?: boolean; workflow?: 'garage' | 'parts' | 'insurance' | 'inspection' | 'repair'; year?: number | null; q?: string } = {}, db: Queryable = this.db) {
    this.checkContext(actor, context);
    const categories = vehicleCategoriesForContext(context, options);
    if (!categories.includes(category)) throw forbidden('Категория не разрешена в выбранном сценарии');
    const brand = slug(brandKey);
    const year = options.year ?? null;
    if (year != null && (!Number.isInteger(year) || year < 1900 || year > 2100))
      throw bad('vehicle_ref_year', 'Некорректный год');
    const q = normalizeAlias((options.q ?? '').slice(0, 80));
    const rows = await db.query<ModelRow>(
      'select m.category,m.brand_key,m.model_key as key,m.display_name as name,m.aliases,' +
      'm.year_from,m.year_to,s.source_key ' +
      'from vehicle_ref_models m join vehicle_ref_snapshots v on v.id=m.snapshot_id ' +
      'join vehicle_ref_sources s on s.source_key=v.source_key ' +
      "where v.state='active' and s.state='approved' and s.redistribution_approved=true " +
      'and m.category=$1 and m.brand_key=$2 ' +
      'order by m.model_key,s.source_key limit 10000',
      [category, brand]);
    const map = new Map<string, ModelRow & { sources: string[]; conflict: boolean }>();
    const matches = new Set<string>();
    for (const r of rows) {
      const yearMatches = year == null || ((r.year_from == null || r.year_from <= year) &&
        (r.year_to == null || r.year_to >= year));
      if (yearMatches && (!q || [r.name, ...r.aliases].some((name) => normalizeAlias(name).includes(q))))
        matches.add(r.key);
      const found = map.get(r.key);
      if (!found) map.set(r.key, { ...r, sources: [r.source_key], conflict: false });
      else {
        found.sources.push(r.source_key);
        if (found.name !== r.name || found.year_from !== r.year_from ||
            found.year_to !== r.year_to) found.conflict = true;
      }
    }
    // Search and year filters select keys, not individual source rows: a
    // conflicting source must never silently disappear from the result.
    return [...map.entries()].filter(([key]) => matches.has(key)).map(([, value]) => value)
      .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  }

  async validateSelection(actor: AuthUser, context: CatalogRoleContext, selection: ReferenceSelection,
    options: { includeHeavy?: boolean; workflow?: 'garage' | 'parts' | 'insurance' | 'inspection' | 'repair' } = {}) {
    return this.db.tx(async db => {
    // A concurrent revision switch or rights revocation must not mix rows
    // from two snapshots into a single verified selection.
    await db.query('set transaction isolation level repeatable read, read only');
      const brands = await this.brands(actor, context, options, db);
      const brand = brands.find((b) => b.key === selection.brandKey && b.category === selection.category);
      if (brand?.conflict) throw conflict('vehicle_ref_brand_conflict', 'Название марки различается между источниками');
      const models = await this.models(actor, context, selection.category, selection.brandKey,
        { ...options, year: selection.year }, db);
      const model = models.find((m) => m.key === selection.modelKey);
      if (model?.conflict) throw conflict('vehicle_ref_model_conflict', 'Описание модели различается между источниками');
      // The brand and the model must be supported by the SAME approved source.
      // A composite "brand from A, model from B" must never claim to be an
      // attested catalogue entry for A. Pick a deterministic common source.
      const common = model && brand ? model.sources.filter((key) => brand.sources.includes(key)).sort() : [];
      if (brand && model && !common.length)
        throw conflict('vehicle_ref_provenance_conflict','Марка и модель не подтверждены одним источником');
      try {
        const selectedEntry=validateReferenceSelection(brands, models.map((m): ReferenceModel =>
          ({ category: m.category, brandKey: m.brand_key, key: m.key, name: m.name, aliases: m.aliases,
            yearFrom: m.year_from, yearTo: m.year_to, sourceKey: m.source_key })), selection);
        return {
          ...selectedEntry,
          brand:{...selectedEntry.brand,sourceKey:common[0]},
          model:{...selectedEntry.model,sourceKey:common[0]},
        };
      } catch (e) {
        throw bad('vehicle_ref_selection_invalid', (e as Error).message);
      }
    });
  }
}
