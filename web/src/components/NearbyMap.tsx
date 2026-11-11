import { useState } from 'react';

/** Лёгкая схема реальных координат: работает без загрузки тайлов и внешних карт.
 * Это не дорожная карта; не показываем выдуманные улицы или позиции. */
export function NearbyMap({ items, center, kind = 'service' }: { items: any[]; center?: { lat: number; lng: number } | null; kind?: 'service' | 'master' }) {
  const [selected, setSelected] = useState<string | null>(null);
  const located = items.filter((p) => Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lng)) && p.lat != null && p.lng != null);
  const coordinates = [...located.map((p) => ({ lat: Number(p.lat), lng: Number(p.lng) })), ...(center ? [center] : [])];
  if (!coordinates.length) return <div className="nearby-map-empty">Точки на карте появятся, когда сервисы передадут координаты. Пока используйте список ниже.</div>;
  const minLat = Math.min(...coordinates.map((p) => p.lat)), maxLat = Math.max(...coordinates.map((p) => p.lat));
  const minLng = Math.min(...coordinates.map((p) => p.lng)), maxLng = Math.max(...coordinates.map((p) => p.lng));
  const latSpan = Math.max(.015, maxLat - minLat), lngSpan = Math.max(.02, maxLng - minLng);
  const y = (lat: number) => 50 - (lat - (minLat + maxLat) / 2) / latSpan * 75;
  const x = (lng: number) => 50 + (lng - (minLng + maxLng) / 2) / lngSpan * 75;
  const chosen = located.find((p) => String(p.id) === selected);
  return <section className="nearby-map" aria-label="Схема расположения рядом с вами">
    <div className="nearby-map-head"><b>Рядом с вами</b><span>Схема расположения · без загрузки карты</span></div>
    <div className="nearby-map-plane">
      {center && <span className="nearby-map-you" style={{ left: x(center.lng) + '%', top: y(center.lat) + '%' }} title="Ваше местоположение">●</span>}
      {located.slice(0, 80).map((p) => <button type="button" key={p.id} className={'nearby-map-pin ' + (p.isPartner === true ? 'partner' : 'neutral')} style={{ left: x(Number(p.lng)) + '%', top: y(Number(p.lat)) + '%' }} aria-label={p.name ?? 'Точка'} title={p.name} onClick={() => setSelected(String(p.id))}>{kind === 'master' ? '🔧' : '✚'}</button>)}
      {chosen && <div className="nearby-map-selected"><b>{chosen.name}</b><span>{chosen.address ?? 'Координаты предоставлены исполнителем'}</span>{kind === 'service' && !chosen.directoryOnly && <a href={'#/services/' + encodeURIComponent(chosen.id)}>Открыть сервис →</a>}{chosen.directoryOnly && <span>Справочная точка · запись пока недоступна</span>}</div>}
    </div>
    <div className="nearby-map-foot"><span>● Вы</span><span>🟠 Партнёр</span><span>⚪ Справочная точка</span></div>
    <small>Положение схематичное, не навигация. Для маршрута откройте карточку сервиса. При плохом интернете список остаётся доступен.</small>
  </section>;
}
