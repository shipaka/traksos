import {useEffect,useRef,useState} from 'react';
import { post, rub } from '../api.ts';
import {useAction,useMe} from '../ui.tsx';
import {useAdminScopedResource} from '../adminScopedResource20261124.ts';
import {parseAdminRubles} from '../adminFinanceKopecks20261124.ts';

type Move = 'receipt' | 'refund';
type Method = 'invoice' | 'online' | 'cash' | 'other';
const paymentNames: Record<string,string> = {
  not_invoiced:'Нет счёта',
  legacy_not_verified:'Старый счёт: без сверки',
  awaiting_payment:'Ожидается оплата',
  partial:'Оплачен частично',
  received:'Поступление подтверждено',
  refunded:'Возврат зарегистрирован',
};

function BankMovements({id,close,reload}:{id:string;close:()=>void;reload:()=>void}) {
  const {me}=useMe();
  const admin=!!me?.roles.includes('admin');
  const scope=(me?.id??'signed-out')+':booking:'+id;
  const scopeRef=useRef(scope);
  scopeRef.current=scope;
  const d=useAdminScopedResource<any>('/api/admin/bookings/'+id+'/payment-events',scope,admin);
  const {busy,run}=useAction();
  const [kind,setKind]=useState<Move>('receipt');
  const [method,setMethod]=useState<Method>('invoice');
  const [amount,setAmount]=useState('');
  const [reference,setReference]=useState('');
  const [error,setError]=useState('');
  const [uncertain,setUncertain]=useState(false);
  const lock=useRef(false);
  useEffect(()=>{
    setKind('receipt');setMethod('invoice');setAmount('');setReference('');setError('');setUncertain(false);
  },[scope]);
  const kopecks=parseAdminRubles(amount);
  async function save() {
    if(lock.current||uncertain||!d.data||d.error)return;
    if(busy||!admin||kopecks===null||reference.trim().length<4){
      setError('Укажите точную сумму до копейки и номер подтверждающего банковского документа.');
      return;
    }
    const startedAs=scope;
    setError('');
    // This screen only records a completed bank/receipt operation. It is
    // deliberately not a bank/payment gateway or an automatic retry.
    lock.current=true;
    const result=await run(()=>post('/api/admin/bookings/'+id+'/payment-events',
      {kind,method,amount:kopecks,reference:reference.trim()}),
      kind==='receipt'?'Поступление записано':'Возврат учтён').finally(()=>{lock.current=false;});
    if(scopeRef.current!==startedAs)return;
    if(result){
      setAmount('');setReference('');d.reload();reload();
    }else {setUncertain(true);setError('Операция не подтверждена. Сверьте банковский журнал перед повторной записью.');}
  }
  const inv=d.data?.invoice;
  const events=Array.isArray(d.data?.events)?d.data.events:null;
  const valid=inv&&events;
  return <div className="card stack">
    <div className="between"><b>Ручная банковская сверка — счёт №{inv?.number??''}</b>
      <button type="button" className="btn ghost small" onClick={close}>Закрыть</button></div>
    <p className="note">Здесь фиксируется уже совершённая операция по реальному банковскому/кассовому документу. Кнопка ничего не списывает со счёта клиента и не отправляет банковский возврат.</p>
    {!valid ? <div className="stack" role={d.error||d.data?'alert':'status'}>
      <p>{d.error?'Не удалось загрузить банковскую сверку: '+d.error:
        d.data?'Сервер вернул неполный журнал — операции недоступны.':
        'Загружаем банковскую сверку…'}</p>
      <button type="button" className="btn ghost small" onClick={d.reload}>
        Повторить загрузку сверки
      </button>
    </div> : <>
      <div className="row"><span>Клиенту начислено <b>{rub(inv.total)}</b></span>
        <span>Получено <b>{rub(inv.received)}</b></span>
        <span>Возвращено <b>{rub(inv.refunded)}</b></span>
        <span>Осталось <b>{rub(inv.outstanding)}</b></span></div>
      {inv.recoveryNeeded && <p className="banner warn">После выплаты СТО был проведён возврат клиенту. Требуется ручная сверка компенсации с сервисом: автоматического возврата из выплаты нет.</p>}
      {inv.paymentRequired && <>
        <div className="grid2">
          <label className="stack">Что подтверждаем
            <select className="field" value={kind} onChange={e=>setKind(e.target.value as Move)}>
              <option value="receipt">Поступившая оплата</option><option value="refund">Уже исполненный возврат</option>
            </select>
          </label>
          <label className="stack">Способ
            <select className="field" value={method} onChange={e=>setMethod(e.target.value as Method)}>
              <option value="invoice">Банковский перевод / счёт</option>
              <option value="online">Онлайн-эквайринг (сверен)</option>
              <option value="cash">Наличные (только сверка исторического кассового документа)</option>
              <option value="other">Другое подтверждённое поступление</option>
            </select>
          </label>
          <label className="stack">Сумма, ₽
            <input className="field" type="text" inputMode="decimal" maxLength={30}
              value={amount} onChange={e=>setAmount(e.target.value)} placeholder="Например, 10500" />
          </label>
          <label className="stack">Номер реальной банковской / кассовой операции
            <input className="field" value={reference} maxLength={200} onChange={e=>setReference(e.target.value)}
              placeholder="Номер транзакции / выписки / чека" />
          </label>
        </div>
        {error&&<div className="banner warn" role="alert">{error}</div>}
        {uncertain&&<div className="row"><button type="button" className="btn ghost small" onClick={d.reload}>Обновить банковский журнал</button><button type="button" className="btn ghost small" disabled={d.loading||!valid} onClick={()=>setUncertain(false)}>Банковский журнал проверен</button></div>}
        {amount&&kopecks===null&&<p className="note" role="alert">Введите сумму в рублях с точностью до копейки, без экспонент и округления.</p>}
        <button className="btn" type="button"
          disabled={busy||uncertain||!admin||reference.trim().length<4||kopecks===null}
          onClick={()=>void save()}>Записать {kind==='receipt'?'поступление':'исполненный возврат'}</button>
      </>}
      {!inv.paymentRequired && <span className="note">Исторический счёт не пересчитывается: новая схема платежей для него не применяется.</span>}
      <b>Журнал подтверждений</b>
      {events!.length===0?<span className="note">Подтверждённых операций пока нет.</span>:
        events!.map((x:any)=><div key={x.id} className="between">
          <span>{x.kind==='receipt'?'Поступление':'Возврат'} · {x.method} · {x.reference}<small className="note"> · {new Date(x.created_at).toLocaleString('ru-RU')} · {x.verified_by}</small></span>
          <b>{x.kind==='receipt'?'+':'−'}{rub(x.amount)}</b></div>)}
    </>}
  </div>;
}

export function AdminServiceFinance() {
  const {me}=useMe();
  const admin=!!me?.roles.includes('admin');
  const scope=(me?.id??'signed-out')+':service-finance-admin';
  const scopeRef=useRef(scope);
  scopeRef.current=scope;
  const d=useAdminScopedResource<any[]>('/api/admin/service-finance',scope,admin);
  const {busy,run}=useAction();
  const [selected,setSelected]=useState<string|null>(null);
  const [payoutRefs,setPayoutRefs]=useState<Record<string,string>>({});
  const [filter,setFilter]=useState<'all'|'awaiting'|'ready'|'disputed'|'recovery'>('all');
  const [actionError,setActionError]=useState('');
  const payoutLock=useRef(false);
  const [payoutUnconfirmed,setPayoutUnconfirmed]=useState(false);
  useEffect(()=>{
    setSelected(null);setPayoutRefs({});setFilter('all');setActionError('');setPayoutUnconfirmed(false);
  },[scope]);
  const items:any[]=Array.isArray(d.data)?d.data:[];
  const shown=items.filter(x=>
    filter==='all'||(filter==='awaiting'&&x.payment_required&&x.outstanding>0)||
    (filter==='ready'&&x.payoutReady)||(filter==='disputed'&&x.status==='disputed')||
    (filter==='recovery'&&x.recoveryNeeded));
  async function markPayout(id:string) {
    if(!admin||busy||payoutLock.current||payoutUnconfirmed||!d.data||d.error)return;
    const ref=payoutRefs[id]?.trim()??'';
    const invoice=items.find(item=>String(item.id)===id);
    if(!invoice?.payoutReady)return;
    if(invoice.payment_required&&ref.length<4){
      setActionError('Укажите номер реально отправленного перевода перед фиксацией выплаты.');
      return;
    }
    if(!window.confirm('Фактический банковский перевод СТО уже выполнен? Записать подтверждение в журнал?'))return;
    const startedAs=scope;
    setActionError('');
    payoutLock.current=true;
    const out=await run(()=>post('/api/admin/bookings/'+id+'/paid',
      invoice.payment_required?{reference:ref}:{}),'Фактическая выплата отмечена по банковскому документу').finally(()=>{payoutLock.current=false;});
    if(scopeRef.current!==startedAs)return;
    if(out){
      setPayoutRefs(old=>({...old,[id]:''}));d.reload();
    }else {setPayoutUnconfirmed(true);setActionError('Подтверждение выплаты не получено. Проверьте историю счёта перед повтором.');}
  }
  if(!admin)return <div className="card stack">
    <h3>Сверка оплаты и выплат СТО</h3>
    <p role="alert">Реестр банковской сверки доступен только администратору.</p>
  </div>;
  return <div className="stack">
    <h3>Сверка оплаты и выплат СТО</h3>
    <p className="note">Два независимых сбора: клиентский 5% сверху и комиссия СТО 5% внутри суммы работ. Максимум по 5 000 ₽ с каждой стороны на счёт. Для старых счетов тариф и итог не меняются.</p>
    <p className="note">В этой версии регистрация поступлений и возвратов ведётся по фактической выписке вручную. Это не платёжный шлюз. Подтверждение работ клиентом ещё не означает поступление оплаты.</p>
    <div className="row">
      {([['all','Все'],['awaiting','Ожидают денег'],['ready','Можно выплатить'],['disputed','В споре'],['recovery','Нужна сверка']] as const)
        .map(([id,label])=><button type="button" className="chip" key={id}
          aria-pressed={filter===id} onClick={()=>setFilter(id)}>{label}</button>)}
      <button type="button" className="btn ghost small" onClick={()=>d.reload()}>Обновить</button>
    </div>
    {actionError&&<div className="banner warn" role="alert">{actionError}</div>}
    {payoutUnconfirmed&&<div className="row"><button type="button" className="btn ghost small" onClick={d.reload}>Обновить реестр выплат</button><button type="button" className="btn ghost small" disabled={d.loading||!Array.isArray(d.data)} onClick={()=>setPayoutUnconfirmed(false)}>История выплаты проверена</button></div>}
    {!Array.isArray(d.data) ? <div className="card stack" role={d.error||d.data?'alert':'status'}>
      {d.error?'Не удалось загрузить финансовый реестр: '+d.error:
        d.data?'Сервер вернул некорректные данные финансов.':'Загружаем финансовый реестр…'}
      <button type="button" className="btn ghost small" onClick={d.reload}>Повторить загрузку финансов</button>
    </div> : shown.length===0 ? <div className="empty">Счетов с такими параметрами нет.</div>:
      shown.map((x:any)=><div key={x.id} className="card stack">
        <div className="between"><div><b>Счёт №{x.number} · {x.center_name}</b>
          <div className="note">{x.client_name} · {new Date(x.invoiced_at).toLocaleDateString('ru-RU')}</div></div>
          <span className="pill">{x.status==='disputed'?'Спор':paymentNames[x.paymentStatus]??x.paymentStatus}</span>
        </div>
        <div className="grid2">
          <div className="sum"><span>Цена работ — база комиссии</span><b>{rub(x.payment_required?x.fee_base_amount:x.amount)}</b></div>
          {x.parts_amount>0 && <div className="sum"><span>Материалы и запчасти (без сбора)</span><b>{rub(x.parts_amount)}</b></div>}
          <div className="sum"><span>Сбор клиента</span><b>+{rub(x.client_fee)}</b></div>
          <div className="sum"><span>Комиссия СТО</span><b>−{rub(x.commission)}</b></div>
          {x.discount>0 && <div className="sum"><span>Скидка клиенту</span><b>−{rub(x.discount)}</b></div>}
          <div className="sum"><span>Итого клиенту</span><b>{rub(x.toPay)}</b></div>
          <div className="sum"><span>Причитается СТО</span><b>{rub(x.payout)}</b></div>
          <div className="sum"><span>Подтверждено поступление</span><b>{rub(x.netReceived)}</b></div>
          <div className="sum"><span>Ещё ожидается</span><b>{rub(x.outstanding)}</b></div>
        </div>
        {x.recoveryNeeded && <p className="banner warn">По уже выплаченному счёту зарегистрирован возврат — требуется ручное урегулирование с СТО.</p>}
        {x.status==='closed'&&!x.paid_out_at && !x.payoutReady &&
          <p className="note">Выплата заблокирована до подтверждения полного поступления.</p>}
        {x.paid_out_at && <span className="note">Выплата отмечена {new Date(x.paid_out_at).toLocaleDateString('ru-RU')}{x.payout_reference?' · перевод '+x.payout_reference:''}.</span>}
        <div className="row">
          <button type="button" className="btn ghost small" onClick={()=>setSelected(selected===x.id?null:x.id)}>
            {selected===x.id?'Скрыть сверку':'Сверить оплату / возврат'}
          </button>
          {x.payoutReady && <>
            {x.payment_required && <label className="stack">Номер реально отправленного перевода СТО
              <input className="field" maxLength={200} value={payoutRefs[x.id]??''}
                onChange={e=>setPayoutRefs(old=>({...old,[x.id]:e.target.value}))}
                placeholder="Номер платёжного поручения / транзакции" />
            </label>}
            <button type="button" className="btn small" disabled={busy||payoutUnconfirmed||(x.payment_required&&(payoutRefs[x.id]??'').trim().length<4)}
              onClick={()=>markPayout(x.id)}>Отметить фактическую выплату СТО</button>
          </>}
        </div>
        {selected===x.id && <BankMovements key={scope+':'+x.id} id={x.id}
          close={()=>setSelected(null)} reload={d.reload}/>}
      </div>)}
    <p className="note">Полная история сверки доступна только администратору. Платёжные документы и банковские переводы подтверждаются вне TrakSOS; внутреннее действие не отправляет реальные деньги.</p>
  </div>;
}
