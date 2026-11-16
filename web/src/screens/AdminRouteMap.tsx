import { get, fmtTime } from '../api.ts';
import { useLoad, Loading } from '../ui.tsx';

type RoutePoint = { lat: number; lng: number; received_at: string };
const mercator = (lat: number) => Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360));
export function AdminRouteMap({ orderId }: { orderId: string }) {
  const route = useLoad(() => get(`/api/admin/orders/${orderId}/route`), [orderId]);
  if (!route.data) return <section className="card"><b>Карта GPS-маршрута · только администратор</b><Loading error={route.error}/></section>;
  const points: RoutePoint[] = (route.data.points ?? []).filter((p: RoutePoint) =>
    Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lng)) &&
    Math.abs(Number(p.lat)) <= 85 && Math.abs(Number(p.lng)) <= 180);
  if (!points.length) return <section className="card"><b>Карта GPS-маршрута</b><p className="note">Точек по этой заявке пока нет или истёк срок хранения (30 дней).</p></section>;
  const minLat = Math.min(...points.map(p => Number(p.lat)));
  const maxLat = Math.max(...points.map(p => Number(p.lat)));
  const minLng = Math.min(...points.map(p => Number(p.lng)));
  const maxLng = Math.max(...points.map(p => Number(p.lng)));
  const padLat = Math.max(0.004, (maxLat - minLat) * 0.2);
  const padLng = Math.max(0.007, (maxLng - minLng) * 0.2);
  const south = Math.max(-85, minLat - padLat), north = Math.min(85, maxLat + padLat);
  const west = Math.max(-180, minLng - padLng), east = Math.min(180, maxLng + padLng);
  const yTop = mercator(north), yBottom = mercator(south);
  const x = (p: RoutePoint) => ((Number(p.lng) - west) / (east - west)) * 1000;
  const y = (p: RoutePoint) => ((yTop - mercator(Number(p.lat))) / (yTop - yBottom)) * 600;
  const trace = points.map((p, i) => `${i ? 'L' : 'M'}${x(p).toFixed(2)},${y(p).toFixed(2)}`).join(' ');
  const first = points[0], last = points[points.length - 1];
  const bbox = [west,south,east,north].map(v=>v.toFixed(6)).join(',');
  const url = 'https://www.openstreetmap.org/export/embed.html?bbox=' + bbox + '&layer=mapnik';
  const external = 'https://www.openstreetmap.org/?mlat=' + Number(last.lat).toFixed(6) +
    '&mlon=' + Number(last.lng).toFixed(6) + '#map=15/' +
    Number(last.lat).toFixed(6) + '/' + Number(last.lng).toFixed(6);
  return <section className="card stack" aria-label="Карта истории GPS исполнителя">
    <div className="between"><b>Маршрут исполнителя · №{route.data.number}</b><span className="pill">Только администратор</span></div>
    <p className="note">Принятых GPS-точек: {points.length}. Первая: {fmtTime(first.received_at)}. Последняя: {fmtTime(last.received_at)}.</p>
    <div style={{position:'relative',height:360,borderRadius:14,overflow:'hidden',background:'#152638'}}>
      <iframe title="Карта OpenStreetMap с историей GPS" src={url} loading="lazy" referrerPolicy="no-referrer"
        style={{width:'100%',height:'100%',border:0}}/>
      <svg viewBox="0 0 1000 600" preserveAspectRatio="none" aria-hidden="true"
        style={{position:'absolute',inset:0,width:'100%',height:'100%',pointerEvents:'none'}}>
        <path d={trace} fill="none" stroke="#16c9f5" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round"/>
        <circle cx={x(first)} cy={y(first)} r="11" fill="#1bc98e" stroke="#fff" strokeWidth="3"/>
        <circle cx={x(last)} cy={y(last)} r="11" fill="#ffb34b" stroke="#fff" strokeWidth="3"/>
      </svg>
    </div>
    <p className="note">Зелёная точка — начало, оранжевая — последняя. Линия соединяет полученные координаты, а не проверенный дорожный маршрут. При изменении масштаба карты линия может не совпадать с подложкой.</p>
    <a href={external} target="_blank" rel="noopener noreferrer">Открыть последнюю точку в OpenStreetMap ↗</a>
  </section>;
}
