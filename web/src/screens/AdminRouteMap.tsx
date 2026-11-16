import { get, fmtTime } from '../api.ts';
import { useLoad, Loading } from '../ui.tsx';

type RoutePoint = { lat: number; lng: number; received_at: string };
const mercator = (lat: number) => Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360));
const distanceKm = (a: RoutePoint, b: RoutePoint) => {
  const radians = Math.PI / 180;
  const dLat = (b.lat - a.lat) * radians;
  const dLng = (b.lng - a.lng) * radians;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * radians) *
    Math.cos(b.lat * radians) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
};
export function AdminRouteMap({ orderId }: { orderId: string }) {
  const route = useLoad(() => get(`/api/admin/orders/${orderId}/route`), [orderId]);
  if (!route.data) return <section className="card"><b>Карта GPS-маршрута · только администратор</b><Loading error={route.error}/></section>;
  // Never connect samples with missing coordinates or timestamps: a zero coerced
  // from null would falsely place a performer near the Gulf of Guinea.
  const points: RoutePoint[] = (Array.isArray(route.data.points) ? route.data.points : [])
    .filter((p: RoutePoint | null) => p != null &&
      typeof p.lat === 'number' && Number.isFinite(p.lat) &&
      typeof p.lng === 'number' && Number.isFinite(p.lng) &&
      Math.abs(p.lat) <= 85 && Math.abs(p.lng) <= 180 &&
      typeof p.received_at === 'string' && !Number.isNaN(Date.parse(p.received_at)))
    .sort((a: RoutePoint, b: RoutePoint) => Date.parse(a.received_at) - Date.parse(b.received_at));
  if (!points.length) return <section className="card"><b>Карта GPS-маршрута</b><p className="note">Точек по этой заявке пока нет или истёк срок хранения (30 дней).</p></section>;
  // A malformed or unexpectedly large API response must not overflow the
  // JavaScript argument stack or freeze the administrator's dashboard.
  let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
  for (const p of points) {
    minLat = Math.min(minLat, p.lat);
    maxLat = Math.max(maxLat, p.lat);
    minLng = Math.min(minLng, p.lng);
    maxLng = Math.max(maxLng, p.lng);
  }
  const padLat = Math.max(0.004, (maxLat - minLat) * 0.2);
  const padLng = Math.max(0.007, (maxLng - minLng) * 0.2);
  const south = Math.max(-85, minLat - padLat), north = Math.min(85, maxLat + padLat);
  const west = Math.max(-180, minLng - padLng), east = Math.min(180, maxLng + padLng);
  const yTop = mercator(north), yBottom = mercator(south);
  const x = (p: RoutePoint) => ((Number(p.lng) - west) / (east - west)) * 1000;
  const y = (p: RoutePoint) => ((yTop - mercator(Number(p.lat))) / (yTop - yBottom)) * 600;
  // Never draw a continuous path across missing telemetry or physically
  // implausible jumps. Neither the diagram nor GPS samples prove a road route.
  const gapThresholdMs = 15 * 60 * 1000;
  const breaksSegment = (a: RoutePoint, b: RoutePoint) => {
    const elapsedMs = Date.parse(b.received_at) - Date.parse(a.received_at);
    return elapsedMs <= 0 || elapsedMs > gapThresholdMs ||
      distanceKm(a, b) / (elapsedMs / 3_600_000) > 180;
  };
  let gapCount = 0;
  let straightLineKm = 0;
  for (let i = 1; i < points.length; i++) {
    if (breaksSegment(points[i - 1], points[i])) gapCount++;
    else straightLineKm += distanceKm(points[i - 1], points[i]);
  }
  const trace = points.map((p, i) => {
    const gap = i > 0 && breaksSegment(points[i - 1], p);
    return `${i === 0 || gap ? 'M' : 'L'}${x(p).toFixed(2)},${y(p).toFixed(2)}`;
  }).join(' ');
  const first = points[0], last = points[points.length - 1];
  const bbox = [west,south,east,north].map(v=>v.toFixed(6)).join(',');
  const url = 'https://www.openstreetmap.org/export/embed.html?bbox=' + bbox + '&layer=mapnik';
  const external = 'https://www.openstreetmap.org/?mlat=' + Number(last.lat).toFixed(6) +
    '&mlon=' + Number(last.lng).toFixed(6) + '#map=15/' +
    Number(last.lat).toFixed(6) + '/' + Number(last.lng).toFixed(6);
  return <section className="card stack" aria-label="Карта истории GPS исполнителя">
    <div className="between"><b>Маршрут исполнителя · №{route.data.number}</b><span className="pill">Только администратор</span></div>
    <p className="note">Принятых GPS-точек: {points.length}. Разрывов маршрута (паузы, скачки GPS): {gapCount}. Сумма прямых отрезков между достоверно последовательными точками: {straightLineKm.toFixed(1)} км (не дорожный пробег). Первая: {fmtTime(first.received_at)}. Последняя: {fmtTime(last.received_at)}.</p>
    <div style={{height:360,borderRadius:14,overflow:'hidden',background:'#152638'}}>
      <iframe title="Карта OpenStreetMap района движения" src={url} loading="lazy" referrerPolicy="no-referrer"
        style={{width:'100%',height:'100%',border:0}}/>
    </div>
    <div className="stack" style={{gap:6}}>
      <b>История движения · схема по принятым точкам</b>
      <svg viewBox="0 0 1000 600" role="img" aria-label="Траектория GPS с начальной и последней точкой"
        style={{width:'100%',height:'auto',maxHeight:290,borderRadius:12,background:'#142437'}}>
        <path d={trace} fill="none" stroke="#16c9f5" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round"/>
        <circle cx={x(first)} cy={y(first)} r="12" fill="#1bc98e" stroke="#fff" strokeWidth="3"/>
        <circle cx={x(last)} cy={y(last)} r="12" fill="#ffb34b" stroke="#fff" strokeWidth="3"/>
      </svg>
      <p className="note">Зелёная точка — начало, оранжевая — последняя. Схема показывает последовательность принятых GPS-точек отдельно от интерактивной карты. При перерыве более 15 минут, одинаковых временных отметках или скачке координат быстрее 180 км/ч линия прерывается: неподтверждённое движение не дорисовывается. Это не доказательство дорожного маршрута или прибытия.</p>
    </div>
    <a href={external} target="_blank" rel="noopener noreferrer">Открыть последнюю точку в OpenStreetMap ↗</a>
  </section>;
}
