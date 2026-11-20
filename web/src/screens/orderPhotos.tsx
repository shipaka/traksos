/**
 * Genuine repair photo evidence for the approved 618.png master quick action.
 * The camera/gallery remains on the user's device until they explicitly upload.
 * Images are re-encoded via canvas to strip EXIF/location before encryption by
 * the server. Debug preview never opens a picker or sends an API request.
 */
import { useEffect, useRef, useState } from 'react';
import { API_URL, get, getToken, post } from '../api.ts';
import { useLoad, useToast } from '../ui.tsx';
import { NavGlyph } from '../navGlyph.tsx';

type PhotoMeta={id:string;mime:string;size_bytes:number;created_at:string;uploader_name:string|null};
const MAX_UPLOAD=1_400_000;

async function safeJpeg(file:File):Promise<string>{
  if(!file.type.startsWith('image/') || file.size>18_000_000)
    throw new Error('Нужна фотография до 18 МБ');
  const bitmap=await createImageBitmap(file);
  try {
    const canvas=document.createElement('canvas');
    const ctx=canvas.getContext('2d');
    if(!ctx)throw new Error('Не удалось подготовить фотографию');
    for(const longest of [1600,1400,1200,1000]){
      const factor=Math.min(1,longest/Math.max(bitmap.width,bitmap.height));
      canvas.width=Math.max(1,Math.round(bitmap.width*factor));
      canvas.height=Math.max(1,Math.round(bitmap.height*factor));
      ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);
      ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);
      for(const quality of [.88,.74,.62]){
        const value=canvas.toDataURL('image/jpeg',quality);
        const bytes=Math.ceil((value.length-value.indexOf(',')-1)*.75);
        if(bytes<=MAX_UPLOAD && bytes>=1_000)return value;
      }
    }
    throw new Error('Не удалось уменьшить фото — выберите другое');
  } finally { bitmap.close?.(); }
}

export function OrderPhotoCapture({orderId,reviewOnly=false}:{
  orderId:string;reviewOnly?:boolean;
}){
  const [busy,setBusy]=useState(false);
  const input=useRef<HTMLInputElement>(null);
  const toast=useToast();
  const upload=async(file?:File)=>{
    if(!file || busy || reviewOnly)return;
    setBusy(true);
    try{
      const dataUrl=await safeJpeg(file);
      await post('/api/orders/'+encodeURIComponent(orderId)+'/photos',{dataUrl});
      window.dispatchEvent(new CustomEvent('traksos-photo-added',{detail:{orderId}}));
      toast('Фото прикреплено к заявке');
    }catch(e){toast(e instanceof Error?e.message:'Не удалось загрузить фото')}
    finally{setBusy(false);if(input.current)input.current.value='';}
  };
  if(reviewOnly)return <button type="button" className="and19-photo-capture" aria-label="Фото заявки — безопасное демо">
    <NavGlyph glyph="camera"/>Фото
  </button>;
  return <label className={'and19-photo-capture'+(busy?' is-busy':'')}
    aria-label="Прикрепить реальное фото к текущей заявке">
    <NavGlyph glyph="camera"/><span>{busy?'Загрузка…':'Фото'}</span>
    <input ref={input} type="file" accept="image/jpeg,image/png,image/webp"
      capture="environment" disabled={busy}
      onChange={event=>{void upload(event.currentTarget.files?.[0]);}}/>
  </label>;
}

function SecurePhoto({orderId,photo}:{orderId:string;photo:PhotoMeta}){
  const [src,setSrc]=useState('');
  const [expanded,setExpanded]=useState(false);
  useEffect(()=>{
    if(!expanded)return;
    const close=(event:KeyboardEvent)=>{if(event.key==='Escape')setExpanded(false)};
    document.addEventListener('keydown',close);
    return ()=>document.removeEventListener('keydown',close);
  },[expanded]);
  useEffect(()=>{
    if(!getToken())return;
    if(sessionStorage.getItem('traksos.sandboxMode')==='1' &&
       new URL(API_URL||location.origin,location.origin).origin!==location.origin)return;
    const abort=new AbortController();
    let objectUrl='';
    const url=API_URL+'/api/orders/'+encodeURIComponent(orderId)+
      '/photos/'+encodeURIComponent(photo.id)+'/file';
    fetch(url,{headers:{authorization:'Bearer '+getToken()},cache:'no-store',signal:abort.signal})
      .then(r=>{if(!r.ok)throw new Error('Нет доступа к файлу');return r.blob()})
      .then(blob=>{
        if(abort.signal.aborted)return;
        if(!['image/jpeg','image/png','image/webp'].includes(blob.type))return;
        objectUrl=URL.createObjectURL(blob);setSrc(objectUrl);
      }).catch(()=>{});
    return ()=>{abort.abort();if(objectUrl)URL.revokeObjectURL(objectUrl)};
  },[orderId,photo.id]);
  return <>
    <button className="tr-order-photo" type="button" disabled={!src}
      onClick={()=>setExpanded(true)}
      aria-label={'Посмотреть фото ремонта от '+(photo.uploader_name||'исполнителя')}>
      {src?<img src={src} loading="lazy" alt="Фотография ремонта по этой заявке"/>:
        <span className="tr-order-photo-loading">Загружаем фото</span>}
      <small>{photo.uploader_name||'Исполнитель'} · {new Date(photo.created_at).toLocaleDateString('ru-RU')}</small>
    </button>
    {expanded&&src&&<div className="tr-order-photo-backdrop" onClick={()=>setExpanded(false)}>
      <div className="tr-order-photo-modal" role="dialog" aria-modal="true"
        aria-label="Фото ремонта" onClick={e=>e.stopPropagation()}>
        <button autoFocus type="button" onClick={()=>setExpanded(false)}>Закрыть фото</button>
        <img src={src} alt="Фотография ремонта, прикреплённая к заявке"/>
      </div>
    </div>}
  </>;
}

export function OrderPhotoGallery({orderId}:{orderId:string}){
  const files=useLoad<PhotoMeta[]>(()=>get('/api/orders/'+encodeURIComponent(orderId)+'/photos'),[orderId]);
  useEffect(()=>{
    const onAdded=(event:Event)=>{
      if((event as CustomEvent<{orderId:string}>).detail?.orderId===orderId)files.reload();
    };
    window.addEventListener('traksos-photo-added',onAdded);
    return ()=>window.removeEventListener('traksos-photo-added',onAdded);
  },[orderId,files.reload]);
  if(!files.data?.length)return null;
  return <section className="tr-order-photo-gallery" aria-label="Реальные фотографии по заявке">
    <div className="between"><h2>Фотографии ремонта</h2>
      <span className="note">{files.data.length} шт.</span></div>
    <div className="tr-order-photo-grid">
      {files.data.map(photo=><SecurePhoto key={photo.id} orderId={orderId} photo={photo}/>)}
    </div>
    <small>Фото сохранены внутри заявки и доступны только её участникам.</small>
  </section>;
}
