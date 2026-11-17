import {useState} from 'react';
import {get} from '../api.ts';
import {useLoad,useMe,Back} from '../ui.tsx';

type Tip={id:string;title:string;category:string;body:string;priority:string;tags:string[]};
type Link={id:string;title:string;make:string|null;subsystem:string;region:string;url:string;scope:string;rights:string;author?:string;licenseUrl?:string};
export function VehicleKnowledge(){
  const {me}=useMe();
  const professional=Boolean(me?.roles.some(r=>['admin','master','tow','service'].includes(r)));
  const [tab,setTab]=useState<'tips'|'professional'>('tips');
  const [query,setQuery]=useState('');
  const [search,setSearch]=useState('');
  const tips=useLoad<{items:Tip[];message:string}>(()=>get(
    '/api/vehicle-reference/tips?q='+encodeURIComponent(search)),[search]);
  const links=useLoad<{links:Link[];message:string}>(()=>
    tab==='professional'&&professional ? get('/api/vehicle-reference/professional?q='+encodeURIComponent(search))
      : Promise.resolve({links:[],message:''}),[tab,professional,search]);
  return <main className="stack" style={{maxWidth:1000,margin:'0 auto'}}>
    <Back to="" label="Рабочий стол" />
    <section className="card stack">
      <span className="label">TRAKSOS · ТРАНСПОРТ И БЕЗОПАСНОСТЬ</span>
      <h1>Памятки и ТехБаза</h1>
      <p>Водителю — понятные рекомендации по безопасности. Подробные технические документы,
        ссылки на оригинальные схемы и сервисные материалы — только для подтверждённых специалистов.</p>
      <nav className="row" aria-label="Разделы справочника">
        <button className="btn" type="button" aria-pressed={tab==='tips'} onClick={()=>setTab('tips')}>Памятки водителю</button>
        {professional&&<button className="btn ghost" type="button" aria-pressed={tab==='professional'}
          onClick={()=>setTab('professional')}>Профессиональная ТехБаза</button>}
      </nav>
    </section>
    <form className="card row" onSubmit={e=>{e.preventDefault();setSearch(query.trim())}}>
      <input className="field" aria-label="Поиск по справочнику" placeholder="Найти по системе или проблеме"
        value={query} onChange={e=>setQuery(e.target.value)} maxLength={80}/>
      <button className="btn" type="submit">Найти</button>
    </form>
    {tab==='tips'&&<section className="stack" aria-label="Памятки">
      <p className="note">В памятках намеренно нет электрических распиновок, карт кодирования ЭБУ,
        процедур вмешательства в тормозную систему и непроверенных моментов затяжки.</p>
      {!tips.data?<p className="note">{tips.error??'Загружаю памятки…'}</p>:
        tips.data.items.length===0?<p>По вашему запросу пока нет памяток.</p>:
        tips.data.items.map(t=><article className="card stack" key={t.id}>
          <div className="between"><h2>{t.title}</h2><span className="pill">{t.priority==='critical'?'Безопасность':t.priority==='high'?'Внимание':'Памятка'}</span></div>
          <p>{t.body}</p><small className="note">{t.tags.join(' · ')}</small>
        </article>)}
      <p className="note">По вопросам конкретной машины обратитесь к специалисту. Публикация новых
        технических инструкций проходит модерацию в профессиональной ТехБазе.</p>
    </section>}
    {tab==='professional'&&professional&&<section className="stack" aria-label="Профессиональные источники">
      {!links.data?<p className="note">{links.error??'Проверяю право доступа…'}</p>:<>
        <p className="note">{links.data.message}</p>
        {links.data.links.map(link=><article className="card stack" key={link.id}>
          <h2>{link.title}</h2>
          <small className="note">{link.make??'Универсальный производитель систем'} · {link.subsystem} · {link.region}</small>
          <p>{link.scope}</p>
          <a className="btn ghost" target="_blank" rel="noopener noreferrer" href={link.url}>
            Открыть оригинальный источник производителя</a>
          {link.rights==='LINK_ONLY'
            ? <small className="note">Заводская документация: только внешняя ссылка, TrakSOS не копирует PDF или схемы без разрешения правообладателя.</small>
            : <small className="note">Учебная схема · {link.rights} · автор: {link.author??'указан в источнике'}.
                <a href={link.licenseUrl} target="_blank" rel="noopener noreferrer"> Условия лицензии</a>. Иллюстрация не подтверждает применимость к конкретному VIN.</small>}
        </article>)}
      </>}
    </section>}
  </main>;
}
