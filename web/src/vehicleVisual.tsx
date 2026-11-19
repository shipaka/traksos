/** A clickable truck picture leading to THAT vehicle's authorized history.
 * The underlying pictures are license-checked local WebP assets selected ONLY
 * by make+model+appropriate generation/year. Never use remote URL guesses,
 * registration plate, VIN or unknown "similar" truck photos as lookup keys.
 */
import { useEffect, useState } from 'react';
import { vehicleReferencePhoto } from './vehiclePhotoCatalog.ts';
export { vehicleReferencePhoto } from './vehiclePhotoCatalog.ts';
import './vehicleVisual.css';

export function VehicleModelPhoto({ brand, model, year, className = '' }: {
  brand?: string | null; model?: string | null; year?: number|string|null; className?: string;
}) {
  const photo = vehicleReferencePhoto(brand, model, year);
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [photo?.src]);
  if (!photo || failed) {
    return <span className={'trak-vehicle-no-photo ' + className} role="img"
      aria-label={'Проверенное фото модели ' + [brand, model, year].filter(Boolean).join(' ') + ' пока не добавлено'}>
      <span className="trak-vehicle-no-photo-icon" aria-hidden="true">▤</span>
      <span>Точное фото модели пока не добавлено</span>
    </span>;
  }
  return <img className={className} loading="lazy" src={photo.src} alt={photo.description}
    onError={() => setFailed(true)} />;
}

export function VehiclePhotoLink({brand,model,year,plate,href,compact=false}:{
  brand?:string|null;model?:string|null;year?:number|string|null;
  plate?:string|null;href:string;compact?:boolean
}) {
  const photo=vehicleReferencePhoto(brand,model,year);
  const description=[brand,model,year,plate].filter(Boolean).join(' ')||'Грузовой автомобиль';
  return <a className={'trak-vehicle-photo-link'+(compact?' compact':'')} href={href}
    aria-label={'Открыть карточку и историю автомобиля: '+description}>
    <VehicleModelPhoto brand={brand} model={model} year={year}/>
    <span className="trak-vehicle-photo-caption">
      <span>{description}</span>
      <small>{photo ? 'Фото соответствующей модели, не вашей машины'
        : 'Фото для этой модели пока нет'} · открыть историю автомобиля ›</small>
    </span>
  </a>;
}
