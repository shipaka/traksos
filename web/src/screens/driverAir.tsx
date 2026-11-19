import { useEffect, useRef, useState } from 'react';
import { get, post } from '../api.ts';
import { Back, useMe } from '../ui.tsx';

type Message = { id:string; author:string; body:string; isBot:boolean; createdAt:string };
type Air = { messages:Message[]; botEnabled:boolean; canModerate:boolean; canConfigure:boolean; canPost:boolean; publicForDrivers:boolean };

export function DriverAir() {
  const { me } = useMe();
  const [air,setAir] = useState<Air|null>(null);
  const [text,setText] = useState('');
  const [error,setError] = useState('');
  const [posting,setPosting] = useState(false);
  const [supportHint,setSupportHint] = useState(false);
  const [refresh,setRefresh] = useState(0);
  const end = useRef<HTMLDivElement>(null);
  const lastCount = useRef(0);
  const isStaff = !!me?.roles.some(r=>r==='admin'||r==='moderator');
  const ownerOrDriver = !!me?.roles.some(r=>r==='client'||r==='driver') &&
    !me?.roles.some(r=>['master','tow','service','insurer','inspection_operator','admin','moderator'].includes(r));
  const canView = ownerOrDriver || isStaff;

  useEffect(()=>{
    if(!canView) return;
    let live=true;
    const load=async()=>{
      try {
        const result=await get<Air>('/api/air/messages');
        if(live) {setAir(result);setError('');}
      } catch(e:any) {if(live)setError(e.message||'Не удалось открыть эфир');}
    };
    void load();
    const timer=setInterval(()=>void load(),12000);
    return ()=>{live=false;clearInterval(timer);};
  },[canView,refresh]);
  useEffect(()=>{
    if(air && air.messages.length!==lastCount.current) {
      lastCount.current=air.messages.length;
      end.current?.scrollIntoView({block:'nearest',behavior:'auto'});
    }
  },[air?.messages.length]);

  const send = async()=>{
    if(!air?.canPost||posting||!text.trim())return;
    setPosting(true);setError('');
    try {
      const answer=await post<{supportSuggested:boolean}>('/api/air/messages',{body:text.trim()});
      setText('');
      setSupportHint(!!answer.supportSuggested);
      setRefresh(n=>n+1);
    } catch(e:any) {
      setError(e.message||'Не удалось отправить. Проверь соединение.');
      // A request may be accepted but its response lost; fetch history, never auto-retry.
      setRefresh(n=>n+1);
    } finally {setPosting(false);}
  };
  const switchBot=async()=>{
    if(!air||posting)return;
    setPosting(true);
    try {await post('/api/admin/air/bot',{enabled:!air.botEnabled});setRefresh(n=>n+1);}
    catch(e:any){setError(e.message||'Не удалось изменить настройку');}
    finally{setPosting(false);}
  };
  const hide=async(id:string)=>{
    if(posting||!window.confirm('Скрыть это сообщение из общего эфира?'))return;
    setPosting(true);
    try {await post('/api/admin/air/messages/'+encodeURIComponent(id)+'/hide');setRefresh(n=>n+1);}
    catch(e:any){setError(e.message||'Не удалось скрыть сообщение');}
    finally{setPosting(false);}
  };
  if(!canView) return <main><Back to="" /><h1>Эфир водителей</h1>
    <p>Писать в общем эфире могут только водители и владельцы автопарков. Сотрудникам доступна модерация.</p></main>;
  return <main className="stack" style={{maxWidth:840}}>
    <Back to="" />
    <div className="between" style={{gap:12,flexWrap:'wrap'}}>
      <div><h1>Эфир TrakSOS</h1><p className="sub">Общий текстовый чат водителей и владельцев автопарков. Маршруты, жизнь в рейсе, полезный опыт и общение.</p></div>
      <a className="btn ghost small" href="#/support/new">Личное обращение</a>
    </div>
    <div className="card flat">
      <p className="note">Это публичная переписка для зарегистрированных участников. Не отправляй в эфир телефоны, VIN, номера документов, личные данные и подробности заявок. Для жалоб и обращений к сотрудникам используй личную поддержку.</p>
      {air?.canConfigure && <label className="note" style={{display:'flex',alignItems:'center',gap:8}}>
        <input type="checkbox" checked={air.botEnabled} disabled={posting} onChange={()=>void switchBot()} />
        Разрешить редкие дружелюбные реплики TrakBot в эфире
      </label>}
      {air && !air.botEnabled && <span className="note">Самостоятельные сообщения TrakBot сейчас выключены. При вызове модератора или админа он подскажет, как оформить обращение приватно.</span>}
    </div>
    <section className="card" aria-label="Общий эфир водителей">
      <div role="log" aria-label="Сообщения эфира" aria-live="polite" style={{height:'min(53vh,520px)',minHeight:260,overflowY:'auto'}}>
        {!air && <div className="empty">Загружаю сообщения…</div>}
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
        <div ref={end}/>
      </div>
      {error && <p className="note" role="alert">{error}</p>}
      {supportHint && <div className="card flat">
        <b>TrakBot уточняет обращение</b>
        <p className="note">Проблема по заявке, поведению участника или работе сервиса? Напиши подробности в личной поддержке. Это не создаст обращение до твоего подтверждения.</p>
        <a className="btn ghost" href="#/support/new">Перейти к обращению</a>
      </div>}
      {air?.canPost ? <form className="compose" onSubmit={e=>{e.preventDefault();void send();}}>
        <input className="field" value={text} maxLength={400} disabled={posting}
          onChange={e=>setText(e.target.value)} aria-label="Сообщение в эфир"
          placeholder="Напиши водителям… или @TrakBot, расскажи шутку" />
        <button className="btn" type="submit" disabled={posting||!text.trim()}>Отправить</button>
      </form> : <p className="note">Режим наблюдения: писать в эфир могут только водители и владельцы автопарков. Модераторы и администраторы могут скрывать нарушения.</p>}
      {air?.canPost && <p className="note">Для вызова помощи напиши @модератор или @админ. TrakBot уточнит, как оформить вопрос без раскрытия деталей в публичном чате.</p>}
    </section>
  </main>;
}
