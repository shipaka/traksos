// Обязательное согласие с офертой: если действующая редакция не принята — окно поверх всего,
// с текстом и галочкой. Пока не принял, ключевые действия сервер не пропустит.

import { useEffect, useState } from 'react';
import { get, post, onEvent, ApiError } from '../api.ts';
import { useAction, useMe } from '../ui.tsx';
import { Markdown } from '../markdown.tsx';
import { EconomicsGuide } from './economicsGuide.tsx';

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

/** Страница оферты по ссылке: #/offer/client, #/offer/performer, #/offer/privacy.
 * A network/server failure is NOT proof a legal version is unpublished.
 */
export function OfferPage({ audience }: { audience: string }) {
  const [o, setO] = useState<any>(undefined);
  const [loadError, setLoadError] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let active = true;
    setO(undefined);
    setLoadError(false);
    get(`/api/offers/current/${audience}`)
      .then(value => { if (active) setO(value); })
      .catch(error => {
        if (!active) return;
        if (error instanceof ApiError && error.status === 404) setO(null);
        else setLoadError(true);
      });
    return () => { active = false; };
  }, [audience, retry]);

  return (
    <main className="public-offer-page">
      <a href="#/" className="guest-explore-back">← На главную</a>
      {loadError ? (
        <section className="offer-unpublished" role="alert">
          <h1>Не удалось загрузить документ</h1>
          <p>Сервер не ответил или произошла ошибка соединения. Это не означает, что документ не опубликован.</p>
          <button type="button" className="btn" onClick={() => setRetry(value => value + 1)}>Попробовать снова</button>
        </section>
      ) : o === undefined ? (
        <div className="empty" role="status">Загружаем документ…</div>
      ) : o === null ? (
        <section className="offer-unpublished" role="status">
          <h1>Документ пока не опубликован</h1>
          <p>На сервере пока нет доступной действующей редакции для этого раздела. Мы не заменяем юридический текст примером или черновиком.</p>
          <a href="#/help">Связаться с поддержкой</a>
        </section>
      ) : (
        <>
          <div className="card offer-text">
            <span className="note">Редакция {o.version} · с {new Date(o.effective_at).toLocaleDateString('ru-RU')}</span>
            <Markdown text={o.body ?? ''} />
          </div>
          {audience !== 'privacy' && <EconomicsGuide inOffer />}
          <p className="note">Действующая правовая редакция — текст выше. Изменение тарифов требует новой опубликованной версии документа и предусмотренного принятия пользователем; примеры текущей экономики не изменяют уже подписанную редакцию задним числом.</p>
        </>
      )}
    </main>
  );
}
