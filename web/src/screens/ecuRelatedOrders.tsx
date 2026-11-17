import {useState} from 'react';
import {get,post,rub,fmtTime} from '../api.ts';
import {useAction,useLoad} from '../ui.tsx';
import {SERVICES,STATUS} from '../dict.ts';

type Stage={
  id:string;number:number;service:string;status:string;
  additionalTo:string|null;continuationOf:string|null;
  money?:{total:number}
};
type Recommendation={
  id:string;orderId:string;reason:string;status:'pending'|'used'|'declined';
  createdAt:string;linkedOrderId:string|null
};
type Props={order:{
  id:string;you:string;service:string;status:string;additionalTo:string|null;
  hasActiveEcuAddition?:boolean;
  caseRootId:string;caseOtherStages?:Array<{number:number;service:string;status:string}>;
  caseSummary?:{
    stages:Stage[];confirmedTotal:number;pendingCount:number;
    separateContracts:boolean;multiStage:boolean
  }
}};
const active=new Set(['accepted','en_route','arrived','working','awaiting_confirmation','completed']);
export function EcuRelatedOrders({order}:Props){
  const {run,busy}=useAction();
  const [reason,setReason]=useState('');
  const customer=order.you==='client';
  const executor=order.you==='performer'&&order.service!=='ecu';
  const allowed=customer||executor||order.you==='admin';
  const refs=useLoad<{recommendations:Recommendation[];canCreate:boolean}>(
    ()=>allowed?get('/api/orders/'+order.id+'/ecu-recommendations'):
      Promise.resolve({recommendations:[],canCreate:false}),[order.id,allowed],
    (e:any)=>e.type==='order'&&e.orderId===order.id
  );
  const steps=order.caseSummary?.stages??[];
  const addOnExists=Boolean(order.hasActiveEcuAddition)||steps.some(x=>x.additionalTo===order.id&&x.service==='ecu'&&
    !['cancelled','no_performer'].includes(x.status));
  const mayAdd=customer&&order.service!=='ecu'&&active.has(order.status)&&!addOnExists;
  const mayRecommend=executor&&active.has(order.status);
  if(!customer&&!executor&&order.you!=='admin'&&order.service!=='ecu')return null;
  return <section className="card stack" aria-label="Связанные работы и специалист по ЭБУ">
    <h3>Одно обращение · отдельные заявки</h3>
    <p className="note">Если после диагностики нужен другой специалист, можно
      создать дополнительную заявку по этому же автомобилю.
      У каждого исполнителя собственные статусы, договорённость о цене,
      ответственность и оплата.</p>
    {customer||order.you==='admin'?<>
      {steps.length>0&&<div className="stack">
        {steps.map(s=><a key={s.id} className="linkrow" href={'#/order/'+s.id}>
          <span><b>№{s.number} · {SERVICES[s.service]?.name??s.service}</b>
            <small>{STATUS[s.status]?.name??s.status}
              {s.additionalTo?' · дополнительная работа':''}
              {s.continuationOf?' · следующий этап':''}
            </small></span>
          <span>{s.status==='completed'&&s.money?
            rub(s.money.total):'›'}</span>
        </a>)}
      </div>}
      <div className="sum">
        <span>Итого по завершённым этапам</span>
        <b>{rub(order.caseSummary?.confirmedTotal??0)}</b>
      </div>
      {(order.caseSummary?.pendingCount??0)>0&&<p className="note">
        Ещё выполняются или согласуются этапы: {order.caseSummary?.pendingCount}.
        Их стоимость не включена в сумму завершённых работ.</p>}
      <p className="note">Это сводка для клиента, а не общий платёж.
        Неоплаченные/оспариваемые этапы не считаются автоматически оплаченными.</p>
    </>:<>
      {(order.caseOtherStages??[]).length>0&&<div className="stack">
        <strong>Другие этапы этого обращения</strong>
        {order.caseOtherStages!.map(s=><div className="between" key={s.number}>
          <span>№{s.number} · {SERVICES[s.service]?.name??s.service}</span>
          <small>{STATUS[s.status]?.name??s.status}</small>
        </div>)}
      </div>}
      <p className="note">Вам видны только номера и статусы соседних этапов.
        Суммы, личные данные, чаты и расчёты других исполнителей закрыты.</p>
    </>}
    {refs.error&&<p role="alert">{refs.error}
      <button type="button" className="btn ghost" onClick={refs.reload}>Повторить</button></p>}
    {(refs.data?.recommendations??[]).map(ref=><div className="card stack" key={ref.id}>
      <strong>Рекомендация эксперта по ЭБУ
        {ref.status==='pending'?' · ждёт решения':ref.status==='used'?' · выполнена':' · отклонена'}
      </strong>
      <p>{ref.reason}</p>
      <span className="note">{fmtTime(ref.createdAt)}</span>
      {customer&&ref.status==='pending'&&mayAdd&&<div className="row">
        <a className="btn" href={'#/new/ecu?additionalTo='+order.id}>
          Оформить отдельную заявку
        </a>
        <button className="btn ghost" type="button" disabled={busy} onClick={async()=>{
          const result=await run(()=>post('/api/orders/'+order.id+
            '/ecu-recommendations/'+ref.id+'/decline',{}),'Рекомендация отклонена');
          if(result)await refs.reload();
        }}>Пока не нужно</button>
      </div>}
      {ref.linkedOrderId&&customer&&<a href={'#/order/'+ref.linkedOrderId}>
        Открыть дополнительную заявку</a>}
    </div>)}
    {mayAdd&&<a className="btn ghost" href={'#/new/ecu?additionalTo='+order.id}>
      Подключить специалиста по ЭБУ
    </a>}
    {customer&&addOnExists&&<p className="note">
      Специалист по ЭБУ уже подключён. Новую заявку оформлять не нужно —
      откройте отдельную карточку в истории выше.
    </p>}
    {mayRecommend&&<form className="stack" onSubmit={async e=>{
      e.preventDefault();
      const sent=await run(()=>post('/api/orders/'+order.id+'/recommend-ecu',
        {reason:reason.trim()}),'Рекомендация отправлена клиенту');
      if(sent){setReason('');await refs.reload();}
    }}>
      <label>Нужен эксперт по ЭБУ?
        <textarea className="field" rows={3} minLength={20} maxLength={800}
          placeholder="Что именно не удалось решить и зачем нужен электронщик. Без VIN и чужих контактов."
          value={reason} onChange={e=>setReason(e.target.value)}/>
      </label>
      <button className="btn ghost" type="submit"
        disabled={busy||reason.trim().length<20}>
        Предложить клиенту отдельный этап ЭБУ
      </button>
      <p className="note">Рекомендация не создаёт платную заявку.
        Клиент решает самостоятельно и подтверждает стоимость до заказа.</p>
    </form>}
  </section>;
}
