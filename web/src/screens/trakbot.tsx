import { useEffect, useRef, useState } from 'react';
import { get, post } from '../api.ts';
import { Back, useMe } from '../ui.tsx';

interface BotMessage { id: string; role: 'user'|'bot'; body: string; created_at: string; }
interface BotHistory { messages: BotMessage[]; freePilot: true; }
interface CodeRecord {
  code: string; title_en: string; title_ru: string|null;
  detail_en: string|null; detail_ru: string|null; source_url: string; review_state: string;
}
const initialGreeting = 'Привет! Я TrakBot. Могу помочь с первичными вопросами по автомобилю. Напиши точный код ошибки и блок управления или опиши, что происходит.';

export function TrakBotChat() {
  const { me } = useMe();
  const [messages, setMessages] = useState<BotMessage[]>([]);
  const [text, setText] = useState('');
  const [make, setMake] = useState('');
  const [ecu, setEcu] = useState('');
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const end = useRef<HTMLDivElement>(null);
  const isTech = !!me?.roles.some((role) => ['master','service','admin','moderator'].includes(role));
  useEffect(() => {
    let live = true;
    get<BotHistory>('/api/trakbot/messages').then((result) => { if (live) setMessages(result.messages); })
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
      const result = await post<{ message: BotMessage; freePilot: true }>('/api/trakbot/answer', {
        message: body, vehicle: { ...(make.trim() && { make: make.trim() }), ...(ecu.trim() && { ecu: ecu.trim() }) },
      });
      setMessages((old) => [...old, { id: 'local-'+Date.now(), role: 'user', body, created_at: new Date().toISOString() }, result.message]);
      setText('');
    } catch (e: any) { setError(e.message || 'Ошибка связи'); }
    finally { setWorking(false); }
  };

  return <main>
    <Back to="help" />
    <h1>TrakBot</h1>
    <div className="sub">Личный технический помощник. Другим участникам эфира ваши сообщения не видны.</div>
    <div className="card flat" style={{ gap: 8 }}>
      <b>Что за машина?</b>
      <div className="grid2">
        <input className="field" maxLength={60} value={make} onChange={(e) => setMake(e.target.value)} placeholder="Марка, например Scania" aria-label="Марка" />
        <input className="field" maxLength={60} value={ecu} onChange={(e) => setEcu(e.target.value)} placeholder="Блок, например EBS" aria-label="Блок управления" />
      </div>
      <span className="note">В пилотном режиме бот использует общие OBD-II коды и безопасные вопросы по симптомам. Заводские SPN/FMI и конкретные схемы он не выдумывает.</span>
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
        <button type="submit" className="btn small" disabled={working || !text.trim()}>{working ? '...' : 'Отправить'}</button>
      </form>
    </section>
    <span className="note">Пока бесплатно. Платные консультации с резервированием оплаты не включены. Если в справочнике нет точного ответа, TrakBot скажет об этом.</span>
    <a className="btn ghost" href="#/new/consult">Нужна помощь человека? Консультация специалиста</a>
    {isTech && <a href="#/tech/codes" className="btn ghost">Технический справочник кодов для специалистов</a>}
  </main>;
}

export function TechCodes() {
  const { me } = useMe();
  const permitted = !!me?.roles.some((role) => ['master','service','admin','moderator'].includes(role));
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
    <form className="compose" onSubmit={(e) => {e.preventDefault();void search();}}>
      <input aria-label="Поиск кода" className="field" placeholder="Код или фрагмент названия" value={term} onChange={(e)=>setTerm(e.target.value)} />
      <button className="btn small" disabled={busy || term.trim().length < 2}>Искать</button>
    </form>
    {error && <p role="alert">{error}</p>}
    {items.map((it) => <details key={it.code} className="card">
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
