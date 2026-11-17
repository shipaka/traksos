import {useState} from 'react';
import {get} from '../api.ts';
import {useLoad,useMe,Back} from '../ui.tsx';

type Tip={id:string;title:string;category:string;body:string;priority:string;tags:string[]};
type Link={id:string;title:string;make:string|null;subsystem:string;region:string;url:string;scope:string;rights:string;author?:string;licenseUrl?:string;owner?:string;checkedOn?:string;requiresLogin?:string;changeStatus?:string;modelFamilyKeywords?:string[];documentSections?:string[];confirmedFitment?:boolean;accessCost?:string};
export function VehicleKnowledge(){
  const {me}=useMe();
  const professional=Boolean(me?.roles.some(r=>['master','service'].includes(r)));
  const [tab,setTab]=useState<'tips'|'professional'>('tips');
  const [category,setCategory]=useState<'truck'|'trailer'>('truck');
  const [make,setMake]=useState('');
  const [subsystem,setSubsystem]=useState('');
  const [query,setQuery]=useState('');
  const [search,setSearch]=useState('');
  const tips=useLoad<{items:Tip[];message:string}>(()=>get(
    '/api/vehicle-reference/tips?q='+encodeURIComponent(search)),[search]);
  const links=useLoad<{links:Link[];message:string}>(()=>
    tab==='professional'&&professional ? get('/api/vehicle-reference/professional?q='+encodeURIComponent(search)+
      '&category='+category+'&make='+encodeURIComponent(make.trim().toLowerCase())+
      '&subsystem='+encodeURIComponent(subsystem.trim().toLowerCase()))
      : Promise.resolve({links:[],message:''}),[tab,professional,search,category,make,subsystem]);
  return <main className="stack" style={{maxWidth:1000,margin:'0 auto'}}>
    <Back to="" label="Рабочий стол" />
    <section className="card stack">
      <span className="label">TrakSOS · ТРАНСПОРТ И БЕЗОПАСНОСТЬ</span>
      <h1>{professional?'Памятки и техническая библиотека':'Эксплуатация и полезные памятки'}</h1>
      <p>{professional?'Проверенные источники по грузовикам и прицепам с доступом по профессиональной роли.':'Полезные рекомендации по эксплуатации и безопасности грузовой техники.'}</p>
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
      <p className="note">Для точной модели и комплектации руководствуйтесь заводской инструкцией по эксплуатации.</p>
      {!tips.data?<p className="note">{tips.error??'Загружаю памятки…'}</p>:
        tips.data.items.length===0?<p>По вашему запросу пока нет памяток.</p>:
        tips.data.items.map(t=><article className="card stack" key={t.id}>
          <div className="between"><h2>{t.title}</h2><span className="pill">{t.priority==='critical'?'Безопасность':t.priority==='high'?'Внимание':'Памятка'}</span></div>
          <p>{t.body}</p><small className="note">{t.tags.join(' · ')}</small>
        </article>)}
      <p className="note">Если рекомендаций недостаточно, уточните модификацию машины по VIN или обратитесь к специалисту.</p>
    </section>}
    {tab==='professional'&&professional&&<section className="stack" aria-label="Профессиональные источники">
      <div className="card stack">
        <b>Уточнение документа по грузовой технике</b>
        <label>Тип техники
          <select className="field" value={category} onChange={e=>setCategory(e.target.value as 'truck'|'trailer')}>
            <option value="truck">Грузовики и тягачи</option>
            <option value="trailer">Полуприцепы и прицепные системы</option>
          </select>
        </label>
        <label>Марка (необязательно)
          <input className="field" value={make} onChange={e=>setMake(e.target.value)}
            placeholder="Scania, DAF, Volvo, MAN…" maxLength={60}/>
        </label>
        <label>Система
          <select className="field" value={subsystem} onChange={e=>setSubsystem(e.target.value)}>
            <option value="">Все системы</option>
            <option value="ebs">EBS / ABS</option>
            <option value="brakes">Тормоза</option>
            <option value="electrical">Электрика</option>
            <option value="chassis">Шасси и надстройки</option>
            <option value="axle">Оси</option>
            <option value="trailer">Полуприцеп</option>
            <option value="drivetrain">Трансмиссия</option>
            <option value="exhaust">SCR / выхлоп</option>
            <option value="general">Общая документация</option>
          </select>
        </label>
      </div>
      {!links.data?<p className="note">{links.error??'Проверяю право доступа…'}</p>:<>
        <p className="note">{links.data.message}</p>
        {links.data.links.map(link=><article className="card stack" key={link.id}>
          <h2>{link.title}</h2>
          <small className="note">{link.make??'Узлы грузового транспорта'} · {link.subsystem} · {link.region}</small>
          <small className="note">Правообладатель: {link.owner??link.author??'уточняйте в оригинале'} · проверено: {link.checkedOn??'—'} · доступ: {link.requiresLogin==='yes'?'по регистрации':link.requiresLogin==='no'?'открытый':'возможны ограничения'}</small>
          <p>{link.scope}</p>
          {link.accessCost==='paid_subscription'&&<small className="note">
            Для открытия полной заводской информации может потребоваться регистрация и оплата у производителя;
            это не входит в подписку TrakSOS.
          </small>}
          {!!link.modelFamilyKeywords?.length && <small className="note">Семейства в портале: {link.modelFamilyKeywords.join(', ')}. Это не проверка применимости к выбранному VIN.</small>}
          {!!link.documentSections?.length && <small className="note">Разделы документации: {link.documentSections.join(', ')}. Обозначение MY — редакция производителя, не доказательство года выпуска вашей машины.</small>}
          <a className="btn ghost" target="_blank" rel="noopener noreferrer" href={link.url}>
            {link.rights==='LINK_ONLY'?'Открыть оригинальный портал производителя':'Открыть страницу автора и лицензии'}</a>
          {link.rights==='LINK_ONLY'
            ? <small className="note">Заводская документация: только внешняя ссылка, TrakSOS не копирует PDF или схемы без разрешения правообладателя.</small>
            : <small className="note">Учебная схема · {link.rights} · автор: {link.author??'указан в источнике'}.
                <a href={link.licenseUrl} target="_blank" rel="noopener noreferrer"> Условия лицензии</a>. Иллюстрация не подтверждает применимость к конкретному VIN.</small>}
        </article>)}
      </>}
    </section>}
  </main>;
}
