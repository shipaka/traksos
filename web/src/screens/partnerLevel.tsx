import {useState} from 'react';
import {get,post,fmtTime} from '../api.ts';
import {useLoad,useAction,useMe,Back} from '../ui.tsx';

type Tier='start'|'active'|'priority';
const names:Record<Tier,string>={start:'Старт',active:'Активный',priority:'Приоритетный'};
type LevelResponse={
  level:Tier;verification:string;effectiveAt:string|null;reviewDueAt:string|null;
  lastDecisionReason:string|null;
  metrics:{offered:number;completedFromOffers:number;completedTotal:number;
    approvedKnowledge:number;complaints:number;drops:number;rating:number|null;
    ratingCount:number;observedHours:number;firstObservedAt:string|null;
    partialHistory:boolean;windowDays:number;opportunityCompletionRate:number|null;
    opportunityDefinition:string;availabilityDefinition:string};
  recommendation:{candidate:Tier;confidence:'limited'|'observed';
    reasons:string[];manualReviewRequired:boolean};
  privileges:{priorityDispatch:boolean;reducedCommission:boolean;
    acceleratedPayout:boolean;note:string};
  appeal:{id:string;message:string;created_at:string}|null;automaticDemotion:boolean;
};
export function PartnerLevelView(){
  const {me}=useMe(),account=useLoad<LevelResponse>(()=>get('/api/partner/level'),[me?.id]);
  const {busy,run}=useAction();
  const [appeal,setAppeal]=useState('');
  const d=account.data;
  return <main className="stack" style={{width:'min(940px,100%)',margin:'auto',padding:'clamp(12px,3vw,24px)',gap:16}}>
    <Back to="work/me" label="Рабочий кабинет"/>
    <header><span className="note">TRAKSOS · ПРОФЕССИОНАЛЬНОЕ СООБЩЕСТВО</span>
      <h1>TrackSOS Партнёр</h1>
      <p>Три уровня, справедливые даже там, где мало заявок. Реальный спрос и качество важнее абсолютного количества работ.</p>
    </header>
    {account.error&&<div className="banner warn" role="alert">{account.error} <button type="button" onClick={account.reload}>Повторить</button></div>}
    {!d&&!account.error&&<div className="card">Загружаю персональные показатели…</div>}
    {d&&<>
      <section className="card stack" aria-label="Текущий уровень">
        <h2>Ваш статус: {names[d.level]}</h2>
        <p className="note">{d.verification==='approved'?'Профиль исполнителя подтверждён':'Подтвердите профиль исполнителя для получения следующего уровня'}</p>
        <div className="grid2">
          {(['start','active','priority'] as Tier[]).map(t=><div key={t} className="card" style={{
            borderColor:d.level===t?'var(--accent)':'var(--line)'
          }}><b>{names[t]}</b><p className="note">{t==='start'?'Доступ к рабочим функциям и знакомство с платформой':
            t==='active'?'Подтверждённая работа или профессиональный вклад':'Индивидуально подтверждённая экспертиза и качество'}</p>
            {d.level===t&&<span className="pill accent">Текущий</span>}</div>)}
        </div>
        {d.lastDecisionReason&&<p><b>Обоснование:</b> {d.lastDecisionReason}</p>}
        {d.reviewDueAt&&<p className="note">Проверка уровня запланирована на {fmtTime(d.reviewDueAt)}. Дата не означает автоматического понижения.</p>}
        <p className="note">{d.privileges.note}</p>
      </section>
      <section className="card stack" aria-label="Ваши данные за 90 дней">
        <h2>Показатели за {d.metrics.windowDays} дней</h2>
        <dl className="kv">
          <dt>Лично предложено заявок</dt><dd>{d.metrics.offered}</dd>
          <dt>Завершено из предложенных</dt><dd>{d.metrics.completedFromOffers}</dd>
          <dt>Всего завершённых работ</dt><dd>{d.metrics.completedTotal}</dd>
          <dt>Доля завершений в личных предложениях</dt><dd>{d.metrics.opportunityCompletionRate==null?'Недостаточно событий':d.metrics.opportunityCompletionRate+'%'}</dd>
          <dt>Часы на линии (из наблюдений)</dt><dd>{d.metrics.observedHours.toFixed(1)} ч</dd>
          <dt>Проверенных материалов ТехБазы</dt><dd>{d.metrics.approvedKnowledge}</dd>
          <dt>Рейтинг</dt><dd>{d.metrics.rating==null?'Нет оценок':d.metrics.rating.toFixed(2)+' · '+d.metrics.ratingCount+' оценок'}</dd>
        </dl>
        <p className="note">{d.metrics.opportunityDefinition}. {d.metrics.availabilityDefinition}.</p>
        {d.metrics.partialHistory&&<p className="note">Измерение времени на линии началось недавно; прошлые часы не записаны и не используются против вас.</p>}
        {d.recommendation.confidence==='limited'&&<p className="note">Выборка слишком мала для уверенного статистического вывода.</p>}
      </section>
      <section className="card stack">
        <h2>Рекомендация к рассмотрению: {names[d.recommendation.candidate]}</h2>
        <p>Это ориентир для ручного решения, а не автоматический рейтинг, штраф или изменение комиссии.</p>
        {d.recommendation.reasons.map((reason,i)=><p key={i} className="note">— {reason}</p>)}
        <p className="note">Мастера не обязаны работать исключительно с TrackSOS. Отсутствие повторного заказа само по себе ничего не доказывает.</p>
      </section>
      <section className="card stack">
        <h2>Оспорить или уточнить уровень</h2>
        {d.appeal?<p role="status">Обращение уже находится на рассмотрении: {d.appeal.message}</p>:
          <form className="stack" onSubmit={async e=>{
            e.preventDefault();const result=await run(()=>post('/api/partner/level/appeal',{message:appeal.trim()}),'Обращение отправлено');
            if(result){setAppeal('');await account.reload()}
          }}>
            <label htmlFor="partner-appeal">Опишите опыт, доступные предложения или профессиональный вклад. Отсутствие спроса допустимо.</label>
            <textarea id="partner-appeal" className="field" rows={4} minLength={20} maxLength={1500}
              value={appeal} onChange={e=>setAppeal(e.target.value)} placeholder="Например, в нашей специализации за месяц было всего два предложения…"/>
            <button className="btn" disabled={busy||appeal.trim().length<20} type="submit">Отправить на пересмотр</button>
          </form>}
      </section>
    </>}
  </main>;
}

type Queue={appeals:Array<{id:string;user_id:string;message:string;created_at:string;level:Tier|null}>;
 reviewDue:Array<{user_id:string;level:Tier;review_due_at:string}>;automaticDemotion:boolean};
export function PartnerLevelAdmin(){
  const queue=useLoad<Queue>(()=>get('/api/admin/partner/levels'),[]);
  const {busy,run}=useAction();
  const [userId,setUserId]=useState('');
  const [tier,setTier]=useState<Tier>('active');
  const [reason,setReason]=useState('');
  const [answers,setAnswers]=useState<Record<string,string>>({});
  return <main className="stack" style={{width:'min(980px,100%)',padding:20,margin:'auto',gap:16}}>
    <Back to="admin" label="Админка"/>
    <h1>TrackSOS Партнёр · проверка уровней</h1>
    <p className="note">Повышение и понижение выполняются только администратором с причиной. Ни комиссия, ни порядок распределения заявок от этого пока не меняются. Не делайте выводы по абсолютному числу заказов в малом городе.</p>
    {queue.error&&<p role="alert">{queue.error} <button onClick={queue.reload}>Повторить</button></p>}
    <section className="card stack">
      <h2>Назначить или подтвердить уровень</h2>
      <form className="stack" onSubmit={async e=>{
        e.preventDefault();
        const result=await run(()=>post('/api/admin/partner/levels/'+userId.trim()+'/decision',{
          level:tier,reason:reason.trim()}),'Решение сохранено с записью в журнал');
        if(result){setReason('');await queue.reload()}
      }}>
        <label>ID исполнителя <input className="field" value={userId} onChange={e=>setUserId(e.target.value)}
          placeholder="UUID из карточки исполнителя" required/></label>
        <label>Уровень <select className="field" value={tier} onChange={e=>setTier(e.target.value as Tier)}>
          {(['start','active','priority'] as Tier[]).map(x=><option value={x} key={x}>{names[x]}</option>)}
        </select></label>
        <label>Результаты проверки и основание <textarea className="field" rows={3} minLength={20} maxLength={1200}
          value={reason} onChange={e=>setReason(e.target.value)} required/></label>
        <button className="btn" disabled={busy||reason.trim().length<20||!userId.trim()} type="submit">Подтвердить решение</button>
      </form>
    </section>
    <section className="card stack">
      <h2>Обращения специалистов</h2>
      {!queue.data&&<p>Загружаю очередь…</p>}
      {queue.data?.appeals.length===0&&<p className="note">Открытых обращений нет.</p>}
      {queue.data?.appeals.map(a=><article className="card stack" key={a.id}>
        <strong>Исполнитель {a.user_id} · {a.level?names[a.level]:'Старт'}</strong>
        <p>{a.message}</p><small className="note">{fmtTime(a.created_at)}</small>
        <button type="button" className="btn ghost small" onClick={()=>{setUserId(a.user_id);setTier(a.level??'active')}}>
          Выбрать исполнителя для изменения уровня
        </button>
        <textarea className="field" rows={2} minLength={20} maxLength={1200}
          placeholder="Как проверили обстоятельства, какое решение приняли"
          value={answers[a.id]??''} onChange={e=>setAnswers(old=>({...old,[a.id]:e.target.value}))}/>
        <button type="button" className="btn" disabled={busy||(answers[a.id]?.trim().length??0)<20}
          onClick={async()=>{const r=await run(()=>post('/api/admin/partner/appeals/'+a.id+'/resolve',
            {resolution:answers[a.id].trim()}),'Ответ зафиксирован');if(r)await queue.reload()}}>
          Закрыть обращение с ответом
        </button>
      </article>)}
    </section>
    <section className="card stack">
      <h2>Уровни к плановому пересмотру</h2>
      {queue.data?.reviewDue.length===0&&<p className="note">Просроченных проверок нет. Автоматического понижения нет.</p>}
      {queue.data?.reviewDue.map(x=><div key={x.user_id} className="between">
        <span>{x.user_id} · {names[x.level]} · {fmtTime(x.review_due_at)}</span>
        <button className="btn ghost small" onClick={()=>{setUserId(x.user_id);setTier(x.level)}}>Рассмотреть</button>
      </div>)}
    </section>
  </main>;
}
