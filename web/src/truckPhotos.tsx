import { useEffect, useState } from 'react';

// Иллюстрации марки, НЕ фотографии автомобиля пользователя. Источники и лицензии проверены.
// При отсутствии марки или недоступности Wikimedia карточка остаётся полностью рабочей.
const PHOTOS = [
  { names: ['scania', 'скания'], src: 'https://upload.wikimedia.org/wikipedia/commons/6/63/Scania_R.jpg',
    source: 'https://commons.wikimedia.org/wiki/File:Scania_R.jpg', author: 'Geremetta Moreno', license: 'Public domain' },
  { names: ['volvo', 'вольво'], src: 'https://upload.wikimedia.org/wikipedia/commons/e/e0/Volvo_FH_truck.jpg',
    source: 'https://commons.wikimedia.org/wiki/File:Volvo_FH_truck.jpg', author: 'Klever / Boivie', license: 'Public domain' },
  { names: ['daf', 'даф'], src: 'https://upload.wikimedia.org/wikipedia/commons/9/9b/DAF_-_XF.JPG',
    source: 'https://commons.wikimedia.org/wiki/File:DAF_-_XF.JPG', author: 'selbst', license: 'Public domain' },
  { names: ['man', 'ман'], src: 'https://upload.wikimedia.org/wikipedia/commons/0/0f/MAN_TGX.jpg',
    source: 'https://commons.wikimedia.org/wiki/File:MAN_TGX.jpg', author: 'MAN SE', license: 'CC BY 3.0' },
] as const;

function photoFor(brand: string | null | undefined) {
  const normalized = String(brand ?? '').toLowerCase().trim();
  return PHOTOS.find((photo) => photo.names.some((name) => normalized === name || normalized.startsWith(name + ' ')));
}

export function TruckPhoto({ brand }: { brand?: string | null }) {
  const photo = photoFor(brand);
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [photo?.src]);
  if (!photo || failed) return null;
  return (
    <img src={photo.src} alt={`Пример грузовика марки ${brand}, не фотография вашей машины`}
      loading="lazy" decoding="async" onError={() => setFailed(true)}
      style={{ width: 72, height: 55, objectFit: 'cover', borderRadius: 8, flexShrink: 0 }} />
  );
}

export function TruckPhotoCredit({ brand }: { brand?: string | null }) {
  const photo = photoFor(brand);
  if (!photo) return null;
  return <span className="note">Фото для примера: <a href={photo.source} target="_blank" rel="noopener noreferrer">{photo.author} · Wikimedia Commons · {photo.license}</a></span>;
}
