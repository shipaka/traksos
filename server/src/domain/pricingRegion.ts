/**
 * Temporary P0 safety boundary until a licensed reverse geocoder and real
 * country-wide tariff zones are implemented. These are intentionally
 * conservative bounds, NOT a legal map of St Petersburg / Leningrad Oblast.
 * The only purpose is to reject obvious out-of-area use of the KAD pricing.
 *
 * No IP lookup, no fake accurate geocoding, no inference from highway names.
 */
export const legacyTariffScope={
  label:'Санкт-Петербург и Ленинградская область',
  bounds:{minLat:58.0,maxLat:62.0,minLng:27.0,maxLng:36.0},
  preciseBoundariesVerified:false,
  quoteAvailableOutsideScope:false
};
type KnownLocation={lat?:number|null;lng?:number|null;address?:string|null};
export type LocationCheck='outside'|'possible'|'unknown';
const otherCities=[
  'москва','московская область','калининград','владивосток','казань','ижевск',
  'новосибирск','екатеринбург','омск','самара','нижний новгород','челябинск',
  'красноярск','иркутск','якутск','хабаровск','псков','великий новгород',
  'петрозаводск','мурманск','ростов-на-дону','воронеж','пермь','уфа','сочи',
  'краснодар','тюмень','рязань','волгоград','тверь','саратов','орел','орёл',
  'белгород','тамбов','тольятти','симферополь','севастополь','архангельск',
  'норильск','махачкала','ульяновск','томск','чита','благовещенск'
];
function addressOutside(address:string):boolean {
  const text=address.trim().toLocaleLowerCase('ru-RU').replace(/ё/g,'е');
  const normalized=text.replace(/^россия\s*,?\s*/u,'').replace(/^(?:рф|российская федерация)\s*,?\s*/u,'')
    .replace(/^г(?:ород|\.)?\s+/u,'');
  return otherCities.some(name=>normalized===name||normalized.startsWith(name+',')||
    normalized.startsWith(name+' г.')||normalized.startsWith(name+' улица ')||
    normalized.startsWith(name+' ул.'));
}
export function checkLegacyPricingLocation(input:KnownLocation):LocationCheck {
  const {lat,lng}=input;
  // Prefer to reject contradictions rather than trust a spoofed in-zone coordinate.
  if(input.address?.trim()&&addressOutside(input.address))return 'outside';
  if(lat!=null||lng!=null){
    if(lat==null||lng==null||!Number.isFinite(lat)||!Number.isFinite(lng)||
      lat< -90||lat>90||lng< -180||lng>180)return 'outside';
    const b=legacyTariffScope.bounds;
    if(lat<b.minLat||lat>b.maxLat||lng<b.minLng||lng>b.maxLng)return 'outside';
    // Bounding boxes cannot confirm tariff membership, only a possibility.
    return 'possible';
  }
  const value=input.address?.trim().toLocaleLowerCase('ru-RU').replace(/ё/g,'е')??'';
  if(!value)return 'unknown';
  const normalized=value.replace(/^россия\s*,?\s*/u,'').replace(/^(?:рф|российская федерация)\s*,?\s*/u,'')
    .replace(/^г(?:ород|\.)?\s+/u,'');
  if(/^(?:санкт[\s-]?петербург|спб|питер)(?:[,\s.;№\d]|$)/u.test(normalized))return 'possible';
  const markedCity=normalized.match(/^г(?:ород|\.)?\s*([\p{L}\s-]+?)(?:,|;|$)/u);
  if(markedCity){
    // "г. Сосновый Бор" and other regional towns are not proof of being outside.
    // Their real inclusion must be confirmed by a future geocoder.
    if(otherCities.includes(markedCity[1].trim()))return 'outside';
  }
  for(const name of otherCities)if(normalized===name||normalized.startsWith(name+',')||
    normalized.startsWith(name+' г.')||normalized.startsWith(name+' улица ')||
    normalized.startsWith(name+' ул.'))return 'outside';
  return 'unknown';
}
/**
 * Explicit local town names are stronger evidence than the wide lat/lng box.
 * This still does NOT determine whether a street is inside the actual tariff polygon.
 * Only refuse an obviously wrong self-selected price zone, never silently re-price.
 */
const namedLegacyZones=[
  {place:'гатчина',zoneId:'gat'},
  {place:'тосно',zoneId:'tos'},
  {place:'выборг',zoneId:'vyb'},
  {place:'луга',zoneId:'lug'},
  {place:'кириши',zoneId:'kir'},
  {place:'усть-луга',zoneId:'ust'}
] as const;
function startsWithNamedPlace(address:string,place:string){
  return address===place||(address.startsWith(place)&&/^[,;.\\s№\\d]/u.test(address.slice(place.length)));
}
export function legacyTariffZoneMismatch(input:KnownLocation,zoneId:string){
  let address=input.address?.trim().toLocaleLowerCase('ru-RU').replace(/ё/g,'е')??'';
  address=address.replace(/^(?:россия|рф|российская федерация)\\s*,?\\s*/u,'')
    .replace(/^(?:ленинградская область|ленинградская обл\\.?|ленобласть|ло)\\s*,?\\s*/u,'')
    .replace(/^(?:г\\.?|город)\\s+/u,'');
  const found=namedLegacyZones.find(({place})=>startsWithNamedPlace(address,place));
  return found && found.zoneId!==zoneId ? {place:found.place,expectedZoneId:found.zoneId} : null;
}

export function legacyPricingWarning(input:KnownLocation){
  const status=checkLegacyPricingLocation(input);
  return {
    status,
    tariffScope:legacyTariffScope.label,
    validatedByGeocoder:false,
    manualConfirmationRequired:status==='unknown'||status==='possible',
    available:status!=='outside',
    message:status==='outside'
      ?'Для указанного региона пока нет подтверждённого тарифа выезда. Цены СПб/ЛО не применяются. Можно воспользоваться бесплатным Эфиром и посмотреть подтверждённых партнёров рядом.'
      :'Расчёт по тарифам СПб/ЛО предварительный: местонахождение и дорожный путь нужно подтвердить до выезда. Карта покрытия и цены других регионов ещё не подключены.'
  };
}
