import {useState} from 'react';
import {get} from '../api.ts';
import {useLoad} from '../ui.tsx';
import './techBase.css';
import {TechReferenceShelf} from './techReferenceShelf.tsx';

type Article={id:string;title:string;make:string;model:string|null;
 model_year:number|null;subsystem:string;source_url:string|null};
type Context={brand:string|null;model:string|null;year:number|null;initialSystem:string};
type Result={context:Context;articles:Article[];matchStatus:string;warning:string};
type Detail=Article&{description:string;rights_basis:string};
export function OrderTechBase({orderId}:{orderId:string}){
 const [system,setSystem]=useState('');
 const [selectedSystem,setSelectedSystem]=useState('');
 const [articleId,setArticleId]=useState<string|null>(null);
 const data=useLoad<Result>(()=>get('/api/community/knowledge/for-order/'+orderId+
   (selectedSystem?'?subsystem='+encodeURIComponent(selectedSystem):'')),[orderId,selectedSystem]);
 const detail=useLoad<Detail|null>(()=>articleId?get('/api/community/knowledge/'+articleId):Promise.resolve(null),[articleId]);
 const context=data.data?.context;
 return <main className="tech-shell">
  <div className="tech-head">
   <div>
    <span className="note">TRAKSOS · ИЗ ЗАЯВКИ</span>
    <h1>ТехБаза по автомобилю</h1>
    <p>Поиск проверенных технических материалов с учётом данных текущей заявки. Доступен только назначенному специалисту.</p>
   </div>
   <a href={'#/order/'+orderId} className="btn ghost">Вернуться к заявке</a>
  </div>
  {data.error&&<div className="banner warn" role="alert">{data.error} <button onClick={data.reload}>Повторить</button></div>}
  {!data.data&&!data.error&&<p>Подбираю материалы…</p>}
  {data.data&&<section className="tech-section">
    <h2>{context?.brand??'Марка не определена'} {context?.model??''} {context?.year??''}</h2>
    <p className="note">Исходная специализация заявки: {context?.initialSystem??'не определена'}</p>
    <p role="status">{data.data.warning}</p>
    <form className="tech-filters" onSubmit={e=>{e.preventDefault();setSelectedSystem(system.trim());setArticleId(null)}}>
      <label>Поиск по системе
        <input className="field" value={system} maxLength={70} onChange={e=>setSystem(e.target.value)}
          placeholder="Например, EBS или электрооборудование"/>
      </label>
      <button className="btn" type="submit">Показать по системе</button>
      <button className="btn ghost" type="button" onClick={()=>{setSystem('');setSelectedSystem('');setArticleId(null)}}>Все системы</button>
    </form>
    {data.data.articles.length===0&&<p className="tech-empty">
      Проверенных материалов для этой комплектации пока нет. Не используйте схему от похожей модели без подтверждения применимости.
    </p>}
    <div className="tech-result-layout">
      <div className="tech-list">
        {data.data.articles.map(x=><button key={x.id} type="button"
          aria-current={articleId===x.id?'page':undefined} onClick={()=>setArticleId(x.id)}>
          <strong>{x.title}</strong>
          <small>{x.make} {x.model??''} {x.model_year??''} · {x.subsystem}</small>
        </button>)}
      </div>
      {articleId&&<article className="tech-article">
        {detail.error?<p role="alert">{detail.error} <button onClick={detail.reload}>Повторить</button></p>:
          !detail.data?<p>Загружаю материал…</p>:<>
            <h2>{detail.data.title}</h2>
            <p className="tech-description">{detail.data.description}</p>
            {detail.data.source_url&&<a href={detail.data.source_url} target="_blank" rel="noopener noreferrer">
              Открыть разрешённый источник</a>}
            <p className="note">Обязательно проверьте VIN, комплектацию, двигатель и соответствие схемы реальному автомобилю.</p>
          </>}
      </article>}
    </div>
  </section>}
  {data.data&&context?.brand&&<TechReferenceShelf initialMake={context.brand} compact/>}
  <a href="#/techbase" className="btn ghost">Открыть общий поиск ТехБазы</a>
 </main>;
}
