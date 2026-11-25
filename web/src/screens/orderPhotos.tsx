/**
 * Genuine repair photo evidence for the approved 618.png master quick action.
 * The camera/gallery remains on the user's device until they explicitly upload.
 * Images are re-encoded via canvas to strip EXIF/location before encryption by
 * the server. Debug preview never opens a picker or sends an API request.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { authedImage, get, getToken, post } from '../api.ts';
import { useLoad, useToast } from '../ui.tsx';
import { NavGlyph } from '../navGlyph.tsx';
import './orderPhotos.css';

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
  const pending=useRef<{token:string}|null>(null);
  useLayoutEffect(()=>{
    // A new order, review-only mode or auth boundary owns a different
    // capture session, even if the bearer happens to remain identical.
    const invalidate=()=>{
      pending.current=null;
      setBusy(false);
      if(input.current)input.current.value='';
    };
    invalidate();
    window.addEventListener('traksos-auth-external-change',invalidate);
    window.addEventListener('traksos-auth-expired',invalidate);
    return ()=>{
      pending.current=null;
      window.removeEventListener('traksos-auth-external-change',invalidate);
      window.removeEventListener('traksos-auth-expired',invalidate);
    };
  },[orderId,reviewOnly]);
  const upload=async(file?:File)=>{
    if(!file || pending.current || reviewOnly)return;
    const uploadToken=getToken();
    if(!uploadToken){toast('Войдите в аккаунт перед отправкой фото');return;}
    const request={token:uploadToken};
    pending.current=request;
    const current=()=>pending.current===request && getToken()===request.token;
    setBusy(true);
    try{
      const dataUrl=await safeJpeg(file);
      // A delayed JPEG must never be sent after changing order/account or
      // closing the capture. The check is immediately before POST dispatch.
      if(!current())return;
      await post('/api/orders/'+encodeURIComponent(orderId)+'/photos',{dataUrl});
      if(!current())return;
      window.dispatchEvent(new CustomEvent('traksos-photo-added',{detail:{orderId}}));
      toast('Фото прикреплено к заявке');
    }catch(e){if(current())toast(e instanceof Error?e.message:'Не удалось загрузить фото')}
    finally{
      // A stale request cannot unlock a newer upload or clear its file.
      if(pending.current===request){
        pending.current=null;
        setBusy(false);
        if(input.current)input.current.value='';
      }
    }
  };
  // An explanatory control in review-only mode must not pretend it can launch
  // a camera or upload to a real order.
  if(reviewOnly)return <span className="and19-photo-capture" role="img"
    aria-label="Фото заявки — только демонстрация, загрузка недоступна">
    <NavGlyph glyph="camera"/><span>Фото</span>
  </span>;
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
  const [failed,setFailed]=useState(false);
  const [attempt,setAttempt]=useState(0);
  // The file belongs to the current authenticated workspace only. A logout
  // or login in another tab must release any previously loaded private pixels.
  useEffect(()=>{
    const reset=()=>{setExpanded(false);setSrc('');setAttempt(value=>value+1)};
    window.addEventListener('traksos-auth-external-change',reset);
    window.addEventListener('traksos-auth-expired',reset);
    return ()=>{
      window.removeEventListener('traksos-auth-external-change',reset);
      window.removeEventListener('traksos-auth-expired',reset);
    };
  },[]);
  useEffect(()=>{
    if(!expanded)return;
    const close=(event:KeyboardEvent)=>{if(event.key==='Escape')setExpanded(false)};
    document.addEventListener('keydown',close);
    return ()=>document.removeEventListener('keydown',close);
  },[expanded]);
  useEffect(()=>{
    setSrc('');
    setFailed(false);
    if(!getToken()){setFailed(true);return;}
    const abort=new AbortController();
    let objectUrl='';
    const path='/api/orders/'+encodeURIComponent(orderId)+
      '/photos/'+encodeURIComponent(photo.id)+'/file';
    // Keep the existing bearer-snapshot, sandbox and MIME protections.
    // Failed private downloads never cache old pixels; a retry is explicit.
    authedImage(path,{
      signal:abort.signal,
      allowedMimeTypes:['image/jpeg','image/png','image/webp'],
    }).then(url=>{
      if(abort.signal.aborted){URL.revokeObjectURL(url);return;}
      objectUrl=url;
      setSrc(url);
    }).catch(()=>{
      if(!abort.signal.aborted)setFailed(true);
    });
    return ()=>{abort.abort();if(objectUrl)URL.revokeObjectURL(objectUrl)};
  },[orderId,photo.id,attempt]);
  const person=photo.uploader_name||'исполнителя';
  return <>
    <button className="tr-order-photo" type="button" disabled={!src&&!failed}
      onClick={()=>{if(failed){setAttempt(value=>value+1);return;}setExpanded(true)}}
      aria-label={failed
        ? 'Повторить загрузку фото ремонта от '+person
        : 'Посмотреть фото ремонта от '+person}>
      {src?<img src={src} loading="lazy" alt="Фотография ремонта по этой заявке"/>:
        <span className="tr-order-photo-loading">{failed?'Фото недоступно · Повторить':'Загружаем фото'}</span>}
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
  const [retrying,setRetrying]=useState(false);
  const retry=async()=>{
    if(retrying)return;
    setRetrying(true);
    try{await files.reload()}finally{setRetrying(false)}
  };
  useEffect(()=>{
    const onAdded=(event:Event)=>{
      if((event as CustomEvent<{orderId:string}>).detail?.orderId===orderId)files.reload();
    };
    window.addEventListener('traksos-photo-added',onAdded);
    return ()=>window.removeEventListener('traksos-photo-added',onAdded);
  },[orderId,files.reload]);
  if(files.error)return <section className="tr-order-photo-gallery" role="alert"
    aria-label="Ошибка загрузки фотографий заявки">
    <b>Не удалось загрузить фотографии заявки</b>
    <p className="note">Проверьте соединение и повторите запрос. Снимки в заявке не удалены.</p>
    <button type="button" className="btn secondary" disabled={retrying}
      onClick={()=>{void retry()}}>{retrying?'Проверяем…':'Повторить загрузку'}</button>
  </section>;
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
