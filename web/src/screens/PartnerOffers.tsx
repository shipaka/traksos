import { useState } from 'react';
import { get, post, fmtTime } from '../api.ts';
import { useAction, useLoad, Loading } from '../ui.tsx';
import './partnerOffers.css';

type Offer = {
  id:string; category:string; displayName:string; title:string;
  description:string; region:string; status:string;
  createdAt?:string; publishedAt?:string; expiresAt?:string;
};
const CATEGORIES:Record<string,string> = {
  master:'Выездной мастер',tow:'Эвакуация',service:'СТО / ремонт',insurer:'Страхование'
};
const STATUS:Record<string,string> = {
  pending:'На проверке',published:'Опубликовано',rejected:'Отклонено',hidden:'Скрыто'
};
const emptyForm={displayName:'',title:'',description:'',region:''};

/** Public-to-account advertising board: no private driver chat is shared. */
export function PartnerOffers({mode}:{mode:'reader'|'partner'|'staff'}) {
  const published=useLoad<{offers:Offer[]}>(()=>get('/api/community/partner-offers'),[]);
  const mine=useLoad<{offers:Offer[]}>(()=>mode==='partner'
    ? get('/api/community/partner-offers/mine') : Promise.resolve({offers:[]}),[mode]);
  const pending=useLoad<{offers:Offer[]}>(()=>mode==='staff'
    ?get('/api/admin/community/partner-offers'):Promise.resolve({offers:[]}),[mode]);
  const {busy,run}=useAction();
  const [form,setForm]=useState(emptyForm);
  const [reasons,setReasons]=useState<Record<string,string>>({});
  const set=(k:keyof typeof emptyForm,v:string)=>setForm(f=>({...f,[k]:v}));
  const send=async()=>{
    const response=await run(()=>post('/api/community/partner-offers',form),'Предложение отправлено на модерацию');
    if(response){setForm(emptyForm);await mine.reload();}
  };
  const decide=async(id:string,decision:'published'|'rejected'|'hidden')=>{
    const reason=(reasons[id]??'').trim();
    if(reason.length<8)return;
    const result=await run(()=>post('/api/admin/community/partner-offers/'+id+'/review',{decision,reason}),
      decision==='published'?'Предложение опубликовано':'Решение сохранено');
    if(result){await Promise.all([pending.reload(),published.reload()]);setReasons(x=>({...x,[id]:''}));}
  };
  return <section className="partner-offers">
    {mode==='partner'&&<section className="card stack">
      <span className="label">Партнёрам TrakSOS</span>
      <h2>Разместить предложение в Эфире</h2>
      <p className="note">Ваше предложение увидят водители и владельцы автопарков. Каждая публикация проходит проверку. Не более 2 заявок на размещение за 7 дней; одобренное предложение показывается 7 дней.</p>
      <p className="note">Публикация в разделе партнёров не даёт доступа к водительским чатам, перепискам или местоположению участников. Телефоны, ссылки и контакты в тексте запрещены.</p>
      <form className="partner-offers-form" onSubmit={e=>{e.preventDefault();void send()}}>
        <label>Как назвать вашу компанию или мастерскую
          <input className="field" required minLength={3} maxLength={80} value={form.displayName} onChange={e=>set('displayName',e.target.value)} placeholder="Например, Грузовой электрик"/>
        </label>
        <label>Заголовок предложения
          <input className="field" required minLength={6} maxLength={90} value={form.title} onChange={e=>set('title',e.target.value)} placeholder="Диагностика грузовиков с выездом"/>
        </label>
        <label>Город или регион обслуживания
          <input className="field" required minLength={2} maxLength={80} value={form.region} onChange={e=>set('region',e.target.value)} placeholder="Санкт-Петербург и Ленобласть"/>
        </label>
        <label>Что предлагаете
          <textarea className="field" required minLength={15} maxLength={700} rows={4} value={form.description}
            onChange={e=>set('description',e.target.value)} placeholder="Услуга, специализация, доступность и условия. Без контактов и ссылок."/>
        </label>
        <button type="submit" className="btn" disabled={busy}>Отправить на проверку</button>
      </form>
      <h3>Мои предложения</h3>
      {!mine.data?<Loading error={mine.error}/> : mine.data.offers.length===0?
        <p className="note">Публикаций пока нет.</p>:
        mine.data.offers.map(o=><article className="partner-offer" key={o.id}>
          <span className="pill">{STATUS[o.status]??o.status}</span>
          <b>{o.title}</b><p>{o.description}</p>
        </article>)}
    </section>}
    {mode==='staff'&&<section className="card stack">
      <h2>Партнёрская реклама · модерация</h2>
      <p className="note">Проверяйте реальную принадлежность предложения партнёру, достоверность услуги и соответствие публикации правилам. Причина решения обязательна.</p>
      {!pending.data?<Loading error={pending.error}/>:pending.data.offers.length===0?
        <p className="note">На проверке предложений нет.</p>:
        pending.data.offers.map(o=><article className="partner-offer" key={o.id}>
          <div className="between"><b>{o.displayName} · {o.title}</b><span className="pill">На проверке</span></div>
          <small>{CATEGORIES[o.category]??o.category} · {o.region} · {o.createdAt?fmtTime(o.createdAt):'—'}</small>
          <p>{o.description}</p>
          <label>Комментарий к решению
            <textarea className="field" required minLength={8} maxLength={500} rows={2}
              value={reasons[o.id]??''} onChange={e=>setReasons(x=>({...x,[o.id]:e.target.value}))}
              placeholder="Причина одобрения или отклонения"/>
          </label>
          <div className="row">
            <button type="button" className="btn small" disabled={busy||(reasons[o.id]??'').trim().length<8}
              onClick={()=>void decide(o.id,'published')}>Опубликовать на 7 дней</button>
            <button type="button" className="btn ghost small" disabled={busy||(reasons[o.id]??'').trim().length<8}
              onClick={()=>void decide(o.id,'rejected')}>Отклонить</button>
          </div>
        </article>)}
    </section>}
    <section className="stack" aria-label="Предложения партнёров">
      <div className="between"><div><h2>Предложения партнёров</h2>
        <p className="note">Реклама · только проверенные публикации. Указанный регион предоставлен партнёром, не определяется по вашему GPS.</p></div>
        <button className="btn ghost small" type="button" onClick={()=>void published.reload()}>Обновить</button>
      </div>
      {!published.data?<Loading error={published.error}/> : published.data.offers.length===0?
        <div className="empty">Пока нет опубликованных предложений.</div>:
        <div className="partner-offers-grid">{published.data.offers.map(o=>
          <article className="card partner-offer" key={o.id}>
            <div className="between"><span className="pill">Реклама · партнёр</span>
              <small>{CATEGORIES[o.category]??o.category}</small></div>
            <h3>{o.title}</h3><b>{o.displayName}</b>
            <p>{o.description}</p>
            <small>{o.region}</small>
            <small>Опубликовано: {o.publishedAt?fmtTime(o.publishedAt):'—'} · до {o.expiresAt?fmtTime(o.expiresAt):'—'}</small>
          </article>)}</div>}
    </section>
  </section>;
}

export function PartnerAir({staff}:{staff?:boolean}) {
  return <main className="air-shell">
    <div className="air-heading"><div>
      <span className="note">TRAKSOS · ЭФИР ДЛЯ ПАРТНЁРОВ</span>
      <h1>{staff?'Рекламные предложения · управление':'Предложения партнёра'}</h1>
      <p>Мастера, эвакуаторы, СТО и страховые партнёры могут представить услуги водителям и автопаркам. Водительские личные чаты остаются закрытыми.</p>
    </div><a className="btn ghost" href="#/">В кабинет</a></div>
    <PartnerOffers mode={staff?'staff':'partner'}/>
  </main>;
}
