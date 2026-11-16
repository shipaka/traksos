import { useCallback, useEffect, useRef, useState } from 'react';
import { get, post, put, fmtTime, onEvent } from '../api.ts';
import { useAction, useLoad, useMe } from '../ui.tsx';
import './driverAir.css';
import { NearbyHelp } from './nearbyHelp.tsx';

type AirProfile={nickname:string;city_label:string|null;share_city:boolean;public_city:string|null};
type AirRoom={id:string;slug:string;title:string;kind:string;audience:string;locality:string|null;joined:boolean};
type AirMessage={id:string;nickname:string;body:string;public_city:string|null;isMine:boolean;created_at:string;moderation_state:string};
type AirModerationChange={id:string;revision:string;moderation_state:'published'|'hidden';message?:AirMessage};
type AirThread={id:string;status:string;peerNickname:string;direction:'outgoing'|'incoming';blocked:boolean};
type RoadEvent={id:string;nickname:string;category:string;description:string;locality:string|null;expires_at:string;moderation_state:string;verifiedByRoadServices:boolean};
const roadLabels:Record<string,string>={
  traffic:'Дорожная обстановка',parking:'Стоянка',roadworks:'Ремонт дороги',
  weather:'Погода',question:'Вопрос по маршруту'
};
const uuid=()=>crypto.randomUUID();
const safeError=(e:unknown)=>e instanceof Error?e.message:'Не удалось обновить данные. Проверьте интернет.';
function appendMessages(existing:AirMessage[],next:AirMessage[],recentApprovals:ReadonlySet<string>=new Set()){
  const byId=new Map(existing.map(m=>[m.id,m]));
  next.forEach(m=>byId.set(m.id,m));
  const sorted=[...byId.values()].sort((a,b)=>{
    const aa=BigInt(a.id),bb=BigInt(b.id);
    return aa<bb?-1:aa>bb?1:0;
  });
  if(sorted.length<=160)return sorted;
  const tail=sorted.slice(-160);
  const visible=new Set(tail.map(m=>m.id));
  // Reserve at most 10 slots for delayed approvals, even when their original
  // message ID is older than the current 160-message window.
  for(const approved of sorted.filter(m=>recentApprovals.has(m.id)&&!visible.has(m.id)).slice(-10)){
    const victim=tail.findIndex(m=>!recentApprovals.has(m.id));
    if(victim<0)break;
    visible.delete(tail[victim].id);
    tail.splice(victim,1);
    tail.push(approved);visible.add(approved.id);
  }
  return tail.sort((a,b)=>BigInt(a.id)<BigInt(b.id)?-1:BigInt(a.id)>BigInt(b.id)?1:0);
}

/** Only a small tail is in memory; messages are never persisted to localStorage. */
function useAirMessages(endpoint:string|null){
  const [messages,setMessages]=useState<AirMessage[]>([]);
  const [error,setError]=useState<string|null>(null);
  const [loading,setLoading]=useState(true);
  const [revision,setRevision]=useState(0);
  const cursor=useRef('0');
  const moderationCursor=useRef('0');
  const recentApprovals=useRef<Set<string>>(new Set());
  useEffect(()=>{
    let alive=true,fetching=false,initialized=false;
    cursor.current='0';moderationCursor.current='0';recentApprovals.current.clear();
    setMessages([]);setError(null);setLoading(true);
    if(!endpoint){setLoading(false);return;}
    const moderationUrl=endpoint.replace(/\/messages$/,'/moderation-events');
    const load=async(initial=false)=>{
      if(!initialized)initial=true;
      if(fetching||document.visibilityState==='hidden')return;
      if(!navigator.onLine){
        if(alive){setLoading(false);setError('Нет соединения. Сообщения не кэшируются на устройстве; обновим их после восстановления интернета.')}
        return;
      }
      fetching=true;
      try{
        const query=initial?'?recent=1&limit=50':('?after='+encodeURIComponent(cursor.current)+'&limit=50');
        const d=await get<{messages:AirMessage[];nextCursor:string;moderationCursor?:string}>(endpoint+query);
        if(!alive)return;
        setMessages(curr=>initial?d.messages:appendMessages(curr,d.messages,recentApprovals.current));
        cursor.current=d.nextCursor;
        if(initial){
          initialized=true;
          // This watermark was captured BEFORE the recent messages were read.
          // Any moderation committed during the initial load is replayed safely.
          moderationCursor.current=d.moderationCursor??'0';
        }else{
          // Publication/hiding updates are independent of the message-id cursor.
          // Fetch bounded pages, keeping memory usage fixed on weak mobile links.
          for(let page=0;page<5;page++){
            const previous=moderationCursor.current;
            const updates=await get<{
              changes:AirModerationChange[];nextCursor:string;hasMore:boolean
            }>(moderationUrl+'?after='+encodeURIComponent(previous)+'&limit=100');
            if(!alive)return;
            moderationCursor.current=updates.nextCursor;
            if(updates.changes.length)setMessages(curr=>{
              let next=curr;
              for(const event of updates.changes){
                if(event.moderation_state==='hidden'){
                  recentApprovals.current.delete(event.id);
                  next=next.filter(m=>m.id!==event.id);
                }else if(event.message){
                  recentApprovals.current.add(event.id);
                  if(recentApprovals.current.size>10)
                    recentApprovals.current.delete(recentApprovals.current.values().next().value!);
                  next=appendMessages(next,[event.message],recentApprovals.current);
                }
              }
              return next;
            });
            if(!updates.hasMore||updates.nextCursor===previous)break;
          }
        }
        setError(null);
      }catch(e){if(alive)setError(safeError(e))}
      finally{fetching=false;if(alive)setLoading(false)}
    };
    void load(true);
    const timer=window.setInterval(()=>{if(document.visibilityState==='visible')void load()},12000);
    const reconnect=()=>{void load()};
    const visible=()=>{if(document.visibilityState==='visible')void load()};
    const unsubscribe=onEvent((e:any)=>{
      if(['community_message','community_direct_message',
          'community_moderation','community_direct_moderation','connection_restored'].includes(e.type))
        void load();
    });
    window.addEventListener('online',reconnect);
    document.addEventListener('visibilitychange',visible);
    return ()=>{
      alive=false;window.clearInterval(timer);unsubscribe();
      window.removeEventListener('online',reconnect);
      document.removeEventListener('visibilitychange',visible);
    };
  },[endpoint,revision]);
  return {messages,loading,error,reload:()=>setRevision(x=>x+1),
    append:(m:AirMessage)=>setMessages(curr=>appendMessages(curr,[m],recentApprovals.current))};
}
function MessageStream({endpoint,canWrite,placeholder}:{
  endpoint:string|null;canWrite:boolean;placeholder:string
}){
  const {messages,loading,error,reload}=useAirMessages(endpoint);
  const [draft,setDraft]=useState('');
  const [reportId,setReportId]=useState<string|null>(null);
  const {busy,run}=useAction();
  const bottom=useRef<HTMLDivElement>(null);
  useEffect(()=>{bottom.current?.scrollIntoView({block:'nearest',behavior:'auto'})},[endpoint,messages.length]);
  const send=async()=>{
    const text=draft.trim();if(!text||!endpoint||busy||!canWrite)return;
    const sent=await run(()=>post(endpoint,{text,clientNonce:uuid()}),'Сообщение отправлено');
    if(sent){setDraft('');reload()}
  };
  return <div className="air-conversation">
    <div className="air-message-list" role="log" aria-label="Сообщения" aria-live="polite">
      {loading&&<p className="note">Загружаю последние сообщения…</p>}
      {error&&<div className="banner warn" role="status">{error} <button type="button" onClick={reload}>Повторить</button></div>}
      {!loading&&messages.length===0&&<div className="air-empty">В этом чате пока тихо. Можно начать разговор.</div>}
      {messages.map(m=><article key={m.id} className={'air-bubble '+(m.isMine?'mine':'')}>
        <div className="air-bubble-meta">
          <strong>{m.isMine?'Вы':m.nickname}</strong>
          {m.public_city&&<span>{m.public_city}</span>}
          <time dateTime={m.created_at}>{fmtTime(m.created_at)}</time>
        </div>
        <p>{m.body}</p>
        {m.moderation_state==='pending'&&<small>Проверяется модератором</small>}
      {!m.isMine&&m.moderation_state==='published'&&<div className="air-moderation">
        {reportId===m.id?<span>
          <button className="btn ghost small" disabled={busy} onClick={async()=>{
            const api=endpoint?.includes('/direct/')?
              '/api/community/direct/messages/'+m.id+'/report':
              '/api/community/messages/'+m.id+'/report';
            if(api){
              const sent=await run(()=>post(api,{reason:'Прошу проверить сообщение на нарушение правил общения'}),'Жалоба отправлена');
              if(sent)setReportId(null);
            }
          }}>Подтвердить жалобу</button>
          <button className="btn ghost small" onClick={()=>setReportId(null)}>Отмена</button>
        </span>:
        <button className="btn ghost small" type="button" onClick={()=>setReportId(m.id)}>Пожаловаться</button>}
      </div>}
      </article>)}
      <div ref={bottom}/>
    </div>
    <form className="air-compose" onSubmit={e=>{e.preventDefault();void send()}}>
      <label className="sr-only" htmlFor="air-message">Текст сообщения</label>
      <textarea id="air-message" className="field" rows={2} maxLength={2000}
        placeholder={canWrite?placeholder:'Присоединитесь к чату, чтобы писать'}
        value={draft} disabled={!canWrite||busy} onChange={e=>setDraft(e.target.value)}
        onKeyDown={e=>{if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)){e.preventDefault();void send()}}}/>
      <button className="btn" type="submit" disabled={!canWrite||busy||!draft.trim()}>
        {busy?'Отправка…':'Отправить'}
      </button>
    </form>
    <p className="air-safe-tip">Общайтесь на стоянке, не набирайте сообщения за рулём. Фото документов, номера телефонов и точную геолокацию здесь не публикуем.</p>
  </div>;
}

function AirProfileSettings({profile,onSaved}:{
  profile:AirProfile;onSaved:()=>void
}){
  const [nickname,setNickname]=useState(profile.nickname);
  const [city,setCity]=useState(profile.city_label??'');
  const [shareCity,setShareCity]=useState(profile.share_city);
  const {busy,run}=useAction();
  useEffect(()=>{setNickname(profile.nickname);setCity(profile.city_label??'');setShareCity(profile.share_city)},[profile.nickname,profile.city_label,profile.share_city]);
  return <form className="card air-profile" onSubmit={async e=>{
    e.preventDefault();
    const saved=await run(()=>put('/api/community/me',{
      nickname:nickname.trim(),cityLabel:city.trim()||null,shareCity
    }),'Профиль Эфира обновлён');
    if(saved)onSaved();
  }}>
    <h2>Ваш позывной</h2>
    <p className="note">Псевдоним виден другим участникам. Настоящий телефон и профиль остаются закрытыми.</p>
    <label>Псевдоним
      <input className="field" maxLength={24} minLength={3} value={nickname}
        autoComplete="off" onChange={e=>setNickname(e.target.value)} required/>
    </label>
    <label>Населённый пункт (по желанию)
      <input className="field" maxLength={80} value={city} placeholder="Например, Ижевск"
        autoComplete="off" onChange={e=>setCity(e.target.value)}/>
    </label>
    <label className="air-checkbox">
      <input type="checkbox" checked={shareCity} onChange={e=>setShareCity(e.target.checked)}/>
      Показывать населённый пункт рядом с позывным
    </label>
    <p className="note">Город в Эфире независим от адреса магазина, заявки и GPS. Точные координаты не публикуются.</p>
    <button className="btn" type="submit" disabled={busy||nickname.trim().length<3}>
      {busy?'Сохраняю…':'Сохранить'}
    </button>
  </form>;
}
function RoadEvents({roomId,joined}: {roomId:string;joined:boolean}){
  const endpoint='/api/community/rooms/'+roomId+'/road-events';
  const list=useLoad<{events:RoadEvent[]}>(()=>get(endpoint),[roomId]);
  const [category,setCategory]=useState('traffic');
  const [description,setDescription]=useState('');
  const [locality,setLocality]=useState('');
  const {busy,run}=useAction();
  return <section className="air-road">
    <h3>Дорожные сообщения</h3>
    <p className="note">Сообщения пользователей — не официальная дорожная сводка. Записи исчезают после срока действия.</p>
    {list.error&&<p role="alert">{list.error} <button onClick={list.reload}>Повторить</button></p>}
    {!list.error&&(list.data?.events?.length??0)===0&&<p className="air-empty">Актуальных сообщений нет.</p>}
    {(list.data?.events??[]).map(e=><article className="air-road-event" key={e.id}>
      <strong>{roadLabels[e.category]??'Информация'} · {e.locality??'Регион не указан'}</strong>
      <p>{e.description}</p>
      <small>{e.nickname} · до {fmtTime(e.expires_at)} · {e.moderation_state==='pending'?'На модерации':'Сообщение участника'}</small>
      {!e.isMine&&e.moderation_state==='published'&&<button className="btn ghost small" onClick={async()=>{
        const reported=await run(()=>post('/api/community/road-events/'+e.id+'/report',{
          reason:'Прошу проверить актуальность или содержание дорожного сообщения'
        }),'Жалоба отправлена');
        if(reported)await list.reload();
      }}>Пожаловаться</button>}
    </article>)}
    {joined&&<form className="air-road-form" onSubmit={async e=>{
      e.preventDefault();
      const result=await run(()=>post(endpoint,{
        category,description:description.trim(),locality:locality.trim()||undefined,hours:3
      }),'Событие добавлено');
      if(result){setDescription('');await list.reload()}
    }}>
      <h3>Сообщить о ситуации</h3>
      <select className="field" aria-label="Категория" value={category} onChange={e=>setCategory(e.target.value)}>
        {Object.entries(roadLabels).map(([k,v])=><option value={k} key={k}>{v}</option>)}
      </select>
      <input className="field" maxLength={80} value={locality} onChange={e=>setLocality(e.target.value)}
        placeholder="Населённый пункт (не адрес)"/>
      <textarea className="field" maxLength={500} minLength={10} rows={3}
        value={description} onChange={e=>setDescription(e.target.value)}
        placeholder="Что происходит? Без номеров телефонов и данных других водителей."/>
      <button className="btn" type="submit" disabled={busy||description.trim().length<10}>Опубликовать на 3 часа</button>
    </form>}
  </section>;
}
function DirectMessages(){
  const threads=useLoad<{threads:AirThread[]}>(()=>get('/api/community/direct'),[],
    (e:any)=>String(e.type).startsWith('community_direct'));
  const [peer,setPeer]=useState('');
  const [selected,setSelected]=useState<string|null>(null);
  const {busy,run}=useAction();
  const choice=threads.data?.threads.find(t=>t.id===selected)??null;
  return <div className="air-direct">
    <p className="note">Личные сообщения начинаются только после согласия второго водителя. Собеседник видит псевдоним, не номер телефона.</p>
    <form className="air-invite" onSubmit={async e=>{
      e.preventDefault();
      const result=await run(()=>post('/api/community/direct/request',{nickname:peer.trim()}),'Приглашение отправлено');
      if(result){setPeer('');await threads.reload()}
    }}>
      <label htmlFor="air-peer">Пригласить по позывному</label>
      <input className="field" id="air-peer" value={peer} maxLength={24}
        onChange={e=>setPeer(e.target.value)} autoComplete="off" placeholder="Позывной водителя"/>
      <button className="btn" type="submit" disabled={busy||peer.trim().length<3}>Пригласить</button>
    </form>
    {threads.error&&<p role="alert">{threads.error} <button type="button" onClick={threads.reload}>Повторить</button></p>}
    {threads.data?.threads.length===0&&<p className="air-empty">Личных диалогов пока нет.</p>}
    <div className="air-rooms" role="list">
      {(threads.data?.threads??[]).map(t=><div className="air-thread" key={t.id}>
        <button type="button" className="air-thread-open" onClick={()=>setSelected(t.id)}>
          <strong>{t.peerNickname}</strong>
          <small>{t.blocked?'Заблокирован':t.status==='accepted'?'Диалог открыт':t.direction==='incoming'?'Ждёт вашего решения':'Приглашение отправлено'}</small>
        </button>
        {t.status==='pending'&&t.direction==='incoming'&&!t.blocked&&<>
          <button type="button" className="btn small" disabled={busy}
            onClick={async()=>{await run(()=>post('/api/community/direct/'+t.id+'/decision',{decision:'accept'}));await threads.reload()}}>Принять</button>
          <button type="button" className="btn ghost small" disabled={busy}
            onClick={async()=>{await run(()=>post('/api/community/direct/'+t.id+'/decision',{decision:'decline'}));await threads.reload();setSelected(null)}}>Отклонить</button>
        </>}
      </div>)}
    </div>
    {choice?.status==='accepted'&&!choice.blocked&&<section className="air-chat-pane">
      <div className="between"><h3>Диалог · {choice.peerNickname}</h3>
        <button type="button" className="btn ghost small" disabled={busy}
          onClick={async()=>{await run(()=>post('/api/community/direct/blocks',{nickname:choice.peerNickname,blocked:true}));setSelected(null);await threads.reload()}}>Заблокировать</button>
      </div>
      <MessageStream key={choice.id} endpoint={'/api/community/direct/'+choice.id+'/messages'}
        canWrite placeholder="Личное сообщение…"/>
    </section>}
  </div>;
}

export function DriverAir(){
  const {me}=useMe();
  const isDriver=Boolean(me?.roles.includes('driver'));
  const profile=useLoad<AirProfile>(()=>get('/api/community/me'),[me?.id]);
  const rooms=useLoad<{rooms:AirRoom[]}>(()=>get('/api/community/rooms'),[me?.id]);
  const [roomId,setRoomId]=useState<string|null>(null);
  const [view,setView]=useState<'rooms'|'direct'|'profile'|'help'>('rooms');
  const [roomPane,setRoomPane]=useState<'chat'|'road'>('chat');
  const [sending,setSending]=useState(false);
  const {run}=useAction();
  const active=rooms.data?.rooms.find(x=>x.id===roomId)??null;
  useEffect(()=>{
    if(!rooms.data)return;
    const list=rooms.data.rooms;
    setRoomId(previous=>previous&&list.some(r=>r.id===previous)?previous:
      list.find(r=>r.slug==='drivers-russia')?.id??list[0]?.id??null);
  },[rooms.data]);
  const changeMembership=async(join:boolean)=>{
    if(!active||sending)return;
    setSending(true);
    try{
      const result=await run(()=>post('/api/community/rooms/'+active.id+'/'+(join?'join':'leave'),{}),
        join?'Вы в чате':'Вы вышли из чата');
      if(result)await rooms.reload();
    }finally{setSending(false)}
  };
  if(!isDriver)return <main className="air-shell">
    <h1>Водительский Эфир</h1><p>Раздел доступен в водительском кабинете.</p>
  </main>;
  return <main className="air-shell">
    <div className="air-heading">
      <div><span className="note">TRAKSOS · ВОДИТЕЛЬСКОЕ СООБЩЕСТВО</span>
        <h1>Водительский Эфир</h1>
        <p>Бесплатное общение по России: коллеги, города и маршруты. Всё внутри TrakSOS.</p>
      </div>
      <a className="btn ghost" href="#/">В кабинет</a>
    </div>
    <nav className="air-tabs" aria-label="Разделы Эфира">
      <button type="button" aria-current={view==='rooms'?'page':undefined} onClick={()=>setView('rooms')}>Эфир и города</button>
      <button type="button" aria-current={view==='direct'?'page':undefined} onClick={()=>setView('direct')}>Личные чаты</button>
      <button type="button" aria-current={view==='profile'?'page':undefined} onClick={()=>setView('profile')}>Мой позывной</button>
      <button type="button" aria-current={view==='help'?'page':undefined} onClick={()=>setView('help')}>Помощь рядом</button>
    </nav>
    {view==='profile'&&(profile.data?<AirProfileSettings profile={profile.data} onSaved={profile.reload}/>:
      <p role="status">{profile.error??'Загружаю…'}</p>)}
    {view==='direct'&&<DirectMessages/>}
    {view==='help'&&<NearbyHelp/>}
    {view==='rooms'&&<div className="air-layout">
      <aside className="air-channel-list">
        <h2>Комнаты</h2>
        {rooms.error&&<p role="alert">{rooms.error} <button type="button" onClick={rooms.reload}>Повторить</button></p>}
        {!rooms.data&&!rooms.error&&<p className="note">Загружаю комнаты…</p>}
        {rooms.data?.rooms.length===0&&<p className="note">Пока нет доступных комнат</p>}
        {rooms.data?.rooms.map(r=><button type="button" key={r.id}
          aria-current={r.id===roomId?'page':undefined} onClick={()=>{setRoomId(r.id);setRoomPane('chat')}}
          className="air-room-choice">
          <span>{r.title}</span><small>{r.locality??(r.kind==='general'?'Вся Россия':'Тематический чат')}{r.joined?' · участник':''}</small>
        </button>)}
      </aside>
      <section className="air-room-main">
        {!active?<div className="air-empty">Выберите комнату для общения.</div>:<>
          <header className="air-room-head">
            <div><h2>{active.title}</h2>
              <span className="note">{active.locality??'Комната без геопривязки'} · Псевдонимы участников, без точного GPS</span></div>
            <button className="btn ghost" type="button" disabled={sending}
              onClick={()=>void changeMembership(!active.joined)}>
              {active.joined?'Покинуть':'Присоединиться'}
            </button>
          </header>
          <div className="air-pane-tabs">
            <button type="button" aria-pressed={roomPane==='chat'} onClick={()=>setRoomPane('chat')}>Сообщения</button>
            {active.audience==='driver'&&<button type="button" aria-pressed={roomPane==='road'} onClick={()=>setRoomPane('road')}>Дорожная обстановка</button>}
          </div>
          {roomPane==='chat'&&<MessageStream key={active.id+':'+active.joined}
            endpoint={'/api/community/rooms/'+active.id+'/messages'} canWrite={active.joined}
            placeholder="Напишите сообщение коллегам…"/>}
          {roomPane==='road'&&active.audience==='driver'&&<RoadEvents key={active.id} roomId={active.id} joined={active.joined}/>}
        </>}
      </section>
    </div>}
  </main>;
}
