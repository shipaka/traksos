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
export function checkLegacyPricingLocation(input:KnownLocation):LocationCheck {
  const {lat,lng}=input;
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
