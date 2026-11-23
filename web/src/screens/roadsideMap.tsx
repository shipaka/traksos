import {useState} from 'react';
import {useMe} from '../ui.tsx';
import './roadsideMap.css';

type Point = { lat: number; lng: number };
function valid(p:Point|null|undefined):p is Point{
  return !!p && Number.isFinite(p.lat) && Number.isFinite(p.lng) &&
    Math.abs(p.lat)<=90 && Math.abs(p.lng)<=180;
}

/**
 * Only server/order coordinates appear on the real map.
 * Search dots and mock routes must NEVER be rendered as physical positions.
 */
export function RoadsideMap({point,kind='request',address,updatedAt,synthetic=false}:{
  point:Point|null|undefined;kind?:'request'|'performer'|'service';address?:string|null;
  updatedAt?:number|null;synthetic?:boolean;
}){
  // Public/demo embeds may render before the private MeCtx provider exists.
  const me=useMe()?.me;
  const [approvedFor,setApprovedFor]=useState<string|null>(null);
  const good=valid(point);
  const lat=good?point.lat:0, lng=good?point.lng:0;
  // Consent is scoped to the signed-in account, map kind, DEMO flag and
  // precise location. Changing any dimension hides the previous iframe
  // synchronously without depending on an effect after paint.
  const consentScope=[me?.id??'guest',kind,synthetic?'demo':'real',
    good?point.lat.toFixed(6):'none',good?point.lng.toFixed(6):'none'].join(':');
  const showExternalMap=good && approvedFor===consentScope;
  const deltaLat=.014, deltaLng=.029;
  const bbox=good
    ? [lng-deltaLng,lat-deltaLat,lng+deltaLng,lat+deltaLat].map(v=>v.toFixed(6)).join(',')
    : '';
  const url=good?'https://www.openstreetmap.org/export/embed.html?bbox='+bbox+'&layer=mapnik&marker='+lat.toFixed(6)+','+lng.toFixed(6):'';
  const external=good?'https://yandex.ru/maps/?pt='+lng.toFixed(6)+','+lat.toFixed(6)+'&z=13&l=map':'';
  const stale=updatedAt!=null && (Date.now()-updatedAt>120000 || updatedAt>Date.now()+30000);
  return <section className="roadside-map" aria-label={kind==='request'?'Карта места вызова':kind==='service'?'Карта рембазы':'Карта исполнителя'}>
    <div className="roadside-map-head">
      <div className="roadside-map-title">
        <span className="roadside-map-symbol" aria-hidden="true">{kind==='performer'?'↗':kind==='service'?'▤':'⌖'}</span>
        <div><b>{kind==='performer'?'Исполнитель на карте':kind==='service'?'Фактическое расположение СТО':'Место вызова'}</b>
          <small>{synthetic?'Демонстрационные координаты — не реальный выезд'
            :!good?'Координаты пока не переданы'
            :stale?'Последняя точка может быть устаревшей'
            :updatedAt!=null?'Координаты получены от устройства'
            :kind==='service'?'Стационарная точка партнёра':'Точка, указанная в заявке'}</small></div>
      </div>
      {synthetic&&<span className="roadside-map-badge">ДЕМО</span>}
    </div>
    <div className={'roadside-map-viewport'+(!showExternalMap?' is-empty':'')}>
      {showExternalMap?<iframe
        title={kind==='performer'?'Точка исполнителя на OpenStreetMap':kind==='service'?'Фактическое расположение СТО на OpenStreetMap':'Место вызова на OpenStreetMap'}
        loading="lazy" referrerPolicy="no-referrer" src={url}/>:
       <div className="roadside-map-empty">
        <span aria-hidden="true">⌖</span>
        {good?<><b>Показать точку на карте</b>
          <small>Для загрузки карты OpenStreetMap координаты этой точки будут переданы стороннему картографическому сервису. Вы можете не загружать карту и оставить адрес на экране.</small>
          <button type="button" className="btn small roadside-map-load"
            onClick={()=>setApprovedFor(consentScope)}>
            Загрузить карту OpenStreetMap</button>
        </>:<><b>Нужна точка на карте</b>
          <small>Укажите местоположение при оформлении заявки. Сервис не рисует условных мастеров как настоящих.</small>
        </>}
       </div>}
      {showExternalMap&&<div className="roadside-map-overlay" aria-hidden="true">
        <span className="roadside-map-dot"/><span>{kind==='performer'?'Последняя точка исполнителя':kind==='service'?'Адрес въезда на территорию СТО':'Место вашей заявки'}</span>
      </div>}
    </div>
    <div className="roadside-map-foot">
      <span>{address?.trim()||(!good?'Адрес ещё не определён':'Метка по GPS-координатам')}</span>
      {good&&<a href={external} target="_blank" rel="noopener noreferrer">Открыть в Яндекс Картах ↗</a>}
    </div>
  </section>;
}
