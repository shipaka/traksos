import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, get, post, put, fmtTime, onEvent } from '../api.ts';
import {newOrderRequestKey} from '../orderRequestKey.ts';
import { useAction, useLoad, useMe } from '../ui.tsx';
import './driverAir.css';
import { NearbyHelp } from './nearbyHelp.tsx';
import {CommunityNotificationSettings,CommunityMuteToggle} from './communityNotificationSettings.tsx';
import {readAirDraft,writeAirDraft,clearAirDraft} from './airDraft.ts';

type AirProfile={nickname:string;city_label:string|null;share_city:boolean;public_city:string|null};
type DriverAccess={eligible:boolean;enabled:boolean;driverRole:boolean};
type AirRoom={id:string;slug:string;title:string;kind:string;audience:string;locality:string|null;joined:boolean};
type AirMessage={id:string;nickname:string;body:string;public_city:string|null;isMine:boolean;created_at:string;moderation_state:string};
type AirModerationChange={id:string;revision:string;moderation_state:'published'|'hidden';message?:AirMessage};
type AirThread={id:string;status:string;peerNickname:string;direction:'outgoing'|'incoming';blocked:boolean};
type RoadEvent={id:string;nickname:string;category:string;description:string;locality:string|null;expires_at:string;moderation_state:string;verifiedByRoadServices:boolean};
const roadLabels:Record<string,string>={
  traffic:'Дорожная обстановка',parking:'Стоянка',roadworks:'Ремонт дороги',
  weather:'Погода',question:'Вопрос по маршруту'
};
const uuid=()=>newOrderRequestKey();
const safeError=(e:unknown)=>e instanceof Error?e.message:'Не удалось обновить данные. Проверьте интернет.';
// SessionStorage can throw SecurityError in privacy modes and some WebViews.
const optionalDraftStorage=()=>{try{return window.sessionStorage}catch{return null}};
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

function reconcileAirChanges(existing:AirMessage[],changes:AirModerationChange[],highlights:ReadonlySet<string>){
  const byId=new Map(existing.map(m=>[m.id,m]));
  for(const change of changes){
    if(change.moderation_state==='hidden')byId.delete(change.id);
    else if(change.message)byId.set(change.id,change.message);
  }
  return appendMessages([], [...byId.values()],highlights);
}

/** Never persist message text on the device; catch up via a bounded, ordered event feed. */
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
    let syncEpoch:string|null=null;
    let continuation:number|null=null;
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
      if(continuation!==null){window.clearTimeout(continuation);continuation=null;}
      fetching=true;
      let stillBacklogged=false,resync=false;
      const restart=()=>{
        initialized=false;syncEpoch=null;
        cursor.current='0';moderationCursor.current='0';recentApprovals.current.clear();
        setMessages([]);setLoading(true);resync=true;
      };
      try{
        // A message-ID poll remains for backward compatibility; all new
        // publication and moderation changes are also delivered in event order.
        const query=initial?'?recent=1&limit=50':('?after='+encodeURIComponent(cursor.current)+'&limit=50');
        const d=await get<{messages:AirMessage[];nextCursor:string;moderationCursor?:string;syncEpoch?:string}>(endpoint+query);
        if(!alive)return;
        if(!initial&&syncEpoch!==null&&d.syncEpoch!==syncEpoch){
          restart();return;
        }
        setMessages(curr=>initial?d.messages:appendMessages(curr,d.messages,new Set(recentApprovals.current)));
        cursor.current=d.nextCursor;
        if(initial){
          initialized=true;syncEpoch=d.syncEpoch??'0';
          // Taken by the server BEFORE the snapshot; changes during the request
          // are replayed, rather than silently skipping a concurrent approval.
          moderationCursor.current=d.moderationCursor??'0';
        }
        // Drain up to 300 events per turn, then yield for 250ms and continue.
        // Unlike a fixed 500-event cap, long offline periods eventually catch
        // up without blocking input, loading unbounded history or retry storms.
        for(let page=0;page<3;page++){
          const previous=moderationCursor.current;
          const updates=await get<{
            changes:AirModerationChange[];nextCursor:string;hasMore:boolean;syncEpoch?:string
          }>(moderationUrl+'?after='+encodeURIComponent(previous)+'&limit=100');
          if(!alive)return;
          if(updates.syncEpoch!==syncEpoch){
            // The server pruned events or erased a user's messages. A stale
            // in-memory tail is unsafe: replace it with a new authorized snapshot.
            restart();break;
          }
          moderationCursor.current=updates.nextCursor;
          if(updates.changes.length){
            const highlights=recentApprovals.current;
            for(const event of updates.changes){
              if(event.moderation_state==='hidden')highlights.delete(event.id);
              else if(event.message){
                highlights.delete(event.id);highlights.add(event.id);
                while(highlights.size>10)
                  highlights.delete(highlights.values().next().value!);
              }
            }
            const visibleHighlights=new Set(highlights);
            setMessages(curr=>reconcileAirChanges(curr,updates.changes,visibleHighlights));
          }
          stillBacklogged=updates.hasMore&&updates.nextCursor!==previous;
          if(!stillBacklogged)break;
        }
        setError(null);
      }catch(e){
        if(alive){
          if(e instanceof ApiError&&(e.status===403||e.status===404)){
            // Revoked roles, deleted DM threads and private-room access may
            // never leave the previous messages visible in this WebView.
            initialized=false;syncEpoch=null;
            cursor.current='0';moderationCursor.current='0';recentApprovals.current.clear();
            setMessages([]);
          }
          setError(safeError(e));
        }
        stillBacklogged=false;
      }
      finally{
        fetching=false;
        if(alive)setLoading(false);
        if(alive&&(stillBacklogged||resync)&&document.visibilityState==='visible'){
          continuation=window.setTimeout(()=>{continuation=null;void load();},250);
        }
      }
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
      alive=false;window.clearInterval(timer);
      if(continuation!==null)window.clearTimeout(continuation);
      unsubscribe();
      window.removeEventListener('online',reconnect);
      document.removeEventListener('visibilitychange',visible);
    };
  },[endpoint,revision]);
  return {messages,loading,error,reload:()=>setRevision(x=>x+1),
    append:(m:AirMessage)=>setMessages(curr=>appendMessages(curr,[m],new Set(recentApprovals.current)))};
}
function MessageStream({endpoint,canWrite,placeholder,ownerId}:{
  endpoint:string|null;canWrite:boolean;placeholder:string;ownerId:string|null
}){
  const {messages,loading,error,reload}=useAirMessages(endpoint);
  const [draft,setDraft]=useState('');
  const [rememberDraft,setRememberDraft]=useState(false);
  const [draftError,setDraftError]=useState('');
  // Keep one idempotency nonce per unchanged draft until its delivery is known.
  // A dropped HTTP response must not create two messages when retried manually.
  const pendingSend=useRef<{endpoint:string;text:string;nonce:string}|null>(null);
  const [reportId,setReportId]=useState<string|null>(null);
  const {busy,run}=useAction();
  const bottom=useRef<HTMLDivElement>(null);
  useEffect(()=>{
    pendingSend.current=null;setDraft('');setReportId(null);setRememberDraft(false);setDraftError('');
    if(!endpoint||!ownerId)return;
    try{
      const storage=optionalDraftStorage();if(!storage)return;
      const saved=readAirDraft(storage,ownerId,endpoint);
      setRememberDraft(saved.enabled);setDraft(saved.text);
      if(saved.nonce)pendingSend.current={endpoint,text:saved.text.trim(),nonce:saved.nonce};
    }catch{/* Session storage unavailable; chat remains usable without persistence. */}
  },[endpoint,ownerId]);
  const updateDraft=(value:string)=>{
    pendingSend.current=null;setDraft(value);
    if(rememberDraft&&endpoint&&ownerId){
      const storage=optionalDraftStorage();if(storage)writeAirDraft(storage,ownerId,endpoint,value);
    }
  };
  const remember=(enabled:boolean)=>{
    if(!endpoint||!ownerId)return;
    const storage=optionalDraftStorage();
    if(!storage){setRememberDraft(false);setDraftError('Хранение черновика недоступно в настройках этого браузера.');return;}
    if(!enabled)clearAirDraft(storage,ownerId,endpoint);
    else if(!writeAirDraft(storage,ownerId,endpoint,draft)){
      setDraftError('Не удалось сохранить черновик. Попробуйте без сохранения.');return;
    }
    setDraftError('');setRememberDraft(enabled);
  };
  useEffect(()=>{bottom.current?.scrollIntoView({block:'nearest',behavior:'auto'})},[endpoint,messages.length]);
  const send=async()=>{
    const text=draft.trim();if(!text||!endpoint||busy||!canWrite)return;
    const previous=pendingSend.current;
    const nonce=previous?.endpoint===endpoint&&previous.text===text?previous.nonce:uuid();
    pendingSend.current={endpoint,text,nonce};
    if(rememberDraft&&ownerId){const storage=optionalDraftStorage();if(storage)
      writeAirDraft(storage,ownerId,endpoint,draft,Date.now(),nonce);}
    const sent=await run(()=>post(endpoint,{text,clientNonce:nonce}),'Сообщение отправлено');
    if(sent){
      pendingSend.current=null;setDraft('');
      if(ownerId){const storage=optionalDraftStorage();if(storage)
        clearAirDraft(storage,ownerId,endpoint);}
      reload();
    }
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
        value={draft} disabled={!canWrite||busy} onChange={e=>updateDraft(e.target.value)}
        onKeyDown={e=>{if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)){e.preventDefault();void send()}}}/>
      {draftError&&<p className="note" role="status">{draftError}</p>}
      <label className="air-checkbox">
        <input type="checkbox" checked={rememberDraft} disabled={!ownerId}
          onChange={e=>remember(e.target.checked)}/>
        Запомнить мой черновик в этой вкладке на срок до 24 часов
      </label>
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
  const {me}=useMe();
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
        <div className="row">
          <CommunityMuteToggle id={choice.id} kind="thread"/>
          <button type="button" className="btn ghost small" disabled={busy}
            onClick={async()=>{await run(()=>post('/api/community/direct/blocks',{nickname:choice.peerNickname,blocked:true}));setSelected(null);await threads.reload()}}>Заблокировать</button>
        </div>
      </div>
      <MessageStream key={choice.id} endpoint={'/api/community/direct/'+choice.id+'/messages'}
        ownerId={me?.id??null} canWrite placeholder="Личное сообщение…"/>
    </section>}
  </div>;
}

export function DriverAir(){
  const {me}=useMe();
  const isDriver=Boolean(me?.roles.includes('driver')||me?.roles.includes('client'));
  const access=useLoad<DriverAccess>(()=>get('/api/community/driver-access'),[me?.id]);
  const [disableStep,setDisableStep]=useState(false);
  const profile=useLoad<AirProfile>(()=>access.data?.enabled?get('/api/community/me'):
    Promise.resolve({nickname:'',city_label:null,share_city:false,public_city:null}),[me?.id,access.data?.enabled]);
  const rooms=useLoad<{rooms:AirRoom[]}>(()=>access.data?.enabled?get('/api/community/rooms'):
    Promise.resolve({rooms:[]}),[me?.id,access.data?.enabled]);
  const [roomId,setRoomId]=useState<string|null>(null);
  const [view,setView]=useState<'rooms'|'direct'|'profile'|'help'|'notifications'>('rooms');
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
    <h1>Водительский Эфир</h1><p>Раздел доступен водителям и владельцам, которые сами водят грузовик.</p>
  </main>;
  if(!access.data)return <main className="air-shell"><h1>Водительский Эфир</h1>
    <p role="status">{access.error??'Проверяю доступ…'}</p>
    {access.error&&<button type="button" className="btn ghost" onClick={()=>void access.reload()}>Повторить</button>}
  </main>;
  if(!access.data.enabled)return <main className="air-shell">
    <div className="air-heading"><div><span className="note">TRAKSOS · ВОДИТЕЛЬСКОЕ СООБЩЕСТВО</span>
      <h1>Водительский Эфир</h1><p>Бесплатное общение с коллегами по всей России — в вашем аккаунте владельца.</p>
    </div><a className="btn ghost" href="#/">В кабинет</a></div>
    <section className="card stack" aria-label="Добровольное участие в Эфире">
      <h2>Я сам за рулём</h2>
      <p>Подключите Эфир без новой регистрации. Ваш номер телефона, ФИО,
        машина, заявки и точное местоположение не публикуются. В чате используется
        отдельный позывной. Регион и участие в комнатах вы выбираете сами.</p>
      <p className="note">Подключение не отправляет сообщения, не включает GPS и не добавляет вас в чаты.
        Вы сможете отключить участие в настройках Эфира.</p>
      <button className="btn" type="button" disabled={sending||!access.data.eligible}
        onClick={async()=>{const updated=await run(
          ()=>put('/api/community/driver-access',{enabled:true}),'Эфир подключён');
          if(updated)await access.reload();}}>Включить Эфир</button>
    </section>
  </main>;
  return <main className="air-shell">
    <div className="air-heading">
      <div><span className="note">TRAKSOS · ВОДИТЕЛЬСКОЕ СООБЩЕСТВО</span>
        <h1>Водительский Эфир</h1>
        <p>Бесплатное общение по России: коллеги, города и маршруты. Всё внутри TrakSOS.</p>
      </div>
      <div className="stack">
        <a className="btn ghost" href="#/">В кабинет</a>
        {!access.data.driverRole&&<button type="button" className="btn ghost"
          onClick={()=>setDisableStep(true)}>Отключить участие</button>}
      </div>
    </div>
    {disableStep&&<section className="card stack" aria-label="Подтверждение отключения Эфира">
      <b>Отключить водительский Эфир?</b>
      <p className="note">Сообщения и история заявок не удаляются. Пока участие отключено,
        переписки, сообщения и уведомления Эфира будут недоступны.</p>
      <div className="row">
        <button type="button" className="btn" disabled={sending}
          onClick={async()=>{const updated=await run(
            ()=>put('/api/community/driver-access',{enabled:false}),'Эфир отключён');
            if(updated){setDisableStep(false);await access.reload();}}}>Подтвердить отключение</button>
        <button type="button" className="btn ghost" onClick={()=>setDisableStep(false)}>Оставить включённым</button>
      </div>
    </section>}
    <nav className="air-tabs" aria-label="Разделы Эфира">
      <button type="button" aria-current={view==='rooms'?'page':undefined} onClick={()=>setView('rooms')}>Эфир и города</button>
      <button type="button" aria-current={view==='direct'?'page':undefined} onClick={()=>setView('direct')}>Личные чаты</button>
      <button type="button" aria-current={view==='profile'?'page':undefined} onClick={()=>setView('profile')}>Мой позывной</button>
      <button type="button" aria-current={view==='help'?'page':undefined} onClick={()=>setView('help')}>Помощь рядом</button>
      <button type="button" aria-current={view==='notifications'?'page':undefined} onClick={()=>setView('notifications')}>Уведомления</button>
    </nav>
    {view==='profile'&&(profile.data?<AirProfileSettings profile={profile.data} onSaved={profile.reload}/>:
      <p role="status">{profile.error??'Загружаю…'}</p>)}
    {view==='direct'&&<DirectMessages/>}
    {view==='help'&&<NearbyHelp/>}
    {view==='notifications'&&<CommunityNotificationSettings/>}
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
            <div className="row">
              <button className="btn ghost" type="button" disabled={sending}
                onClick={()=>void changeMembership(!active.joined)}>
              {active.joined?'Покинуть':'Присоединиться'}
              </button>
            </div>
          </header>
          <div className="air-pane-tabs">
            <button type="button" aria-pressed={roomPane==='chat'} onClick={()=>setRoomPane('chat')}>Сообщения</button>
            {active.audience==='driver'&&<button type="button" aria-pressed={roomPane==='road'} onClick={()=>setRoomPane('road')}>Дорожная обстановка</button>}
          </div>
          {roomPane==='chat'&&<MessageStream key={active.id+':'+active.joined}
            ownerId={me?.id??null}
            endpoint={'/api/community/rooms/'+active.id+'/messages'} canWrite={active.joined}
            placeholder="Напишите сообщение коллегам…"/>}
          {roomPane==='road'&&active.audience==='driver'&&<RoadEvents key={active.id} roomId={active.id} joined={active.joined}/>}
        </>}
      </section>
    </div>}
  </main>;
}
