import { useEffect, useRef, useState } from 'react';
import { get, post } from '../api.ts';
import { Back, useMe } from '../ui.tsx';

interface BotMessage { id: string; role: 'user'|'bot'; body: string; created_at: string; }
interface BotHistory { messages: BotMessage[]; freePilot: true; aiAvailable?: boolean; }
interface CodeRecord {
  code: string; title_en: string; title_ru: string|null;
  detail_en: string|null; detail_ru: string|null; source_url: string; review_state: string;
}
const initialGreeting = 'Здорово! Что с машиной? Напиши код ошибки или просто расскажи, что происходит. По порядку разберёмся.';

export function TrakBotChat() {
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
  const isTech = !!me?.roles.some((role) => ['master','service','admin','moderator'].includes(role));
  const canUseTech = !!me?.roles.some((role) => ['admin','moderator'].includes(role)) ||
    (isTech && me?.performer?.verification === 'approved');
  useEffect(() => {
    let live = true;
    get<BotHistory>('/api/trakbot/messages').then((result) => { if (live) { setMessages(result.messages); setAiAvailable(!!result.aiAvailable); } })
      .catch((e) => { if (live) setError(e.message || 'Не удалось загрузить диалог'); });
    return () => { live = false; };
  }, [me?.id]);
  useEffect(() => end.current?.scrollIntoView({ block: 'end' }), [messages.length]);

  const send = async () => {
    if (working || !text.trim()) return;
    const body = text.trim();
    setWorking(true);
    setError('');
    try {
      const result = await post<{ message: BotMessage; freePilot: true; handoffSuggested?: boolean }>('/api/trakbot/answer', {
        message: body, allowAiProcessing: aiAvailable && aiConsent,
        vehicle: { ...(make.trim() && { make: make.trim() }), ...(model.trim() && { model: model.trim() }),
          ...(year && { year: Number(year) }), ...(ecu.trim() && { ecu: ecu.trim() }) },
      });
      setMessages((old) => [...old, { id: 'local-'+Date.now(), role: 'user', body, created_at: new Date().toISOString() }, result.message]);
      setText('');
      setHandoff(!!result.handoffSuggested);
    } catch (e: any) {
      setError(e.message || 'Ошибка связи');
      // A write may have succeeded before a network disconnect; reconcile rather than resending.
      get<BotHistory>('/api/trakbot/messages').then((history) => setMessages(history.messages)).catch(() => {});
    }
    finally { setWorking(false); }
  };

  return <main>
    <Back to="help" />
    <h1>TrakBot</h1>
    <div className="sub">{isTech ? 'Технический помощник для мастеров и СТО.' : 'Первичная помощь водителю.'} Только личный чат. В общий эфир TrakBot ничего не отправляет.</div>
    <div className="card flat" style={{ gap: 8 }}>
      <b>Что за машина?</b>
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
    <section className="card">
      <div className="msgs" aria-live="polite" style={{ minHeight: 240, maxHeight: '50vh', overflowY: 'auto' }}>
        {!messages.length && <div className="msg sys"><span className="b">{initialGreeting}</span></div>}
        {messages.map((message) => <div key={message.id} className={'msg '+(message.role === 'user' ? 'me' : '')}>
          {message.role === 'bot' && <span className="n">TrakBot</span>}
          <span className="b" style={{ whiteSpace: 'pre-wrap' }}>{message.body}</span>
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
    <span className="note">Пока бесплатно. Бот не назначает ремонт без проверки, не резервирует и не списывает деньги. Голосовой ввод доступен только на совместимых устройствах после отдельного включения; отправляется распознанный и проверенный тобой текст.</span>
    {handoff && <div className="card flat">
      <b>Здесь достоверной расшифровки не нашлось.</b>
      <span className="note">Не буду придумывать. Можно уточнить исходные данные или перейти к человеку — только если захочешь.</span>
      {!isTech && <a className="btn ghost" href="#/new/consult">Связаться с мастером</a>}
    </div>}
    {canUseTech && <a href="#/tech/codes" className="btn ghost">Технический справочник кодов для специалистов</a>}
  </main>;
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
