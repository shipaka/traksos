import { useLoad, useMe } from '../ui.tsx';
import { get, rub } from '../api.ts';
import { learningRole } from './platformIntro.tsx';

type Example={amount:number;fee:number;total:number;partnerReceives?:number;title:string;formula:string};
type Guide={role:string;title:string;cap:number;paragraphs:{title:string;text:string}[];examples:Example[];
  rules:{clientSharePct:number;referralDays:number;welcome:number;clientSpendCapPct:number;spendCapPct:number;performerReward:number;performerJobs:number;serviceReward:number;ttlDays:number}};
/** Server-calculated, role-limited values: identical data powers economics and published offer annexes. */
export function EconomicsGuide({inOffer=false}:{inOffer?:boolean}) {
  const {me,mode}=useMe();
  const role=me?.owner_id?'driver':learningRole(mode,me?.roles??[]);
  const q=useLoad(()=>get<Guide>('/api/me/economics?role='+encodeURIComponent(role)),[me?.id,role]);
  if(!me)return null;
  if(!q.data)return <section className="card stack" aria-label="Финансовые условия">
    <b>Комиссии, баллы и рефералы</b>
    <span className="note">{q.error?'Не удалось загрузить актуальные условия. Не полагайтесь на старые цифры; проверьте связь или откройте оферту.':'Загружаем действующие условия из системы…'}</span>
  </section>;
  const info=q.data;
  return <section className="card stack economics-guide" aria-label={'Финансовые условия: '+info.title}>
    <div>
      <span className="label">TRAKSOS · ФИНАНСОВЫЕ УСЛОВИЯ КАБИНЕТА</span>
      <h2>{info.title}</h2>
      <p className="note">
        Данные взяты из действующих настроек площадки. Примеры показывают формулу, не создавая заказ или счёт.
        {inOffer?' Это информационная сводка на текущий момент; юридически согласованная редакция документа расположена выше.':''}
      </p>
    </div>
    {info.paragraphs.map(p=><details key={p.title} className="card flat" open={true}>
      <summary><b>{p.title}</b></summary>
      <p className="note" style={{lineHeight:1.6,color:'var(--fg)'}}>{p.text}</p>
    </details>)}
    {!!info.examples.length && <div className="stack">
      <b>Математика на примерах</b>
      <div className="grid2">
        {info.examples.map(e=><div className="card flat stack" key={e.amount}>
          <span className="label">{e.title}</span>
          <p style={{lineHeight:1.55,margin:0}}>{e.formula}</p>
          <div className="between" style={{gap:8}}>
            <span className="note">Сбор / комиссия</span><b>{rub(e.fee)}</b>
          </div>
          <div className="between" style={{gap:8}}>
            <span className="note">{e.partnerReceives!=null?'Исполнитель получает':'Клиент оплачивает'}</span>
            <b>{rub(e.partnerReceives??e.total)}</b>
          </div>
        </div>)}
      </div>
    </div>}
    <p className="note">Для конкретной заявки расчёт может отличаться из-за скидок, баллов, индивидуального тарифа, акций и этапа отмены. Окончательная сумма и условия подтверждаются в самой заявке.</p>
    <div className="row" style={{gap:12,flexWrap:'wrap'}}>
      <a href="#/help">Энциклопедия и вопросы</a>
      <a href="#/invite">Реферальная ссылка и мои баллы</a>
      <a href="#/support/new">Вопрос по расчёту</a>
    </div>
  </section>;
}
