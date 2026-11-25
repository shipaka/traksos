import { useEffect, useRef, useState } from 'react';
import { get, post, del } from '../api.ts';
import { Back, useMe } from '../ui.tsx';
import { BOT_REACTIONS, botReactionFor, TrakBotMascot, TrakBotReactionGallery } from '../trakbotMascot.tsx';

interface BotMessage { id: string; role: 'user'|'bot'; body: string; created_at: string; action_path?: string|null; action_label?: string|null; }
const allowedRoutes = new Set(['/orders','/work/jobs','/base','/profile','/shop','/garage',
  '/fleet','/economics','/tech/codes','/work/docs','/insurance/request/new','/support','/help','/rules',
  '/help/case/refuses-to-pay','/help/case/no-show','/help/case/bill-changed']);
const advice = 'TrakBot даёт справочные рекомендации, не диагноз. Он может ошибаться: проверяй важное с мастером. При проблемах с тормозами, рулевым или подвеской не продолжай движение.';
interface BotHistory { messages: BotMessage[]; freePilot: true; aiAvailable?: boolean; aiTransport?: 'api'|'local'; }
interface CodeRecord {
  code: string; title_en: string; title_ru: string|null;
  detail_en: string|null; detail_ru: string|null; source_url: string; review_state: string;
}
const validMessage=(m:unknown):m is BotMessage=>{
  if(!m||typeof m!=='object')return false;
  const value=m as BotMessage;
  return typeof value.id==='string'&&!!value.id&&['user','bot'].includes(value.role)&&typeof value.body==='string';
};
const historyMessages=(result:BotHistory)=>{
  if(!result||!Array.isArray(result.messages)||!result.messages.every(validMessage))
    throw new Error('Сервер не подтвердил историю переписки');
  return [...new Map(result.messages.map(m=>[m.id,m])).values()];
};
const initialGreeting = 'Здорово! Что с машиной? Напиши код ошибки или просто расскажи, что происходит. По порядку разберёмся.';

/** Only real bot messages receive the technician character; other chats stay untouched. */
function BotBubble({ message, newest = false, onNavigate }: {
  message: BotMessage; newest?: boolean; onNavigate?: () => void;
}) {
  const reaction = botReactionFor(message.body);
  const label = BOT_REACTIONS.find((entry) => entry.id === reaction)?.label || 'Помогу разобраться';
  return <div className={'msg trakbot-message--bot' + (newest ? ' trakbot-message--new' : '')}>
    <div className="trakbot-bot-layout">
      <TrakBotMascot reaction={reaction} size="small" />
      <div className="trakbot-bot-content">
        <div className="trakbot-bot-head"><strong className="trakbot-bot-name">TrackSalesBot</strong>
          <span className="trakbot-bot-state">{label}</span>
        </div>
        <span className="b">{message.body}</span>
        {message.action_path && allowedRoutes.has(message.action_path) &&
          <a className="btn ghost small trakbot-direction" href={'#' + message.action_path} onClick={onNavigate}>
            {message.action_label || 'Открыть раздел'}
          </a>}
      </div>
    </div>
  </div>;
}

/** Remount private state when the account or its permissions change. */
export function TrakBotChat(props: { compact?: boolean; onNavigate?: () => void; onComposerSubmit?: () => void } = {}) {
  const { me } = useMe();
  const identity = [me?.id ?? 'guest', (me?.roles ?? []).join(','), me?.performer?.verification ?? ''].join(':');
  return <TrakBotChatSession key={identity} {...props} />;
}

function TrakBotChatSession({ compact = false, onNavigate, onComposerSubmit }: { compact?: boolean; onNavigate?: () => void; onComposerSubmit?: () => void } = {}) {
  const { me } = useMe();
  const [messages, setMessages] = useState<BotMessage[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const [historyAttempt, setHistoryAttempt] = useState(0);
  const submissionPending = useRef(false);
  const mounted=useRef(true);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  const [reviewPending,setReviewPending]=useState(false);
  const [text, setText] = useState('');
  const [make, setMake] = useState('');
  const [ecu, setEcu] = useState('');
  const [model, setModel] = useState('');
  const [year, setYear] = useState('');
  const [aiAvailable, setAiAvailable] = useState(false);
  const [aiTransport, setAiTransport] = useState<'api'|'local'>('api');
  const [aiConsent, setAiConsent] = useState(false);
  const [handoff, setHandoff] = useState(false);
  const [working, setWorking] = useState(false);
  const [justAnsweredId, setJustAnsweredId] = useState<string | null>(null);
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
    setHistoryLoading(true);
    setHistoryLoaded(false);
    setHistoryError('');
    setMessages([]);setJustAnsweredId(null);setHandoff(false);
    setAiAvailable(false);
    setAiConsent(false);
    get<BotHistory>('/api/trakbot/messages')
      .then((result) => {
        if (!live) return;
        setMessages(historyMessages(result));
        setAiAvailable(!!result.aiAvailable);
        setAiTransport(result.aiTransport === 'local' ? 'local' : 'api');
        setHistoryLoaded(true);
      })
      .catch((e) => { if (live) setHistoryError(e.message || 'Не удалось загрузить личную переписку'); })
      .finally(() => { if (live) setHistoryLoading(false); });
    return () => { live = false; };
  }, [historyAttempt]);
  useEffect(() => { if (msgBox.current) msgBox.current.scrollTop = msgBox.current.scrollHeight; }, [messages.length, working]);

  const send = async () => {
    if (submissionPending.current || working || reviewPending || !historyLoaded || !text.trim()) return;
    if(year && (!/^\d{4}$/.test(year)||Number(year)<1900||Number(year)>2100)){setError('Укажи корректный год выпуска или оставь поле пустым.');return;}
    const body = text.trim();
    submissionPending.current = true;
    setWorking(true);
    setError('');
    try {
      const result = await post<{ userMessage: BotMessage; message: BotMessage; freePilot: true; handoffSuggested?: boolean }>('/api/trakbot/answer', {
        message: body, allowAiProcessing: aiAvailable && aiConsent,
        vehicle: { ...(make.trim() && { make: make.trim() }), ...(model.trim() && { model: model.trim() }),
          ...(year.length === 4 && { year: Number(year) }), ...(ecu.trim() && { ecu: ecu.trim() }) },
      });
      if(!mounted.current)return;
      if(!validMessage(result?.userMessage)||!validMessage(result?.message)||result.userMessage.role!=='user'||result.message.role!=='bot')throw new Error('Сервер не подтвердил ответ');
      setMessages(old=>[...new Map([...old,result.userMessage,result.message].map(m=>[m.id,m])).values()]);
      setJustAnsweredId(result.message.id);
      setText(current=>current.trim()===body?'':current);
      setHandoff(!!result.handoffSuggested);
    } catch (e: any) {
      if(!mounted.current)return;
      setReviewPending(true);
      // POST may have committed before a network timeout. Never auto-repeat.
      setError((e.message || 'Ошибка связи') + ' Проверь историю перед ручной повторной отправкой.');
      try {
        const history = await get<BotHistory>('/api/trakbot/messages');
        if(!mounted.current)return;
        setMessages(historyMessages(history));
      } catch {
        if(mounted.current){setHistoryLoaded(false);setHistoryError('Не удалось загрузить историю после отправки.');setError('Не удалось подтвердить отправку и перечитать историю. Текст сохранён в поле; сначала восстанови связь и проверь историю.');}
      }
    } finally {
      submissionPending.current = false;
      setWorking(false);
    }
  };

  const clearConversation = async () => {
    if (submissionPending.current || working || !historyLoaded || !messages.length || !window.confirm('Очистить всю личную переписку с TrakBot? Отменить действие нельзя.')) return;
    submissionPending.current = true;
    setWorking(true);
    setError('');
    try {
      await del('/api/trakbot/messages');
      if(!mounted.current)return;
      setReviewPending(false);setMessages([]);
      setJustAnsweredId(null);
      setHandoff(false);
      setText('');
    } catch (e: any) {
      if(mounted.current){setError('Удаление не подтверждено. Проверь историю перед повтором.');setHistoryAttempt(n=>n+1);}
    } finally {
      submissionPending.current = false;
      setWorking(false);
    }
  };

  const Frame = compact ? 'div' : 'main';
  return <Frame className={compact ? 'trakbot-compact-body' : undefined}>
    {!compact && <Back to="help" />}
    {compact ? <h2 className="trakbot-compact-title">TrackSalesBot</h2> : <div className="trakbot-chat-title"><TrakBotMascot reaction="hello" size="small" ambient/><h1>TrackSalesBot</h1></div>}
    {!compact && <div className="sub">{isTech ? 'Помощник мастера и СТО.' : 'Помощник для водителя.'} Личный чат, без публикаций в общем эфире.</div>}
    {compact ? <details className="trakbot-advice-compact">
      <summary>Важно: советы справочные, не диагноз</summary>
      <p>{advice} <a href="#/rules" onClick={onNavigate}>Условия</a></p>
    </details> : <p className="trakbot-advice" role="note">{advice} <a href="#/rules" onClick={onNavigate}>Условия</a></p>}
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
        {aiTransport === 'local'
          ? 'Разрешаю обработку текста вопроса и краткого контекста локальной ИИ-моделью TrakSOS. Внешнему ИИ-провайдеру этот режим данные не отправляет.'
          : 'Разрешаю отправить текст вопроса, сведения о машине и краткий контекст внешнему ИИ-провайдеру для составления ответа.'}
        {' '}Телефон и VIN маскируются. Без этого согласия работает только справочник.
      </label>}
      </div>
    </details>
    <section className="card trakbot-dialog">
      <div className="msgs" ref={msgBox} aria-live="polite" style={{ minHeight: compact ? 0 : 240, maxHeight: compact ? undefined : '50vh', overflowY: 'auto' }}>
        {historyLoading && <div className="note" role="status">Загружаю личную переписку…</div>}
        {historyLoaded && !messages.length && <BotBubble message={{ id: 'initial', role: 'bot', body: initialGreeting, created_at: '' }} onNavigate={onNavigate} />}
        {historyLoaded && messages.map((message) => message.role === 'bot'
          ? <BotBubble key={message.id} message={message} newest={message.id === justAnsweredId} onNavigate={onNavigate} />
          : <div key={message.id} className="msg me trakbot-message--user">
            <span className="b" style={{ whiteSpace: 'pre-wrap' }}>{message.body}</span>
          </div>)}
        {working && <div className="trakbot-typing" role="status" aria-label="TrakBot готовит ответ">
          <TrakBotMascot reaction="typing" size="small" active />
          <span>Разбираюсь с вопросом</span>
          <span className="trakbot-typing-dots" aria-hidden="true"><i/><i/><i/></span>
        </div>}
        <div ref={end} />
      </div>
      {historyError && <div className="stack" role="alert" style={{ gap: 8 }}>
        <span className="note" style={{ color: 'var(--danger, #b42318)' }}>{historyError}</span>
        <button type="button" className="btn ghost small" disabled={historyLoading || working}
          onClick={() => setHistoryAttempt((n) => n + 1)}>Повторить загрузку переписки</button>
      </div>}
      {error && <div role="alert" className="note" style={{ color: 'var(--danger, #b42318)' }}>{error}</div>}
      {reviewPending&&historyLoaded&&<button type="button" className="btn ghost small" disabled={working} onClick={()=>setReviewPending(false)}>Историю проверил — разрешить повтор</button>}
      {compact && handoff && <div className="trakbot-compact-handoff" role="note">
        Нет проверенной расшифровки. {!isTech && <a href="#/new/consult" onClick={onNavigate}>Связаться с мастером</a>}
      </div>}
      <form className="compose" onSubmit={(event) => { event.preventDefault(); void send(); onComposerSubmit?.(); }}>
        <input className="field" maxLength={700} disabled={!historyLoaded || working} value={text} onChange={(e) => setText(e.target.value)} placeholder="Например: Iveco, ошибка P0087..." aria-label="Сообщение TrakBot" />
        {speechAvailable && <button type="button" className="btn ghost small" aria-label={listening ? 'Остановить запись голоса' : 'Надиктовать вопрос'} title="Надиктовать вопрос — ответ придёт текстом" onClick={startDictation}>{listening ? 'Стоп' : '🎙'}</button>}
        <button type="submit" className="btn small" disabled={!historyLoaded || working || reviewPending || !text.trim()}>{working ? '...' : 'Отправить'}</button>
      </form>
    </section>
    {!compact && <TrakBotReactionGallery />}
    {compact
      ? <div className="trakbot-compact-footer">
          <span>Бесплатно · Без автоплатежей</span>
          <a href="#/trakbot" onClick={onNavigate}>Полный чат и настройки</a>
        </div>
      : <span className="note">Сейчас это бесплатный помощник, без автоплатежей. Платные консультации — отдельно, только после явного согласия. Голосовой ввод включается отдельно после проверки устройства и приватности.</span>}
    {!compact && !!messages.length && <button type="button" className="btn ghost small" disabled={working}
      aria-label="Очистить историю TrakBot" onClick={() => void clearConversation()}>Очистить мою переписку</button>}
    {!compact && handoff && <div className="card flat">
      <b>Здесь достоверной расшифровки не нашлось.</b>
      <span className="note">Не буду придумывать. Можно уточнить исходные данные или перейти к человеку — только если захочешь.</span>
      {!isTech && <a className="btn ghost" href="#/new/consult" onClick={onNavigate}>Связаться с мастером</a>}
    </div>}
    {!compact && canUseTech && <a href="#/tech/codes" className="btn ghost" onClick={onNavigate}>Технический справочник кодов для специалистов</a>}
  </Frame>;
}

export function TechCodes() {
  const { me } = useMe();
  const identity = [me?.id ?? 'guest', (me?.roles ?? []).join(','), me?.performer?.verification ?? ''].join(':');
  return <TechCodesSession key={identity} />;
}

function TechCodesSession() {
  const { me } = useMe();
  const permitted = !!me?.roles.some((role) => ['admin','moderator'].includes(role)) ||
    (!!me?.roles.some((role) => ['master','service'].includes(role)) && me?.performer?.verification === 'approved');
  const [term, setTerm] = useState('');
  const [items, setItems] = useState<CodeRecord[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [searched, setSearched] = useState(false);
  const searchSequence = useRef(0);
  if (!permitted) return <main><Back to="help" /><h1>Доступ ограничен</h1><p>Справочник доступен подтверждённым техническим специалистам и сотрудникам.</p></main>;
  const search = async () => {
    const query = term.trim();
    if (query.length < 2 || busy) return;
    const request = ++searchSequence.current;
    setBusy(true); setSearched(false); setError(''); setItems([]);
    try {
      const result = await get<{items: CodeRecord[]}>(`/api/tech/codes?q=${encodeURIComponent(query)}`);
      if (request === searchSequence.current) {
        if(!result||!Array.isArray(result.items)||result.items.some(it=>!it||typeof it.code!=='string'||typeof it.source_url!=='string'))throw new Error('Сервер не подтвердил результаты поиска');
        setItems(result.items);
        setSearched(true);
      }
    } catch (e: any) {
      if (request === searchSequence.current) setError(e.message || 'Ошибка поиска');
    } finally {
      if (request === searchSequence.current) setBusy(false);
    }
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
      <input aria-label="Поиск кода" className="field" placeholder="Код или фрагмент названия" value={term}
        onChange={(e) => {
          searchSequence.current += 1;
          setTerm(e.target.value); setItems([]); setSearched(false); setError(''); setBusy(false);
        }} />
      <button className="btn small" disabled={busy || term.trim().length < 2}>Искать</button>
    </form>
    {busy && <p role="status" className="note">Ищу в техническом справочнике…</p>}
    {error && <p role="alert">{error} <button type="button" className="btn ghost small" onClick={() => void search()}>Повторить поиск</button></p>}
    {items.map((it) => <details key={it.code + ':' + it.source_url} className="card">
      <summary><b>{it.code}</b> · {it.title_ru || it.title_en}</summary>
      <div className="stack">
        <p style={{whiteSpace:'pre-wrap'}}>{it.detail_ru || it.detail_en || 'Подробности не проверены'}</p>
        <span className="note">Статус: {it.review_state === 'pilot' ? 'проверка пилотной карточки' : it.review_state === 'external_reviewed' ? 'проверено внешним источником; не заводская верификация' : 'не проверено'}</span>
        {it.source_url.startsWith('https://') && <a href={it.source_url} target="_blank" rel="noopener noreferrer">Источник данных</a>}
      </div>
    </details>)}
    {searched && !busy && !error && items.length === 0 && <span className="note">Совпадений пока нет. Проверь точность кода и блок управления.</span>}
  </main>;
}
