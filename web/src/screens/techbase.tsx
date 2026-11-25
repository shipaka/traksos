import { useMemo, useRef, useState } from 'react';
import { get, getToken } from '../api.ts';
import { usePrivateRead } from './privateRead20261124.ts';
import { useMe } from '../ui.tsx';
import { VehicleTechnicalSources } from './VehicleTechnicalSources.tsx';
import { TechBaseIllustrated, type IllustratedPayload } from './TechBaseIllustrated.tsx';

type Audience = 'driver' | 'master';
type TechDoc = {
  id:string; title:string; audience:Audience; kind:'truck'|'trailer'|'component';
  vehicleMake:string|null; models:string[]; modelYearFrom?:number; modelYearTo?:number; componentMake:string|null;
  system:string; type:string; language:string; source:string; url:string;
  access:'open'|'portal'; applicability:'brand'|'model'|'component'|'vin';
  warning:string; reviewedOn:string;
};
type Payload = { audiences: Audience[]; documents: TechDoc[]; illustrated?:IllustratedPayload };
type GarageVehicle = { id:string; brand:string; model?:string|null; year?:number|null; plate?:string|null; catalog_category?:string|null; catalog_brand_key?:string|null };
const KIND_LABELS = { all:'Все типы', truck:'Грузовики', trailer:'Прицепы', component:'Узлы и агрегаты' };
const TYPE_LABELS: Record<string,string> = { operation:'Эксплуатация',maintenance:'ТО',diagnostics:'Диагностика',wiring:'Схемы',parts:'Запчасти',service:'Ремонт' };
const normalize = (s:string) => s.normalize('NFKC').toLowerCase().replace(/ё/g,'е').replace(/[^a-zа-я0-9]+/gi,'');
const makeKey=(s:string)=>{
  const key=normalize(s);
  const aliases:Record<string,string>={рено:'renault',renaulttrucks:'renault',скания:'scania',вольво:'volvo',volvotrucks:'volvo',даф:'daf',ман:'man',ивеко:'iveco',мерседес:'mercedesbenz',мерседесбенц:'mercedesbenz',mercedes:'mercedesbenz',mercedesbenztrucks:'mercedesbenz',кроне:'krone'};
  return aliases[key]??key;
};
const modelMatches=(value:string,reference:string)=>{
  const actual=normalize(value),expected=normalize(reference);
  if(!actual||!expected)return false;
  return actual===expected;
};

export function TechBase({ audience, initialVehicleId = '' }: { audience:Audience; initialVehicleId?:string }) {
  const { me } = useMe();
  const token=getToken();
  const session=useRef({token,revision:0});
  if(session.current.token!==token)session.current={token,revision:session.current.revision+1};
  const params=new URLSearchParams(location.hash.split('?')[1]??'');
  const orderId=audience==='master'?params.get('orderId')??'':'';
  const bookingId=audience==='master'?params.get('bookingId')??'':'';
  if(!me||!token)return null;
  return <TechBaseForAccount key={JSON.stringify([me.id,me.owner_id,me.roles,session.current.revision,audience,initialVehicleId,orderId,bookingId])} audience={audience} initialVehicleId={initialVehicleId} orderId={orderId} bookingId={bookingId}/>;
}
function TechBaseForAccount({audience,initialVehicleId,orderId,bookingId}:{audience:Audience;initialVehicleId:string;orderId:string;bookingId:string}){
  const {me}=useMe();
  const isMaster = audience === 'master';

  const [vehicleId,setVehicleId] = useState(isMaster?'':initialVehicleId);
  const [kind,setKind] = useState<'all'|'truck'|'trailer'|'component'>('all');
  const [make,setMake] = useState('');
  const [system,setSystem] = useState('');
  const [documentType,setDocumentType] = useState('');
  const [query,setQuery] = useState('');
  const token=getToken();
  const checked=async<T,>(load:()=>Promise<T>)=>{
    if(!token||getToken()!==token)throw Error('Сессия изменилась');
    const result=await load();
    if(getToken()!==token)throw Error('Сессия изменилась');
    return result;
  };
  const relevant=(e:any)=>['connection_restored','profile','verification','account','fleet','vehicle','order','booking','part_recommendations_changed'].includes(e.type);
  const catalog=usePrivateRead<Payload>(()=>checked(async()=>{
    const data=await get<Payload>('/api/techbase?audience='+audience);
    if(!data || !Array.isArray(data.documents) || !Array.isArray(data.audiences) || !data.audiences.includes(audience) || data.documents.some(d=>!d||d.audience!==audience||!Array.isArray(d.models)||d.models.some(m=>typeof m!=='string')||typeof d.title!=='string'||typeof d.system!=='string'||typeof d.source!=='string'||typeof d.url!=='string'||!/^https:\/\//i.test(d.url)))
          throw new Error('invalid_techbase');
    return data;
  }),audience,relevant);
  const garage=usePrivateRead<GarageVehicle[]>(()=>checked(async()=>{
    if(isMaster)return [];
    const data=await get<GarageVehicle[]>('/api/vehicles');
    if(!Array.isArray(data)||data.some(v=>!v||typeof v.id!=='string'||typeof v.brand!=='string'||(v.model!=null&&typeof v.model!=='string')))throw Error('invalid_garage');
    return data;
  }),audience,relevant);
  const sourcePath=orderId&&!bookingId?'/api/orders/'+encodeURIComponent(orderId):bookingId&&!orderId?'/api/bookings/'+encodeURIComponent(bookingId):'';
  const source=usePrivateRead<{canSuggest:boolean}|null>(()=>checked(()=>sourcePath?get(sourcePath+'/part-recommendations'):Promise.resolve(null)),sourcePath,relevant);
  const payload=catalog.data,vehicles=garage.data??[],garageLoaded=!!garage.data;
  const error=catalog.error?'Не удалось получить каталог. Проверьте подключение и права доступа.':'';
  const vehicleError=garage.error?'Не удалось загрузить машины из гаража. Можно искать вручную или повторить загрузку.':'';
  const chosen = vehicles.find(v => v.id === vehicleId);
  const effectiveKind = chosen ? (chosen.catalog_category==='trailer'?'trailer':'truck') : kind;
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
    if (chosen && d.kind !== 'component' && (d.applicability==='model'||d.models.length>0) &&
        (!selectedModel || !d.models.some(m => modelMatches(selectedModel,m)))) return false;
    if (chosen && d.kind !== 'component' && (d.modelYearFrom!=null||d.modelYearTo!=null) && (!Number.isInteger(selectedYear)||!selectedYear)) return false;
    if (selectedYear && d.modelYearFrom!=null && selectedYear < d.modelYearFrom) return false;
    if (selectedYear && d.modelYearTo!=null && selectedYear > d.modelYearTo) return false;
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
        <button type="button" className="btn ghost small" onClick={garage.reload}>
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
      <button type="button" className="btn ghost small" onClick={catalog.reload}>
        Повторить загрузку каталога
      </button>
    </div>}
    {!payload && !error && <div className="card" role="status">Загружаем каталог производителя…</div>}
    {isMaster&&(orderId||bookingId)&&<div className="card stack"><span className="note">{source.data?.canSuggest?'Рекомендация будет привязана к текущему ремонту. Марку и комплектацию необходимо сверить.':'Отправка рекомендации недоступна до подтверждения полномочий по ремонту.'}</span>{sourcePath&&<a className="btn ghost small" href={orderId?'#/order/'+encodeURIComponent(orderId):'#/booking/'+encodeURIComponent(bookingId)}>Вернуться к ремонту</a>}{source.error&&<button className="btn ghost small" onClick={source.reload}>Перепроверить доступ к ремонту</button>}</div>}
    {isMaster && payload?.audiences.includes('master') && payload.illustrated && <TechBaseIllustrated key={me?.id} data={payload.illustrated} specialties={Array.isArray(me?.performer?.specialties)?me?.performer?.specialties:[]} orderId={source.data?.canSuggest&&orderId?orderId:undefined} bookingId={source.data?.canSuggest&&bookingId?bookingId:undefined}/>}
    {payload && (!vehicleId||chosen) && <div className="stack">
      <div className="between"><h2>Материалы</h2><span className="pill">{docs.length} найдено</span></div>
      {docs.length===0 && (!vehicleId||chosen) && <div className="card">Для выбранной модели пока нет подтверждённых ссылок. Снимите фильтр или выберите другую систему. Мы не показываем схемы другой машины как подходящие.</div>}
      {groups.map(group => <section className="stack" key={group.name}>
        <h3 className="techbase-system-title">{group.name} <span className="note">({group.entries.length})</span></h3>
        <div className="techbase-grid">
        {group.entries.map(d=><article className="card stack techbase-document" key={d.id}>
        <div className="between"><span className="pill">{TYPE_LABELS[d.type]||d.type}</span><span className="note">{d.language} · {d.access==='portal'?'Портал':'Открытый источник'}</span></div>
        <h3>{d.title}</h3>
        <span className="note">{d.vehicleMake||d.componentMake||'Компонент'}{d.models.length?' / '+d.models.join(', '):''} · {d.system}</span>
        <span className="note">{d.applicability==='brand'?'Справка по производителю':d.applicability==='vin'?'Подбор по VIN на сайте производителя':d.kind==='component'?'Справка по агрегату, установка не подтверждена':'Указанная модель; комплектация не подтверждена'}</span>
        <p className="techbase-warning">{d.warning}</p>
        <div className="between"><span className="note">{d.source}</span><a className="btn ghost small" href={d.url} target="_blank" rel="noopener noreferrer">Открыть первоисточник ↗</a></div>
      </article>)}
        </div>
      </section>)}
    </div>}
    {payload && (!vehicleId||chosen) && <VehicleTechnicalSources key={JSON.stringify([me?.id,audience,vehicleId,effectiveKind,selectedMake,query])} professional={isMaster}
      makeKey={chosen?.catalog_brand_key??makeKey(selectedMake)}
      category={effectiveKind==='trailer'?'trailer':'truck'}
      query={query} vehicleId={!isMaster?chosen?.id:undefined}/>}
    <div className="techbase-footer-note">TrakSOS показывает оригинальные справочные иллюстрации и ссылки на публикации производителей, не хранит копии без разрешения и не подтверждает применимость автоматически. Инструкции по критически важным тормозным и электрическим системам предназначены для квалифицированных специалистов.</div>
  </main>;
}
