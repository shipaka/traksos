/** Locally stored, license-checked truck model photographs.
 *
 * The source/author/license, generation and photographed year are recorded in
 * scripts/vehiclePhotoSources.json and visible under /vehicle-photo-credits.html.
 * No VIN, plate or user data ever leaves the app to look up a photograph.
 * IMPORTANT: NEVER infer a photo from a brand alone or choose a nearby model.
 */
export type VehiclePhoto = {
  src: string;
  description: string;
  author: string;
  license: string;
  sourcePage: string;
  generation: string;
};
type ModelRecord = VehiclePhoto & {
  brand: string;
  modelPattern: RegExp;
  yearMin: number;
  yearMax: number;
  yearRequired: boolean;
};

const DIR='/vehicles/models/';
const records: ReadonlyArray<ModelRecord> = [
  {
    brand:'renault',modelPattern:/^premium(?:\w*)$/,yearMin:2006,yearMax:2013,yearRequired:false,
    generation:'Premium (2006–2013)',src:DIR+'renault-premium-2006.webp',
    description:'Renault Premium (модель 2010 года; фото модели, не конкретной машины)',
    author:'selbst / Elkawe',license:'Public domain',
    sourcePage:'https://commons.wikimedia.org/wiki/File:Renault_Premium_(2010).JPG',
  },
  {
    brand:'daf',modelPattern:/^xf105(?:[0-9a-z]*)$/,yearMin:2005,yearMax:2015,yearRequired:false,
    generation:'XF105 (2005–2015)',src:DIR+'daf-xf105.webp',
    description:'DAF XF105 (фото модели, не конкретной машины)',
    author:'Alf van Beem',license:'CC0 1.0',
    sourcePage:'https://commons.wikimedia.org/wiki/File:DAF_FT_XF_105,_CTS_Group.JPG',
  },
  {
    brand:'man',modelPattern:/^tgx(?:[0-9a-z]*)$/,yearMin:2007,yearMax:2019,yearRequired:true,
    generation:'TGX (2007–2019)',src:DIR+'man-tgx-2007.webp',
    description:'MAN TGX поколения 2007–2019 (фото модели, не конкретной машины)',
    author:'Alf van Beem',license:'CC0 1.0',
    sourcePage:'https://commons.wikimedia.org/wiki/File:MAN_TGX,_Gunco,_HZ_Transport.JPG',
  },
  {
    brand:'mercedes-benz',modelPattern:/^actros(?:[0-9a-z]*)$/,yearMin:2017,yearMax:2021,yearRequired:true,
    generation:'Actros (2017–2021; фото грузовика с фургонным кузовом)',
    src:DIR+'mercedes-actros-2019.webp',
    description:'Mercedes-Benz Actros с фургонным кузовом (фото модели, не конкретной машины)',
    author:'dickinsonjohn02',license:'CC0 1.0',
    sourcePage:'https://commons.wikimedia.org/wiki/File:165-365_Mercedes_Actros.jpg',
  },
  {
    brand:'volvo',modelPattern:/^fh(?:(?!16)[0-9a-z]*)$/,yearMin:2013,yearMax:2020,yearRequired:true,
    generation:'FH (2013–2020)',src:DIR+'volvo-fh-2013.webp',
    description:'Volvo FH поколения 2013–2020 (фото модели, не конкретной машины)',
    author:'Raymondo166',license:'CC BY 2.5',
    sourcePage:'https://commons.wikimedia.org/wiki/File:New_Volvo_FH.jpg',
  },
  {
    brand:'scania',modelPattern:/^r520(?:[0-9a-z]*)$/,yearMin:2016,yearMax:2025,yearRequired:true,
    generation:'R520 Next Gen (2016–2025)',src:DIR+'scania-r520-2016.webp',
    description:'Scania R520 нового поколения (фото модели, не конкретной машины)',
    author:'Lav Ulv',license:'CC BY 2.0',
    sourcePage:'https://commons.wikimedia.org/wiki/File:Scania_Next_Gen_R_520_1.jpg',
  },
];

const key=(value:string|null|undefined)=>
  (value??'').normalize('NFKC').toLocaleLowerCase('ru-RU').replace(/ё/g,'е').replace(/[^a-zа-я0-9]/g,'');
export function canonicalVehicleBrand(brand:string|null|undefined):string {
  const k=key(brand);
  if(['mercedes','mercedesbenz','mercedesbenztrucks','мерседес','мерседесбенц'].includes(k)) return 'mercedes-benz';
  if(['рено','renaulttrucks'].includes(k))return 'renault';
  if(['скания'].includes(k))return 'scania';
  if(['ман'].includes(k))return 'man';
  if(['даф'].includes(k))return 'daf';
  if(['вольво'].includes(k))return 'volvo';
  return k;
}
export function vehicleReferencePhoto(
  brand?:string|null, model?:string|null, year?:number|string|null
):VehiclePhoto|null {
  const b=canonicalVehicleBrand(brand);
  const m=key(model);
  if(!b||!m)return null;
  const match=records.find(x=>x.brand===b&&x.modelPattern.test(m));
  if(!match)return null;
  const y=(typeof year==='number'||typeof year==='string')?Number(year):NaN;
  if(Number.isFinite(y)&&y>=1900&&y<=2100){
    if(y<match.yearMin||y>match.yearMax)return null;
  }else if(match.yearRequired)return null; // ambiguous truck generations: do not guess!
  return {src:match.src,description:match.description,author:match.author,
    license:match.license,sourcePage:match.sourcePage,generation:match.generation};
}
export const vehiclePhotoCoverage=records.map(x=>({brand:x.brand,generation:x.generation,
  src:x.src,license:x.license,author:x.author,sourcePage:x.sourcePage,
  yearMin:x.yearMin,yearMax:x.yearMax}));
