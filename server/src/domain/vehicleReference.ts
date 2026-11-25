import { createHash } from 'node:crypto';

/**
 * Vehicle-reference domain. This is a versioned, licensed, curated catalogue,
 * not VIN decoding, vehicle identity proof or automatic parts compatibility.
 * Never populate it by copying a third-party site without rights approval.
 */
export const VEHICLE_CATEGORIES = ['truck', 'trailer', 'bus', 'van', 'passenger'] as const;
export type VehicleCategory = typeof VEHICLE_CATEGORIES[number];
export type CatalogRoleContext = 'client' | 'driver' | 'master' | 'tow' | 'service' | 'insurer' | 'inspection_operator' | 'admin';

export interface CatalogModelInput {
  key: string;
  name: string;
  aliases?: string[];
  yearFrom?: number | null;
  yearTo?: number | null;
}
export interface CatalogBrandInput {
  category: VehicleCategory;
  key: string;
  name: string;
  aliases?: string[];
  models: CatalogModelInput[];
}
export interface CatalogSnapshotInput {
  sourceRevision: string;
  brands: CatalogBrandInput[];
}
export interface NormalizedModel {
  key: string;
  name: string;
  aliases: string[];
  yearFrom: number | null;
  yearTo: number | null;
}
export interface NormalizedBrand {
  category: VehicleCategory;
  key: string;
  name: string;
  aliases: string[];
  models: NormalizedModel[];
}
export interface NormalizedCatalog {
  sourceRevision: string;
  brands: NormalizedBrand[];
  brandCount: number;
  modelCount: number;
  sha256: string;
}

export function catalogDigest(payload: unknown): string {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}
export function normalizeAlias(text: string): string {
  // Normalize spaces and Unicode, but never turn a fuzzy matching guess into a verified VIN.
  return text.normalize('NFKC').toLocaleLowerCase('ru-RU').replace(/\s+/g, ' ').trim();
}
function field(value: unknown, max = 120): string {
  if (typeof value !== 'string') throw new Error('catalog_text_required');
  const result = value.normalize('NFKC').replace(/\s+/g, ' ').trim();
  if (!result || result.length > max || /[\u0000-\u001f\u007f]/u.test(result))
    throw new Error('catalog_text_invalid');
  return result;
}
function slug(value: unknown): string {
  const result = field(value, 64);
  if (!/^[a-z0-9][a-z0-9_-]{1,63}$/.test(result)) throw new Error('catalog_key_invalid');
  return result;
}
function aliases(input: unknown, canonical: string): string[] {
  if (input == null) return [];
  if (!Array.isArray(input) || input.length > 30) throw new Error('catalog_alias_list_invalid');
  const set = new Set<string>();
  for (const item of input) {
    const alias = field(item, 120);
    if (normalizeAlias(alias) === normalizeAlias(canonical)) continue;
    const fingerprint = normalizeAlias(alias);
    if (set.has(fingerprint)) throw new Error('catalog_alias_duplicate');
    set.add(fingerprint);
  }
  return [...set].sort();
}
function year(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1900 || value > 2100)
    throw new Error('catalog_year_invalid');
  return value;
}
/** Canonical ordering makes semantically equivalent JSON imports idempotent. */
export function normalizeCatalog(input: CatalogSnapshotInput): NormalizedCatalog {
  if (!input || !Array.isArray(input.brands) || input.brands.length < 1 || input.brands.length > 1500)
    throw new Error('catalog_brands_range');
  const sourceRevision = field(input.sourceRevision, 100);
  const seenBrands = new Set<string>();
  const brandAliases = new Map<VehicleCategory, Map<string, string>>();
  let modelCount = 0;
  const result: NormalizedBrand[] = [];
  for (const raw of input.brands) {
    if (!VEHICLE_CATEGORIES.includes(raw.category)) throw new Error('catalog_category_invalid');
    const key = slug(raw.key);
    const name = field(raw.name);
    const brandId = raw.category + ':' + key;
    if (seenBrands.has(brandId)) throw new Error('catalog_brand_duplicate');
    seenBrands.add(brandId);
    const brandNames = brandAliases.get(raw.category) ?? new Map<string, string>();
    for (const value of [name, ...aliases(raw.aliases, name)]) {
      const normalized = normalizeAlias(value);
      const owner = brandNames.get(normalized);
      if (owner && owner !== key) throw new Error('catalog_ambiguous_brand_alias');
      brandNames.set(normalized, key);
    }
    brandAliases.set(raw.category, brandNames);
    if (!Array.isArray(raw.models) || raw.models.length < 1 || raw.models.length > 1000)
      throw new Error('catalog_models_range');
    const seenModels = new Set<string>();
    const seenModelAliases = new Map<string, string>();
    const models: NormalizedModel[] = [];
    for (const model of raw.models) {
      const mk = slug(model.key);
      if (seenModels.has(mk)) throw new Error('catalog_model_duplicate');
      seenModels.add(mk);
      const modelName = field(model.name);
      const modelAliases = aliases(model.aliases, modelName);
      const yearFrom = year(model.yearFrom);
      const yearTo = year(model.yearTo);
      if (yearFrom && yearTo && yearFrom > yearTo) throw new Error('catalog_year_range_invalid');
      for (const nameVariant of [modelName, ...modelAliases]) {
        const variant = normalizeAlias(nameVariant);
        const owner = seenModelAliases.get(variant);
        if (owner && owner !== mk) throw new Error('catalog_ambiguous_model_alias');
        seenModelAliases.set(variant, mk);
      }
      models.push({ key: mk, name: modelName, aliases: modelAliases, yearFrom, yearTo });
    }
    modelCount += models.length;
    if (modelCount > 12000) throw new Error('catalog_too_many_models');
    models.sort((a, b) => a.key.localeCompare(b.key, 'en'));
    result.push({ category: raw.category, key, name, aliases: aliases(raw.aliases, name), models });
  }
  result.sort((a, b) =>
    a.category.localeCompare(b.category, 'en') || a.key.localeCompare(b.key, 'en'));
  const canonical = { sourceRevision, brands: result };
  return { ...canonical, brandCount: result.length, modelCount, sha256: catalogDigest(canonical) };
}

/**
 * Contextual defaults only; does not modify a real user's permitted services.
 * An existing heavy-truck master remains eligible when their work context
 * explicitly requests includeHeavy, even though passenger is the UI default.
 */
export function vehicleCategoriesForContext(
  role: CatalogRoleContext, opts: { includeHeavy?: boolean; workflow?: 'garage' | 'parts' | 'insurance' | 'inspection' | 'repair' } = {},
): VehicleCategory[] {
  if (!['client','driver','master','tow','service','insurer','inspection_operator','admin'].includes(role))
    throw new Error('catalog_role_invalid');
  if (opts.workflow === 'insurance' || opts.workflow === 'inspection' || opts.workflow === 'parts')
    return [...VEHICLE_CATEGORIES];
  if (role === 'client' || role === 'driver' || role === 'tow')
    return ['truck', 'trailer', 'bus', 'van'];
  if (role === 'master')
    return opts.includeHeavy ? [...VEHICLE_CATEGORIES] : ['passenger', 'van'];
  return [...VEHICLE_CATEGORIES];
}
export interface ReferenceSelection {
  category: VehicleCategory;
  brandKey: string;
  modelKey: string;
  year?: number | null;
}
export interface ReferenceBrand {
  category: VehicleCategory;
  key: string;
  name: string;
  aliases: string[];
  sourceKey?: string;
}
export interface ReferenceModel {
  category: VehicleCategory;
  brandKey: string;
  key: string;
  name: string;
  aliases: string[];
  yearFrom: number | null;
  yearTo: number | null;
  sourceKey?: string;
}

/**
 * Strict two-stage selection: only keys from the *same* approved snapshot.
 * Aliases can be searched but are not used to assert make/model on behalf of
 * the user; VIN compatibility, assembly and engine swaps stay unverified.
 */
export function validateReferenceSelection(
  brands: ReferenceBrand[], models: ReferenceModel[], selected: ReferenceSelection,
): { brand: ReferenceBrand; model: ReferenceModel; verifiedCatalogReference: true; vinDecoded: false; partsFitmentVerified: false } {
  if (!VEHICLE_CATEGORIES.includes(selected.category)) throw new Error('catalog_category_invalid');
  if (selected.year != null && (typeof selected.year !== 'number' || !Number.isInteger(selected.year) ||
    selected.year < 1900 || selected.year > 2100)) throw new Error('catalog_year_invalid');
  const brand = brands.find((b) => b.category === selected.category && b.key === selected.brandKey);
  if (!brand) throw new Error('catalog_brand_unknown');
  const model = models.find((m) => m.category === selected.category &&
    m.brandKey === brand.key && m.key === selected.modelKey);
  if (!model) throw new Error('catalog_model_unknown_or_wrong_brand');
  if (selected.year != null && (model.yearFrom != null && selected.year < model.yearFrom ||
    model.yearTo != null && selected.year > model.yearTo))
    throw new Error('catalog_year_outside_model_range');
  return { brand, model, verifiedCatalogReference: true, vinDecoded: false, partsFitmentVerified: false };
}
