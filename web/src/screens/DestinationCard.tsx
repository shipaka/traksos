import { useState } from 'react';

export type DestinationPoint = {
  lat: number | string | null | undefined;
  lng: number | string | null | undefined;
  address?: string | null;
  name?: string | null;
};

export function DestinationCard({ point, title = 'Точка назначения' }: {
  point: DestinationPoint;
  title?: string;
}) {
  const [copyError, setCopyError] = useState(false);
  const valid = point.lat != null && point.lng != null
    && String(point.lat).trim() !== '' && String(point.lng).trim() !== ''
    && Number.isFinite(Number(point.lat)) && Number.isFinite(Number(point.lng))
    && Math.abs(Number(point.lat)) <= 90 && Math.abs(Number(point.lng)) <= 180;
  if (!valid) return null;
  const lat = Number(point.lat);
  const lng = Number(point.lng);
  const coordinates = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
  const copy = async () => {
    setCopyError(false);
    if (!navigator.clipboard?.writeText) {
      window.prompt('Скопируйте координаты:', coordinates);
      return;
    }
    try {
      await navigator.clipboard.writeText(coordinates);
    } catch {
      setCopyError(true);
      window.prompt('Скопируйте координаты:', coordinates);
    }
  };
  return <section className="stack" aria-label={title}>
    <b>{title}</b>
    {point.name && <span>{point.name}</span>}
    {point.address && <span className="note">{point.address}</span>}
    <span className="note">Широта, долгота · точная точка</span>
    <strong style={{ fontVariantNumeric: 'tabular-nums' }}>{coordinates}</strong>
    <div className="row" style={{ flexWrap: 'wrap' }}>
      <a className="btn ghost" target="_blank" rel="noreferrer"
        href={`https://yandex.ru/maps/?rtext=~${lat},${lng}&rtt=auto`}>Маршрут в Яндекс Картах</a>
      <a className="btn ghost" href={`geo:${lat},${lng}?q=${lat},${lng}`}>Другой навигатор</a>
      <button className="btn ghost" type="button" onClick={copy}>Скопировать координаты</button>
    </div>
    {copyError && <span role="status" className="note">Автокопирование недоступно. Координаты показаны для ручного копирования.</span>}
    <span className="note">Для промзон и закрытых объектов ориентируйтесь на точку, а не на ближайший почтовый адрес.</span>
  </section>;
}
