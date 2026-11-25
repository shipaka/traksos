import { useEffect, useRef, useState } from 'react';
import { get, post } from './api.ts';
import { YEARS } from './dict.ts';

// Каталог по официальным открытым реестрам: собственный текст не сохраняется.
export type CatalogVehicleValue = {
  brand:string;model:string;year:string;
  catalogCategory?:'truck'|'trailer'|'van'|'bus'|'passenger';
  catalogBrandKey?:string;catalogModelKey?:string;
};
type DirectoryMake={key:string;name:string;category:'truck'|'trailer'|'van'|'bus'|'passenger'};
type DirectoryModel={key:string;name:string};
type TruckEvidence={
  production:{yearFrom:number;yearTo:number|null;status:string|null}|null;
  registrationEvidence:{firstRegistrationObserved:number;lastRegistrationObserved:number|null;notProductionYears:true}|null;
  note:string;sourceVersion:string;
};
export function CatalogVehicleFields({value,onChange,purpose='garage'}:{
  value:CatalogVehicleValue;onChange:(v:CatalogVehicleValue)=>void;purpose?:'garage'|'master'|'tow';
}){
  const [category,setCategory]=useState<'truck'|'trailer'|'van'|'bus'|'passenger'>(value.catalogCategory??(purpose==='master'?'passenger':'truck'));
  const [makeQuery,setMakeQuery]=useState('');
  const [modelQuery,setModelQuery]=useState('');
  const [makes,setMakes]=useState<DirectoryMake[]>([]);
  const [models,setModels]=useState<DirectoryModel[]>([]);
  const [makeLoading,setMakeLoading]=useState(false);
  const [modelLoading,setModelLoading]=useState(false);
  const [makeError,setMakeError]=useState('');
  const [modelError,setModelError]=useState('');
  const [retry,setRetry]=useState(0);
  const missingLock=useRef(false);
  const [truckEvidence,setTruckEvidence]=useState<TruckEvidence|null>(null);
  const [missing,setMissing]=useState(false);
  const [missingMake,setMissingMake]=useState('');
  const [missingModel,setMissingModel]=useState('');
  const [missingNote,setMissingNote]=useState('');
  const [sent,setSent]=useState('');
  const [sending,setSending]=useState(false);
  const selectedMake=value.catalogCategory===category?value.catalogBrandKey??'':'';
  const selectedModel=value.catalogCategory===category?value.catalogModelKey??'':'';
  useEffect(()=>{
    let alive=true;
    setMakes([]);setMakeLoading(true);setMakeError('');
    const timer=setTimeout(()=>{
      get('/api/vehicle-reference/makes?purpose='+purpose+'&category='+category+'&includeHeavy='+(purpose==='master')+'&q='+encodeURIComponent(makeQuery)).then((data:any)=>{
        if(alive){setMakes((data.items??[]).filter((x:DirectoryMake)=>x.category===category));
          setMakeError('');}
      }).catch((e:Error)=>{if(alive){setMakes([]);setMakeError(e.message)}})
        .finally(()=>{if(alive)setMakeLoading(false)});
    },180);
    return ()=>{alive=false;clearTimeout(timer)};
  },[category,makeQuery,purpose,retry]);
  useEffect(()=>{
    setModels([]);setModelError('');
    if(!selectedMake){setModelLoading(false);return;}
    let alive=true;setModelLoading(true);
    const timer=setTimeout(()=>{
      const url='/api/vehicle-reference/models?purpose='+purpose+
        '&category='+category+'&brandKey='+encodeURIComponent(selectedMake)+'&includeHeavy='+(purpose==='master')+'&q='+encodeURIComponent(modelQuery);
      get(url).then((data:any)=>{if(alive){setModels(data.items??[]);setModelError('')}})
        .catch((e:Error)=>{if(alive){setModels([]);setModelError(e.message)}})
        .finally(()=>{if(alive)setModelLoading(false)});
    },180);
    return ()=>{alive=false;clearTimeout(timer)};
  },[category,selectedMake,modelQuery,purpose,retry]);
  useEffect(()=>{
    setTruckEvidence(null);
    if(category!=='truck'||!selectedMake||!selectedModel)return;
    let alive=true;
    get('/api/vehicle-reference/truck-evidence?purpose='+purpose+
      '&brandKey='+encodeURIComponent(selectedMake)+'&modelKey='+encodeURIComponent(selectedModel))
      .then((v:TruckEvidence)=>{if(alive)setTruckEvidence(v)})
      .catch(()=>{if(alive)setTruckEvidence(null)});
    return ()=>{alive=false};
  },[category,selectedMake,selectedModel,purpose]);
  const chooseMake=(key:string)=>{
    const choice=makes.find(x=>x.key===key);
    setModelQuery('');
    setModels([]);
    onChange({...value,brand:choice?.name??'',model:'',
      year:'',catalogCategory:choice?.category??category,catalogBrandKey:choice?.key,catalogModelKey:undefined});
  };
  const chooseModel=(key:string)=>{
    const choice=models.find(x=>x.key===key);
    onChange({...value,model:choice?.name??'',year:'',catalogModelKey:choice?.key});
  };
  const submitMissing=async()=>{
    if(missingLock.current||missingMake.trim().length<2||missingModel.trim().length<2)return;
    missingLock.current=true;setSending(true);setSent('');
    try {
      const r:any=await post('/api/vehicle-reference/missing',{
        category,purpose,make:missingMake.trim(),model:missingModel.trim(),
        year:value.year?Number(value.year):undefined,note:missingNote.trim()});
      setSent(r.message||'Заявка направлена на модерацию');
      setMissing(false);setMissingMake('');setMissingModel('');setMissingNote('');
    }catch(e:any){setSent(e.message??'Не удалось отправить запрос')}
    finally{missingLock.current=false;setSending(false)}
  };
  return <div className="stack" style={{gap:8}}>
    <label className="label">Категория транспорта</label>
    <select className="field" aria-label="Категория транспорта" value={category}
      onChange={(e)=>{
        const c=e.target.value as typeof category;setCategory(c);setMakeQuery('');setModelQuery('');setMakes([]);setModels([]);setTruckEvidence(null);
        onChange({...value,brand:'',model:'',year:'',catalogCategory:c,
          catalogBrandKey:undefined,catalogModelKey:undefined});
      }}>
      {(purpose==='tow' ? [
        ['truck','Тяжёлый эвакуатор (подтверждённая надстройка)']
      ] : purpose==='master' ? [
        ['passenger','Легковой автомобиль'],['van','Фургон'],['truck','Грузовой автомобиль'],
        ['trailer','Прицеп или полуприцеп'],['bus','Автобус']
      ] : [
        ['truck','Грузовой автомобиль'],['trailer','Прицеп или полуприцеп'],
        ['van','Фургон'],['bus','Автобус']
      ]).map(([v,l])=><option key={v} value={v}>{l}</option>)}
    </select>
    <input className="field" value={makeQuery} onChange={e=>setMakeQuery(e.target.value)}
      aria-label="Поиск марки" placeholder="Поиск марки в каталоге" maxLength={80}/>
    <select className="field" aria-label="Марка" value={selectedMake}
      onChange={e=>chooseMake(e.target.value)} disabled={makeLoading||!!makeError}>
      <option value="">{makeLoading?'Поиск марок…':'Выберите марку'}</option>
      {makes.map(x=><option key={x.key} value={x.key}>{x.name}</option>)}
      {selectedMake&&!makes.some(x=>x.key===selectedMake)&&<option value={selectedMake}>{value.brand}</option>}
    </select>
    {selectedMake&&<>
      <input className="field" aria-label="Поиск модели" placeholder="Поиск модели или серии"
        value={modelQuery} onChange={e=>setModelQuery(e.target.value)} maxLength={80}/>
      <select className="field" aria-label="Модель" value={selectedModel}
        onChange={e=>chooseModel(e.target.value)} disabled={modelLoading||!!modelError}>
        <option value="">{modelLoading?'Поиск моделей…':'Выберите модель'}</option>
        {models.map(x=><option key={x.key} value={x.key}>{x.name}</option>)}
        {selectedModel&&!models.some(x=>x.key===selectedModel)&&<option value={selectedModel}>{value.model}</option>}
      </select>
    </>}
    <select className="field" aria-label="Год выпуска" value={value.year}
      onChange={e=>onChange({...value,year:e.target.value})}>
      <option value="">Год выпуска (при наличии)</option>
      {YEARS.map(y=><option key={y} value={String(y)}>{y}</option>)}
    </select>
    {(makeError||modelError)&&<div className="stack" role="alert"><span className="note">Каталог временно недоступен: {makeError||modelError}. Свободный ввод не включается.</span><button className="btn ghost small" type="button" onClick={()=>setRetry(n=>n+1)}>Повторить загрузку каталога</button></div>}
    <span className="note">
      Марка и модель выбираются из справочника. Год и комплектацию
      необходимо уточнять по документам автомобиля.
    </span>
    {category==='truck' && truckEvidence && <aside className="card stack">
      <b>Грузовой справочник · проверенные данные</b>
      {truckEvidence.production&&<span className="note">Официально подтверждённое начало выпуска:
        {truckEvidence.production.yearFrom} г.
        {truckEvidence.production.yearTo?' — '+truckEvidence.production.yearTo+' г.':''}
      </span>}
      {truckEvidence.registrationEvidence&&<span className="note">Первые регистрации в реестрах:
        {truckEvidence.registrationEvidence.firstRegistrationObserved}–{truckEvidence.registrationEvidence.lastRegistrationObserved??'н/д'}.
        Это не период выпуска модели.
      </span>}
      {!truckEvidence.production&&!truckEvidence.registrationEvidence&&<span className="note">Пока нет подтверждённых дат модели; не заменяем их предположениями.</span>}
      <small className="note">Годы и модификации техники уточняются по VIN и документации изготовителя.
        Справочные данные VehiclesDB, выпуск {truckEvidence.sourceVersion}.</small>
    </aside>}
    <button className="btn ghost small" type="button" aria-expanded={missing}
      onClick={()=>setMissing(!missing)}>Нет марки или модели в каталоге?</button>
    {missing&&<section className="card stack">
      <b>Предложить транспорт в каталог</b>
      <p className="note">Здесь можно описать отсутствующую модель. Она не добавится в общую базу без проверки администратором.</p>
      <input className="field" aria-label="Новая марка для модерации" placeholder="Марка"
        value={missingMake} onChange={e=>setMissingMake(e.target.value)} maxLength={100}/>
      <input className="field" aria-label="Новая модель для модерации" placeholder="Модель или серия"
        value={missingModel} onChange={e=>setMissingModel(e.target.value)} maxLength={120}/>
      <textarea className="field" rows={2} aria-label="Основание запроса" placeholder="Год, регион, документы (без личных данных)"
        value={missingNote} onChange={e=>setMissingNote(e.target.value)} maxLength={1200}/>
      <button className="btn" type="button" disabled={sending||missingMake.trim().length<2||missingModel.trim().length<2}
        onClick={()=>void submitMissing()}>{sending?'Отправляю…':'Отправить на модерацию'}</button>
    </section>}
    {sent&&<span className="note" role="status">{sent}</span>}
    <small className="note">Данные: <a href="https://vehiclesdb.com" target="_blank" rel="noopener noreferrer">Vehicle data by VehiclesDB</a> · CC BY 4.0 · <a href="/api/vehicle-reference/attribution" target="_blank" rel="noopener noreferrer">источники и лицензии</a>.</small>
  </div>;
}

