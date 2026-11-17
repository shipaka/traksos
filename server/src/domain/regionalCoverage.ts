/**
 * Release gate for the ONLY geographic tariffs that are configured today.
 *
 * Region is the customer's explicit declaration, zone is a SEPARATE explicit
 * price selection. Neither IP nor a GPS point silently picks a zone.
 *
 * These bounding boxes and city-centre tolerances are coarse ANTI-MISMATCH
 * checks, NOT geocoding or precise KAD boundaries. All displayed amounts are
 * preliminary until a performer and the client agree on the real call-out.
 * Do not extend to other regions by reusing Saint Petersburg prices.
 */
import { haversineKm } from './geo.ts';

export type ServiceRegion = 'spb' | 'lo' | 'other';
export interface CoverageInput {
  service: string;
  regionId?: ServiceRegion | null;
  zoneId?: string | null;
  address?: string | null;
  city?: string | null;
  lat?: number | null;
  lng?: number | null;
}

export class CoverageError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name='CoverageError'; }
}
const invalid = (code: string, message: string): never => { throw new CoverageError(code,message); };

const SPB_ZONES = new Set(['spb']);
const LO_ZONES = new Set(['kad30','gat','tos','vyb','lug','kir','ust']);
const CITY_POINTS: Record<string, { name: string; lat: number; lng: number; stem: RegExp }> = {
  gat: { name:'Гатчина', lat:59.576, lng:30.129, stem:/гатчин/i },
  tos: { name:'Тосно', lat:59.540, lng:30.877, stem:/тосн/i },
  vyb: { name:'Выборг', lat:60.714, lng:28.757, stem:/выборг/i },
  lug: { name:'Луга', lat:58.737, lng:29.847, stem:/(?:^|[\s,])луг(?:а|и|е|ой|у)?(?=$|[\s,.])/i },
  kir: { name:'Кириши', lat:59.448, lng:32.021, stem:/кириш/i },
  ust: { name:'Усть-Луга', lat:59.665, lng:28.284, stem:/усть[-\s]?луг/i },
};
const SPB_PATTERN = /(?:санкт[-\s]?петербург|спб|\bspb\b|с[.]?\s?петербург)/i;
const LO_PATTERN = /(?:ленинградск\S*\s+област|\bленобласт\S*)/i;
// Explicit incompatible locations: fail closed even when the user/client also
// supplies a spoofed Petersburg point. This is NOT a nationwide geocoder.
const OTHER_PATTERN = /(?:^|[\s,])(?:москва|москвы|москве|москву|москвой|калининград(?:а|е|ом)?|владивосток(?:а|е|ом)?|новосибирск(?:а|е|ом)?|екатеринбург(?:а|е|ом)?|краснодар(?:а|е|ом)?|хабаровск(?:а|е|ом)?|казань|казани)(?=$|[\s,.])|(?:московск\S*\s+област|приморск\S*\s+край|калининградск\S*\s+област)/i;
const SPB_CENTER = {lat:59.934, lng:30.315};

function inside(lat:number,lng:number,range:{south:number;north:number;west:number;east:number}) {
  // This is only a country/region consistency check, not proof of KAD membership.
  return lat >= range.south && lat <= range.north && lng >= range.west && lng <= range.east;
}
const SPB_ENVELOPE = {south:59.65,north:60.25,west:29.35,east:31.00};
const LO_ENVELOPE = {south:58.15,north:61.65,west:27.05,east:36.9};

export function assertRegionalTariff(i: CoverageInput, requireSite = false) {
  if (i.service === 'consult') return;
  if (i.regionId == null)
    invalid('region_required','Выберите регион местонахождения машины отдельно от тарифной зоны');
  if (i.regionId === 'other')
    invalid('manual_quote_required','Для вашего региона тариф выезда ещё не утверждён. Стоимость и доступность нужно согласовать отдельно — не оплачивайте выезд по тарифу КАД');
  if (i.regionId !== 'spb' && i.regionId !== 'lo')
    invalid('bad_region','Неизвестный регион обращения');
  const zone = i.zoneId?.trim();
  if (!zone || !(i.regionId === 'spb' ? SPB_ZONES : LO_ZONES).has(zone))
    invalid('region_zone_mismatch','Тарифная зона не соответствует выбранному региону: проверьте место выезда');

  const hasLat = i.lat !== null && i.lat !== undefined;
  const hasLng = i.lng !== null && i.lng !== undefined;
  if (hasLat !== hasLng) invalid('invalid_location','Для точки на карте нужны обе координаты');
  if (hasLat && hasLng && (!Number.isFinite(i.lat!) || !Number.isFinite(i.lng!) ||
      Math.abs(i.lat!) > 90 || Math.abs(i.lng!) > 180))
    invalid('invalid_location','Координаты места выезда недействительны');
  const gps = hasLat && hasLng;
  const address = i.address?.trim() ?? '';
  const statedPlace = [i.city?.trim(), address].filter(Boolean).join(', ');
  if (requireSite && !gps && address.length < 3)
    invalid('location_required','Укажите адрес или координаты автомобиля');

  // Do not trust a declared region when the typed street/city explicitly says otherwise.
  if (address && OTHER_PATTERN.test(statedPlace))
    invalid('address_region_mismatch','Адрес находится за пределами действующих тарифных зон СПб и Ленобласти');
  if (i.regionId === 'lo' && SPB_PATTERN.test(statedPlace) && !LO_PATTERN.test(statedPlace))
    invalid('address_region_mismatch','В адресе указан Санкт-Петербург, а выбран регион Ленобласть');
  if (i.regionId === 'spb' && LO_PATTERN.test(statedPlace) && !SPB_PATTERN.test(statedPlace))
    invalid('address_region_mismatch','В адресе указана Ленобласть, а выбран Санкт-Петербург');

  // Without a geocoder, address-only orders must identify the locality,
  // otherwise it is impossible to show the SPb/KAD tariff honestly.
  if (!gps && address) {
    if (i.regionId === 'spb' && !SPB_PATTERN.test(statedPlace))
      invalid('location_unverified','Для заявки без GPS укажите в адресе Санкт-Петербург');
    if (i.regionId === 'lo') {
      const locality = CITY_POINTS[zone!];
      if (locality && !locality.stem.test(statedPlace))
        invalid('location_unverified',`В адресе без GPS укажите населённый пункт: ${locality.name}`);
      if (zone === 'kad30' && !LO_PATTERN.test(statedPlace))
        invalid('location_unverified','Для зоны за КАД без GPS укажите Ленинградскую область в адресе');
    }
  }

  // A named town must not be priced as another town or as the KAD ring.
  if (statedPlace) {
    const statedTown = Object.entries(CITY_POINTS).find(([,city])=>city.stem.test(statedPlace))?.[0];
    if (statedTown && statedTown !== zone)
      invalid('address_zone_mismatch','Указанный город не совпадает с выбранной тарифной зоной');
    if (i.regionId === 'spb' && statedTown)
      invalid('address_zone_mismatch','Выберите тарифную зону указанного города, а не Санкт-Петербурга');
  }

  if (gps) {
    const bounds = i.regionId === 'spb' ? SPB_ENVELOPE : LO_ENVELOPE;
    if (!inside(i.lat!,i.lng!,bounds))
      invalid('outside_coverage','GPS-точка за пределами текущего тарифного покрытия. Нужна индивидуальная смета');
    if (zone === 'kad30' && haversineKm({lat:i.lat!,lng:i.lng!},SPB_CENTER)>83)
      invalid('zone_location_mismatch','Точка слишком далеко от КАД для выбранной тарифной зоны');
    const town=CITY_POINTS[zone!];
    if (town && haversineKm({lat:i.lat!,lng:i.lng!},town)>33)
      invalid('zone_location_mismatch',`Координаты не соответствуют зоне «${town.name}»`);
    // Inner Petersburg is not the LO zone "up to 30 km beyond KAD".
    if (zone === 'kad30' && haversineKm({lat:i.lat!,lng:i.lng!},SPB_CENTER)<4)
      invalid('region_zone_mismatch','Точка в центре Санкт-Петербурга не соответствует зоне за КАД');
  }
}

export const REGIONAL_COVERAGE_NOTE = 'Тариф предварительный: регион и зона выбраны вручную. Координаты не подтверждают точную границу КАД; окончательные стоимость и подача согласуются с исполнителем.';
