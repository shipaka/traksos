import {useLayoutEffect,useRef,useState} from 'react';
import {get,getToken,post,rub,fmtTime} from '../api.ts';
import {useAction,useLoad,useMe} from '../ui.tsx';
import {usePrivateRead} from './privateRead20261124.ts';

type Ref={brand:string;article:string;name:string;source:string;sourcePage:number};
type Product={id:string;brand:string;article:string;name:string;price:number;stock:number|null;leadDays:number};
type Rec={id:string;source_order_id:string|null;source_booking_id?:string|null;vehicle_id:string|null;product_id:string|null;brand:string;article:string;name:string;qty:number;reason:string;status:string;created_at:string;sourcing_status?:'not_requested'|'requested'|'resolved'|'unavailable';sourcing_note?:string|null;sourcing_requested_at?:string|null};
const labels:Record<string,string>={pending:'Ожидает решения',accepted:'Замена согласована',declined:'Отказано'};
type ProposalProps={orderId?:string;bookingId?:string;cardId?:string;onSent?:()=>void};
export function PartProposal(props:ProposalProps){
 const {me}=useMe();
 const token=getToken();
 const scope=useRef({token,revision:0});
 if(scope.current.token!==token)scope.current={token,revision:scope.current.revision+1};
 if(!me||!token)return null;
 return <PartProposalForm key={JSON.stringify([me.id,scope.current.revision,props.orderId,props.bookingId,props.cardId])} {...props}/>;
}
function PartProposalForm({orderId,bookingId,cardId,onSent}:ProposalProps){
 const source=bookingId?'/api/bookings/'+encodeURIComponent(bookingId):orderId?'/api/orders/'+encodeURIComponent(orderId):null;
 const refs=useLoad<{refs:Ref[]}>(()=>cardId?get('/api/techbase/parts/'+encodeURIComponent(cardId)):Promise.resolve({refs:[]}),[cardId]);
 const [brand,setBrand]=useState(''),[article,setArticle]=useState(''),[name,setName]=useState('');
 const [qty,setQty]=useState(1),[reason,setReason]=useState(''),[confirmed,setConfirmed]=useState(false);
 const [match,setMatch]=useState<{enabled:boolean;products:Product[]}|null>(null),[product,setProduct]=useState('');
 const {busy,run}=useAction();
 const generation=useRef(0),submitLock=useRef(false);
 const [lookupPending,setLookupPending]=useState(false),[lookupError,setLookupError]=useState(false);
 const token=getToken();
 useLayoutEffect(()=>()=>{generation.current++;},[token]);
 const change=(fn:()=>void)=>{if(submitLock.current)return;generation.current++;fn();setMatch(null);setProduct('');setLookupError(false);setLookupPending(false);setConfirmed(false);};
 const materialChange=(fn:()=>void)=>{if(submitLock.current)return;fn();setConfirmed(false);};
 async function lookup(){
  if(submitLock.current||getToken()!==token)return;
  const id=++generation.current,session=token;
  setMatch(null);setProduct('');setConfirmed(false);setLookupError(false);setLookupPending(true);
  const current=()=>generation.current===id&&getToken()===session;
  try{
   const result=await get<{enabled:boolean;products:Product[]}>('/api/shop/exact-part?brand='+encodeURIComponent(brand)+'&article='+encodeURIComponent(article));
   if(current())setMatch(result);
  }catch{if(current())setLookupError(true);}
  finally{if(current())setLookupPending(false);}
 }
 async function submit(){
  if(submitLock.current||lookupPending||!confirmed||!source||getToken()!==token)return;
  submitLock.current=true;
  const id=generation.current;
  try{
   const result=await run(()=>post(source+'/part-recommendations',{brand,article,name,qty,reason,productId:product||null,cardId:cardId||null,fitmentConfirmed:true}),'Рекомендация сохранена; заказ не создан');
   if(result&&generation.current===id&&getToken()===token){setReason('');setConfirmed(false);onSent?.();}
  }finally{submitLock.current=false;}
 }
 const refOnly=!!cardId&&!!refs.data?.refs.length;
 return <section className="card flat stack" aria-label="Подбор запчасти">
  <b>Артикул и подбор запчасти</b>
  {cardId&&!refs.data&&<span className="note">{refs.error?'Не удалось получить подтверждённые артикулы':'Загрузка артикулов'}</span>}
  {refs.data?.refs.map(r=><div key={r.brand+r.article} className="stack"><button className="btn ghost small" type="button" disabled={busy} onClick={()=>change(()=>{setBrand(r.brand);setArticle(r.article);setName(r.name);})}>{r.brand} {r.article} — {r.name}</button><a href={r.source} target="_blank" rel="noopener noreferrer">Источник артикула · стр. {r.sourcePage}</a></div>)}
  {cardId&&refs.data?.refs.length===0&&<span className="note">Артикул в этой карточке ещё не подтверждён. Укажите номер с маркировки установленной детали.</span>}
  <label>Производитель<input className="field" value={brand} maxLength={80} disabled={busy} readOnly={refOnly} onChange={e=>change(()=>setBrand(e.target.value))}/></label>
  <label>Артикул<input className="field" value={article} maxLength={100} disabled={busy} readOnly={refOnly} onChange={e=>change(()=>setArticle(e.target.value))}/></label>
  <button type="button" className="btn ghost small" disabled={busy||lookupPending||!brand.trim()||!article.trim()} onClick={lookup}>Найти точный артикул в магазине</button>
  {lookupPending&&<span role="status">Ищем точный артикул…</span>}
  {lookupError&&<span role="status">Не удалось проверить артикул. Повторите поиск.</span>}
  {match&&!match.enabled&&<span className="note">Магазин закрыт. Можно сохранить рекомендацию без цены и товара.</span>}
  {match?.enabled&&match.products.length===0&&<span className="note">Точного товара нет. Можно сохранить запрос на подбор.</span>}
  {match?.products.map(p=><button className={'btn ghost small'+(product===p.id?' selected':'')} key={p.id} type="button" disabled={busy} onClick={()=>materialChange(()=>{setProduct(p.id);setName(p.name);})}>{p.name} · {rub(p.price)} · {p.stock==null?'Под заказ':'Остаток: '+p.stock} · {p.leadDays} дн.</button>)}
  {match?.enabled&&article&&<a href={'#/shop?q='+encodeURIComponent(article)}>Открыть магазин</a>}
  {source?<><label>Название детали<input className="field" value={name} maxLength={160} disabled={busy} onChange={e=>change(()=>setName(e.target.value))}/></label>
   <label>Количество<input className="field" type="number" min={1} max={99} value={qty} disabled={busy} onChange={e=>materialChange(()=>setQty(Number(e.target.value)))}/></label>
   <label>Причина замены<textarea className="field" rows={2} maxLength={1000} value={reason} disabled={busy} onChange={e=>materialChange(()=>setReason(e.target.value))}/></label>
   <label><input type="checkbox" checked={confirmed} disabled={busy||lookupPending} onChange={e=>setConfirmed(e.target.checked)}/> Сверил маркировку, исполнение и применимость к этой машине. Совпадение артикула не заменяет проверку VIN.</label>
   <button className="btn small" type="button" disabled={busy||lookupPending||!confirmed||!brand.trim()||!article.trim()||name.trim().length<2||reason.trim().length<12||!Number.isInteger(qty)||qty<1||qty>99}
    onClick={submit}>Предложить замену клиенту</button>
  </>:<span className="note">Для отправки рекомендации откройте ТехБазу из назначенной заявки или ремонта СТО.</span>}
 </section>;
}
// Keys are local React identity only; never put bearer tokens into routes or DOM.
function usePartScope(){
 const {me}=useMe();const token=getToken();
 const session=useRef({token,revision:0});
 if(session.current.token!==token)session.current={token,revision:session.current.revision+1};
 return {me,scope:me&&token?JSON.stringify([me.id,session.current.revision,me.owner_id,me.roles]):null};
}
function usePartRead<T>(fetchCurrent:()=>Promise<T>,key:string,refreshOn?:(e:any)=>boolean){
 const session=getToken(),active=useRef(false);
 useLayoutEffect(()=>{active.current=true;return()=>{active.current=false;};},[]);
 const current=()=>active.current&&!!session&&getToken()===session;
 const result=usePrivateRead<T>(async()=>{
  if(!current())throw Error('Сессия изменилась');
  const data=await fetchCurrent();
  if(!current())throw Error('Сессия изменилась');
  return data;
 },key,e=>e.type==='connection_restored'||e.type==='part_recommendations_changed'||!!refreshOn?.(e));
 return {...result,reload:()=>{if(current())return result.reload();}};
}
function PartReadStatus({read}:{read:{loading:boolean;error:string|null;reload:()=>void}}){
 return read.error?<div role="alert" className="note">Не удалось обновить данные. <button type="button" className="btn ghost small" onClick={read.reload}>Повторить загрузку</button></div>:read.loading?<span role="status" className="note">Загрузка…</span>:null;
}
function usePartAction(){
 const session=getToken(),active=useRef(false),lock=useRef(false);
 useLayoutEffect(()=>{active.current=true;return()=>{active.current=false;};},[]);
 const {busy,run}=useAction();
 const current=()=>active.current&&!!session&&getToken()===session;
 return {busy,run:async<T,>(fn:()=>Promise<T>,message:string)=>{
  if(!current()||lock.current)return undefined;
  lock.current=true;
  try{const result=await run(fn,message);return current()?result:undefined;}
  finally{lock.current=false;}
 }};
}
function RecRows({rows,canDecide,reload}:{rows:Rec[];canDecide:boolean;reload:()=>void}){
 const {busy,run}=usePartAction();
 return <>{rows.map(r=><div className="card flat stack" key={r.id}>
  <div className="between"><b>{r.name}</b><span className="pill">{labels[r.status]??r.status}</span></div>
  <span>{r.brand} · {r.article} × {r.qty}</span><p>{r.reason}</p><small className="note">{fmtTime(r.created_at)} · Заказ не оформлен автоматически.</small>
  {canDecide&&r.status==='pending'&&<div className="row">{[true,false].map(accept=><button key={String(accept)} className="btn ghost small" disabled={busy} onClick={async()=>{if(await run(()=>post((r.source_booking_id?'/api/bookings/'+r.source_booking_id:'/api/orders/'+r.source_order_id)+'/part-recommendations/'+r.id+'/decision',{accept}),accept?'Замена согласована':'Рекомендация отклонена'))reload();}}>{accept?'Согласовать замену':'Отказаться'}</button>)}</div>}
  {r.sourcing_status==='requested'&&<span className="note">Магазин подбирает точную деталь. Заказа пока нет.</span>}
  {r.sourcing_status==='unavailable'&&<span className="note">Деталь пока не найдена. {r.sourcing_note}</span>}
  {r.sourcing_status==='resolved'&&r.product_id&&<span className="note">Магазин подобрал точный товар. {r.sourcing_note}</span>}
  {canDecide&&r.status==='accepted'&&(r.product_id
   ?<a className="btn ghost small" href={'#/shop/cart?partRecommendationId='+encodeURIComponent(r.id)}>Проверить цену и оформить заказ</a>
   :r.sourcing_status!=='requested'&&<button className="btn ghost small" disabled={busy} onClick={async()=>{if(await run(()=>post('/api/shop/part-recommendations/'+r.id+'/sourcing',{}),'Запрос на подбор отправлен; заказ не создан'))reload();}}>{r.sourcing_status==='unavailable'?'Повторить запрос подбора':'Запросить подбор детали в магазине'}</button>)} 
  <a href={r.source_booking_id?'#/booking/'+r.source_booking_id:'#/order/'+r.source_order_id}>{r.source_booking_id?'Исходная запись СТО':'Исходная заявка'}</a>
 </div>)}</>;
}
export function OrderPartRecommendations({order:o}:{order:any}){
 const {scope}=usePartScope();
 if(!scope||!['client','performer'].includes(o.you))return null;
 return <OrderPartList key={JSON.stringify([scope,o.id,o.you])} order={o}/>;
}
function OrderPartList({order:o}:{order:any}){
 const list=usePartRead<{canSuggest:boolean;canDecide:boolean;items:Rec[]}>(()=>get('/api/orders/'+o.id+'/part-recommendations'),o.id,e=>(e.type==='order'||e.type==='part_sourcing')&&e.orderId===o.id);
 const [open,setOpen]=useState(false);
 if(o.you!=='client'&&o.you!=='performer')return null;
 return <section className="card stack"><b>Рекомендации по запчастям</b>
  <PartReadStatus read={list}/>
  {list.data?.canSuggest&&<><a className="btn ghost small" href={'#/techbase/master?orderId='+encodeURIComponent(o.id)}>Подобрать деталь в ТехБазе</a><button type="button" className="btn ghost small" onClick={()=>setOpen(v=>!v)}>{open?'Свернуть':'Предложить по маркировке детали'}</button>{open&&<PartProposal orderId={o.id} onSent={list.reload}/>}</>}
  {list.data&&<RecRows rows={list.data.items} canDecide={list.data.canDecide} reload={list.reload}/>}
 </section>;
}
export function BookingPartRecommendations({bookingId}:{bookingId:string}){
 const {scope}=usePartScope();
 return scope?<BookingPartList key={JSON.stringify([scope,bookingId])} bookingId={bookingId}/>:null;
}
function BookingPartList({bookingId}:{bookingId:string}){
 const list=usePartRead<{canSuggest:boolean;canDecide:boolean;items:Rec[]}>(()=>get('/api/bookings/'+encodeURIComponent(bookingId)+'/part-recommendations'),bookingId,e=>(e.type==='booking'||e.type==='part_sourcing')&&e.bookingId===bookingId);
 const [open,setOpen]=useState(false);
 return <section className="card stack"><b>Рекомендации по запчастям</b>
  <span className="note">Рекомендация и заказ магазина не изменяют счёт СТО автоматически.</span>
  <PartReadStatus read={list}/>
  {list.data?.canSuggest&&<><a className="btn ghost small" href={'#/techbase/master?bookingId='+encodeURIComponent(bookingId)}>Подобрать деталь в ТехБазе</a><button className="btn ghost small" type="button" onClick={()=>setOpen(v=>!v)}>{open?'Свернуть':'Предложить по маркировке детали'}</button>{open&&<PartProposal bookingId={bookingId} onSent={list.reload}/>}</>}
  {list.data&&<RecRows rows={list.data.items} canDecide={list.data.canDecide} reload={list.reload}/>}
  {list.data?.items.length===0&&!list.data.canSuggest&&<span className="note">Рекомендаций пока нет</span>}
 </section>;
}
export function PartRecommendationHistory({vehicleId}:{vehicleId?:string}){
 const {me,scope}=usePartScope();
 if(!scope||!me?.roles?.includes('client')||me.owner_id)return null;
 return <PartHistory key={JSON.stringify([scope,vehicleId])} vehicleId={vehicleId}/>;
}
function PartHistory({vehicleId}:{vehicleId?:string}){
 const [page,setPage]=useState(0);
 const history=usePartRead<{items:Rec[];hasMore:boolean}>(()=>get('/api/shop/part-recommendations?page='+page+(vehicleId?'&vehicleId='+encodeURIComponent(vehicleId):'')),String(page),e=>e.type==='part_sourcing'||e.type==='order'||e.type==='booking');
 return <section className="card stack"><b>История рекомендаций мастеров</b><PartReadStatus read={history}/>
  {history.data?.items.length===0&&<span className="note">Рекомендаций пока нет</span>}
  {history.data&&<RecRows rows={history.data.items} canDecide={true} reload={history.reload}/>}
  {(page>0||history.data?.hasMore)&&<div className="row"><button className="btn ghost small" disabled={!page||history.loading} onClick={()=>setPage(p=>p-1)}>Назад</button><button className="btn ghost small" disabled={!history.data?.hasMore} onClick={()=>setPage(p=>p+1)}>Далее</button></div>}
 </section>;
}

export function AdminPartSourcing(){
 const {scope}=usePartScope();
 return scope?<AdminPartQueue key={scope}/>:null;
}
function AdminPartQueue(){
 const [status,setStatus]=useState<'requested'|'resolved'|'unavailable'>('requested');
 const [page,setPage]=useState(0);
 const [selected,setSelected]=useState('');
 const queue=usePartRead<{items:Rec[];hasMore:boolean;shopEnabled:boolean}>(()=>get('/api/admin/shop/part-sourcing?status='+status+'&page='+page),JSON.stringify([status,page]),e=>e.type==='part_sourcing');
 useLayoutEffect(()=>{if(!queue.data)setSelected('');},[queue.data]);
 return <section className="card stack"><h2>Подбор запчастей по рекомендациям</h2>
  <p className="note">Только подтверждённый производитель и артикул. Привязка товара не создаёт заказ, оплату или резерв. Клиент сам проверяет цену и оформляет покупку.</p>
  {queue.data&&!queue.data.shopEnabled&&<p className="note">Витрина закрыта. Можно готовить предложения, оформление покупки недоступно до открытия.</p>}
  <div className="row">{([['requested','На подборе'],['resolved','Подобраны'],['unavailable','Не найдены']] as const).map(([key,label])=><button type="button" className="chip" aria-pressed={status===key} key={key} onClick={()=>{setStatus(key);setPage(0);setSelected('');}}>{label}</button>)}</div>
  <button className="btn ghost small" onClick={queue.reload}>Обновить очередь</button>
  <PartReadStatus read={queue}/>
  {queue.data?.items.length===0&&<p className="note">В этом разделе нет запросов</p>}
  {queue.data?.items.map(r=><article className="card flat stack" key={r.id}>
   <b>{r.brand} · {r.article} × {r.qty}</b><span>{r.name}</span><p>{r.reason}</p>
   <span className="note">{r.sourcing_requested_at?fmtTime(r.sourcing_requested_at):fmtTime(r.created_at)}</span>
   {r.sourcing_note&&<p>{r.sourcing_note}</p>}
   {status==='requested'&&<><button className="btn ghost small" onClick={()=>setSelected(v=>v===r.id?'':r.id)}>{selected===r.id?'Свернуть':'Подобрать точный товар'}</button>
    {selected===r.id&&<SourcingEditor key={r.id} rec={r} onDone={()=>{setSelected('');queue.reload();}}/>}</>}
  </article>)}
  {(page>0||queue.data?.hasMore)&&<div className="row"><button className="btn ghost small" disabled={!page||queue.loading} onClick={()=>{setSelected('');setPage(p=>p-1);}}>Назад</button><button className="btn ghost small" disabled={!queue.data?.hasMore} onClick={()=>{setSelected('');setPage(p=>p+1);}}>Далее</button></div>}
 </section>;
}
function SourcingEditor({rec,onDone}:{rec:Rec;onDone:()=>void}){
 const candidates=usePartRead<{products:Product[];hasMore:boolean}>(()=>get('/api/admin/shop/part-sourcing/'+rec.id+'/candidates'),rec.id);
 const [product,setProduct]=useState(''),[note,setNote]=useState('');
 const {busy,run}=usePartAction();
 useLayoutEffect(()=>{if(!candidates.data)setProduct('');},[candidates.data]);
 const selectedValid=!!candidates.data&&!candidates.data.hasMore&&candidates.data.products.some(p=>p.id===product);
 async function resolve(status:'resolved'|'unavailable'){
  if(!candidates.data||(status==='resolved'&&!selectedValid))return;
  if(await run(()=>post('/api/admin/shop/part-sourcing/'+rec.id+'/resolve',{status,...(status==='resolved'?{productId:product}:{}),note}),status==='resolved'?'Точный товар предложен клиенту':'Результат подбора сохранён'))onDone();
 }
 return <div className="stack">
  <PartReadStatus read={candidates}/>
  {candidates.data?.products.length===0&&<p className="note">Товар не найден. Добавьте проверенную позицию в разделе «Товары», затем вернитесь к запросу.</p>}
  {candidates.data?.hasMore&&<p className="note">Найдено более 20 совпадений. Уточните каталог перед привязкой.</p>}
  {candidates.data?.products.map(p=><button key={p.id} type="button" className="btn ghost small" aria-pressed={product===p.id} onClick={()=>setProduct(p.id)}>{p.name} · {p.brand} {p.article} · {rub(p.price)} · {p.stock==null?'Под заказ':'Остаток '+p.stock}</button>)}
  <button className="btn ghost small" onClick={()=>{setProduct('');candidates.reload();}}>Обновить совпадения</button>
  <label>Комментарий клиенту<textarea className="field" maxLength={500} rows={2} value={note} onChange={e=>setNote(e.target.value)}/></label>
  <button className="btn small" disabled={busy||!selectedValid} onClick={()=>resolve('resolved')}>Предложить выбранную деталь</button>
  <button className="btn ghost small" disabled={busy||!candidates.data||note.trim().length<8} onClick={()=>resolve('unavailable')}>Пока не удалось подобрать</button>
 </div>;
}
