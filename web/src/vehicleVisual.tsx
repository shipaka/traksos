/** Photo truth rule (19 Nov): a vehicle card can show only a photo of the
 * exact make/model (or the owner's actual vehicle photo once supported).
 * An unrelated truck is NOT an acceptable visual fallback. Offline-first:
 * model photos are curated local assets, not remote model-name searches.
 *
 * Do not confuse this with the public promotional truck, whose manufacturer's
 * branding is intentionally absent and TrakSos is printed on the trailer.
 */
import { useEffect, useState } from 'react';
import './vehicleVisual.css';

type ModelPhoto = { src: string; description: string };
const normalized = (value: string | null | undefined) =>
  (value ?? '').toLocaleLowerCase('ru-RU').trim().replace(/\s+/g, ' ');

/** Add models here only after visually checking and licensing their exact photos.
 * A filename or a generic "truck" picture is not proof of model identity.
 */
const modelPhotos: ReadonlyArray<{ brand: string; model: RegExp; photo: ModelPhoto }> = [
  {
    brand: 'scania',
    model: /^r\s*520(?:\b|$)/i,
    photo: {
      src: '/tracksos-approved-scania-r520.webp',
      description: 'Пример Scania R520 — фотография этой модели, не конкретного автомобиля',
    },
  },
];

/** A missing/unverified model NEVER receives a photo of a different truck. */
export function vehicleReferencePhoto(brand?: string | null, model?: string | null): ModelPhoto | null {
  const b = normalized(brand);
  const m = normalized(model);
  if (!b || !m) return null;
  return modelPhotos.find(x => x.brand === b && x.model.test(m))?.photo ?? null;
}

export function VehicleModelPhoto({ brand, model, className = '' }: {
  brand?: string | null; model?: string | null; className?: string;
}) {
  const photo = vehicleReferencePhoto(brand, model);
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [photo?.src]);
  if (!photo || failed) {
    return <span className={'trak-vehicle-no-photo ' + className} role="img"
      aria-label={'Фотография модели ' + [brand, model].filter(Boolean).join(' ') + ' пока не добавлена'}>
      <span className="trak-vehicle-no-photo-icon" aria-hidden="true">▤</span>
      <span>Фото модели пока не добавлено</span>
    </span>;
  }
  return <img className={className} loading="lazy" src={photo.src} alt={photo.description}
    onError={() => setFailed(true)} />;
}

/** The photo/placeholder itself is a full-width link into authorized history. */
export function VehiclePhotoLink({brand,model,plate,href,compact=false}:{
  brand?:string|null;model?:string|null;plate?:string|null;href:string;compact?:boolean
}) {
  const photo=vehicleReferencePhoto(brand,model);
  const description=[brand,model,plate].filter(Boolean).join(' ')||'Грузовой автомобиль';
  return <a className={'trak-vehicle-photo-link'+(compact?' compact':'')} href={href}
    aria-label={'Открыть карточку и историю автомобиля: '+description}>
    <VehicleModelPhoto brand={brand} model={model}/>
    <span className="trak-vehicle-photo-caption">
      <span>{description}</span>
      <small>{photo ? 'Фото указанной модели, не этой машины' : 'Точное фото модели пока недоступно'} · открыть историю автомобиля ›</small>
    </span>
  </a>;
}
