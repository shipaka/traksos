import { readFile } from 'node:fs/promises';

export type ShelfCategory = 'truck' | 'trailer';
export type ShelfRow = {
  category:ShelfCategory;makeKey:string;make:string;modelKey:string;model:string;
  bodyKind:string|null;sourceUrl:string;yearFrom:number|null;yearTo:number|null;variantVerified:false;
};
export type RecoveryRow = {
  makeKey:string;make:string;modelKey:string;model:string;chassisModel:string;
  bodyType:'heavy_wrecker';configuration:string;sourceUrl:string;note:string;
};
type Photo = {
  category:ShelfCategory;makeKey:string;modelKey:string;match:'family';
  label:string;file:string;author:string;license:string;licenseUrl:string;checkedOn:string;
};
type Guide = {
  category:ShelfCategory;makeKey:string;modelKeys:string[];title:string;
  url:string;requiresVin:boolean;languageNote:string;
};
type RecoveryPhoto = {makeKey:string;file:string;author:string;license:string;licenseUrl:string;
  caption:string;specificModelVerified:false;sourcePage:string};
type Data = {
  version:string;status:string;notice:string;rows:ShelfRow[];recovery:RecoveryRow[];
  recoveryMedia:RecoveryPhoto[];media:Photo[];guides:Guide[];
};
let pending:Promise<Data>|undefined;
export function vehicleOwnerShelf() {
  pending ??= readFile(new URL('../../data/vehicle_owner_shelf_2026_11_17.json',import.meta.url),'utf8')
    .then(s=>JSON.parse(s) as Data).catch(e=>{pending=undefined;throw e});
  return pending;
}
function commonsFilePage(file:string) {
  return 'https://commons.wikimedia.org/wiki/File:'+encodeURIComponent(file.replaceAll(' ','_'));
}
function commonsPreview(file:string) {
  return 'https://commons.wikimedia.org/wiki/Special:Redirect/file/'+encodeURIComponent(file)+'?width=640';
}
/** Public operator literature and visual identification only. NEVER returns professional repair resources. */
export async function publicVehicleCard(category:string,makeKey:string,modelKey:string) {
  const data=await vehicleOwnerShelf();
  const photo=data.media.find(p=>p.category===category&&p.makeKey===makeKey&&p.modelKey===modelKey);
  const guides=data.guides.filter(g=>g.category===category&&g.makeKey===makeKey&&
    (!g.modelKeys.length||g.modelKeys.includes(modelKey)));
  const local=data.rows.find(r=>r.category===category&&r.makeKey===makeKey&&r.modelKey===modelKey);
  return {
    version:data.version,
    scope:'operator_only',
    notice:'Эксплуатация и безопасность. Конкретный год, предохранители и комплектацию сверяйте по VIN и руководству изготовителя.',
    vehicleKind:local?.bodyKind??null,
    photo:photo ? {
      src:commonsPreview(photo.file),sourcePage:commonsFilePage(photo.file),
      caption:photo.label,confidence:photo.match,author:photo.author,
      license:photo.license,licenseUrl:photo.licenseUrl,checkedOn:photo.checkedOn,
      note:'Иллюстрация семейства, не подтверждение комплектации и не фотография вашей машины.'
    } : null,
    manuals:guides.map(g=>({title:g.title,url:g.url,requiresVin:g.requiresVin,
      note:g.languageNote,origin:'official_manufacturer_link'})),
    sections:[
      {key:'identification',title:'Модель и документы',text:'Уточните точное исполнение, заводскую табличку, VIN и год по документам своей техники.'},
      {key:'safe-use',title:'Безопасная эксплуатация',text:'Перед использованием сверяйтесь с инструкцией производителя и предупреждениями на самой машине.'},
      {key:'routine',title:'Ежедневная проверка',text:'Проверяйте по оригинальному руководству: жидкости, индикаторы, колёса, крепление груза и оборудование.'}
    ],
    noVehicleSpecificFuseLayout:true,
    repairSchematicsIncluded:false
  };
}

/** Illustrations of tow-truck BODY TYPES, intentionally not linked as photos of the chosen model. */
export async function publicRecoveryGallery() {
  const d=await vehicleOwnerShelf();
  return {scope:'recovery_category_examples',modelMatch:'not_verified',
    notice:'Примеры реально существующих эвакуаторов. Это НЕ фотографии выбранной модификации: подтверждайте фото шасси, надстройку, VIN и паспорт грузоподъёмности.',
    items:d.recoveryMedia.map(p=>({makeKey:p.makeKey,src:commonsPreview(p.file),sourcePage:p.sourcePage,
      caption:p.caption,author:p.author,license:p.license,licenseUrl:p.licenseUrl,
      specificModelVerified:false}))};
}
