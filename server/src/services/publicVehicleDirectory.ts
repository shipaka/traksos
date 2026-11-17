import { readFile } from 'node:fs/promises';
import type { AuthUser } from '../http/router.ts';
import { bad, forbidden } from '../http/router.ts';
import { normalizeAlias, type VehicleCategory } from '../domain/vehicleReference.ts';
import { vehicleOwnerShelf } from './vehicleOwnerShelf.ts';

// Pin one legally reusable open-data release. The archived upstream licence
// and FULL upstream notices ship alongside this JSON and must appear in the UI.
export type DirectoryCategory = VehicleCategory;
type MakeRow = [key: string, name: string, categories: DirectoryCategory[]];
type ModelRow = [category: DirectoryCategory, makeKey: string, modelKey: string, name: string];
interface DirectoryFile {
  dataset: string;
  sourceVersion: string;
  sourceBlobSha: string;
  license: string;
  licenseUrl: string;
  attributionUrl: string;
  importedAt: string;
  makes: MakeRow[];
  models: ModelRow[];
}
const catalogPath = new URL('../../data/vehiclesdb_2026_11_11.json', import.meta.url);
interface TruckEvidenceRecord {
 makeKey: string; modelKey: string; registrationFirst: number | null;
 registrationLast: number | null; productionStart: number | null;
 productionEnd: number | null; productionStatus: string | null;
 citedCountries: string[]; citedSourceIds: string[];
 regionCodes: string[]; officialAliases: string[];
}
interface TruckEvidenceFile {
 sourceVersion: string;truckModelsSha: string;license: string;records: TruckEvidenceRecord[];
}
let truckCache: Promise<TruckEvidenceFile> | undefined;
async function truckData() {
 truckCache ??= readFile(new URL('../../data/vehiclesdb_truck_evidence_2026_11_11.json',import.meta.url),'utf8')
   .then(text=>JSON.parse(text) as TruckEvidenceFile)
   .catch(err=>{truckCache=undefined;throw err});
 return truckCache;
}
let cached: Promise<DirectoryFile> | undefined;
async function dataset() {
  cached ??= readFile(catalogPath, 'utf8').then((text) => JSON.parse(text) as DirectoryFile)
    .catch((e) => { cached = undefined; throw e; });
  return cached;
}
const NON_PUBLIC_SERVICE_CATEGORY: DirectoryCategory[] = ['passenger', 'van'];
const TRUCK_CATEGORIES: DirectoryCategory[] = ['truck', 'trailer', 'van', 'bus'];
const ALL_CATEGORIES: DirectoryCategory[] = ['passenger', 'truck', 'trailer', 'van', 'bus'];
export type CatalogPurpose = 'garage' | 'master' | 'tow' | 'service' | 'insurance' | 'parts' | 'admin';
export function categoriesForActor(user: AuthUser, purpose: CatalogPurpose, masterHeavy = false): DirectoryCategory[] {
  if (!user || user.status !== 'active') throw forbidden('Требуется действующий аккаунт');
  const roles = user.roles ?? [];
  const admin = roles.includes('admin');
  const hasAny = (...r: string[]) => admin || r.some((x) => roles.includes(x));
  if (purpose === 'admin' && !admin) throw forbidden('Только администратору');
  if (purpose === 'garage' && !hasAny('client', 'driver')) throw forbidden('Гараж доступен клиентам и водителям');
  if (purpose === 'master' && !hasAny('master')) throw forbidden('Нужна роль мастера');
  if (purpose === 'tow' && !hasAny('tow')) throw forbidden('Нужна роль эвакуаторщика');
  if (purpose === 'service' && !hasAny('service', 'master')) throw forbidden('Нужна роль СТО или мастера');
  if (purpose === 'insurance' && !hasAny('insurer', 'inspection_operator', 'client', 'driver'))
    throw forbidden('Недостаточно прав');
  if (purpose === 'parts' && !hasAny('client', 'driver', 'master', 'service'))
    throw forbidden('Недостаточно прав');
  if (purpose === 'tow') return ['truck']; // Recovery vehicle rigs only; never all trucks or trailers.
  if (purpose === 'garage') return TRUCK_CATEGORIES;
  if (purpose === 'master') return masterHeavy ? ALL_CATEGORIES : NON_PUBLIC_SERVICE_CATEGORY;
  return ALL_CATEGORIES;
}
function limitSearch(q?: string) {
  return normalizeAlias((q ?? '').slice(0, 90));
}
export function publishedAttribution() {
  return {
    label: 'Vehicle data by VehiclesDB',
    url: 'https://vehiclesdb.com',
    license: 'CC BY 4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
    upstreamNotices: '/api/vehicle-reference/attribution',
    note: 'Данные открытых государственных реестров, не VIN-проверка и не подтверждение комплектации.',
  };
}
export class PublicVehicleDirectory {
  async metadata() {
    const [d,shelf] = await Promise.all([dataset(),vehicleOwnerShelf()]);
    return { source: d.dataset, version: d.sourceVersion, sourceBlobSha: d.sourceBlobSha,
      count: d.models.length+shelf.rows.length, brandCount: d.makes.length,
      supplementalCount:shelf.rows.length,recoveryOnlyCount:shelf.recovery.length,
      categories: ALL_CATEGORIES,
      supplementalNotice:shelf.notice,attribution: publishedAttribution() };
  }
  async makes(user: AuthUser, purpose: CatalogPurpose, q = '', masterHeavy = false, category?: DirectoryCategory) {
    if (category && !categoriesForActor(user,purpose,masterHeavy).includes(category))
      throw forbidden('Категория недоступна для этой роли');
    const categories = categoriesForActor(user, purpose, masterHeavy);
    const [data,shelf] = await Promise.all([dataset(),vehicleOwnerShelf()]);
    const term = limitSearch(q);
    const allMakes:MakeRow[] = purpose==='tow'
      ? shelf.recovery.reduce<MakeRow[]>((out,r)=> {
          if (!out.some(m=>m[0]===r.makeKey)) out.push([r.makeKey,r.make,['truck']]);
          return out;
        },[])
      : data.makes.map(([key,name,types])=>[key,name,[...types]] as MakeRow);
    if(purpose!=='tow') for(const r of shelf.rows){
      const found=allMakes.find(m=>m[0]===r.makeKey);
      if(found){if(!found[2].includes(r.category))found[2]=[...found[2],r.category];}
      else allMakes.push([r.makeKey,r.make,[r.category]]);
    }
    const makes = allMakes.flatMap(([key, name, available]) => categories
      .filter((cat) => available.includes(cat) && (!category || cat===category))
      .map((category) => ({ key, name, category })))
      .filter((x) => !term || normalizeAlias(x.name).includes(term) || normalizeAlias(x.key).includes(term))
      .sort((a, b) => a.name.localeCompare(b.name, 'ru') || a.category.localeCompare(b.category));
    return { items: makes.slice(0, 150), total: makes.length, hasMore: makes.length > 150,
      attribution: publishedAttribution() };
  }
  async models(user: AuthUser, purpose: CatalogPurpose,
    category: DirectoryCategory, makeKey: string, q = '', masterHeavy = false) {
    const allowed = categoriesForActor(user, purpose, masterHeavy);
    if (!allowed.includes(category)) throw forbidden('Категория транспорта недоступна для этой роли');
    const [data,shelf] = await Promise.all([dataset(),vehicleOwnerShelf()]);
    const term = limitSearch(q);
    const supplement = purpose==='tow'
      ? shelf.recovery.map(r=>['truck',r.makeKey,r.modelKey,r.model] as ModelRow)
      : shelf.rows.map(r=>[r.category,r.makeKey,r.modelKey,r.model] as ModelRow);
    const allModels=purpose==='tow'?supplement:[...data.models,...supplement];
    const knownMake=purpose==='tow'?shelf.recovery.some(r=>r.makeKey===makeKey)
      : data.makes.some(r=>r[0]===makeKey&&r[2].includes(category))
        || shelf.rows.some(r=>r.makeKey===makeKey&&r.category===category);
    if (!knownMake) throw bad('catalog_make_unknown', 'Марка отсутствует в подтверждённом каталоге');
    const matches = allModels.filter((m) => m[0] === category && m[1] === makeKey &&
      (!term || normalizeAlias(m[3]).includes(term) || normalizeAlias(m[2]).includes(term)));
    const knownDisplay=purpose==='tow'?shelf.recovery.find(r=>r.makeKey===makeKey)?.make:
      data.makes.find(r=>r[0]===makeKey)?.[1]??shelf.rows.find(r=>r.makeKey===makeKey)?.make;
    return { make: { key: makeKey, name: knownDisplay??makeKey, category },
      items: matches.slice(0, 200).map((m) => ({ key: m[2], name: m[3], yearFrom: null, yearTo: null })),
      total: matches.length, hasMore: matches.length > 200,
      yearsUnverified: true, attribution: publishedAttribution() };
  }
  async truckEvidence(actor: AuthUser,purpose:CatalogPurpose,makeKey:string,modelKey:string) {
    if(!categoriesForActor(actor,purpose,true).includes('truck'))
      throw forbidden('Грузовой справочник недоступен выбранной роли');
    await this.resolve('truck',makeKey,modelKey);
    const full=await truckData();
    const row=full.records.find((r)=>r.makeKey===makeKey&&r.modelKey===modelKey);
    return {
      source:'VehiclesDB',sourceVersion:full.sourceVersion,license:full.license,
      attribution:publishedAttribution(),
      category:'truck',brandKey:makeKey,modelKey,
      production:row?.productionStart ? {yearFrom:row.productionStart,yearTo:row.productionEnd,
        status:row.productionStatus,confidence:'source_lifecycle'} : null,
      registrationEvidence:row?.registrationFirst ? {
        firstRegistrationObserved:row.registrationFirst,
        lastRegistrationObserved:row.registrationLast,
        countryCodes:row.citedCountries,
        sourceIds:row.citedSourceIds,
        notProductionYears:true
      } : null,
      applicabilityVerified:false,vehicleVariantVerified:false,
      note:'Первичная регистрация в реестре НЕ доказывает год производства или серию. Версию двигателя, EBS и электрику необходимо сверить по VIN на заводском портале.',
    };
  }
  async resolve(category: DirectoryCategory, makeKey: string, modelKey: string) {
    const [d,shelf] = await Promise.all([dataset(),vehicleOwnerShelf()]);
    const manual = shelf.rows.find(r=>r.category===category&&r.makeKey===makeKey&&r.modelKey===modelKey);
    if(manual)return {category,brandKey:makeKey,modelKey,brand:manual.make,model:manual.model,
      source:'verified_manufacturer_name',sourceVersion:shelf.version,
      yearsVerified:false,partsFitmentVerified:false};
    const make = d.makes.find((m) => m[0] === makeKey && m[2].includes(category));
    const model = d.models.find((m) => m[0] === category && m[1] === makeKey && m[2] === modelKey);
    if (!make || !model) throw bad('catalog_selection_unknown', 'Выберите марку и модель из подтверждённого каталога');
    return { category, brandKey: makeKey, modelKey,
      brand: make[1], model: model[3], source: d.dataset,
      sourceVersion: d.sourceVersion, yearsVerified: false, partsFitmentVerified: false };
  }
}
