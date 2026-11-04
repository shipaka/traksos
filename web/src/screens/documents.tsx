// Фото для проверки исполнителя: снимаем камерой, видим статус каждого, отправляем модератору.

import { useEffect, useState } from 'react';
import { get, post, authedImage, compressImage } from '../api.ts';
import { useLoad, useAction, useMe, Loading, Back, go } from '../ui.tsx';

export function Documents() {
  const { reload: reloadMe } = useMe();
  const st = useLoad(() => get('/api/performer/documents'), [], (e) => e.type === 'verification');
  const { busy, run } = useAction();
  if (!st.data) return <main><Back to="work" /><Loading error={st.error} /></main>;
  const d = st.data;
  const done = d.required.filter((r: any) => r.doc && r.doc.status !== 'rejected').length;
  const waiting = d.verification === 'pending' && d.submittedAt;

  return (
    <main>
      <Back to="work" />
      <div>
        <h1>Проверка</h1>
        <div className="sub">Снимите камерой прямо сейчас — фото из галереи модератор может не принять. Фото видят только вы и модератор, хранятся зашифрованными.</div>
      </div>

      {d.verification === 'approved' && <div className="card"><b>✓ Проверка пройдена</b><span className="note">Если смените машину — переснимите её, профиль уйдёт на повторную проверку.</span></div>}
      {d.verification === 'rejected' && <div className="card hi"><b>Проверка не пройдена</b><span className="note">{d.note}</span></div>}
      {waiting && <div className="card hi"><b>На проверке у модератора</b><span className="note">Обычно до 24 часов. Пришлём уведомление.</span></div>}

      <div className="progress"><span style={{ width: `${(done / d.required.length) * 100}%` }} /></div>
      <span className="note">{done} из {d.required.length}</span>

      {d.required.map((r: any) => <DocRow key={r.kind} r={r} onDone={st.reload} />)}

      {d.verification !== 'approved' && (
        <button className="btn" disabled={busy || !d.complete} onClick={async () => {
          if (await run(() => post('/api/performer/documents/submit'), 'Отправлено на проверку')) { st.reload(); reloadMe(); }
        }}>{waiting ? 'Отправить ещё раз' : 'Отправить на проверку'}</button>
      )}
      <button className="btn ghost" onClick={() => go('work')}>В кабинет</button>
    </main>
  );
}

function DocRow({ r, onDone }: { r: any; onDone: () => void }) {
  const { busy, run } = useAction();
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let url: string | null = null;
    if (r.doc) authedImage(`/api/documents/${r.doc.id}/file`).then((u) => { url = u; setSrc(u); }).catch(() => {});
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [r.doc?.id]);

  async function onFile(f: File | undefined) {
    if (!f) return;
    const dataUrl = await compressImage(f).catch(() => null);
    if (!dataUrl) return;
    const takenAt = f.lastModified ? new Date(f.lastModified).toISOString() : undefined;
    if (await run(() => post('/api/performer/documents', { kind: r.kind, dataUrl, takenAt }), 'Фото загружено')) onDone();
  }

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
      {src && <img src={src} alt={r.name} style={{ width: '100%', maxHeight: 220, objectFit: 'cover', borderRadius: 12 }} />}
      {status !== 'approved' && (
        <label className="btn ghost" style={{ cursor: 'pointer' }}>
          {busy ? 'Загружаю…' : r.doc ? 'Переснять' : 'Снять'}
          <input type="file" accept="image/*" capture={r.camera} hidden disabled={busy} onChange={(e) => onFile(e.target.files?.[0])} />
        </label>
      )}
    </div>
  );
}
