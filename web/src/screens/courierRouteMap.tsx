import './courierRouteMap.css';

type Stop={id:string;seq:number;address:string|null;lat:number|null;lng:number|null;
  orderNumber:number;status:string};
type Route={id:string;pickupAddress:string;pickupLat:number|null;pickupLng:number|null;
  routePlanning:string;directKm:number|null;routeDisclaimer:string;stops:Stop[]};
type Point={lat:number;lng:number;label:string};
const valid=(v:number|null)=>v!==null&&Number.isFinite(v);

/** Each browser navigation segment has at most 20 route points, with
 * a shared endpoint between consecutive segments. Coordinates only.
 */
export function courierNavigationLinks(route:Route):{url:string;label:string}[]{
 if(!valid(route.pickupLat)||!valid(route.pickupLng))return [];
 const left=route.stops.filter(s=>!['delivered','failed'].includes(s.status));
 if(left.some(s=>!valid(s.lat)||!valid(s.lng)))return [];
 const all:Point[]=[{lat:route.pickupLat!,lng:route.pickupLng!,label:'Склад'},
   ...left.map(s=>({lat:s.lat!,lng:s.lng!,label:String(s.seq)}))];
 const result:{url:string;label:string}[]=[];
 for(let index=0;index<all.length-1;index+=19){
  const points=all.slice(index,index+20);
  if(points.length<2)break;
  const routeText=points.map(p=>p.lat+','+p.lng).join('~');
  result.push({url:'https://yandex.ru/maps/?mode=routes&rtext='+
    encodeURIComponent(routeText)+'&rtt=auto',
   label:result.length===0?'Открыть весь маршрут, часть 1':
    'Продолжение маршрута, часть '+(result.length+1)});
 }
 return result;
}
export function CourierRouteMap({route}:{route:Route}){
 const left=route.stops.filter(s=>!['delivered','failed'].includes(s.status));
 const hasAll=valid(route.pickupLat)&&valid(route.pickupLng)&&
   left.every(s=>valid(s.lat)&&valid(s.lng));
 const points:Point[]=hasAll?[{lat:route.pickupLat!,lng:route.pickupLng!,label:'С'},
   ...left.map(s=>({lat:s.lat!,lng:s.lng!,label:String(s.seq)}))]:[];
 const latitudes=points.map(p=>p.lat),longitudes=points.map(p=>p.lng);
 const minLat=Math.min(...latitudes),maxLat=Math.max(...latitudes);
 const minLng=Math.min(...longitudes),maxLng=Math.max(...longitudes);
 const screen=points.map(p=>({
   x:minLng===maxLng?320:28+584*(p.lng-minLng)/(maxLng-minLng),
   y:minLat===maxLat?130:232-196*(p.lat-minLat)/(maxLat-minLat),
   label:p.label
 }));
 const urls=courierNavigationLinks(route);
 return <section className="courier-route-map" aria-label="Схема и навигация маршрутного листа">
  <h3>Маршрутный лист · {route.stops.length} остановок</h3>
  <p className="note" role="status">{route.routeDisclaimer}</p>
  {route.routePlanning==='coordinate_heuristic'&&route.directKm!=null&&
   <p className="note">По прямой между последовательными точками: {route.directKm} км.
     Это не дорожный пробег и не время прибытия.</p>}
  {hasAll&&points.length>1?
   <svg role="img" aria-label="Схема координат склада и оставшихся остановок по порядку"
     viewBox="0 0 640 260" className="courier-route-plot">
    <rect x="0" y="0" width="640" height="260" rx="16" fill="#0c2137"/>
    <polyline fill="none" stroke="#80ddec" strokeWidth="3"
      points={screen.map(p=>p.x+','+p.y).join(' ')}/>
    {screen.map((p,i)=><g key={i}>
      <circle cx={p.x} cy={p.y} r="12" fill={i===0?'#bb984e':'#146983'}
        stroke="#dafbff" strokeWidth="1.5"/>
      <text x={p.x} y={p.y+3.5} fontSize="10" fontWeight="700"
        textAnchor="middle" fill="#fff">{p.label}</text>
    </g>)}
   </svg>:
   <p className="note">Часть координат не подтверждена. Курьер видит
     готовый список адресов, но схема точек и навигация всего рейса пока недоступны.</p>}
  {hasAll&&<p className="note">Это схема по координатам, не уличная карта.
    Автоматически рассчитанный порядок требует проверки дорожным навигатором.</p>}
  {urls.length>0&&<div className="courier-route-navigation">
    {urls.map((x,i)=><a key={i} className="btn ghost" target="_blank"
      rel="noopener noreferrer" href={x.url}>{x.label}</a>)}
    {urls.length>1&&<p className="note">Рейс разбит на {urls.length} последовательных
      участков Яндекс Карт. Следующий участок открывайте после предыдущего.</p>}
  </div>}
 </section>;
}
