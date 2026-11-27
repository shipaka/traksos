import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { geographicCenter, mustExpandCluster, clusterScreenPoints, fitRussiaView } from './partnerNetworkGeometry20261123.ts';
import { directoryPoints, directDirectoryDial, type DirectoryPoint } from './stoDirectoryPilot20261127.ts';
import { StoMapPinIcon, mapCategoryLabel } from './stoMapPinIcon20261127.tsx';
import './partnerNetworkMap20261123.css';

type VerifiedPoint={id:string;kind:'service';name:string;lat:number;lng:number;directory?:false};
type PartnerPoint=VerifiedPoint|DirectoryPoint;
// The independent source list must never be interpreted as verified opt-in data.
function combinePoints(verified:VerifiedPoint[]):PartnerPoint[]{
  const normalized=(name:string)=>name.toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
  return [...verified,...directoryPoints.filter(d=>!verified.some(p=>p.id===d.id || (normalized(p.name)===normalized(d.name)&&Math.abs(p.lat-d.lat)<.001&&Math.abs(p.lng-d.lng)<.001)))];
}
function markerClass(members:PartnerPoint[]){
  const count=members.filter(p=>!p.directory).length;
  return count===0?' is-directory':count===members.length?' is-verified':' is-mixed';
}
function samePartner(a:PartnerPoint,b:PartnerPoint){
  return a.id===b.id && a.kind===b.kind && a.name===b.name &&
    a.lat===b.lat && a.lng===b.lng && a.directory===b.directory;
}
type View={lat:number;lng:number;zoom:number};
type Cluster={key:string;x:number;y:number;members:PartnerPoint[]};
const TILE=256;
const MIN_ZOOM=1;
const MAX_ZOOM=18;
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
  const radius=v.zoom<=4?90:v.zoom<=7?72:54;
  const screen=points.map(point=>({...pointInViewport(point,v,width,height),point}))
    .filter(p=>p.x>=-35&&p.x<=width+35&&p.y>=-35&&p.y<=height+35);
  return clusterScreenPoints(screen,radius).map(group=>({...group,
    key:group.members.map(p=>p.id).sort().join('|')}));
}
export function PartnerNetworkMap({onClose}:{onClose:()=>void}){
  const [view,setView]=useState<View>(()=>fitRussiaView(850,490));
  const initialFit=useRef(true);
  const [size,setSize]=useState({width:850,height:490});
  const [points,setPoints]=useState<PartnerPoint[]>(()=>combinePoints([]));
  const [state,setState]=useState<'loading'|'ready'|'error'>('loading');
  // Expose an explicit retry after a transient API failure; no fake pins.
  const [retryCount,setRetryCount]=useState(0);
  const [selected,setSelected]=useState<PartnerPoint|null>(null);
  const [expandedCluster,setExpandedCluster]=useState<Cluster|null>(null);
  const clusterTrigger=useRef<HTMLButtonElement|null>(null);
  const selectedTrigger=useRef<HTMLButtonElement|null>(null);
  const firstClusterOption=useRef<HTMLButtonElement|null>(null);
  const selectedDismiss=useRef<HTMLButtonElement|null>(null);
  useLayoutEffect(()=>{if(selected)selectedDismiss.current?.focus();},[selected]);
  // Moving focus into a list makes its choices reachable immediately, even
  // when many other markers precede the expanded cluster in Tab order.
  useLayoutEffect(()=>{if(expandedCluster)firstClusterOption.current?.focus();},[expandedCluster]);
  const modal=useRef<HTMLElement|null>(null);
  const surface=useRef<HTMLDivElement|null>(null);
  const closeRef=useRef<HTMLButtonElement|null>(null);
  // When consent is revoked while a details panel/cluster list owns focus,
  // its focused control unmounts. Move focus to a still-present modal control.
  // Ordinary voluntary close continues to restore focus to the map marker.
  const revokedPanelFocus=useRef(false);
  useLayoutEffect(()=>{
    if(revokedPanelFocus.current && !selected && !expandedCluster){
      revokedPanelFocus.current=false;
      closeRef.current?.focus();
    }
  },[selected,expandedCluster]);
  const drag=useRef<{x:number;y:number;pointerId:number;view:View}|null>(null);
  function restoreMarkerFocus(marker:HTMLButtonElement|null){
    requestAnimationFrame(()=>{
      (marker?.isConnected?marker:closeRef.current)?.focus();
    });
  }
  function dismissSelected(){
    setSelected(null);
    restoreMarkerFocus(selectedTrigger.current);
  }

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
          restoreMarkerFocus(clusterTrigger.current);
        }else if(selected){
          dismissSelected();
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
    let current:AbortController|null=null;
    setState('loading');
    // A partner can withdraw public-map consent while a visitor keeps this
    // modal open. Re-fetch verified data on return to the tab and periodically;
    // never leave a revoked point or its cached partner card on the screen.
    const refresh=()=>{
      current?.abort();
      const controller=new AbortController();
      current=controller;
      fetch('/api/public/partner-map',{cache:'no-store',signal:controller.signal})
        .then(async res=>{
          if(!res.ok)throw Error('http '+res.status);
          const data=await res.json();
          if(data?.source!=='verified_stationary_opt_in' || !Array.isArray(data?.points))
            throw Error('public map contract mismatch');
          const safe:VerifiedPoint[]=data.points.filter((p:any)=>
            p.kind==='service'&&typeof p.name==='string'&&
            typeof p.id==='string'&&Number.isFinite(p.lat)&&Number.isFinite(p.lng)&&
            Math.abs(p.lat)<=90&&Math.abs(p.lng)<=180&&!(p.lat===0&&p.lng===0)).map((p:any)=>({id:p.id,kind:'service',name:p.name,lat:p.lat,lng:p.lng}));
          const combined=combinePoints(safe);
          if(controller.signal.aborted)return;
          setPoints(combined);
          // Keep React state identity when verified data did not change.
          // Replacing the selected object on every focus/interval refresh
          // would re-focus its close button while the user clicks a link.
          setSelected(old=>{
            if(!old)return null;
            const fresh=combined.find(p=>p.id===old.id);
            if(!fresh){
              revokedPanelFocus.current=true; // consent was withdrawn
              return null;
            }
            return samePartner(old,fresh)?old:fresh;
          });
          setExpandedCluster(old=>{
            if(!old)return null;
            const members=old.members.map(p=>combined.find(next=>next.id===p.id))
              .filter((p):p is PartnerPoint=>!!p);
            if(members.length!==old.members.length){
              revokedPanelFocus.current=true; // one or more partners revoked consent
              return null;
            }
            return members.every((p,i)=>samePartner(p,old.members[i])) ? old : {...old,members};
          });
          setState('ready');
        }).catch(()=>{
          if(controller.signal.aborted)return;
          setState('error');
          setPoints(combinePoints([]));
          setSelected(old=>old?.directory?old:null);
          setExpandedCluster(null);
        });
    };
    refresh();
    const onReturn=()=>{if(!document.hidden)refresh();};
    window.addEventListener('focus',onReturn);
    document.addEventListener('visibilitychange',onReturn);
    const interval=window.setInterval(()=>{if(!document.hidden)refresh();},60_000);
    return ()=>{
      window.clearInterval(interval);
      window.removeEventListener('focus',onReturn);
      document.removeEventListener('visibilitychange',onReturn);
      current?.abort();
    };
  },[retryCount]);
  useEffect(()=>{
    const update=()=>{
      if(surface.current){
        const width=surface.current.clientWidth,height=surface.current.clientHeight;
        if(width>0&&height>0){setSize({width,height});if(initialFit.current){setView(fitRussiaView(width,height));initialFit.current=false;}}
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
          <small>Подтверждённые партнёры и независимый справочник СТО</small></div>
        <button type="button" className="tr-network-close" ref={closeRef} onClick={onClose}
          aria-label="Закрыть карту">✕ <span>Закрыть</span></button>
      </header>
      <div className="tr-network-viewport" ref={surface} aria-label="Интерактивная карта СТО"
        onPointerDown={event=>{
          // Capturing a pointer for panning must never steal a click from
          // the verified partner's login link, zoom buttons or detail panels.
          // Pointer capture otherwise retargets the matching pointerup/click
          // to the map viewport instead of the interactive child.
          const target=event.target as HTMLElement;
          if(event.button!==0 || !event.isPrimary ||
             target.closest('button,a,input,select,textarea,[role="button"],[contenteditable="true"],.tr-network-partner,.tr-network-cluster-list,.tr-network-zoom,.tr-network-notice,.tr-network-attribution'))return;
          drag.current={x:event.clientX,y:event.clientY,pointerId:event.pointerId,view};
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={event=>{
          // A second touch may cross the viewport during a one-finger pan.
          // Only the captured primary pointer can move this map: otherwise
          // a two-finger gesture jumps to unrelated world coordinates.
          const d=drag.current;if(!d || d.pointerId!==event.pointerId)return;
          const c=world(d.view.lat,d.view.lng,d.view.zoom);
          const next=unproject(c.x-(event.clientX-d.x),c.y-(event.clientY-d.y),d.view.zoom);
          setView({...d.view,lat:clamp(next.lat,-82,82),lng:next.lng});
        }}
        onPointerUp={event=>{
          if(drag.current?.pointerId!==event.pointerId)return;
          drag.current=null;
          if(event.currentTarget.hasPointerCapture(event.pointerId))
            event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onPointerCancel={event=>{if(drag.current?.pointerId===event.pointerId)drag.current=null;}}
        onLostPointerCapture={event=>{if(drag.current?.pointerId===event.pointerId)drag.current=null;}}
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
          <button type="button" aria-label="Показать Санкт-Петербург и область" onClick={()=>{setView({lat:59.86,lng:30.47,zoom:10});setSelected(null);setExpandedCluster(null);}}>СПб / ЛО</button>
          <button type="button" aria-label="Показать Россию" onClick={()=>{setView(fitRussiaView(size.width,size.height));setSelected(null);setExpandedCluster(null);}}>Россия</button>
        </div>
        {clusters.map(cluster=><button key={cluster.key} type="button"
          className={'tr-network-marker'+(cluster.members.length>1?' is-cluster':'')+markerClass(cluster.members)}
          style={{left:cluster.x,top:cluster.y}}
          aria-label={cluster.members.length>1
            ?'Показать '+cluster.members.length+' СТО поблизости'
            :'СТО '+cluster.members[0].name+(cluster.members[0].directory?' · сторонняя':' · партнёр')}
          title={cluster.members.length>1
            ?'СТО: '+cluster.members.length+' · партнёров: '+cluster.members.filter(p=>!p.directory).length:cluster.members[0].name}
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
              selectedTrigger.current=event.currentTarget;
              setExpandedCluster(null);
              setSelected(cluster.members[0]);
            }
          }}>{cluster.members.length>1?<span>{cluster.members.length}</span>:<StoMapPinIcon category={cluster.members[0].directory?cluster.members[0].category??'sto':'sto'}/>}</button>)}
        {expandedCluster&&<aside className="tr-network-cluster-list"
          role="group" aria-label="Выбрать СТО из группы">
          <div className="tr-network-cluster-head"><b>СТО в группе ({expandedCluster.members.length})</b>
            <button type="button" aria-label="Скрыть список партнёров" onClick={()=>{
              setExpandedCluster(null);
              restoreMarkerFocus(clusterTrigger.current);
            }}>✕</button></div>
          <div className="tr-network-cluster-options">
            {expandedCluster.members.map((p,index)=><button type="button" key={p.id}
              ref={index===0?firstClusterOption:undefined}
              onClick={()=>{selectedTrigger.current=clusterTrigger.current;
                setExpandedCluster(null);setSelected(p);}}>
              СТО {p.name} · {p.directory?'Сторонняя организация':'Партнёр'}</button>)}
          </div>
        </aside>}
        {selected&&<aside className="tr-network-partner" aria-label={selected.directory?"Карточка стороннего СТО":"Карточка партнёра"}>
          <button type="button" ref={selectedDismiss} className="tr-network-dismiss" onClick={dismissSelected} aria-label="Скрыть карточку">✕</button>
          <b>{selected.name}</b>{selected.directory?<>
            <span>Сторонняя организация · не подтверждена</span>
            <small>{mapCategoryLabel[selected.category??'sto']}</small><small>{selected.address}</small><small>{selected.services.join(' · ')}</small>
            {selected.hours&&<small>График: {selected.hours}; уточните по телефону.</small>}
            <small>Актуальность не подтверждена. TrakSOS не участвует в оказании услуги.</small>
            {directDirectoryDial(selected.phone)&&<a href={directDirectoryDial(selected.phone)}>Позвонить напрямую: {selected.phone}</a>}
          </>:<><span>Проверенная стационарная СТО · партнёр сети</span>
          <small>Координаты опубликованы с согласия СТО. Наличие свободного времени уточняется при обращении.</small>
          <a href="#/login" onClick={onClose}>Войти для выбора сервиса</a></>}
        </aside>}
        {state!=='ready'&&<div className="tr-network-notice" role="status">
          <span>{state==='loading'?'Получаем подтверждённые точки партнёров…'
            :'Данные партнёров временно недоступны. Сторонний справочник доступен отдельно.'}</span>
          {state==='error'&&<button type="button" className="tr-network-retry"
            onClick={()=>setRetryCount(n=>n+1)}>Повторить загрузку</button>}
        </div>}
        {state==='ready'&&points.length===0&&<div className="tr-network-notice" role="status">
          Пока нет СТО, разрешивших показывать проверенное местоположение на публичной карте.
          Мы расширяем партнёрскую сеть; декоративные точки за реальные не выдаём.
        </div>}
        <div className="tr-network-attribution">Карта © OpenStreetMap contributors ·
          <span>зелёные — партнёры (не статус работы) · серые — сторонние · двухцветные — смешанные группы</span></div>
      </div>
    </section>
  </div>;
}
