import {useEffect,useRef,useState} from 'react';
import {get,post,fmtTime,onEvent} from '../api.ts';
import {Back,go,Loading} from '../ui.tsx';

type Notice = {id:number;title?:string;body:string;kind:string;created_at:string;read_at:string|null;data?:{orderId?:string;ticketId?:string}};
type NoticePage = {unread:number;items:Notice[];nextBefore?:number|null};
const endpoint='/api/me/notifications';

// The enclosing session is keyed by account; each cursor page is separately
// keyed so old requests cannot update or navigate a different page.
export function NotificationHistory(){
  const [cursors,setCursors]=useState<(number|null)[]>([null]);
  const before=cursors[cursors.length-1];
  return <NotificationPage key={String(before)} before={before} pageNumber={cursors.length}
    older={cursor=>setCursors(previous=>previous.includes(cursor)?previous:[...previous,cursor])}
    newer={()=>setCursors(previous=>previous.length>1?previous.slice(0,-1):previous)}
    newest={()=>setCursors([null])}/>;
}

function NotificationPage({before,pageNumber,older,newer,newest}:{
  before:number|null;pageNumber:number;older:(cursor:number)=>void;newer:()=>void;newest:()=>void
}){
  const alive=useRef(false);
  const revision=useRef(0);
  const readLock=useRef(false);
  const navigationLock=useRef(false);
  const [data,setData]=useState<NoticePage|null>(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState<string|null>(null);
  const [readError,setReadError]=useState('');
  const [markingAll,setMarkingAll]=useState(false);
  const [openingId,setOpeningId]=useState<number|null>(null);
  const reload=async()=>{
    if(!alive.current)return;
    const request=++revision.current;
    setLoading(true);setError(null);
    try{
      const result=await get<NoticePage>(endpoint+(before===null?'':'?before='+before));
      if(!alive.current||request!==revision.current)return;
      setData(result);
    }catch(e){
      if(!alive.current||request!==revision.current)return;
      setData(null);setError(e instanceof Error?e.message:String(e));
    }finally{
      if(alive.current&&request===revision.current)setLoading(false);
    }
  };
  useEffect(()=>{
    alive.current=true;
    void reload();
    const off=onEvent(e=>{
      if(e.type==='connection_restored'||e.type==='notification')void reload();
    });
    return ()=>{alive.current=false;revision.current++;off();};
  },[before]);
  const busy=loading||markingAll||openingId!==null;
  const nextBefore=data?.nextBefore;
  const canOlder=typeof nextBefore==='number'&&Number.isSafeInteger(nextBefore)&&nextBefore>0
    &&(before===null||nextBefore<before);
  const move=(fn:()=>void)=>{
    if(readLock.current||navigationLock.current||busy)return;
    navigationLock.current=true;fn();
  };
  const open=async(n:Notice)=>{
    if(readLock.current||navigationLock.current||busy||error)return;
    readLock.current=true;setOpeningId(n.id);setReadError('');
    try{
      if(!n.read_at){
        try{
          await post(endpoint+'/'+n.id+'/read');
          if(!alive.current)return;
          window.dispatchEvent(new Event('traksos:notifications-read'));
          void reload();
        }catch{
          if(alive.current)setReadError('Не удалось отметить уведомление прочитанным. Повторите после восстановления связи.');
        }
      }
      if(!alive.current)return;
      if(n.data?.orderId)go('order/'+n.data.orderId);
      else if(n.data?.ticketId)go('support/'+n.data.ticketId);
      else if(n.kind==='verification')go('work/docs');
      else if(n.kind==='balance')go('work');
      else if(n.kind==='pricing')go('profile');
    }finally{
      readLock.current=false;
      if(alive.current)setOpeningId(null);
    }
  };
  const markAll=async()=>{
    if(readLock.current||navigationLock.current||busy||error||!data?.unread)return;
    readLock.current=true;setMarkingAll(true);setReadError('');
    try{
      await post(endpoint+'/read');
      if(!alive.current)return;
      window.dispatchEvent(new Event('traksos:notifications-read'));
      await reload();
    }catch{
      if(alive.current)setReadError('Не удалось отметить уведомления: соединение недоступно');
    }finally{
      readLock.current=false;
      if(alive.current)setMarkingAll(false);
    }
  };
  return <main>
    <Back to=""/>
    <div className="between notifications-header"><h1>Уведомления</h1>
      <button type="button" className="btn ghost small" disabled={busy||!!error||!data?.unread}
        onClick={()=>void markAll()}>Прочитать все</button>
    </div>
    {readError&&<p className="err" role="alert">{readError}</p>}
    {loading||error||!data?<div className="stack">
      <Loading error={error}/>
      {error&&<button type="button" className="btn ghost small" onClick={()=>void reload()}>Повторить загрузку уведомлений</button>}
    </div>:!data.items.length?<div className="empty">Пока ничего</div>:<div className="rows">
      {data.items.map(n=><button type="button" key={n.id} className="list-item"
        aria-label={'Уведомление: '+(n.title??'TrakSOS')+'. '+(n.read_at?'Прочитано':'Не прочитано')}
        disabled={busy} style={{width:'100%',background:n.read_at?'transparent':'var(--accent-soft)',border:0,textAlign:'left',color:'inherit'}}
        onClick={()=>void open(n)}>
        <div className="stack" style={{gap:2}}>
          <b style={{fontSize:14}}>{n.title??'TrakSOS'}</b>
          <span style={{fontSize:14}}>{n.body}</span>
          <span className="note">{fmtTime(n.created_at)}</span>
        </div>
      </button>)}
    </div>}
    {(pageNumber>1||canOlder)&&<div className="stack">
      <span className="note">Страница {pageNumber}</span>
      {pageNumber>1&&<button type="button" className="btn ghost small" disabled={busy}
        onClick={()=>move(newer)}>Более новые</button>}
      {pageNumber>2&&<button type="button" className="btn ghost small" disabled={busy}
        onClick={()=>move(newest)}>К последним уведомлениям</button>}
      {canOlder&&<button type="button" className="btn ghost small" disabled={busy||!!error}
        onClick={()=>move(()=>older(nextBefore!))}>Более старые</button>}
    </div>}
  </main>;
}
