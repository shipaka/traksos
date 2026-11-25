import { useEffect, useMemo, useState } from 'react';
import { ApiError, get } from '../api.ts';
import { useMe } from '../ui.tsx';

type Audience = 'driver' | 'master';
type TechDoc = {
  id:string; title:string; audience:Audience; kind:'truck'|'trailer'|'component';
  vehicleMake:string|null; models:string[]; modelYearFrom?:number; modelYearTo?:number; componentMake:string|null;
  system:string; type:string; language:string; source:string; url:string;
  access:'open'|'portal'; applicability:'brand'|'model'|'component'|'vin';
  warning:string; reviewedOn:string;
};
type Payload = { audiences: Audience[]; documents: TechDoc[] };
type GarageVehicle = { id:string; brand:string; model?:string|null; year?:number|null; plate?:string|null; catalog_category?:string|null };
const KIND_LABELS = { all:'Все типы', truck:'Грузовики', trailer:'Прицепы', component:'Узлы и агрегаты' };
const TYPE_LABELS: Record<string,string> = { operation:'Эксплуатация',maintenance:'ТО',diagnostics:'Диагностика',wiring:'Схемы',parts:'Запчасти',service:'Ремонт' };
const normalize = (s:string) => s.normalize('NFKC').toLowerCase().replace(/ё/g,'е').replace(/[^a-zа-я0-9]+/gi,'');
const makeKey=(s:string)=>{
  const key=normalize(s);
  const aliases:Record<string,string>={рено:'renault',renaulttrucks:'renault',скания:'scania',вольво:'volvo',volvotrucks:'volvo',даф:'daf',ман:'man',ивеко:'iveco',мерседес:'mercedesbenz',мерседесбенц:'mercedesbenz',mercedes:'mercedesbenz',mercedesbenztrucks:'mercedesbenz',кроне:'krone'};
  return aliases[key]??key;
};
// Only an explicitly listed normalized model is an exact model filter match.
const modelMatches=(value:string,reference:string)=>{
  const actual=normalize(value),expected=normalize(reference);
  return !!actual&&!!expected&&actual===expected;
};
const vehicleKind=(v:GarageVehicle):'truck'|'trailer' =>
  v.catalog_category==='trailer'?'trailer':'truck';

export function TechBase({ audience, initialVehicleId = '' }: { audience:Audience; initialVehicleId?:string }) {
  const { me } = useMe();
  return <TechBaseForAccount key={(me?.id??'guest')+':'+audience+':'+initialVehicleId} audience={audience} initialVehicleId={initialVehicleId}/>;
}
function TechBaseForAccount({audience,initialVehicleId}:{audience:Audience;initialVehicleId:string}){
  const {me}=useMe();
  const isMaster = audience === 'master';
  const [payload,setPayload] = useState<Payload|null>(null);
  const [vehicles,setVehicles] = useState<GarageVehicle[]>([]);
  const [vehicleId,setVehicleId] = useState(isMaster?'':initialVehicleId);
  const [kind,setKind] = useState<'all'|'truck'|'trailer'|'component'>('all');
  const [make,setMake] = useState('');
  const [system,setSystem] = useState('');
  const [documentType,setDocumentType] = useState('');
  const [query,setQuery] = useState('');
  const [error,setError] = useState('');
  const [vehicleError,setVehicleError] = useState('');
  const [catalogRetry,setCatalogRetry] = useState(0);
  const [vehiclesRetry,setVehiclesRetry] = useState(0);
  const [garageLoaded,setGarageLoaded]=useState(false);
  useEffect(() => {
    let active = true;
    setPayload(null); setError('');
    get('/api/techbase?audience='+audience)
      .then((data:Payload) => { if(active) {
        // An HTTP 200 with a malformed response must not look like an empty,
        // verified manufacturer catalog.
        if(!data || !Array.isArray(data.documents) || !Array.isArray(data.audiences) || !data.audiences.includes(audience) || data.documents.some(d=>!d||d.audience!==audience||!Array.isArray(d.models)||d.models.some(m=>typeof m!=='string')||typeof d.title!=='string'||typeof d.system!=='string'||typeof d.source!=='string'||typeof d.url!=='string'||!/^https:\/\//i.test(d.url)))
          throw new Error('invalid_techbase');
        setPayload(data);
      }})
      .catch((e:unknown) => { if(active) setError(e instanceof ApiError&&e.status===403?'Нет доступа к этому разделу ТехБазы. Проверьте роль и статус верификации.':'Не удалось получить каталог. Проверьте подключение и права доступа.'); });
    return () => { active = false; };
  }, [audience, me?.id, catalogRetry]);
  useEffect(() => {
    // Garage vehicle names and plates belong to the current account. Clear
    // the old user's options before a new authenticated GET can complete.
    setVehicles([]);
    setVehicleId(isMaster?'':initialVehicleId);
    setVehicleError('');
  }, [me?.id, initialVehicleId, isMaster]);
  useEffect(() => {
    if (isMaster) return;
    let active = true;
    setVehicleError('');setGarageLoaded(false);
    get('/api/vehicles').then((data:GarageVehicle[]) => {
      if (active) {
        if(!Array.isArray(data))throw new Error('invalid_garage');
        setVehicles(data);
        setGarageLoaded(true);
      }
    }).catch(() => {
      if(active) {
        setVehicles([]);
        setVehicleError('Не удалось загрузить машины из гаража. Можно искать вручную или повторить загрузку.');
      }
    });
    return () => {active=false;};
  }, [isMaster, me?.id, vehiclesRetry]);
  const chosen = vehicles.find(v => v.id === vehicleId);
  const effectiveKind=chosen?vehicleKind(chosen):kind;
  const selectedMake = (chosen?.brand || make).trim();
  const selectedModel = chosen?.model?.trim() || '';
  const selectedYear = chosen?.year || null;
  const docs = useMemo(() => (payload?.documents ?? []).filter(d => {
    if(vehicleId&&!chosen)return false;
    if (effectiveKind !== 'all' && d.kind !== effectiveKind) return false;
    if (system && d.system !== system) return false;
    if (documentType && d.type !== documentType) return false;
    // Never treat a component reference as validated for the selected truck.
    if (selectedMake && d.kind !== 'component' && makeKey(d.vehicleMake || '') !== makeKey(selectedMake)) return false;
    if (chosen && d.kind !== 'component') {
      if ((d.applicability==='model'||d.models.length>0) &&
          (!selectedModel||!d.models.some(m=>modelMatches(selectedModel,m)))) return false;
      if ((d.modelYearFrom!=null||d.modelYearTo!=null) &&
          (!Number.isInteger(selectedYear)||!selectedYear)) return false;
    }
    if (selectedYear && d.modelYearFrom && selectedYear < d.modelYearFrom) return false;
    if (selectedYear && d.modelYearTo && selectedYear > d.modelYearTo) return false;
    if (query) {
      const words = (d.title+' '+d.system+' '+d.source+' '+d.models.join(' ')+' '+(d.componentMake||'')).toLowerCase();
      if (!words.includes(query.trim().toLowerCase())) return false;
    }
    return true;
  }),[payload,effectiveKind,system,documentType,query,selectedMake,selectedModel,selectedYear,vehicleId,chosen]);
  const systems = [...new Set((payload?.documents ?? []).map(d=>d.system))].sort();
  const groups = [...new Set(docs.map(d=>d.system))].sort().map(name => ({name,entries:docs.filter(d=>d.system===name)}));
  const canSeeMaster = !!payload?.audiences.includes('master');

  return <main className="techbase-page">
    <section className="techbase-hero">
      <div className="techbase-eyebrow">TrakSOS / ТехБаза / {isMaster?'Профессиональная':'Для водителя'}</div>
      <h1>{isMaster?'ТехБаза мастера':'ТехБаза водителя'}</h1>
      <p>{isMaster?'Схемы, диагностика, ремонт и документация производителя — с проверкой применимости.':'Эксплуатация, безопасные проверки, инструкции и обслуживание вашего транспорта.'}</p>
      <div className="techbase-hero-actions">
        {canSeeMaster && <><a href="#/techbase/driver" className={!isMaster?'selected':''}>Для водителя</a><a href="#/techbase/master" className={isMaster?'selected':''}>Для мастера</a></>}
      </div>
    </section>
    <section className="card stack techbase-filter" aria-label="Поиск технических материалов">
      {!isMaster && vehicleError && <div className="banner warn" role="alert">
        {vehicleError}
        <button type="button" className="btn ghost small" onClick={()=>setVehiclesRetry(n=>n+1)}>
          Повторить загрузку гаража
        </button>
      </div>}
      {!isMaster&&vehicleId&&!chosen&&<div className="banner" role="status">{garageLoaded?'Выбранный автомобиль не найден в вашем гараже.':'Ожидаем данные выбранного автомобиля.'} <button type="button" className="btn ghost small" onClick={()=>{setVehicleId('');setKind('all');}}>Перейти к ручному поиску</button></div>}
      {!isMaster && vehicles.length>0 && <label className="stack">
        <b>Машина из моего гаража</b>
        <select className="field" value={vehicleId} onChange={e=>{setVehicleId(e.target.value);setMake('');setKind('all');}}>
          <option value="">Все машины / ручной поиск</option>
          {vehicles.map(v=><option key={v.id} value={v.id}>{v.brand} {v.model||''} {v.year||''} {v.plate?'· '+v.plate:''}</option>)}
        </select>
      </label>}
      <div className="grid2">
        <label className="stack"><b>Раздел техники</b>
          <select className="field" value={effectiveKind} disabled={!!chosen} onChange={e=>setKind(e.target.value as typeof kind)}>
            {Object.entries(KIND_LABELS).map(([v,n])=><option key={v} value={v}>{n}</option>)}
          </select>
        </label>
        <label className="stack"><b>Система</b>
          <select className="field" value={system} onChange={e=>setSystem(e.target.value)}>
            <option value="">Все системы</option>
            {systems.map(s=><option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label className="stack"><b>Тип материала</b>
          <select className="field" value={documentType} onChange={e=>setDocumentType(e.target.value)}>
            <option value="">Любой тип документа</option>
            {Object.entries(TYPE_LABELS).map(([v,n])=><option key={v} value={v}>{n}</option>)}
          </select>
        </label>
        <label className="stack"><b>Марка техники</b>
          <input className="field" value={selectedMake} disabled={!!chosen}
            placeholder="Например, Scania или KRONE" onChange={e=>setMake(e.target.value)} />
        </label>
        <label className="stack"><b>Название, модель или система</b>
          <input className="field" value={query} placeholder="EBS, BPW, Vector, руководство..." onChange={e=>setQuery(e.target.value)} />
        </label>
      </div>
      {chosen && <div className="techbase-context">Выбрано из гаража: {chosen.brand} {chosen.model||''} {chosen.year||''}.
        Документы по отдельным агрегатам требуют проверки маркировки блока — привязка к машине не доказывает их совместимость.</div>}
      {isMaster && <div className="techbase-context">Для электросхем и распиновок дополнительно проверьте номер блока, ревизию, двигатель и комплектацию. Без этого материалы являются справочными.</div>}
    </section>
    {error && <div className="banner warn" role="alert">{error}
      <button type="button" className="btn ghost small" onClick={()=>setCatalogRetry(n=>n+1)}>
        Повторить загрузку каталога
      </button>
    </div>}
    {!payload && !error && <div className="card" role="status">Загружаем каталог производителя…</div>}
    {payload && <div className="stack">
      <div className="between"><h2>Материалы</h2><span className="pill">{docs.length} найдено</span></div>
      {docs.length===0 && (!vehicleId||chosen) && <div className="card">Для выбранной модели пока нет подтверждённых ссылок. Снимите фильтр или выберите другую систему. Мы не показываем схемы другой машины как подходящие.</div>}
      {groups.map(group => <section className="stack" key={group.name}>
        <h3 className="techbase-system-title">{group.name} <span className="note">({group.entries.length})</span></h3>
        <div className="techbase-grid">
        {group.entries.map(d=><article className="card stack techbase-document" key={d.id}>
        <div className="between"><span className="pill">{TYPE_LABELS[d.type]||d.type}</span><span className="note">{d.language} · {d.access==='portal'?'Портал':'Открытый источник'}</span></div>
        <h3>{d.title}</h3>
        <span className="note">{d.vehicleMake||d.componentMake||'Компонент'}{d.models.length?' / '+d.models.join(', '):''} · {d.system}</span>
        <p className="techbase-warning">{d.warning}</p>
        <div className="between"><span className="note">{d.source}</span><a className="btn ghost small" href={d.url} target="_blank" rel="noopener noreferrer">Открыть первоисточник ↗</a></div>
      </article>)}
        </div>
      </section>)}
    </div>}
    <div className="techbase-footer-note">TrakSOS показывает ссылки на публикации производителей, не хранит копии без разрешения и не подтверждает применимость автоматически. Инструкции по критически важным тормозным и электрическим системам предназначены для квалифицированных специалистов.</div>
  </main>;
}
