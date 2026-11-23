// Фото для проверки исполнителя: снимаем камерой, видим статус каждого, отправляем модератору.

import { useEffect, useState } from 'react';
import { get, post, del, authedImage, compressImage, getToken } from '../api.ts';
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
        <div className="sub">Подтверждение личности добровольное. Подтверждённые мастера получают отметку доверия. Фото доступны вам и модераторам, хранятся зашифрованными.</div>
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
      <div className="card stack">
        <b>Конфиденциальные данные</b>
        <span className="note">Можно удалить фотографии паспорта, селфи и транспорта. Подтверждение будет отозвано, аккаунт останется.</span>
        <button className="btn bad" disabled={busy} onClick={async () => {
          if (!confirm('Удалить все фотографии проверки? Статус подтверждения будет снят.')) return;
          const result = await run(() => del('/api/performer/documents/confidential'), 'Фотографии удалены');
          if (result) { await st.reload(); await reloadMe(); }
        }}>Удалить конфиденциальные данные</button>
      </div>
      <button className="btn ghost" onClick={() => go('work')}>В кабинет</button>
    </main>
  );
}

function DocRow({ r, onDone }: { r: any; onDone: () => void }) {
  const { busy, run } = useAction();
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
        if (abort.signal.aborted) { URL.revokeObjectURL(u); return; }
        url = u;
        setSrc(u);
      }).catch(() => {});
    }
    return () => {
      abort.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [r.doc?.id]);

  async function onFile(f: File | undefined) {
    if (!f) return;
    const uploadToken = getToken();
    if (!uploadToken) return;
    const dataUrl = await compressImage(f).catch(() => null);
    if (!dataUrl || getToken() !== uploadToken) return;
    // Do not submit confidential identity/vehicle documents through another
    // account if logout happened during canvas compression on mobile.
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
          <input type="file" accept="image/*" capture={r.camera} hidden disabled={busy} onChange={(e) => {
            const file = e.currentTarget.files?.[0];
            // Selecting the same photo after a failed upload must trigger change again.
            // Clear only the input value; the captured File remains valid for compression.
            e.currentTarget.value = '';
            void onFile(file);
          }} />
        </label>
      )}
    </div>
  );
}
