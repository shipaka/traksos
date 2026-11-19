import { useState } from 'react';
import { get, post, rub } from '../api.ts';
import { useAction, useLoad, Loading } from '../ui.tsx';

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
  const d=useLoad(()=>get('/api/admin/bookings/'+id+'/payment-events'),[id]);
  const {busy,run}=useAction();
  const [kind,setKind]=useState<Move>('receipt');
  const [method,setMethod]=useState<Method>('invoice');
  const [amount,setAmount]=useState('');
  const [reference,setReference]=useState('');
  async function save() {
    const kopecks=Math.round(Number(amount)*100);
    if (!Number.isSafeInteger(kopecks)||kopecks<=0||reference.trim().length<4)return;
    const result=await run(()=>post('/api/admin/bookings/'+id+'/payment-events',
      {kind,method,amount:kopecks,reference:reference.trim()}),
    kind==='receipt'?'Поступление записано':'Возврат учтён');
    if(result){setAmount('');setReference('');await d.reload();reload();}
  }
  const inv=d.data?.invoice;
  return <div className="card stack">
    <div className="between"><b>Ручная банковская сверка — счёт №{inv?.number??''}</b>
      <button type="button" className="btn ghost small" onClick={close}>Закрыть</button></div>
    <p className="note">Здесь фиксируется уже совершённая операция по реальному банковскому/кассовому документу. Кнопка ничего не списывает со счёта клиента и не отправляет банковский возврат.</p>
    {!inv ? <Loading error={d.error} /> : <>
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
              <option value="cash">Наличные по кассовому документу</option>
              <option value="other">Другое подтверждённое поступление</option>
            </select>
          </label>
          <label className="stack">Сумма, ₽
            <input className="field" type="number" min=".01" max="100000000" step=".01"
              value={amount} onChange={e=>setAmount(e.target.value)} placeholder="Например, 10500" />
          </label>
          <label className="stack">Номер реальной банковской / кассовой операции
            <input className="field" value={reference} maxLength={200} onChange={e=>setReference(e.target.value)}
              placeholder="Номер транзакции / выписки / чека" />
          </label>
        </div>
        <button className="btn" type="button" disabled={busy||!reference.trim()||reference.trim().length<4||!amount||Number(amount)<=0}
          onClick={save}>Записать {kind==='receipt'?'поступление':'исполненный возврат'}</button>
      </>}
      {!inv.paymentRequired && <span className="note">Исторический счёт не пересчитывается: новая схема платежей для него не применяется.</span>}
      <b>Журнал подтверждений</b>
      {d.data.events.length===0?<span className="note">Подтверждённых операций пока нет.</span>:
        d.data.events.map((x:any)=><div key={x.id} className="between">
          <span>{x.kind==='receipt'?'Поступление':'Возврат'} · {x.method} · {x.reference}<small className="note"> · {new Date(x.created_at).toLocaleString('ru-RU')} · {x.verified_by}</small></span>
          <b>{x.kind==='receipt'?'+':'−'}{rub(x.amount)}</b></div>)}
    </>}
  </div>;
}

export function AdminServiceFinance() {
  const d=useLoad(()=>get('/api/admin/service-finance'),[]);
  const {busy,run}=useAction();
  const [selected,setSelected]=useState<string|null>(null);
  const [payoutRefs,setPayoutRefs]=useState<Record<string,string>>({});
  const [filter,setFilter]=useState<'all'|'awaiting'|'ready'|'disputed'|'recovery'>('all');
  const items:any[]=d.data??[];
  const shown=items.filter(x=>
    filter==='all'||(filter==='awaiting'&&x.payment_required&&x.outstanding>0)||
    (filter==='ready'&&x.payoutReady)||(filter==='disputed'&&x.status==='disputed')||
    (filter==='recovery'&&x.recoveryNeeded));
  async function markPayout(id:string) {
    const ref=payoutRefs[id]?.trim()??'';
    if(ref.length<4)return;
    const out=await run(()=>post('/api/admin/bookings/'+id+'/paid',{reference:ref}),'Фактическая выплата отмечена по банковскому документу');
    if(out)await d.reload();
  }
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
    {!d.data ? <Loading error={d.error}/> : shown.length===0 ? <div className="empty">Счетов с такими параметрами нет.</div>:
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
            <button type="button" className="btn small" disabled={busy||(x.payment_required&&(payoutRefs[x.id]??'').trim().length<4)}
              onClick={()=>markPayout(x.id)}>Отметить фактическую выплату СТО</button>
          </>}
        </div>
        {selected===x.id && <BankMovements id={x.id} close={()=>setSelected(null)} reload={d.reload}/>}
      </div>)}
    <p className="note">Полная история сверки доступна только администратору. Платёжные документы и банковские переводы подтверждаются вне TrakSOS; внутреннее действие не отправляет реальные деньги.</p>
  </div>;
}
