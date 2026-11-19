import { useEffect, useRef, useState } from 'react';
import { get, post, del } from '../api.ts';
import { Back, useMe } from '../ui.tsx';

interface BotMessage { id: string; role: 'user'|'bot'; body: string; created_at: string; action_path?: string|null; action_label?: string|null; }
const allowedRoutes = new Set(['/orders','/work/jobs','/base','/profile','/shop','/garage',
  '/fleet','/tech/codes','/work/docs','/insurance/request/new','/support','/help','/rules']);
const advice = 'TrakBot даёт справочные рекомендации, не диагноз. Он может ошибаться: проверяй важное с мастером. При проблемах с тормозами, рулевым или подвеской не продолжай движение.';
interface BotHistory { messages: BotMessage[]; freePilot: true; aiAvailable?: boolean; }
interface CodeRecord {
  code: string; title_en: string; title_ru: string|null;
  detail_en: string|null; detail_ru: string|null; source_url: string; review_state: string;
}
const initialGreeting = 'Здорово! Что с машиной? Напиши код ошибки или просто расскажи, что происходит. По порядку разберёмся.';

export function TrakBotChat({ compact = false, onNavigate }: { compact?: boolean; onNavigate?: () => void } = {}) {
  const { me } = useMe();
  const [messages, setMessages] = useState<BotMessage[]>([]);
  const [text, setText] = useState('');
  const [make, setMake] = useState('');
  const [ecu, setEcu] = useState('');
  const [model, setModel] = useState('');
  const [year, setYear] = useState('');
  const [aiAvailable, setAiAvailable] = useState(false);
  const [aiConsent, setAiConsent] = useState(false);
  const [handoff, setHandoff] = useState(false);
  const [working, setWorking] = useState(false);
  const [listening, setListening] = useState(false);
  const speechRef = useRef<any>(null);
  // Launch gate: voice recognition may send audio to the browser vendor.
  // Enable only after 152-FZ/privacy assessment and configured speech provider.
  const speechAvailable = typeof window !== 'undefined' && (window as any).TRAKSOS_VOICE_INPUT_ENABLED === true &&
    !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);
  const startDictation = () => {
    // Browser/Android WebView permission happens only after an explicit tap.
    if (!speechAvailable || working) return;
    if (listening) { speechRef.current?.stop(); return; }
    const Ctor = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    const recognition = new Ctor();
    speechRef.current = recognition;
    recognition.lang = 'ru-RU';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onresult = (event: any) => {
      const result = String(event.results?.[0]?.[0]?.transcript ?? '').trim();
      if (result) setText((current) => (current ? current + ' ' : '') + result);
    };
    recognition.onerror = () => setError('Голосовой ввод недоступен. Напиши сообщение текстом.');
    recognition.onend = () => { speechRef.current = null; setListening(false); };
    try { setError(''); setListening(true); recognition.start(); }
    catch { setListening(false); setError('Не получилось включить микрофон. Можно написать текстом.'); }
  };
  useEffect(() => () => speechRef.current?.abort(), []);
  const [error, setError] = useState('');
  const end = useRef<HTMLDivElement>(null);
  const msgBox = useRef<HTMLDivElement>(null);
  const isTech = !!me?.roles.some((role) => ['master','service','admin','moderator'].includes(role));
  const canUseTech = !!me?.roles.some((role) => ['admin','moderator'].includes(role)) ||
    (isTech && me?.performer?.verification === 'approved');
  useEffect(() => {
    let live = true;
    get<BotHistory>('/api/trakbot/messages').then((result) => { if (live) { setMessages(result.messages); setAiAvailable(!!result.aiAvailable); } })
      .catch((e) => { if (live) setError(e.message || 'Не удалось загрузить диалог'); });
    return () => { live = false; };
  }, [me?.id]);
  useEffect(() => { if (msgBox.current) msgBox.current.scrollTop = msgBox.current.scrollHeight; }, [messages.length]);

  const send = async () => {
    if (working || !text.trim()) return;
    const body = text.trim();
    setWorking(true);
    setError('');
    try {
      const result = await post<{ userMessage: BotMessage; message: BotMessage; freePilot: true; handoffSuggested?: boolean }>('/api/trakbot/answer', {
        message: body, allowAiProcessing: aiAvailable && aiConsent,
        vehicle: { ...(make.trim() && { make: make.trim() }), ...(model.trim() && { model: model.trim() }),
          ...(year.length === 4 && { year: Number(year) }), ...(ecu.trim() && { ecu: ecu.trim() }) },
      });
      setMessages((old) => [...old, result.userMessage, result.message]);
      setText('');
      setHandoff(!!result.handoffSuggested);
    } catch (e: any) {
      setError(e.message || 'Ошибка связи');
      // A write may have succeeded before a network disconnect; reconcile rather than resending.
      get<BotHistory>('/api/trakbot/messages').then((history) => setMessages(history.messages)).catch(() => {});
    }
    finally { setWorking(false); }
  };

  const clearConversation = async () => {
    if (working || !messages.length || !window.confirm('Очистить всю личную переписку с TrakBot? Отменить действие нельзя.')) return;
    setWorking(true);
    setError('');
    try {
      await del('/api/trakbot/messages');
      setMessages([]);
      setHandoff(false);
      setText('');
    } catch (e: any) {
      setError(e.message || 'Не получилось очистить историю. Попробуй ещё раз.');
    } finally {
      setWorking(false);
    }
  };

  const Frame = compact ? 'div' : 'main';
  return <Frame className={compact ? 'trakbot-compact-body' : undefined}>
    {!compact && <Back to="help" />}
    {compact ? <h2 className="trakbot-compact-title">TrakBot</h2> : <h1>TrakBot</h1>}
    <div className="sub">{isTech ? 'Помощник мастера и СТО.' : 'Помощник для водителя.'} Личный чат, без публикаций в общем эфире.</div>
    <p className="trakbot-advice" role="note">{advice} <a href="#/rules" onClick={onNavigate}>Условия</a></p>
    <details className="card flat trakbot-vehicle" open={!compact || undefined}>
      <summary><b>Данные машины (необязательно)</b></summary>
      <div className="stack" style={{ gap: 8 }}>
      <div className="grid2">
        <input className="field" maxLength={60} value={make} onChange={(e) => setMake(e.target.value)} placeholder="Марка, например Scania" aria-label="Марка" />
        <input className="field" maxLength={60} value={model} onChange={(e) => setModel(e.target.value)} placeholder="Модель" aria-label="Модель" />
        <input className="field" inputMode="numeric" maxLength={4} value={year} onChange={(e) => setYear(e.target.value.replace(/\D/g, '').slice(0, 4))} placeholder="Год выпуска" aria-label="Год выпуска" />
        <input className="field" maxLength={60} value={ecu} onChange={(e) => setEcu(e.target.value)} placeholder="Блок, например EDC" aria-label="Блок управления" />
      </div>
      <span className="note">Общий OBD-II справочник — не заводская диагностика. Если кода или достоверных данных нет, TrakBot скажет об этом прямо.</span>
      {aiAvailable && <label className="note" style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <input type="checkbox" checked={aiConsent} onChange={(e) => setAiConsent(e.target.checked)} />
        Разрешаю отправлять текст моего вопроса, указанные данные машины и краткий контекст диалога внешнему ИИ-провайдеру для составления ответа.
        Номер телефона и VIN перед отправкой скрываются. Без согласия работает только локальный справочник.
      </label>}
      </div>
    </details>
    <section className="card trakbot-dialog">
      <div className="msgs" ref={msgBox} aria-live="polite" style={{ minHeight: compact ? 180 : 240, maxHeight: compact ? '35vh' : '50vh', overflowY: 'auto' }}>
        {!messages.length && <div className="msg sys"><span className="b">{initialGreeting}</span></div>}
        {messages.map((message) => <div key={message.id} className={'msg '+(message.role === 'user' ? 'me' : '')}>
          {message.role === 'bot' && <span className="n">TrakBot</span>}
          <span className="b" style={{ whiteSpace: 'pre-wrap' }}>{message.body}</span>
          {message.role === 'bot' && message.action_path && allowedRoutes.has(message.action_path) &&
            <a className="btn ghost small trakbot-direction" href={'#' + message.action_path} onClick={onNavigate}>
              {message.action_label || 'Открыть раздел'}
            </a>}
        </div>)}
        <div ref={end} />
      </div>
      {error && <div role="alert" className="note" style={{ color: 'var(--danger, #b42318)' }}>{error}</div>}
      <form className="compose" onSubmit={(event) => { event.preventDefault(); void send(); }}>
        <input className="field" maxLength={700} value={text} onChange={(e) => setText(e.target.value)} placeholder="Например: Iveco, ошибка P0087..." aria-label="Сообщение TrakBot" />
        {speechAvailable && <button type="button" className="btn ghost small" aria-label={listening ? 'Остановить запись голоса' : 'Надиктовать вопрос'} title="Надиктовать вопрос — ответ придёт текстом" onClick={startDictation}>{listening ? 'Стоп' : '🎙'}</button>}
        <button type="submit" className="btn small" disabled={working || !text.trim()}>{working ? '...' : 'Отправить'}</button>
      </form>
    </section>
    <span className="note">Сейчас это бесплатный помощник, без автоплатежей. Платные консультации — отдельно, только после явного согласия. Голосовой ввод включается отдельно после проверки устройства и приватности.</span>
    {!!messages.length && <button type="button" className="btn ghost small" disabled={working}
      aria-label="Очистить историю TrakBot" onClick={() => void clearConversation()}>Очистить мою переписку</button>}
    {handoff && <div className="card flat">
      <b>Здесь достоверной расшифровки не нашлось.</b>
      <span className="note">Не буду придумывать. Можно уточнить исходные данные или перейти к человеку — только если захочешь.</span>
      {!isTech && <a className="btn ghost" href="#/new/consult" onClick={onNavigate}>Связаться с мастером</a>}
    </div>}
    {canUseTech && <a href="#/tech/codes" className="btn ghost" onClick={onNavigate}>Технический справочник кодов для специалистов</a>}
  </Frame>;
}

export function TechCodes() {
  const { me } = useMe();
  const permitted = !!me?.roles.some((role) => ['admin','moderator'].includes(role)) ||
    (!!me?.roles.some((role) => ['master','service'].includes(role)) && me?.performer?.verification === 'approved');
  const [term, setTerm] = useState('');
  const [items, setItems] = useState<CodeRecord[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  if (!permitted) return <main><Back to="help" /><h1>Доступ ограничен</h1><p>Справочник доступен подтверждённым техническим специалистам и сотрудникам.</p></main>;
  const search = async () => {
    if (term.trim().length < 2) return;
    setBusy(true);setError('');
    try { const r = await get<{items: CodeRecord[]}>(`/api/tech/codes?q=${encodeURIComponent(term.trim())}`);setItems(r.items); }
    catch(e:any) {setError(e.message || 'Ошибка поиска');}
    finally {setBusy(false);}
  };
  return <main>
    <Back to="trakbot" />
    <h1>Техническая база TrakSOS</h1>
    <p className="sub">Справочник кодов с происхождением данных и пометками достоверности. Не заменяет заводскую документацию.</p>
    <div className="row" style={{flexWrap:'wrap'}}>
      <a className="btn ghost small" href="#/tech/cases">Реальные случаи ремонта</a>
      {me?.roles.includes('admin') && <a className="btn ghost small" href="#/tech/review">Проверить новые кейсы</a>}
    </div>
    <form className="compose" onSubmit={(e) => {e.preventDefault();void search();}}>
      <input aria-label="Поиск кода" className="field" placeholder="Код или фрагмент названия" value={term} onChange={(e)=>setTerm(e.target.value)} />
      <button className="btn small" disabled={busy || term.trim().length < 2}>Искать</button>
    </form>
    {error && <p role="alert">{error}</p>}
    {items.map((it) => <details key={it.code + ':' + it.source_url} className="card">
      <summary><b>{it.code}</b> · {it.title_ru || it.title_en}</summary>
      <div className="stack">
        <p style={{whiteSpace:'pre-wrap'}}>{it.detail_ru || it.detail_en || 'Подробности не проверены'}</p>
        <span className="note">Статус: {it.review_state === 'pilot' ? 'проверка пилотной карточки' : it.review_state === 'external_reviewed' ? 'проверено внешним источником; не заводская верификация' : 'не проверено'}</span>
        {it.source_url.startsWith('https://') && <a href={it.source_url} target="_blank" rel="noopener noreferrer">Источник данных</a>}
      </div>
    </details>)}
    {!busy && term.trim().length >= 2 && items.length === 0 && <span className="note">Совпадений пока нет. Проверь точность кода и блок управления.</span>}
  </main>;
}
