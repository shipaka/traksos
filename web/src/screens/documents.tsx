// Фото для проверки исполнителя: снимаем камерой, видим статус каждого, отправляем модератору.

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { get, post, del, authedImage, compressImage, getToken } from '../api.ts';
import { useAction, useMe, useToast, Loading, Back, go } from '../ui.tsx';

import {usePrivateRead} from './privateRead20261124.ts';

export function Documents() {
  const {me,reload}=useMe();
  const token=getToken();
  if(!me||!token)return null;
  const scope=JSON.stringify([me.id,token]);
  return <DocumentsAccount key={scope} scope={scope} token={token} reloadMe={reload}/>;
}

function DocumentsAccount({scope,token,reloadMe}:{scope:string;token:string;reloadMe:()=>Promise<void>}) {
  const st=usePrivateRead<any>(()=>get('/api/performer/documents'),scope,e=>e.type==='verification');
  const {run}=useAction();
  const toast=useToast();
  const [busy,setBusy]=useState(false);
  const lock=useRef(false), active=useRef(true);
  useLayoutEffect(()=>{active.current=true;return ()=>{active.current=false;};},[]);
  const current=()=>active.current&&getToken()===token;
  async function act(fn:()=>Promise<void>){
    if(lock.current||!current())return;
    lock.current=true;setBusy(true);
    try{await fn();}finally{lock.current=false;if(current())setBusy(false);}
  }
  async function upload(kind:string,f:File){
    await act(async()=>{
      const dataUrl=await compressImage(f).catch(()=>null);
      if(!current())return;
      if(!dataUrl){toast('Не удалось подготовить фото. Выберите файл ещё раз.');return;}
      const takenAt=f.lastModified?new Date(f.lastModified).toISOString():undefined;
      if(await run(()=>post('/api/performer/documents',{kind,dataUrl,takenAt}),'Фото загружено')){
        if(current())await st.reload();
      }
    });
  }
  if (st.error) return <main><Back to="work"/><div className="card stack" role="alert"><span>Не удалось загрузить документы проверки.</span><button className="btn small" type="button" onClick={()=>void st.reload()}>Повторить загрузку</button></div></main>;
  if (!st.data) return <main><Back to="work" /><Loading /></main>;
  const d = st.data;
  const done = d.required.filter((r: any) => r.doc && r.doc.status !== 'rejected').length;
  const waiting = d.verification === 'pending' && d.submittedAt;

  return (
    <main>
      <Back to="work" />
      <div>
        <h1>Проверка</h1>
        <div className="sub">Подтверждение личности добровольное. Подтверждённые мастера получают отметку доверия. Фото доступны вам и модераторам, хранятся зашифрованными.</div>
      </div>

      {d.verification === 'approved' && <div className="card"><b>✓ Проверка пройдена</b><span className="note">Если смените машину — переснимите её, профиль уйдёт на повторную проверку.</span></div>}
      {d.verification === 'rejected' && <div className="card hi"><b>Проверка не пройдена</b><span className="note">{d.note}</span></div>}
      {waiting && <div className="card hi"><b>На проверке у модератора</b><span className="note">Обычно до 24 часов. Пришлём уведомление.</span></div>}

      <div className="progress"><span style={{ width: `${d.required.length ? (done / d.required.length) * 100 : 0}%` }} /></div>
      <span className="note">{done} из {d.required.length}</span>

      {d.required.map((r: any) => <DocRow key={JSON.stringify([r.kind,r.doc?.id??null])} r={r} token={token} busy={busy} upload={upload} />)}

      {d.verification !== 'approved' && (
        <button className="btn" disabled={busy || !d.complete} onClick={()=>void act(async()=>{
          if (await run(() => post('/api/performer/documents/submit'), 'Отправлено на проверку')) {
            if(current())await st.reload();if(current())await reloadMe();
          }
        })}>{waiting ? 'Отправить ещё раз' : 'Отправить на проверку'}</button>
      )}
      <div className="card stack">
        <b>Конфиденциальные данные</b>
        <span className="note">Можно удалить фотографии паспорта, селфи и транспорта. Подтверждение будет отозвано, аккаунт останется.</span>
        <button className="btn bad" disabled={busy} onClick={()=>void act(async()=>{
          if (!confirm('Удалить все фотографии проверки? Статус подтверждения будет снят.')||!current()) return;
          const result = await run(() => del('/api/performer/documents/confidential'), 'Фотографии удалены');
          if (result) { if(current())await st.reload();if(current())await reloadMe(); }
        })}>Удалить конфиденциальные данные</button>
      </div>
      <button className="btn ghost" onClick={() => go('work')}>В кабинет</button>
    </main>
  );
}

function DocRow({r,token,busy,upload}:{r:any;token:string;busy:boolean;upload:(kind:string,f:File)=>Promise<void>}) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    const abort = new AbortController();
    let url: string | null = null;
    setSrc(null);
    if (r.doc) {
      authedImage(`/api/documents/${r.doc.id}/file`, {
        signal: abort.signal,
        allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
      }).then(u => {
        // An old photo request may settle after this row unmounts or its
        // document ID changes. Revoke it immediately, never reuse its pixels.
        if (abort.signal.aborted||getToken()!==token) { URL.revokeObjectURL(u); return; }
        url = u;
        setSrc(u);
      }).catch(() => {});
    }
    return () => {
      abort.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [r.doc?.id,token]);

  const status = r.doc?.status;
  return (
    <div className={`card ${status === 'rejected' ? 'hi' : ''}`}>
      <div className="between">
        <b>{r.name}</b>
        {status === 'approved' && <span className="pill good">Принято</span>}
        {status === 'pending' && <span className="pill">Загружено</span>}
        {status === 'rejected' && <span className="pill bad">Переснять</span>}
      </div>
      <span className="note">{status === 'rejected' ? `Модератор: ${r.doc.note}` : r.hint}</span>
      {src && <img src={src} alt={r.name} style={{ width: '100%', maxHeight: 220, objectFit: 'contain', borderRadius: 12 }} />}
      {status !== 'approved' && (
        <label className="btn ghost" style={{ cursor: 'pointer' }}>
          {busy ? 'Загружаю…' : r.doc ? 'Переснять' : 'Снять'}
          <input type="file" accept="image/*" capture={r.camera} hidden disabled={busy} onChange={(e) => {
            const file = e.currentTarget.files?.[0];
            // Selecting the same photo after a failed upload must trigger change again.
            // Clear only the input value; the captured File remains valid for compression.
            e.currentTarget.value = '';
            if(file)void upload(r.kind,file);
          }} />
        </label>
      )}
    </div>
  );
}
