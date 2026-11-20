import {get,rub,fmtTime} from '../api.ts';
import {useLoad} from '../ui.tsx';
import {SERVICES,STATUS} from '../dict.ts';

type Payment={
 kind:string;status:string;totalKopecks:number;refundedKopecks:number
};
type Stage={
 id:string;number:number;status:string;service:string;
 additionalTo:string|null;continuationOf:string|null;
 paymentMethod:string;
 price:{proposedTotal:number|null;confirmedTotal:number|null;currency:'RUB';unit:'kopecks'};
 paymentEvidence:{capturedNetKopecks:number;heldKopecks:number;
  refundedKopecks:number;cashOrInvoiceUnverified:boolean;records:Payment[]};
 needsCustomerApproval:boolean;requiresPaymentReconciliation:boolean;
 events:Array<{id:string;type:string;at:string}>
};
type Ledger={
 rootId:string;requestedOrderId:string;limitedToCreator:boolean;
 stages:Stage[];totals:{confirmedKopecks:number;capturedNetKopecks:number;
  heldKopecks:number;refundableNotInferred:boolean};
 pendingApprovals:number;hasOpenPaymentReconciliation:boolean;
 separateContracts:boolean;warning:string
};
const paymentStatus:Record<string,string>={
 created:'Создан',pending:'Ожидает банк',held:'Резерв',captured:'Проведено',
 refunded:'Возвращено',partially_refunded:'Частично возвращено',
 cancelled:'Отменено',failed:'Ошибка'
};
const eventStatus:Record<string,string>={
 accepted:'Исполнитель принял этап',
 amount_proposed:'Мастер предложил итоговую сумму',
 amount_disputed:'Сумма оспорена клиентом',
 amount_confirmed:'Сумма согласована клиентом',
 cancelled:'Этап отменён'
};

/** Read-only account view; a technician never requests other contractors'
 * amounts. The server additionally limits fleet drivers to own work orders.
 */
export function ServiceCaseLedger({orderId}:{orderId:string}){
 const ledger=useLoad<Ledger>(()=>get('/api/orders/'+orderId+'/case-ledger'),
  [orderId],e=>e.type==='order'||e.type==='payment');
 return <details className="card stack" aria-label="История договоров и оплат по обращению">
  <summary><b>Договоры, согласования и оплаты по обращению</b></summary>
  <div className="stack" style={{marginTop:14,gap:12}}>
   <p className="note">Каждый выезд, дополнительный специалист по ЭБУ и
    продолжение ремонта оформляются самостоятельной заявкой и собственным
    согласованием. Оплата одного этапа не подтверждает оплату другого.</p>
   {ledger.error&&<p role="alert">{ledger.error}
    <button className="btn ghost small" onClick={()=>void ledger.reload()}>
      Повторить</button></p>}
   {!ledger.data&&!ledger.error&&<p className="note">Проверяем финансовую историю…</p>}
   {ledger.data&&<>
    {ledger.data.limitedToCreator&&
     <p className="note">Показываются только заявки, созданные вами.
      Финансовые детали других заявок владельца автопарка скрыты.</p>}
    <div className="grid2">
     <div><small>Согласовано по завершённым этапам</small>
      <b>{rub(ledger.data.totals.confirmedKopecks)}</b></div>
     <div><small>Подтверждено банком после возвратов</small>
      <b>{rub(ledger.data.totals.capturedNetKopecks)}</b></div>
     <div><small>Деньги в резерве, не окончательный платёж</small>
      <b>{rub(ledger.data.totals.heldKopecks)}</b></div>
     <div><small>Ожидают согласования клиента</small>
      <b>{ledger.data.pendingApprovals}</b></div>
    </div>
    {ledger.data.hasOpenPaymentReconciliation&&
     <p role="status" className="banner warn">
      Есть подтверждённая работа без завершённой банковской сверки.
      Не считайте её автоматически оплаченной.</p>}
    <div className="stack">
     {ledger.data.stages.map(stage=><article className="card stack" key={stage.id}
       style={{gap:8}}>
      <div className="between">
       <b>Этап №{stage.number} · {SERVICES[stage.service]?.name??stage.service}</b>
       <span className="note">{STATUS[stage.status]?.name??stage.status}</span>
      </div>
      {stage.additionalTo&&<p className="note">Дополнительный специалист —
       отдельная заявка, не доплата к первому выезду.</p>}
      {stage.needsCustomerApproval&&<p role="status" className="note">
       Предложено к согласованию: {rub(stage.price.proposedTotal??0)}.
       Сначала проверьте смету и дополнительные позиции на экране этого этапа.</p>}
      {stage.price.confirmedTotal!==null&&
       <p>Подтверждённая стоимость: <b>{rub(stage.price.confirmedTotal)}</b></p>}
      <div className="grid2">
       <small>Проведено банком: {rub(stage.paymentEvidence.capturedNetKopecks)}</small>
       <small>Резерв: {rub(stage.paymentEvidence.heldKopecks)}</small>
       <small>Возвраты по банковским записям: {rub(stage.paymentEvidence.refundedKopecks)}</small>
       <small>Способ расчёта: {stage.paymentMethod}</small>
      </div>
      {stage.paymentEvidence.cashOrInvoiceUnverified&&
       <p className="note">Для наличных и счёта банковское подтверждение
        в этом отчёте не предоставляется.</p>}
      {stage.requiresPaymentReconciliation&&
       <p role="status" className="note">Банковский платёж требует сверки.</p>}
      {stage.paymentEvidence.records.map((payment,index)=><small key={index}
        className="note">{payment.kind}: {paymentStatus[payment.status]??payment.status}
        {' · '}{rub(payment.totalKopecks)}</small>)}
      {stage.events.length>0&&<details>
       <summary>История согласований ({stage.events.length})</summary>
       <ol className="stack">
        {stage.events.map(event=><li key={event.id}>
         <small>{eventStatus[event.type]??event.type} · {fmtTime(event.at)}</small>
        </li>)}
       </ol>
      </details>}
     </article>)}
    </div>
    <p className="note">{ledger.data.warning}</p>
    <button className="btn ghost small" onClick={()=>void ledger.reload()}>
     Обновить финансовые статусы
    </button>
   </>}
  </div>
 </details>;
}
