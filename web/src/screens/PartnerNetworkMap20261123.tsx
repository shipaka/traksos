import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { geographicCenter, mustExpandCluster } from './partnerNetworkGeometry20261123.ts';
import './partnerNetworkMap20261123.css';

type PartnerPoint={id:string;kind:'service';name:string;lat:number;lng:number};
type View={lat:number;lng:number;zoom:number};
type Cluster={key:string;x:number;y:number;members:PartnerPoint[]};
const TILE=256;
const MIN_ZOOM=2;
const MAX_ZOOM=12;
function clamp(value:number,min:number,max:number){return Math.min(max,Math.max(min,value));}
function world(lat:number,lng:number,zoom:number){
  const scale=TILE*2**zoom;
  const latitude=clamp(lat,-85.05,85.05)*Math.PI/180;
  return {x:(lng+180)/360*scale,
    y:(1-Math.log(Math.tan(Math.PI/4+latitude/2))/Math.PI)/2*scale};
}
function unproject(x:number,y:number,zoom:number){
  const s=TILE*2**zoom;
  return {lng:((x/s*360+540)%360)-180,
    lat:180/Math.PI*Math.atan(Math.sinh(Math.PI*(1-2*y/s)))};
}
function pointInViewport(p:PartnerPoint,v:View,width:number,height:number){
  const center=world(v.lat,v.lng,v.zoom),point=world(p.lat,p.lng,v.zoom);
  const length=TILE*2**v.zoom;
  let dx=point.x-center.x;
  if(dx>length/2)dx-=length;
  if(dx< -length/2)dx+=length;
  return {x:width/2+dx,y:height/2+(point.y-center.y)};
}
function tileSet(view:View,width:number,height:number){
  const c=world(view.lat,view.lng,view.zoom);
  const minX=Math.floor((c.x-width/2)/TILE)-1,maxX=Math.floor((c.x+width/2)/TILE)+1;
  const minY=Math.max(0,Math.floor((c.y-height/2)/TILE)-1);
  const maxY=Math.min(2**view.zoom-1,Math.floor((c.y+height/2)/TILE)+1);
  const max=2**view.zoom;
  const result:{key:string;src:string;left:number;top:number}[]=[];
  for(let y=minY;y<=maxY;y++)for(let x=minX;x<=maxX;x++){
    const wrapped=((x%max)+max)%max;
    result.push({key:x+':'+y,src:'https://tile.openstreetmap.org/'+view.zoom+'/'+wrapped+'/'+y+'.png',
      left:Math.round(x*TILE-c.x+width/2),top:Math.round(y*TILE-c.y+height/2)});
  }
  return result;
}
function clusterPoints(points:PartnerPoint[],v:View,width:number,height:number):Cluster[]{
  const buckets=new Map<string,Cluster>();
  const cell=54;
  for(const p of points){
    const pos=pointInViewport(p,v,width,height);
    if(pos.x< -35||pos.x>width+35||pos.y< -35||pos.y>height+35)continue;
    const cx=Math.floor(pos.x/cell),cy=Math.floor(pos.y/cell),key=cx+':'+cy;
    const old=buckets.get(key);
    if(old){old.members.push(p);old.x=(old.x*(old.members.length-1)+pos.x)/old.members.length;
      old.y=(old.y*(old.members.length-1)+pos.y)/old.members.length;}
    else buckets.set(key,{key,x:pos.x,y:pos.y,members:[p]});
  }
  return [...buckets.values()];
}
export function PartnerNetworkMap({onClose}:{onClose:()=>void}){
  const [view,setView]=useState<View>({lat:60,lng:93,zoom:3});
  const [size,setSize]=useState({width:850,height:490});
  const [points,setPoints]=useState<PartnerPoint[]>([]);
  const [state,setState]=useState<'loading'|'ready'|'error'>('loading');
  const [selected,setSelected]=useState<PartnerPoint|null>(null);
  const [expandedCluster,setExpandedCluster]=useState<Cluster|null>(null);
  const clusterTrigger=useRef<HTMLButtonElement|null>(null);
  const selectedDismiss=useRef<HTMLButtonElement|null>(null);
  useLayoutEffect(()=>{if(selected)selectedDismiss.current?.focus();},[selected]);
  const modal=useRef<HTMLElement|null>(null);
  const surface=useRef<HTMLDivElement|null>(null);
  const closeRef=useRef<HTMLButtonElement|null>(null);
  const drag=useRef<{x:number;y:number;view:View}|null>(null);

  useEffect(()=>{
    const previous=document.body.style.overflow;
    document.body.style.overflow='hidden';
    closeRef.current?.focus();
    return ()=>{document.body.style.overflow=previous;};
  },[]);
  // Keep Escape scoped: first close a list/card, then close the map itself.
  // Do not re-focus the modal's Close button on every map state update.
  useEffect(()=>{
    const onKey=(event:KeyboardEvent)=>{
      if(event.key==='Escape'){
        event.preventDefault();
        if(expandedCluster){
          setExpandedCluster(null);
          requestAnimationFrame(()=>clusterTrigger.current?.focus());
        }else if(selected){
          setSelected(null);
        }else onClose();
        return;
      }
      if(event.key==='Tab' && modal.current){
        const nodes=[...modal.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]),a[href],input:not([disabled]),[tabindex="0"]'
        )].filter(node=>node.getClientRects().length);
        if(!nodes.length)return;
        const first=nodes[0],last=nodes[nodes.length-1];
        if(event.shiftKey && document.activeElement===first){event.preventDefault();last.focus();}
        else if(!event.shiftKey && document.activeElement===last){event.preventDefault();first.focus();}
      }
    };
    document.addEventListener('keydown',onKey);
    return ()=>document.removeEventListener('keydown',onKey);
  },[onClose,selected,expandedCluster]);
  useEffect(()=>{
    const c=new AbortController();
    setState('loading');
    fetch('/api/public/partner-map',{cache:'no-store',signal:c.signal})
      .then(async res=>{
        if(!res.ok)throw Error('http '+res.status);
        const data=await res.json();
        if(data?.source!=='verified_stationary_opt_in' || !Array.isArray(data?.points))
          throw Error('public map contract mismatch');
        const safe=data.points.filter((p:any)=>
          p.kind==='service'&&typeof p.name==='string'&&
          typeof p.id==='string'&&Number.isFinite(p.lat)&&Number.isFinite(p.lng)&&
          Math.abs(p.lat)<=90&&Math.abs(p.lng)<=180&&!(p.lat===0&&p.lng===0));
        setPoints(safe);setState('ready');
      }).catch(e=>{if(!c.signal.aborted){setState('error');setPoints([]);}});
    return ()=>c.abort();
  },[]);
  useEffect(()=>{
    const update=()=>{
      if(surface.current){
        setSize({width:surface.current.clientWidth,height:surface.current.clientHeight});
      }
    };
    update();
    const ob=typeof ResizeObserver==='undefined'?null:new ResizeObserver(update);
    if(surface.current)ob?.observe(surface.current);
    window.addEventListener('resize',update);
    return ()=>{ob?.disconnect();window.removeEventListener('resize',update);};
  },[]);
  const tiles=useMemo(()=>tileSet(view,size.width,size.height),[view,size]);
  const clusters=useMemo(()=>clusterPoints(points,view,size.width,size.height),[points,view,size]);
  function pan(px:number,py:number){
    setView(v=>{
      const p=world(v.lat,v.lng,v.zoom);
      const next=unproject(p.x+px,p.y+py,v.zoom);
      return {...v,lat:clamp(next.lat,-82,82),lng:next.lng};
    });
  }
  function zoom(delta:number){
    setSelected(null);
    setExpandedCluster(null);
    setView(v=>({...v,zoom:clamp(v.zoom+delta,MIN_ZOOM,MAX_ZOOM)}));
  }
  return <div className="tr-network-backdrop" role="presentation"
    onMouseDown={event=>{if(event.target===event.currentTarget)onClose();}}>
    <section className="tr-network-dialog" ref={modal} role="dialog"
      aria-modal="true" aria-labelledby="tr-network-title">
      <header className="tr-network-heading">
        <div><b id="tr-network-title">Карта партнёров TrakSOS</b>
          <small>Только подтвердившие адрес СТО, добровольно разрешившие публикацию</small></div>
        <button type="button" className="tr-network-close" ref={closeRef} onClick={onClose}
          aria-label="Закрыть карту">✕ <span>Закрыть</span></button>
      </header>
      <div className="tr-network-viewport" ref={surface} aria-label="Интерактивная карта подтверждённых партнёров"
        onPointerDown={event=>{
          if(event.button!==0 || (event.target as HTMLElement).closest('button'))return;
          drag.current={x:event.clientX,y:event.clientY,view};
          (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
        }}
        onPointerMove={event=>{
          const d=drag.current;if(!d)return;
          const c=world(d.view.lat,d.view.lng,d.view.zoom);
          const next=unproject(c.x-(event.clientX-d.x),c.y-(event.clientY-d.y),d.view.zoom);
          setView({...d.view,lat:clamp(next.lat,-82,82),lng:next.lng});
        }}
        onPointerUp={()=>{drag.current=null;}}
        onPointerCancel={()=>{drag.current=null;}}
        onKeyDown={event=>{
          if(event.target!==event.currentTarget)return;
          if(event.key==='ArrowLeft'){pan(-95,0);event.preventDefault();}
          if(event.key==='ArrowRight'){pan(95,0);event.preventDefault();}
          if(event.key==='ArrowUp'){pan(0,-95);event.preventDefault();}
          if(event.key==='ArrowDown'){pan(0,95);event.preventDefault();}
        }} tabIndex={0}>
        <div className="tr-network-tiles" aria-hidden="true">
          {tiles.map(t=><img key={t.key} src={t.src} alt="" loading="lazy" draggable={false}
            style={{left:t.left,top:t.top}}/>)}
        </div>
        <div className="tr-network-zoom" aria-label="Масштаб карты">
          <button type="button" aria-label="Приблизить карту" disabled={view.zoom===MAX_ZOOM} onClick={()=>zoom(1)}>+</button>
          <button type="button" aria-label="Отдалить карту" disabled={view.zoom===MIN_ZOOM} onClick={()=>zoom(-1)}>−</button>
          <button type="button" aria-label="Показать Россию" onClick={()=>{setView({lat:60,lng:93,zoom:3});setSelected(null);setExpandedCluster(null);}}>Россия</button>
        </div>
        {clusters.map(cluster=><button key={cluster.key} type="button"
          className={'tr-network-marker'+(cluster.members.length>1?' is-cluster':'')}
          style={{left:cluster.x,top:cluster.y}}
          aria-label={cluster.members.length>1
            ?'Показать '+cluster.members.length+' партнёров поблизости'
            :'СТО '+cluster.members[0].name}
          title={cluster.members.length>1
            ?'Проверенных СТО: '+cluster.members.length:cluster.members[0].name}
          onClick={event=>{
            if(cluster.members.length>1){
              if(mustExpandCluster(cluster.members,view.zoom,MAX_ZOOM)){
                clusterTrigger.current=event.currentTarget;
                setExpandedCluster(cluster);
                setSelected(null);
              }else{
                const center=geographicCenter(cluster.members);
                setView(v=>({...center,zoom:clamp(v.zoom+2,MIN_ZOOM,MAX_ZOOM)}));
                setExpandedCluster(null);
                setSelected(null);
              }
            }else{
              setExpandedCluster(null);
              setSelected(cluster.members[0]);
            }
          }}>{cluster.members.length>1?cluster.members.length:'●'}</button>)}
        {expandedCluster&&<aside className="tr-network-cluster-list"
          role="group" aria-label="Выбрать СТО из группы">
          <div className="tr-network-cluster-head"><b>Партнёры в одной точке ({expandedCluster.members.length})</b>
            <button type="button" aria-label="Скрыть список партнёров" onClick={()=>{
              setExpandedCluster(null);
              requestAnimationFrame(()=>clusterTrigger.current?.focus());
            }}>✕</button></div>
          <div className="tr-network-cluster-options">
            {expandedCluster.members.map(p=><button type="button" key={p.id}
              onClick={()=>{setExpandedCluster(null);setSelected(p);}}>
              СТО {p.name}</button>)}
          </div>
        </aside>}
        {selected&&<aside className="tr-network-partner" aria-label="Карточка партнёра">
          <button type="button" ref={selectedDismiss} className="tr-network-dismiss" onClick={()=>setSelected(null)} aria-label="Скрыть карточку">✕</button>
          <b>{selected.name}</b><span>Проверенная стационарная СТО · партнёр сети</span>
          <small>Координаты опубликованы с согласия СТО. Наличие свободного времени уточняется при обращении.</small>
          <a href="#/login" onClick={onClose}>Войти для выбора сервиса</a>
        </aside>}
        {state!=='ready'&&<div className="tr-network-notice" role="status">
          {state==='loading'?'Получаем подтверждённые точки партнёров…'
            :'Данные сети временно недоступны. Не подставляем демонстрационные точки.'}</div>}
        {state==='ready'&&points.length===0&&<div className="tr-network-notice" role="status">
          Пока нет СТО, разрешивших показывать проверенное местоположение на публичной карте.
          Мы расширяем партнёрскую сеть; декоративные точки за реальные не выдаём.
        </div>}
        <div className="tr-network-attribution">Карта © OpenStreetMap contributors ·
          <span>жёлтые точки: подтверждённые СТО, не текущий GPS мастеров</span></div>
      </div>
    </section>
  </div>;
}
