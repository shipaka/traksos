import {useEffect,useRef,useState} from 'react';
import {get,patch} from '../api.ts';
import '../vehicleOwnerGuide.css';

type Card = {
  scope:'operator_only';notice:string;vehicleKind:string|null;
  photo:{src:string;sourcePage:string;caption:string;confidence:string;author:string;
    license:string;licenseUrl:string;checkedOn:string;note:string}|null;
  manuals:{title:string;url:string;requiresVin:boolean;note:string;origin:string}[];
  sections:{key:string;title:string;text:string}[];
};
type Selection={category:string;brandKey:string;modelKey:string};
const categoryLabels:Record<string,string>={truck:'грузовик',trailer:'прицеп / полуприцеп',van:'фургон',bus:'автобус'};
export function VehicleOwnerGuide({vehicle,canLink=false,onLinked}:{vehicle:{
  id:string;brand:string;model?:string|null;year?:number|null;
  catalog_category?:string|null;catalog_brand_key?:string|null;catalog_model_key?:string|null;
};canLink?:boolean;onLinked?:()=>void}){
  const [open,setOpen]=useState(false);
  const [card,setCard]=useState<Card|null>(null);
  const [error,setError]=useState('');
  const [missingImage,setMissingImage]=useState(false);
  const [matching,setMatching]=useState(false);
  const [unmatched,setUnmatched]=useState(false);
  const [candidate,setCandidate]=useState<Selection|null>(null);
  const [linking,setLinking]=useState(false);
  const [linkError,setLinkError]=useState('');
  const [retry,setRetry]=useState(0);
  const lock=useRef(false);
  const category=vehicle.catalog_category,makeKey=vehicle.catalog_brand_key,modelKey=vehicle.catalog_model_key;
  useEffect(()=>{
    if(!open)return;
    let alive=true;
    setCard(null);setError('');setMissingImage(false);setMatching(true);setUnmatched(false);setCandidate(null);setLinkError('');
    const run=async()=>{
      let selected=category&&makeKey&&modelKey?{category,brandKey:makeKey,modelKey}:null;
      // Resolve from the saved record on the server, not from truncated search
      // lists or loosely normalized display names supplied by the browser.
      if(!selected&&vehicle.model?.trim()){
        const match=await get<{status:'exact'|'ambiguous'|'unmatched';selection:Selection|null}>(
          '/api/vehicle-reference/vehicles/'+encodeURIComponent(vehicle.id)+'/match');
        if(match.status==='exact')selected=match.selection;
      }
      if(!selected){if(alive)setUnmatched(true);return;}
      const url='/api/vehicle-reference/public-card?category='+encodeURIComponent(selected.category)+
        '&brandKey='+encodeURIComponent(selected.brandKey)+'&modelKey='+encodeURIComponent(selected.modelKey);
      const data=await get<Card>(url);
      if(alive){setCard(data);if(!category&&!makeKey&&!modelKey)setCandidate(selected);}
    };
    void run().catch((e:Error)=>{if(alive)setError(e.message||'Источник недоступен')})
      .finally(()=>{if(alive)setMatching(false)});
    return()=>{alive=false;};
  },[open,category,makeKey,modelKey,vehicle.id,vehicle.brand,vehicle.model,retry]);
  async function confirmLink(){
    if(!canLink||!candidate||lock.current)return;
    lock.current=true;setLinking(true);setLinkError('');
    try{
      await patch('/api/vehicle-reference/vehicles/'+encodeURIComponent(vehicle.id)+'/catalog',candidate);
      setCandidate(null);onLinked?.();
    }catch(e){setLinkError(e instanceof Error?e.message:'Не удалось подтвердить каталог');}
    finally{lock.current=false;setLinking(false);}
  }
  return <section className="vehicle-owner-guide">
    <button type="button" className="vehicle-owner-guide-toggle" aria-expanded={open}
      onClick={()=>setOpen(v=>!v)} aria-controls={'vehicle-guide-'+vehicle.id}>
      <span className="vehicle-owner-guide-book" aria-hidden="true">▤</span>
      <span><b>Книжка моей техники</b><small>Фото, эксплуатация, памятки и оригинальные инструкции</small></span>
      <span aria-hidden="true">{open?'−':'+'}</span>
    </button>
    {open&&<div id={'vehicle-guide-'+vehicle.id} className="vehicle-owner-guide-content">
      {error?<div role="alert" className="stack"><p className="note">Не удалось открыть книжку: {error}</p><button type="button" className="btn ghost small" onClick={()=>setRetry(n=>n+1)}>Повторить</button></div>
        : matching?<p className="note" role="status">Проверяю точное совпадение марки и модели с лицензированным справочником…</p>
        : unmatched?<p className="note">Эту машину добавили до подключения каталога. Надёжное точное совпадение не найдено: укажите подтверждённые марку и модель — другую машину или инструкцию мы не подставляем.</p>
        : card?<>
          {candidate&&<div className="card stack">
            <b>Найдено точное совпадение · {categoryLabels[candidate.category]??candidate.category}</b>
            <span className="note">Пока это справочное совпадение. VIN, год выпуска и история не меняются.</span>
            {canLink?<button type="button" className="btn small" disabled={linking} onClick={()=>void confirmLink()}>{linking?'Подтверждаю…':'Подтвердить связь с каталогом'}</button>:<span className="note">Подтвердить связь может владелец автопарка.</span>}
            {linkError&&<span role="alert" className="note">{linkError}</span>}
          </div>}
          <div className="vehicle-owner-guide-grid">
            <div className="vehicle-owner-guide-media">
              {card.photo&&!missingImage
                ? <img src={card.photo.src} alt={card.photo.caption} loading="lazy"
                    referrerPolicy="no-referrer" onError={()=>setMissingImage(true)}/>
                : <div className="vehicle-owner-guide-fallback" aria-hidden="true">▰</div>}
              {card.photo&&!missingImage
                ? <small>Иллюстрация семейства · <a href={card.photo.sourcePage} target="_blank" rel="noopener noreferrer">{card.photo.author}</a>
                    {' · '}<a href={card.photo.licenseUrl} target="_blank" rel="noopener noreferrer">{card.photo.license}</a>.
                    {' '}Фото не определяет точную комплектацию.</small>
                : <small>Подтверждённой фотографии этой модели пока нет. Другую марку не подставляем.</small>}
            </div>
            <div className="vehicle-owner-guide-text">
              <b>{vehicle.brand} {vehicle.model??''}{vehicle.year?' · '+vehicle.year:''}</b>
              {card.vehicleKind&&<small className="note">Тип: {card.vehicleKind==='semi'?'полуприцеп':card.vehicleKind==='drawbar'?'грузовой прицеп':'грузовая техника'}</small>}
              <p className="note">{card.notice}</p>
              <div className="vehicle-owner-guide-actions">
                {card.manuals.map(m=><a key={m.url} className="btn ghost small" href={m.url}
                    target="_blank" rel="noopener noreferrer">Открыть инструкцию производителя</a>)}
                {card.manuals.length===0&&<span className="note">Прямая официальная инструкция для этой модели пока не подтверждена.</span>}
              </div>
              {card.manuals.map(m=><small className="note" key={m.url}>{m.title}. {m.note}</small>)}
            </div>
          </div>
          <div className="vehicle-owner-guide-topics">
            {card.sections.map(x=><article key={x.key}><b>{x.title}</b><p className="note">{x.text}</p></article>)}
          </div>
        </>:<p className="note">Для этой модели пока нет подтверждённой карточки.</p>}
    </div>}
  </section>;
}
