import { useMemo, useState } from 'react';
import { get, post, fmtPhone } from '../api.ts';
import { useLoad, Loading } from '../ui.tsx';
import './adminRegistry.css';

type Filters = {
  q:string; role:string; region:string; city:string; status:string; verification:string;
  specialty:string; activity:string; company:string; tag:string; kind:string;
  ratingMin:string; from:string; to:string;
};
const DEFAULT:Filters = {q:'',role:'',region:'',city:'',status:'',verification:'',
  specialty:'',activity:'',company:'',tag:'',kind:'',ratingMin:'',from:'',to:''};
const ROLE_NAMES:Record<string,string> = {
  client:'Клиент', driver:'Водитель', master:'Выездной мастер',
  tow:'Эвакуаторщик',service:'СТО / рембаза',insurer:'Страховой агент',
  inspection_operator:'Техосмотр',moderator:'Модератор',admin:'Администратор',
};
const REGIONS:Record<string,string> = {spb:'Санкт-Петербург',lo:'Ленинградская область'};
const VERIFY:Record<string,string> = {pending:'Ожидает проверки',approved:'Проверен',rejected:'Отказано'};
function prettyRegion(value:string|null) {return value ? REGIONS[value]??value : 'Не определён';}
function formatDate(value:string|null) {return value ? new Date(value).toLocaleDateString('ru-RU'):'—';}
function selection(filters:Filters) {
  const p = new URLSearchParams();
  for (const [k,v] of Object.entries(filters)) if (v.trim()) p.set(k,v.trim());
  return p;
}
function downloadCsv(filename:string,csv:string) {
  const blob=new Blob([csv],{type:'text/csv;charset=utf-8'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();
  window.setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function RegistryEdit({item,onSaved,onCancel}:{item:any;onSaved:()=>void;onCancel:()=>void}) {
  const [region,setRegion]=useState(item.region_source==='указан администратором' ? item.region??'' : '');
  const [city,setCity]=useState(item.city??'');
  const [tags,setTags]=useState((item.tags??[]).join(', '));
  const [note,setNote]=useState(item.note??'');
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  return <form className="tr-registry-editor" onSubmit={async e=>{
    e.preventDefault();if(busy)return;
    setBusy(true);setError('');
    try {
      await post('/api/admin/registry/'+encodeURIComponent(item.id)+'/metadata',{
        region:region.trim()||null,city:city.trim()||null,
        tags:tags.split(',').map(x=>x.trim()).filter(Boolean).slice(0,12),note:note.trim(),
      });
      onSaved();
    } catch(err){setError(err instanceof Error ? err.message:'Не удалось сохранить');}
    finally{setBusy(false);}
  }}>
    <p className="note">Редактируются только внутренние заметки реестра. Профиль, роли, телефоны, платежи и история заявок не изменятся.</p>
    <div className="tr-registry-fields">
      <label className="stack">Регион учёта
        <input className="field" value={region} maxLength={80} onChange={e=>setRegion(e.target.value)}
          placeholder="Например, spb, lo, Москва" />
      </label>
      <label className="stack">Город / населённый пункт
        <input className="field" value={city} maxLength={120} onChange={e=>setCity(e.target.value)} placeholder="Гатчина" />
      </label>
      <label className="stack">Теги через запятую
        <input className="field" value={tags} onChange={e=>setTags(e.target.value)} placeholder="VIP, автопарк, ночные заявки" />
      </label>
    </div>
    <label className="stack">Внутренняя заметка
      <textarea className="field" value={note} maxLength={2000} rows={3} onChange={e=>setNote(e.target.value)}
        placeholder="Что важно знать администратору об участнике" />
    </label>
    {error && <div className="banner bad" role="alert">{error}</div>}
    <div className="row">
      <button className="btn small" disabled={busy} type="submit">{busy?'Сохраняется…':'Сохранить карточку'}</button>
      <button className="btn ghost small" type="button" onClick={onCancel}>Отмена</button>
    </div>
  </form>;
}

export function AdminRegistry() {
  const [draft,setDraft]=useState<Filters>({...DEFAULT});
  const [applied,setApplied]=useState<Filters>({...DEFAULT});
  const [page,setPage]=useState(1);
  const [editing,setEditing]=useState<string|null>(null);
  const [exporting,setExporting]=useState(false);
  const [exportError,setExportError]=useState('');
  const [exportInfo,setExportInfo]=useState('');
  const params=useMemo(()=>{
    const p=selection(applied);p.set('page',String(page));p.set('pageSize','30');
    return p.toString();
  },[applied,page]);
  const result=useLoad(()=>get('/api/admin/registry?'+params),[params]);
  const total=Number(result.data?.total??0);
  const pages=Math.max(1,Math.ceil(total/30));
  function set<K extends keyof Filters>(key:K,value:Filters[K]) {
    setDraft(prev=>({...prev,[key]:value}));
  }
  async function exportFiltered() {
    if(exporting)return;
    setExporting(true);setExportError('');setExportInfo('');
    try {
      const body:any={};
      for(const [k,v] of Object.entries(applied))if(v.trim())body[k]=v.trim();
      const data=await post<{filename:string;csv:string;count:number;total:number;truncated:boolean}>('/api/admin/registry/export',body);
      downloadCsv(data.filename,data.csv);
      setExportInfo(data.truncated
        ? `Выгружено ${data.count} из ${data.total}. Максимум 5000 строк за одну выгрузку — сузьте фильтры по региону или датам.`
        : `Выгружено ${data.count} карточек в CSV. Действие зарегистрировано в журнале.`);
    } catch(err) {setExportError(err instanceof Error?err.message:'Ошибка выгрузки');}
    finally{setExporting(false);}
  }
  return <section className="tr-registry stack">
    <div className="tr-registry-intro">
      <div><h3>Единая база клиентов и партнёров</h3>
        <p className="note">Сведения автоматически собраны из регистраций, карточек компаний, исполнителей, СТО и истории работ. Дублирующая база контактов не создаётся.</p></div>
      <a className="btn ghost small" href="#/admin/section/access">+ Создать участника</a>
    </div>
    <form className="tr-registry-filter stack" onSubmit={e=>{e.preventDefault();setPage(1);setApplied({...draft});setEditing(null);}}>
      <div className="tr-registry-fields">
        <label className="stack">Поиск
          <input className="field" type="search" value={draft.q} onChange={e=>set('q',e.target.value)}
            placeholder="Имя, компания, телефон, ИНН, госномер" maxLength={120} />
        </label>
        <label className="stack">Роль
          <select className="field" value={draft.role} onChange={e=>set('role',e.target.value)}>
            <option value="">Все роли</option>
            {Object.entries(ROLE_NAMES).map(([key,value])=><option key={key} value={key}>{value}</option>)}
          </select>
        </label>
        <label className="stack">Регион
          <input className="field" value={draft.region} onChange={e=>set('region',e.target.value)}
            placeholder="Санкт-Петербург, Ленинградская область, Москва…" maxLength={80}/>
        </label>
        <label className="stack">Город / адрес
          <input className="field" value={draft.city} onChange={e=>set('city',e.target.value)}
            placeholder="Гатчина, Выборг…" maxLength={120}/>
        </label>
        <label className="stack">Статус
          <select className="field" value={draft.status} onChange={e=>set('status',e.target.value)}>
            <option value="">Любой</option><option value="active">Активен</option><option value="blocked">Заблокирован</option>
          </select>
        </label>
        <label className="stack">Проверка партнёра
          <select className="field" value={draft.verification} onChange={e=>set('verification',e.target.value)}>
            <option value="">Любая</option><option value="pending">На проверке</option>
            <option value="approved">Одобрен</option><option value="rejected">Отклонён</option>
          </select>
        </label>
        <label className="stack">Активность
          <select className="field" value={draft.activity} onChange={e=>set('activity',e.target.value)}>
            <option value="">Любая</option><option value="with_orders">Есть заявки</option>
            <option value="without_orders">Без заявок</option><option value="recent_30">Заявки за 30 дней</option>
          </select>
        </label>
        <label className="stack">Компании / частные лица
          <select className="field" value={draft.company} onChange={e=>set('company',e.target.value)}>
            <option value="">Все</option><option value="yes">Компании и СТО</option><option value="no">Без компании</option>
          </select>
        </label>
        <label className="stack">Тип исполнителя
          <select className="field" value={draft.kind} onChange={e=>set('kind',e.target.value)}>
            <option value="">Все</option><option value="master">Мастер</option>
            <option value="tow">Эвакуатор</option><option value="service">СТО</option><option value="ecu">Диагност ЭБУ</option>
          </select>
        </label>
        <label className="stack">Специализация
          <input className="field" value={draft.specialty} onChange={e=>set('specialty',e.target.value)}
            placeholder="electric, diag, air, tyre…" maxLength={60}/>
        </label>
        <label className="stack">Тег
          <input className="field" value={draft.tag} onChange={e=>set('tag',e.target.value)}
            placeholder="VIP, автопарк…" maxLength={50}/>
        </label>
        <label className="stack">Рейтинг от
          <select className="field" value={draft.ratingMin} onChange={e=>set('ratingMin',e.target.value)}>
            <option value="">Любой</option><option value="3">3+</option>
            <option value="4">4+</option><option value="4.5">4,5+</option>
            <option value="5">5</option>
          </select>
        </label>
        <label className="stack">Зарегистрирован с
          <input className="field" type="date" value={draft.from} onChange={e=>set('from',e.target.value)} />
        </label>
        <label className="stack">По
          <input className="field" type="date" value={draft.to} onChange={e=>set('to',e.target.value)} />
        </label>
      </div>
      <div className="row">
        <button className="btn" type="submit">Найти участников</button>
        <button className="btn ghost" type="button" onClick={()=>{setDraft({...DEFAULT});setApplied({...DEFAULT});setPage(1);setEditing(null);}}>Сбросить</button>
        <button className="btn ghost" type="button" disabled={exporting} onClick={exportFiltered}>{exporting?'Формируем CSV…':'Выгрузить найденных · CSV'}</button>
      </div>
    </form>
    {exportError && <div className="banner bad" role="alert">{exportError}</div>}
    {exportInfo && <p className="note" role="status">{exportInfo}</p>}
    <div className="tr-registry-results-header">
      <b>{result.data ? `Найдено участников: ${total}` : 'Загружаем реестр'}</b>
      <div className="row">
        <span className="note">Регион последней заявки — не подтверждённый адрес проживания или работы.</span>
        <button type="button" className="btn ghost small" onClick={()=>result.reload()}>Обновить данные</button>
      </div>
    </div>
    {!result.data ? <Loading error={result.error} /> : <>
      {result.data.items.length===0 && <div className="empty">По заданным параметрам участников нет. Измените фильтры.</div>}
      {result.data.items.map((item:any)=><article className="tr-registry-card card" key={item.id}>
        <div className="between">
          <div className="stack tr-registry-identity">
            <a href={'#/admin/user/'+item.id}><b>{item.company_name||item.center_name||item.name||'Без имени'}</b></a>
            {item.company_name && item.name && <span className="note">Контакт: {item.name}</span>}
            <span className="note">{fmtPhone(item.phone)}{item.company_inn||item.center_inn||item.worker_inn ? ' · ИНН '+(item.company_inn||item.center_inn||item.worker_inn):''}</span>
          </div>
          <div className="row">
            <span className={'pill '+(item.status==='blocked'?'bad':'')}>{item.status==='blocked'?'Заблокирован':'Активен'}</span>
            {item.verification && <span className="pill">{VERIFY[item.verification]||item.verification}</span>}
          </div>
        </div>
        <div className="tr-registry-facts">
          <span><b>Роль:</b> {(item.roles??[]).map((r:string)=>ROLE_NAMES[r]??r).join(', ')}</span>
          <span><b>Регион:</b> {prettyRegion(item.region)} <small className="note">({item.region_source})</small></span>
          {item.city && <span><b>Город:</b> {item.city}</span>}
          {item.center_address && <span><b>Адрес СТО:</b> {item.center_address}</span>}
          {item.specialties?.length>0 && <span><b>Специализации:</b> {item.specialties.join(', ')}</span>}
          {item.tax_status && <span><b>Налоговый статус:</b> {item.tax_status==='ip'?'ИП':item.tax_status==='self_employed'?'Самозанятый':item.tax_status}</span>}
          {item.kind && <span><b>Тип исполнителя:</b> {item.kind}</span>}
          {item.rating!=null && <span><b>Рейтинг:</b> {item.rating} · {item.rating_count} отзывов</span>}
          <span><b>Автопарк:</b> {item.vehicles_count} ТС</span>
          <span><b>Заявок клиента:</b> {item.orders_client_count}</span>
          <span><b>Заявок исполнителя:</b> {item.orders_performer_count}</span>
          {item.center_name && <span><b>Заказов СТО:</b> {item.bookings_service_count}</span>}
          <span><b>Регистрация:</b> {formatDate(item.created_at)}</span>
          <span><b>Последняя активность:</b> {formatDate(item.last_seen_at)}</span>
          {item.tags?.length>0 && <span><b>Теги:</b> {item.tags.join(', ')}</span>}
        </div>
        {item.note && <p className="note"><b>Заметка:</b> {item.note}</p>}
        <div className="row">
          <a className="btn ghost small" href={'#/admin/user/'+item.id}>Полная карточка и история</a>
          <button className="btn ghost small" onClick={()=>setEditing(editing===item.id?null:item.id)}>
            {editing===item.id?'Свернуть заметки':'Регион, теги и заметки'}
          </button>
        </div>
        {editing===item.id && <RegistryEdit key={item.id} item={item} onSaved={()=>{setEditing(null);result.reload();}}
          onCancel={()=>setEditing(null)}/>}
      </article>)}
      {pages>1 && <div className="row tr-registry-pagination">
        <button type="button" className="btn ghost small" disabled={page<=1}
          onClick={()=>{setPage(p=>p-1);setEditing(null);}}>← Предыдущая</button>
        <span className="note">Страница {page} из {pages}</span>
        <button type="button" className="btn ghost small" disabled={page>=pages}
          onClick={()=>{setPage(p=>p+1);setEditing(null);}}>Следующая →</button>
      </div>}
    </>}
    <p className="note">Выгрузка доступна только администратору и записывается в журнал. В CSV входят персональные данные — храните файл в защищённом месте. Не более 5 000 записей за одну выгрузку.</p>
  </section>;
}
