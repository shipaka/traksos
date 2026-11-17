import {useState} from 'react';
import {get,post,rub,fmtTime} from '../api.ts';
import {useAction,useLoad} from '../ui.tsx';
import {SERVICES,STATUS} from '../dict.ts';

type Recommendation={
  id:string;orderId:string;reason:string;status:'pending'|'used'|'declined';
  createdAt:string;linkedOrderId:string|null;
};
type Response={recommendations:Recommendation[];canCreate:boolean};
const allowed=new Set(['accepted','en_route','arrived','working','awaiting_confirmation','completed']);

/**
 * Connected jobs share a repair history, NEVER a contract, chat or payment.
 * A recommendation is informational; the customer explicitly places the
 * additional paid ECU order through the normal price/consent form.
 */
export function EcuReferralPanel({order}:{order:any}){
  const isCustomer=order.you==='client';
  const isPerformer=order.you==='performer';
  const isStaff=order.you==='admin';
  const visible=isCustomer||isPerformer||isStaff;
  const {busy,run}=useAction();
  const [reason,setReason]=useState('');
  const [editing,setEditing]=useState(false);
  const rec=useLoad<Response>(
    ()=>visible?get(`/api/orders/${order.id}/ecu-recommendations`):
      Promise.resolve({recommendations:[],canCreate:false}),
    [order.id,order.you],e=>e.type==='order'&&e.orderId===order.id
  );
  if(!visible)return null;
  const steps=order.caseSummary?.stages??[];
  const related=(order.caseOtherStages??[]) as {number:number;service:string;status:string}[];
  const activeRecommendation=rec.data?.recommendations.find(x=>x.status==='pending');
  const alreadyAdded=Boolean(order.hasActiveEcuAddition)||
    steps.some((x:any)=>x.additionalTo===order.id&&x.service==='ecu'&&
      !['cancelled','no_performer'].includes(x.status))||
    related.some(x=>x.service==='ecu'&&!['cancelled','no_performer'].includes(x.status));
  const canRecommend=isPerformer&&order.service!=='ecu'&&allowed.has(order.status)&&
    !alreadyAdded&&!activeRecommendation;
  const canAdd=isCustomer&&order.service!=='ecu'&&allowed.has(order.status)&&
    !alreadyAdded&&(rec.data?.canCreate??true);
  const applyLink=`#/new/ecu?additionalTo=${encodeURIComponent(order.id)}`;
  async function recommend(){
    const saved=await run(()=>post(`/api/orders/${order.id}/recommend-ecu`,{
      reason:reason.trim()
    }),'Рекомендация направлена клиенту');
    if(saved){setReason('');setEditing(false);await rec.reload();}
  }
  async function decline(refId:string){
    const saved=await run(()=>post(
      `/api/orders/${order.id}/ecu-recommendations/${refId}/decline`,{}
    ),'Рекомендация отклонена');
    if(saved)await rec.reload();
  }

  const multi=steps.length+(order.caseSummary?.serviceBookings?.length??0)>1;
  if(!multi&&!related.length&&!canRecommend&&!canAdd&&
     !(rec.data?.recommendations.length))return null;
  return <section className="card stack" aria-label="Связанные работы и специалист по ЭБУ">
    <div className="between"><b>Ремонтный случай · связанные работы</b>
      {multi&&<span className="pill">Несколько исполнителей</span>}
    </div>
    <p className="note">Все этапы относятся к одной неисправности. Заявки,
      исполнители, статусы, расчёты и ответственность по каждой работе отдельные.
      Чат и суммы другого специалиста не раскрываются исполнителям.</p>
    {(isCustomer||isStaff)&&steps.length>0&&<div className="stack">
      {steps.map((step:any)=><a className="linkrow" href={`#/order/${step.id}`}
        key={step.id}>
        <span><b>№{step.number} · {SERVICES[step.service]?.name??step.service}</b>
          <small>{STATUS[step.status]?.name??step.status}
            {step.additionalTo?' · дополнительная работа':''}</small>
        </span>
        <span>{step.status==='completed'?rub(step.money?.total??0):'Открыть'} </span>
      </a>)}
      {order.caseSummary?.serviceBookings?.map((x:any)=><div key={x.id} className="note">
        СТО №{x.number} · {x.status}
      </div>)}
      <div className="sum"><span>Подтверждено за завершённые этапы</span>
        <b>{rub(order.caseSummary?.confirmedTotal??0)}</b></div>
      {(order.caseSummary?.pendingCount??0)>0&&<span className="note">
        Незавершённых заявок: {order.caseSummary.pendingCount}. Их итоговая стоимость пока неизвестна.
      </span>}
    </div>}
    {isPerformer&&related.length>0&&<div className="stack">
      <b>Другие этапы ремонта</b>
      {related.map((x)=><span key={x.number} className="note">
        №{x.number} · {SERVICES[x.service]?.name??x.service} ·
        {STATUS[x.status]?.name??x.status}
      </span>)}
    </div>}
    {isCustomer&&order.service!=='ecu'&&alreadyAdded&&steps.length<=1&&<p className="note" role="status">
      По этому обращению уже открыт дополнительный этап ЭБУ. Если его оформил владелец автопарка,
      детали отдельного заказа доступны только уполномоченному заказчику.
    </p>}
    {rec.error&&<p role="alert" className="note">Рекомендации: {rec.error}
      <button type="button" className="btn ghost small" onClick={()=>void rec.reload()}>Повторить</button>
    </p>}
    {rec.data?.recommendations.map(x=><div key={x.id} className="banner col">
      <b>Предложение специалиста по ЭБУ · {x.status==='pending'?'На рассмотрении':
        x.status==='used'?'Заказ оформлен':'Отклонено'}</b>
      <span className="note">{x.reason} · {fmtTime(x.createdAt)}</span>
      {isCustomer&&x.status==='pending'&&!alreadyAdded&&<div className="row">
        <a className="btn small" href={applyLink}>Оформить отдельную заявку</a>
        <button type="button" className="btn ghost small" disabled={busy}
          onClick={()=>void decline(x.id)}>Не требуется</button>
      </div>}
      {(isCustomer||isStaff)&&x.linkedOrderId&&<a
        href={`#/order/${x.linkedOrderId}`}>Открыть дополнительную заявку</a>}
    </div>)}
    {canRecommend&&<div className="stack">
      {editing?<><label className="stack">
        <span className="label">Почему требуется специалист по ЭБУ?</span>
        <textarea className="field" minLength={20} maxLength={800}
          value={reason} onChange={e=>setReason(e.target.value)}
          placeholder="Например: ошибки блока EBS сохраняются после проверки питания и проводки"/>
      </label>
      <div className="row">
        <button type="button" className="btn" disabled={busy||reason.trim().length<20}
          onClick={()=>void recommend()}>Рекомендовать клиенту</button>
        <button type="button" className="btn ghost" onClick={()=>setEditing(false)}>Отмена</button>
      </div></>:<button type="button" className="btn ghost" onClick={()=>setEditing(true)}>
        Рекомендовать специалиста по ЭБУ
      </button>}
      <span className="note">Рекомендация не создаёт платную заявку и не назначает
        исполнителя без решения клиента.</span>
    </div>}
    {canAdd&&!activeRecommendation&&<a className="btn ghost" href={applyLink}>
      Добавить отдельный этап · специалист по ЭБУ
    </a>}
  </section>;
}
