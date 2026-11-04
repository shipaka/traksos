// Обязательное согласие с офертой: если действующая редакция не принята — окно поверх всего,
// с текстом и галочкой. Пока не принял, ключевые действия сервер не пропустит.

import { useEffect, useState } from 'react';
import { get, post, onEvent, ApiError } from '../api.ts';
import { useAction, useMe } from '../ui.tsx';
import { Markdown } from '../markdown.tsx';

/** Любой ответ сервера «offer_required» открывает окно согласия */
export const offerRequired = new EventTarget();
export function reportApiError(e: unknown) {
  if (e instanceof ApiError && e.code === 'offer_required') offerRequired.dispatchEvent(new Event('need'));
}

export function OfferGate() {
  const { me } = useMe();
  const [pending, setPending] = useState<any[]>([]);
  const load = () => get('/api/me/offers').then((list: any[]) => setPending(list.filter((x) => x.current && !x.accepted))).catch(() => {});
  useEffect(() => { if (me) load(); }, [me?.id]); // eslint-disable-line
  useEffect(() => onEvent((e) => { if (e.type === 'offer') load(); }), []);
  useEffect(() => { const f = () => load(); offerRequired.addEventListener('need', f); return () => offerRequired.removeEventListener('need', f); }, []);
  if (!me || !pending.length) return null;
  return <OfferModal key={pending[0].current.id} item={pending[0]} left={pending.length} onDone={load} />;
}

function OfferModal({ item, left, onDone }: { item: any; left: number; onDone: () => void }) {
  const { busy, run } = useAction();
  const [agree, setAgree] = useState(false);
  const [full, setFull] = useState<any>(null);
  useEffect(() => { get(`/api/offers/${item.current.id}`).then(setFull).catch(() => {}); }, [item.current.id]);
  return (
    <div className="call" role="dialog" aria-modal="true" aria-label={item.name} style={{ justifyContent: 'flex-start', gap: 14, overflowY: 'auto' }}>
      <span className="label" style={{ color: 'var(--accent)' }}>Условия изменились{left > 1 ? ` · ещё ${left - 1}` : ''}</span>
      <h1>{item.name}</h1>
      <span className="note">Редакция {item.current.version} · действует с {new Date(item.current.effective_at).toLocaleDateString('ru-RU')}</span>
      {item.current.summary && <div className="card"><b>Что изменилось</b><span>{item.current.summary}</span></div>}
      <div className="card offer-text">{full ? <Markdown text={full.body ?? ''} /> : 'Загружаю текст…'}</div>
      <label className="row" style={{ flexWrap: 'nowrap', alignItems: 'flex-start' }}>
        <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} style={{ marginTop: 4, width: 20, height: 20 }} />
        <span>Я прочитал и принимаю «{item.name}», редакция {item.current.version}</span>
      </label>
      <button className="btn" disabled={!agree || busy} onClick={async () => {
        if (await run(() => post(`/api/offers/${item.current.id}/accept`), 'Спасибо — условия приняты')) onDone();
      }}>Принимаю</button>
    </div>
  );
}

/** Страница оферты по ссылке: #/offer/client, #/offer/performer, #/offer/privacy */
export function OfferPage({ audience }: { audience: string }) {
  const [o, setO] = useState<any>(undefined);
  useEffect(() => { get(`/api/offers/current/${audience}`).then(setO).catch(() => setO(null)); }, [audience]);
  return (
    <main>
      <a href="#/" className="note" style={{ textDecoration: 'none' }}>← Назад</a>
      {o === undefined ? <div className="empty">Загружаю…</div> : o === null ? <div className="empty">Документ ещё не опубликован</div> : (
        <div className="card offer-text"><span className="note">Редакция {o.version} · с {new Date(o.effective_at).toLocaleDateString('ru-RU')}</span><Markdown text={o.body ?? ''} /></div>
      )}
    </main>
  );
}
