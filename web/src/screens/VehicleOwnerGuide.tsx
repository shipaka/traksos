import {useEffect,useState} from 'react';
import {get} from '../api.ts';
import '../vehicleOwnerGuide.css';

type Card = {
  scope:'operator_only';notice:string;vehicleKind:string|null;
  photo:{src:string;sourcePage:string;caption:string;confidence:string;author:string;
    license:string;licenseUrl:string;checkedOn:string;note:string}|null;
  manuals:{title:string;url:string;requiresVin:boolean;note:string;origin:string}[];
  sections:{key:string;title:string;text:string}[];
};
export function VehicleOwnerGuide({vehicle}:{vehicle:{
  id:string;brand:string;model?:string|null;year?:number|null;
  catalog_category?:string|null;catalog_brand_key?:string|null;catalog_model_key?:string|null;
}}){
  const [open,setOpen]=useState(false);
  const [card,setCard]=useState<Card|null>(null);
  const [error,setError]=useState('');
  const [missingImage,setMissingImage]=useState(false);
  const category=vehicle.catalog_category,makeKey=vehicle.catalog_brand_key,modelKey=vehicle.catalog_model_key;
  useEffect(()=>{
    if(!open||!category||!makeKey||!modelKey)return;
    let alive=true;
    setCard(null);setError('');setMissingImage(false);
    const url='/api/vehicle-reference/public-card?category='+encodeURIComponent(category)+
      '&brandKey='+encodeURIComponent(makeKey)+'&modelKey='+encodeURIComponent(modelKey);
    get<Card>(url).then(v=>{if(alive)setCard(v)})
      .catch((e:Error)=>{if(alive)setError(e.message||'Источник недоступен')});
    return()=>{alive=false};
  },[open,category,makeKey,modelKey]);
  return <section className="vehicle-owner-guide">
    <button type="button" className="vehicle-owner-guide-toggle" aria-expanded={open}
      onClick={()=>setOpen(v=>!v)} aria-controls={'vehicle-guide-'+vehicle.id}>
      <span className="vehicle-owner-guide-book" aria-hidden="true">▤</span>
      <span><b>Книжка моей техники</b><small>Фото, эксплуатация, памятки и оригинальные инструкции</small></span>
      <span aria-hidden="true">{open?'−':'+'}</span>
    </button>
    {open&&<div id={'vehicle-guide-'+vehicle.id} className="vehicle-owner-guide-content">
      {!category||!makeKey||!modelKey
        ? <p className="note">Эта машина внесена до обновления справочника. Уточните её марку и модель в карточке, чтобы подобрать руководство без ошибки.</p>
        : error?<p role="alert" className="note">Не удалось открыть книжку: {error}</p>
        : !card?<p className="note" role="status">Подбираю материалы по выбранной модели…</p>
        : <>
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
        </>}
    </div>}
  </section>;
}
