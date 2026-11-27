/** A clickable truck picture leading to THAT vehicle's authorized history.
 * The underlying pictures are license-checked local WebP assets selected ONLY
 * by make+model+appropriate generation/year. Never use remote URL guesses,
 * registration plate, VIN or unknown "similar" truck photos as lookup keys.
 */
import { useState } from 'react';
import { vehicleReferencePhoto, vehicleFamilyReferencePhoto, type VehiclePhoto } from './vehiclePhotoCatalog.ts';
export { vehicleReferencePhoto } from './vehiclePhotoCatalog.ts';
import './vehicleVisual.css';

type PhotoState = 'loading'|'loaded'|'failed';
type ModelProps = {brand?:string|null;model?:string|null;year?:number|string|null;className?:string;familyExample?:boolean};
function PhotoImage({photo,description,className='',state,onState}:{
  photo:VehiclePhoto|null;description:string;className?:string;state:PhotoState;onState:(state:PhotoState)=>void
}) {
  if (!photo || state==='failed') {
    const message=photo ? 'Не удалось загрузить фото модели' : 'Точное фото модели пока не добавлено';
    return <span className={'trak-vehicle-no-photo '+className} role="img"
      aria-label={message+': '+description}>
      <span className="trak-vehicle-no-photo-icon" aria-hidden="true">▤</span>
      <span>{message}</span>
    </span>;
  }
  return <img className={className} loading="lazy" src={photo.src} alt={photo.description}
    onLoad={()=>onState('loaded')} onError={()=>onState('failed')} />;
}
function ModelImage({photo,description,className}:{photo:VehiclePhoto|null;description:string;className?:string}){
  const [state,setState]=useState<PhotoState>('loading');
  return <PhotoImage photo={photo} description={description} className={className} state={state} onState={setState}/>;
}
export function VehicleModelPhoto({brand,model,year,className='',familyExample=false}:ModelProps){
  const photo=vehicleReferencePhoto(brand,model,year)??(familyExample?vehicleFamilyReferencePhoto(brand,model,year):null);
  // A different source remounts the load state and cannot inherit an old error.
  return <ModelImage key={photo?.src??'missing'} photo={photo} description={[brand,model,year].filter(Boolean).join(' ')} className={className}/>;
}

function LinkedPhoto({photo,family,description,href,compact}:{
  photo:VehiclePhoto|null;family:boolean;description:string;href:string;compact:boolean
}){
  const [state,setState]=useState<PhotoState>('loading');
  const caption=!photo?'Фото для этой модели пока нет':
    state==='failed'?'Не удалось загрузить фото модели':
    state==='loading'?'Загрузка фото модели…':
    family?'Пример семейства Scania R: R520, не точная модификация':'Фото соответствующей модели, не вашей машины';
  return <div className="trak-vehicle-photo-wrap">
    <a className={'trak-vehicle-photo-link'+(compact?' compact':'')} href={href}
      aria-label={'Открыть карточку и историю автомобиля: '+description}>
      <PhotoImage photo={photo} description={description} state={state} onState={setState}/>
      <span className="trak-vehicle-photo-caption">
        <span>{description}</span>
        <small>{caption} · открыть историю автомобиля ›</small>
      </span>
    </a>
    {photo && state==='loaded' && <a href="/vehicle-photo-credits.html" target="_blank" rel="noopener noreferrer"
      className="trak-vehicle-photo-credits">Источник и лицензия фотографии</a>}
  </div>;
}
export function VehiclePhotoLink({brand,model,year,plate,href,compact=false}:{
  brand?:string|null;model?:string|null;year?:number|string|null;
  plate?:string|null;href:string;compact?:boolean
}){
  const exact=vehicleReferencePhoto(brand,model,year);
  const family=exact?null:vehicleFamilyReferencePhoto(brand,model,year);
  const photo=exact??family;
  const description=[brand,model,year,plate].filter(Boolean).join(' ')||'Грузовой автомобиль';
  return <LinkedPhoto key={photo?.src??'missing'} photo={photo} family={!!family} description={description} href={href} compact={compact}/>;
}
