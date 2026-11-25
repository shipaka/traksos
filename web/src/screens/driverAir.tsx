import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { get, post, getToken } from '../api.ts';
import { staffRecipient } from '../../../server/src/domain/airIntent.ts';
import { stageAirDraft } from '../airSupportDraft.ts';
import { Back, useMe } from '../ui.tsx';

type Message = { id:string; author:string; body:string; isBot:boolean; createdAt:string };
type Air = { messages:Message[]; botEnabled:boolean; canModerate:boolean; canConfigure:boolean; canPost:boolean; publicForDrivers:boolean };

export function DriverAir() {
  const { me } = useMe();
  const isStaff = !!me?.roles.some(r=>r==='admin'||r==='moderator');
  const ownerOrDriver = !!me?.roles.some(r=>r==='client'||r==='driver') &&
    !me?.roles.some(r=>['master','tow','service','insurer','inspection_operator','admin','moderator'].includes(r));
  if (!(ownerOrDriver || isStaff)) return <main><Back to="" /><h1>Эфир водителей</h1>
    <p>Писать в общем эфире могут только водители и владельцы автопарков. Сотрудникам доступна модерация.</p></main>;
  // A→B can preserve the same permission boolean. A keyed room unmounts every
  // previous draft, moderator permission, support hint and in-flight response.
  return <AirRoom key={me!.id+':'+[...me!.roles].sort().join(',')+':'+(getToken()??'')} owner={me!.id} token={getToken()} />;
}

function AirRoom({owner,token}:{owner:string;token:string|null}) {
  const [air,setAir] = useState<Air|null>(null);
  const [loading,setLoading] = useState(true);
  const [text,setText] = useState('');
  const [error,setError] = useState('');
  const [actionError,setActionError] = useState('');
  const [posting,setPosting] = useState(false);
  const inFlight = useRef(false);
  const snapshotGeneration = useRef(0);
  const [supportHint,setSupportHint] = useState(false);
  const [refresh,setRefresh] = useState(0);
  const logRef = useRef<HTMLDivElement>(null);
  const keepAtBottom = useRef(true);
  const lastTailId = useRef<string|null>(null);

  useEffect(()=>{
    let live=true;
    let latestRequest=0;
    const generation=snapshotGeneration.current;
    const current=()=>live && generation===snapshotGeneration.current;
    // On explicit refresh or after a POST, never keep displaying an old
    // snapshot as though its permissions and messages are still current.
    setAir(null);
    setLoading(true);
    setError('');
    const load=async()=>{
      if(!current() || inFlight.current || document.visibilityState!=='visible' || !navigator.onLine)return;
      const request=++latestRequest;
      setLoading(true);
      try {
        const result=await get<Air>('/api/air/messages');
        if(current() && request===latestRequest) {setAir(result);setError('');}
      } catch(e:any) {
        if(current() && request===latestRequest) {
          setAir(null);
          setError(e?.message||'Не удалось открыть эфир');
        }
      } finally {
        if(current() && request===latestRequest) setLoading(false);
      }
    };
    // Two overlapping polls can finish out of order on mobile networks:
    // only the newest response is allowed to replace the visible snapshot.
    const timer=setInterval(()=>{
      if(document.visibilityState==='visible' && navigator.onLine) void load();
    },12000);
    const online=()=>void load();
    const visibility=()=>{
      if(!current())return;
      // A response started before suspension must not restore an old snapshot.
      ++latestRequest;
      if(document.visibilityState==='visible') {
        if(navigator.onLine) void load();
        else offline();
      } else {
        setAir(null);setLoading(false);
      }
    };
    const offline=()=>{
      if(!current())return;
      ++latestRequest;
      setAir(null);setLoading(false);
      setError('Нет связи с сервером. Проверь интернет и повтори загрузку.');
    };
    document.addEventListener('visibilitychange',visibility);
    window.addEventListener('online',online);
    window.addEventListener('offline',offline);
    if(!navigator.onLine) offline();
    else if(document.visibilityState==='visible') void load();
    else setLoading(false);
    return ()=>{
      live=false;clearInterval(timer);
      document.removeEventListener('visibilitychange',visibility);
      window.removeEventListener('online',online);
      window.removeEventListener('offline',offline);
    };
  },[refresh]);
  useLayoutEffect(()=>{
    // Hidden/offline/uncertain-write states remove the list DOM. Rehydrate
    // the same tail as a fresh render, even when no message ID changed.
    if(!air){lastTailId.current=null;return;}
    const tailId=air.messages[air.messages.length-1]?.id??null;
    if(tailId!==lastTailId.current) {
      lastTailId.current=tailId;
      // Follow new messages only if the user is already reading near the end;
      // scrolling the whole page would interrupt someone reading old messages.
      if(keepAtBottom.current && logRef.current)
        logRef.current.scrollTop=logRef.current.scrollHeight;
    }
  },[air]);

  // A lost write response may still mean the server committed the action.
  // Invalidate all pending polls before releasing the synchronous write lock;
  // never allow another action on the old moderation/permission snapshot.
  const reconcileAfterWrite=()=>{
    ++snapshotGeneration.current;
    setAir(null);setLoading(true);setRefresh(n=>n+1);
    inFlight.current=false;setPosting(false);
  };
  const openPrivate=()=>{
    if(inFlight.current||!token||getToken()!==token)return;
    stageAirDraft(owner,token,text,staffRecipient(text));
    location.hash='#/support/new';
  };
  const target=staffRecipient(text);
  const send = async()=>{
    if(!air?.canPost||inFlight.current||!text.trim()||getToken()!==token)return;
    if(target){openPrivate();return;}
    inFlight.current=true;setPosting(true);setActionError('');setSupportHint(false);
    try {
      const answer=await post<{supportSuggested:boolean}>('/api/air/messages',{body:text.trim()});
      setText('');
      setSupportHint(!!answer.supportSuggested);
    } catch(e:any) {
      setActionError(e?.message||'Не удалось отправить. Проверь соединение.');
      // A request may be accepted but its response lost; fetch history, never auto-retry.
      // Keep the typed draft so the user can compare it with actual history.
    } finally {reconcileAfterWrite();}
  };
  const switchBot=async()=>{
    if(!air?.canConfigure||inFlight.current)return;
    inFlight.current=true;setPosting(true);setActionError('');
    try {await post('/api/admin/air/bot',{enabled:!air.botEnabled});}
    catch(e:any){setActionError(e?.message||'Не удалось изменить настройку');}
    finally{reconcileAfterWrite();}
  };
  const hide=async(id:string)=>{
    if(!air?.canModerate||inFlight.current||!window.confirm('Скрыть это сообщение из общего эфира?'))return;
    inFlight.current=true;setPosting(true);setActionError('');
    try {await post('/api/admin/air/messages/'+encodeURIComponent(id)+'/hide');}
    catch(e:any){setActionError(e?.message||'Не удалось скрыть сообщение');}
    finally{reconcileAfterWrite();}
  };
  return <main className="stack" style={{maxWidth:840}}>
    <Back to="" />
    <div className="between" style={{gap:12,flexWrap:'wrap'}}>
      <div><h1>Эфир TrakSOS</h1><p className="sub">Общий текстовый чат водителей и владельцев автопарков. Маршруты, жизнь в рейсе, полезный опыт и общение.</p></div>
      <button type="button" className="btn ghost small" disabled={posting} onClick={openPrivate}>Личное обращение</button>
    </div>
    <div className="card flat">
      <p className="note">Это публичная переписка для зарегистрированных участников. Не отправляй в эфир телефоны, VIN, номера документов, личные данные и подробности заявок. Для жалоб и обращений к сотрудникам используй личную поддержку.</p>
      {air?.canConfigure && <label className="note" style={{display:'flex',alignItems:'center',gap:8}}>
        <input type="checkbox" checked={air.botEnabled} disabled={posting} onChange={()=>void switchBot()} />
        Разрешить редкие дружелюбные реплики TrakBot в эфире
      </label>}
      {air && !air.botEnabled && <span className="note">Самостоятельные сообщения TrakBot сейчас выключены. Для обращения к модератору или администратору используйте личную поддержку.</span>}
    </div>
    <section className="card" aria-label="Общий эфир водителей">
      <div ref={logRef} role="log" aria-label="Сообщения эфира" aria-live="polite"
        onScroll={event=>{
          if(!air)return; // An empty placeholder is not a user scroll intent.
          const el=event.currentTarget;
          keepAtBottom.current=el.scrollHeight-el.scrollTop-el.clientHeight<96;
        }}
        style={{height:'min(53vh,520px)',minHeight:260,overflowY:'auto'}}>
        {!air && <div className="empty">{loading ? 'Загружаю сообщения…' : 'Сообщения пока недоступны.'}</div>}
        {air && !air.messages.length && <div className="empty">{air.canPost ? 'Эфир открыт. Начни разговор — например, расскажи, как проходит рейс.' : 'Сообщений пока нет.'}</div>}
        {air?.messages.map(item=><div key={item.id} className="card flat" style={{margin:'8px 0',padding:12}}>
          <div className="between" style={{gap:10}}>
            <b>{item.author}</b>
            <span className="note">{new Date(item.createdAt).toLocaleString('ru-RU',{hour:'2-digit',minute:'2-digit',day:'numeric',month:'short'})}</span>
          </div>
          <div style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere',marginTop:5}}>{item.body}</div>
          {item.isBot && /личн(?:ом|ое) обращени|личную поддержку|личной поддержке/i.test(item.body) &&
            <a className="btn ghost small" style={{marginTop:8}} href="#/support/new">Описать вопрос приватно</a>}
          {air?.canModerate && <button className="btn ghost small" type="button" disabled={posting}
            style={{marginTop:8}} onClick={()=>void hide(item.id)}>Скрыть</button>}
        </div>)}

      </div>
      {error && <div className="stack" role="alert">
        <p className="note">{error}</p>
        <button className="btn ghost small" type="button" disabled={loading}
          onClick={()=>setRefresh(n=>n+1)}>Повторить загрузку эфира</button>
      </div>}
      {actionError && <p className="note" role="alert">{actionError}</p>}
      {supportHint && <div className="card flat">
        <b>TrakBot уточняет обращение</b>
        <p className="note">Проблема по заявке, поведению участника или работе сервиса? Напиши подробности в личной поддержке. Это не создаст обращение до твоего подтверждения.</p>
        <a className="btn ghost" href="#/support/new">Перейти к обращению</a>
      </div>}
      {air?.canPost ? <form className="compose" onSubmit={e=>{e.preventDefault();void send();}}>
        <input className="field" value={text} maxLength={400} disabled={posting}
          onChange={e=>setText(e.target.value)} aria-label="Сообщение в эфир"
          placeholder="Напиши водителям… или @TrakBot, расскажи шутку" />
        <button className="btn" type="submit" disabled={posting||!text.trim()}>{target ? "Перейти в личную поддержку" : "Отправить"}</button>
      </form> : air ? <p className="note">Режим наблюдения: писать в эфир могут только водители и владельцы автопарков. Модераторы и администраторы могут скрывать нарушения.</p> : null}
      {air?.canPost && <p className="note">Для личного обращения напиши @модератор или @админ — текст перейдёт в приватную форму, не публикуясь в эфире.</p>}
      {target && air?.canPost && <p className="note" role="status">Личное обращение: {target==="admin"?"администратору":"модератору"}. Ничего не будет отправлено без подтверждения в поддержке.</p>}
    </section>
  </main>;
}
