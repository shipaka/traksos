/** Existing on-device photographic assets. Never pretend a model reference
 * is the user's actual truck; real photos require an owner-provided image.
 * No third-party hotlinks: this works in the APK with weak connectivity.
 */
import './vehicleVisual.css';

export function vehicleReferencePhoto(brand?:string|null,model?:string|null) {
  if (/^scania$/i.test((brand??'').trim()) && /^r\s?520\b/i.test((model??'').trim()))
    return {src:'/tracksos-approved-scania-r520.webp', description:'Пример Scania R520 — не фотография этой машины'};
  return {src:'/tracksos-hero-service-hq.webp',description:'Тематическая фотография грузовика — не фотография этой машины'};
}

export function VehiclePhotoLink({brand,model,plate,href,compact=false}:{
  brand?:string|null;model?:string|null;plate?:string|null;href:string;compact?:boolean
}) {
  const photo=vehicleReferencePhoto(brand,model);
  const description=[brand,model,plate].filter(Boolean).join(' ')||'Грузовой автомобиль';
  return <a className={'trak-vehicle-photo-link'+(compact?' compact':'')} href={href}
    aria-label={'Открыть карточку и историю автомобиля: '+description}>
    <img loading="lazy" src={photo.src} alt={photo.description}
      onError={e=>{
        const img=e.currentTarget;
        if(!img.src.endsWith('/tracksos-photo-master.webp')) img.src='/tracksos-photo-master.webp';
      }}/>
    <span className="trak-vehicle-photo-caption"><span>{description}</span>
      <small>Фото-иллюстрация · открыть историю автомобиля ›</small></span>
  </a>;
}
