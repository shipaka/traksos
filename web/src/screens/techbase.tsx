import { useEffect, useMemo, useState } from 'react';
import { get } from '../api.ts';
import { useMe } from '../ui.tsx';

type Audience = 'driver' | 'master';
type TechDoc = {
  id:string; title:string; audience:Audience; kind:'truck'|'trailer'|'component';
  vehicleMake:string|null; models:string[]; componentMake:string|null;
  system:string; type:string; language:string; source:string; url:string;
  access:'open'|'portal'; applicability:'brand'|'model'|'component'|'vin';
  warning:string; reviewedOn:string;
};
type Payload = { audiences: Audience[]; documents: TechDoc[] };
type GarageVehicle = { id:string; brand:string; model?:string|null; year?:number|null; plate?:string|null };
const KIND_LABELS = { all:'Все типы', truck:'Грузовики', trailer:'Прицепы', component:'Узлы и агрегаты' };
const TYPE_LABELS: Record<string,string> = { operation:'Эксплуатация',maintenance:'ТО',diagnostics:'Диагностика',wiring:'Схемы',parts:'Запчасти',service:'Ремонт' };
const normalize = (s:string) => s.toLowerCase().replace(/[^a-zа-яё0-9]+/gi,'').replace('мерседесбенц','mercedesbenz');

export function TechBase({ audience }: { audience:Audience }) {
  const { me } = useMe();
  const isMaster = audience === 'master';
  const [payload,setPayload] = useState<Payload|null>(null);
  const [vehicles,setVehicles] = useState<GarageVehicle[]>([]);
  const [vehicleId,setVehicleId] = useState('');
  const [kind,setKind] = useState<'all'|'truck'|'trailer'|'component'>('all');
  const [make,setMake] = useState('');
  const [system,setSystem] = useState('');
  const [query,setQuery] = useState('');
  const [error,setError] = useState('');
  useEffect(() => {
    let active = true;
    setPayload(null); setError('');
    get('/api/techbase?audience='+audience)
      .then((data:Payload) => { if(active) setPayload(data); })
      .catch(() => { if(active) setError('Не удалось получить каталог. Проверьте подключение и права доступа.'); });
    return () => { active = false; };
  }, [audience, me?.id]);
  useEffect(() => {
    if (isMaster) return;
    let active = true;
    get('/api/vehicles').then((data:GarageVehicle[]) => {
      if (active && Array.isArray(data)) setVehicles(data);
    }).catch(() => {});
    return () => {active=false;};
  }, [isMaster, me?.id]);
  const chosen = vehicles.find(v => v.id === vehicleId);
  const selectedMake = (chosen?.brand || make).trim();
  const selectedModel = chosen?.model?.trim() || '';
  const docs = useMemo(() => (payload?.documents ?? []).filter(d => {
    if (kind !== 'all' && d.kind !== kind) return false;
    if (system && d.system !== system) return false;
    // Never treat a component reference as validated for the selected truck.
    if (selectedMake && d.kind !== 'component' && normalize(d.vehicleMake || '') !== normalize(selectedMake)) return false;
    if (selectedModel && d.kind === 'truck' && d.models.length &&
        !d.models.some(m => normalize(selectedModel).includes(normalize(m)) || normalize(m).includes(normalize(selectedModel)))) return false;
    if (query) {
      const words = (d.title+' '+d.system+' '+d.source+' '+d.models.join(' ')+' '+(d.componentMake||'')).toLowerCase();
      if (!words.includes(query.trim().toLowerCase())) return false;
    }
    return true;
  }),[payload,kind,system,query,selectedMake,selectedModel]);
  const systems = [...new Set((payload?.documents ?? []).map(d=>d.system))].sort();
  const canSeeMaster = !!payload?.audiences.includes('master');

  return <main className="techbase-page">
    <section className="techbase-hero">
      <div className="techbase-eyebrow">TrackSOS / ТехБаза / {isMaster?'Профессиональная':'Для водителя'}</div>
      <h1>{isMaster?'ТехБаза мастера':'ТехБаза водителя'}</h1>
      <p>{isMaster?'Схемы, диагностика, ремонт и документация производителя — с проверкой применимости.':'Эксплуатация, безопасные проверки, инструкции и обслуживание вашего транспорта.'}</p>
      <div className="techbase-hero-actions">
        {canSeeMaster && <><a href="#/techbase/driver" className={!isMaster?'selected':''}>Для водителя</a><a href="#/techbase/master" className={isMaster?'selected':''}>Для мастера</a></>}
      </div>
    </section>
    <section className="card stack techbase-filter" aria-label="Поиск технических материалов">
      {!isMaster && vehicles.length>0 && <label className="stack">
        <b>Машина из моего гаража</b>
        <select className="field" value={vehicleId} onChange={e=>{setVehicleId(e.target.value);setMake('');setKind(e.target.value?'truck':'all');}}>
          <option value="">Все машины / ручной поиск</option>
          {vehicles.map(v=><option key={v.id} value={v.id}>{v.brand} {v.model||''} {v.year||''} {v.plate?'· '+v.plate:''}</option>)}
        </select>
      </label>}
      <div className="grid2">
        <label className="stack"><b>Раздел техники</b>
          <select className="field" value={kind} onChange={e=>setKind(e.target.value as typeof kind)}>
            {Object.entries(KIND_LABELS).map(([v,n])=><option key={v} value={v}>{n}</option>)}
          </select>
        </label>
        <label className="stack"><b>Система</b>
          <select className="field" value={system} onChange={e=>setSystem(e.target.value)}>
            <option value="">Все системы</option>
            {systems.map(s=><option key={s} value={s}>{s}</option>)}
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
    {error && <div className="banner warn" role="alert">{error}</div>}
    {!payload && !error && <div className="card" role="status">Загружаем каталог производителя…</div>}
    {payload && <div className="stack">
      <div className="between"><h2>Материалы</h2><span className="pill">{docs.length} найдено</span></div>
      {docs.length===0 && <div className="card">Для выбранной модели пока нет подтверждённых ссылок. Снимите фильтр или выберите другую систему. Мы не показываем схемы другой машины как подходящие.</div>}
      <div className="techbase-grid">
      {docs.map(d=><article className="card stack techbase-document" key={d.id}>
        <div className="between"><span className="pill">{TYPE_LABELS[d.type]||d.type}</span><span className="note">{d.language} · {d.access==='portal'?'Портал':'Открытый источник'}</span></div>
        <h3>{d.title}</h3>
        <span className="note">{d.vehicleMake||d.componentMake||'Компонент'}{d.models.length?' / '+d.models.join(', '):''} · {d.system}</span>
        <p className="techbase-warning">{d.warning}</p>
        <div className="between"><span className="note">{d.source}</span><a className="btn ghost small" href={d.url} target="_blank" rel="noopener noreferrer">Открыть первоисточник ↗</a></div>
      </article>)}
      </div>
    </div>}
    <div className="techbase-footer-note">TrackSOS показывает ссылки на публикации производителей, не хранит копии без разрешения и не подтверждает применимость автоматически. Инструкции по критически важным тормозным и электрическим системам предназначены для квалифицированных специалистов.</div>
  </main>;
}
