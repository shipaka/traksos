// Обязательное согласие с офертой: если действующая редакция не принята — окно поверх всего,
// с текстом и галочкой. Пока не принял, ключевые действия сервер не пропустит.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { get, getToken, post, onEvent, ApiError } from '../api.ts';
import { useAction, useMe } from '../ui.tsx';
import { Markdown } from '../markdown.tsx';
import { EconomicsGuide } from './economicsGuide.tsx';

/** Любой ответ сервера «offer_required» открывает окно согласия */
export const offerRequired = new EventTarget();
export function reportApiError(e: unknown) {
  if (e instanceof ApiError && (e.code === 'offer_required' || e.code === 'offer_outdated')) offerRequired.dispatchEvent(new Event('need'));
}

export function OfferGate() {
  const context=useMe();
  const me=context?.me,mode=context?.mode??'client';
  const token=getToken();
  if(!me||!token)return null;
  return <OfferGateAccount key={JSON.stringify([me.id,token,mode])} token={token} mode={mode}/>;
}

function OfferGateAccount({token,mode}:{token:string;mode:string}){
  const [pending,setPending]=useState<any[]>([]);
  const serial=useRef(0),active=useRef(true);
  useLayoutEffect(()=>{active.current=true;return ()=>{active.current=false;serial.current++;};},[]);
  const load=useCallback(async()=>{
    if(!active.current||getToken()!==token)return;
    const n=++serial.current;
    try{
      const list=await get<any[]>('/api/me/offers');
      if(active.current&&getToken()===token&&serial.current===n)
        setPending(list.filter(x=>x.current&&!x.accepted));
    }catch{/* Keep only this session's pending agreements; the server still enforces consent. */}
  },[token]);
  useEffect(()=>{void load();},[load]);
  useEffect(()=>onEvent(e=>{if(e.type==='offer')void load();}),[load]);
  useEffect(()=>{const f=()=>void load();offerRequired.addEventListener('need',f);return ()=>offerRequired.removeEventListener('need',f);},[load]);
  // Mixed-role accounts must only see agreements for the ACTIVE workspace.
  // Mandatory server-side consent checks are unchanged on role-specific actions.
  const audiencesByMode: Record<string,string[]> = {
    client:['client'], performer:['performer'], service:['performer'],
    insurer:['insurer'], inspection:['inspection'],
    courier:[], admin:[], moderator:[]
  };
  const visible = pending.filter(item => item.audience === 'privacy' ||
    audiencesByMode[mode]?.includes(item.audience));
  if (!visible.length) return null;
  return <OfferModal key={JSON.stringify([visible[0].current.id,visible[0].current.version,visible[0].audience])} token={token} item={visible[0]} left={visible.length} onDone={load} />;
}

function OfferModal({ item, left, onDone, token }: { item: any; left: number; onDone: () => void; token:string }) {
  const { busy, run } = useAction();
  const activeSession=useRef(true), submitting=useRef(false);
  useLayoutEffect(()=>{activeSession.current=true;return ()=>{activeSession.current=false;};},[]);
  const current=()=>activeSession.current&&getToken()===token;
  const [agree, setAgree] = useState(false);
  const [full, setFull] = useState<any>(null);
  const [loadError, setLoadError] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setFull(null);
    setLoadError(false);
    setAgree(false);
    get(`/api/offers/${item.current.id}`)
      .then((value: any) => {
        if (!active||!current()) return;
        // Consent is only allowed for the actual, readable, current edition.
        if (value?.id !== item.current.id ||
            value?.version !== item.current.version ||
            value?.audience !== item.audience ||
            typeof value?.body !== 'string' || !value.body.trim()) {
          setLoadError(true);
          return;
        }
        setFull(value);
      })
      .catch(() => { if (active&&current()) setLoadError(true); });
    return () => { active = false; };
  }, [item.current.id, item.current.version, item.audience, retry]);
  const canAccept = !!full && !loadError && !busy;
  return (
    <div className="call" role="dialog" aria-modal="true" aria-label={item.name} style={{ justifyContent: 'flex-start', gap: 14, overflowY: 'auto' }}>
      <span className="label" style={{ color: 'var(--accent)' }}>Условия изменились{left > 1 ? ` · ещё ${left - 1}` : ''}</span>
      <h1>{item.name}</h1>
      <span className="note">Редакция {item.current.version} · с {new Date(item.current.effective_at).toLocaleDateString('ru-RU')}</span>
      {String(item.current.version).toLowerCase().includes('черновик') && <p className="note" role="note">Тестовый черновик для проверки интерфейса. Это не согласованный юридический документ и не окончательный текст для публикации.</p>}
      {item.current.summary && <div className="card"><b>Что изменилось</b><span>{item.current.summary}</span></div>}
      <div className="card offer-text">{loadError ? (
        <div role="alert">
          <p>Не удалось загрузить действующую редакцию условий. Принять документ без его текста нельзя.</p>
          <button type="button" className="btn ghost" onClick={() => setRetry(value => value + 1)}>Попробовать снова</button>
        </div>
      ) : full ? <Markdown text={full.body} /> : <span role="status">Загружаю текст…</span>}</div>
      <label className="row" style={{ flexWrap: 'nowrap', alignItems: 'flex-start' }}>
        <input type="checkbox" checked={agree} disabled={!full || loadError || busy} onChange={(e) => setAgree(e.target.checked)} style={{ marginTop: 4, width: 20, height: 20 }} />
        <span>Я прочитал и принимаю «{item.name}», редакция {item.current.version}</span>
      </label>
      <button className="btn" disabled={!agree || !canAccept} onClick={async () => {
        if (!agree || !canAccept || submitting.current || !current()) return;
        submitting.current=true;
        try{
          if(await run(()=>post(`/api/offers/${item.current.id}/accept`),'Спасибо — условия приняты')){
            if(current()){setAgree(false);onDone();}
          }
        }finally{submitting.current=false;}
      }}>Принимаю</button>
    </div>
  );
}

const documentTitles = new Map([
  ['client', 'Оферта для клиентов'],
  ['performer', 'Условия для партнёров'],
  ['privacy', 'Обработка персональных данных'],
  ['insurer', 'Договор страхового партнёра'],
  ['inspection', 'Договор оператора техосмотра'],
]);

/** Страница оферты по ссылке: #/offer/client, #/offer/performer, #/offer/privacy.
 * A network/server failure is NOT proof a legal version is unpublished.
 */
export function OfferPage({ audience }: { audience: string }) {
  return <OfferPageEdition key={audience} audience={audience}/>;
}

function OfferPageEdition({audience}:{audience:string}) {
  const [o, setO] = useState<any>(undefined);
  const title = documentTitles.get(audience) ?? 'Документ';
  const [loadError, setLoadError] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let active = true;
    setO(undefined);
    setLoadError(false);
    get(`/api/offers/current/${encodeURIComponent(audience)}`)
      .then(value => {
        if(!active)return;
        // This endpoint intentionally returns JSON null for unpublished documents.
        if(value===null){setO(null);return;}
        if(!value||value.audience!==audience||typeof value.version!=='string'||!value.version.trim()||typeof value.body!=='string'||!value.body.trim()||!Number.isFinite(Date.parse(value.effective_at))) {
          setLoadError(true);return;
        }
        setO(value);
      })
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
          <h1>{title}</h1>
          <p>Не удалось загрузить документ</p>
          <p>Сервер не ответил или произошла ошибка соединения. Это не означает, что документ не опубликован.</p>
          <button type="button" className="btn" onClick={() => setRetry(value => value + 1)}>Попробовать снова</button>
        </section>
      ) : o === undefined ? (
        <div className="empty" role="status">Загружаем документ…</div>
      ) : o === null ? (
        <section className="offer-unpublished" role="status">
          <h1>{title}</h1>
          <p>Документ пока не опубликован</p>
          <p>На сервере пока нет доступной действующей редакции для этого раздела. Мы не заменяем юридический текст примером или черновиком.</p>
          <a href="#/login">Войти для обращения в поддержку</a>
        </section>
      ) : (
        <>
          <div className="card offer-text">
            <span className="note">Редакция {o.version} · с {new Date(o.effective_at).toLocaleDateString('ru-RU')}</span>
            <Markdown text={o.body ?? ''} />
          </div>
          {audience !== 'privacy' && <EconomicsGuide inOffer />}
          {audience === 'performer' && <p className="note" role="note">Информация для исполнителя: в конкретном выездном заказе ставка комиссии сохраняется при его создании; временная акция от 0 до 5% не меняет старые заказы. При 0% удержание и списание баллов в счёт комиссии отсутствуют. Это пояснение к текущему расчёту, а не изменение текста опубликованной редакции договора выше.</p>}
          {String(o.version).toLowerCase().includes('черновик')
            ? <p className="note" role="note">Тестовый черновик. Не является окончательной юридической редакцией. До публикации реального согласия или оферты требуется проверенный текст.</p>
            : <p className="note">Действующая правовая редакция — текст выше. Изменение тарифов требует новой опубликованной версии документа и предусмотренного принятия пользователем; примеры текущей экономики не изменяют уже подписанную редакцию задним числом.</p>}
        </>
      )}
    </main>
  );
}
