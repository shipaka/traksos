import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { ApiError, get, post, onEvent } from './api.ts';
import { BRANDS, MODELS, YEARS } from './dict.ts';
import { reportApiError } from './screens/offers.tsx';

// Роутер на хэше: #/order/123 → ['order', '123'] ---------------------------

export function useRoute() {
  const read = () => (location.hash.replace(/^#\/?/, '') || '').split('?')[0].split('/').filter(Boolean);
  const [r, setR] = useState(read);
  useEffect(() => {
    const f = () => { setR(read()); window.scrollTo(0, 0); };
    window.addEventListener('hashchange', f);
    return () => window.removeEventListener('hashchange', f);
  }, []);
  return r;
}
export const go = (path: string) => { location.hash = '#/' + path.replace(/^\//, ''); };

// Сессия ------------------------------------------------------------------

export interface Me {
  id: string; phone: string; name: string | null; roles: string[]; owner_id: string | null;
  company_name: string | null; company_inn: string | null; rating: number | null; rating_count: number;
  performer: any | null;
}
export const MeCtx = createContext<{ me: Me | null; reload: () => Promise<void>; mode: 'client' | 'performer' | 'admin' | 'moderator' | 'service' | 'insurer' | 'inspection' | 'courier'; setMode: (m: 'client' | 'performer' | 'admin' | 'moderator' | 'service' | 'insurer' | 'inspection' | 'courier') => void }>(null as any);
export const useMe = () => useContext(MeCtx);

// Уведомления сверху -------------------------------------------------------

const ToastCtx = createContext<(text: string) => void>(() => {});
export const useToast = () => useContext(ToastCtx);
export function ToastProvider({ children }: { children: ReactNode }) {
  const [text, setText] = useState<string | null>(null);
  const timer = useRef<any>();
  const show = useCallback((t: string) => {
    setText(t);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setText(null), 3500);
  }, []);
  return (
    <ToastCtx.Provider value={show}>
      {children}
      {text && <div className="toast" role="status">{text}</div>}
    </ToastCtx.Provider>
  );
}

/** Загрузка данных + перезагрузка по событиям сервера */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[], reloadOn?: (e: any) => boolean) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const reload = useCallback(async () => {
    try {
      setData(await fnRef.current());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => { setData(null); reload(); }, deps); // eslint-disable-line
  useEffect(() => (reloadOn ? onEvent((e) => reloadOn(e) && reload()) : undefined), deps); // eslint-disable-line
  return { data, error, reload, setData };
}

/** Кнопка, которая сама показывает «…» и ошибку */
export function useAction() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const run = useCallback(async <T,>(fn: () => Promise<T>, okText: string | null = 'Готово'): Promise<T | undefined> => {
    setBusy(true);
    try {
      const r = await fn();
      if (okText) toast(okText);
      return r;
    } catch (e) {
      reportApiError(e);
      toast(e instanceof ApiError ? e.message : 'Что-то пошло не так — попробуйте ещё раз');
      return undefined;
    } finally {
      setBusy(false);
    }
  }, [toast]);
  return { busy, run };
}

export function Loading({ error }: { error?: string | null }) {
  return <div className="empty">{error ?? 'Загружаю…'}</div>;
}

/** Сколько переходов сделано внутри приложения: есть куда вернуться — «Назад» ведёт туда, откуда пришли */
let inAppSteps = 0;
if (typeof window !== 'undefined') window.addEventListener('hashchange', () => { inAppSteps++; });

export function Back({ to, label = 'Назад' }: { to: string; label?: string }) {
  // Назад — туда, откуда пришли (уведомления, оферта и т. п. открываются из разных мест); зашли по ссылке — на `to`
  return <a href={'#/' + to} className="note" style={{ textDecoration: 'none' }} onClick={(e) => { if (inAppSteps > 0) { e.preventDefault(); inAppSteps -= 2; history.back(); } }}>← {label}</a>;
}

export function Chips<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { id: T; name: string }[] }) {
  return (
    <div className="scroll-x">
      {options.map((o) => (
        <button key={o.id} type="button" className="chip" aria-pressed={value === o.id} onClick={() => onChange(o.id)}>{o.name}</button>
      ))}
    </div>
  );
}

/** Подпись и поле. group — для набора кнопок: тогда это группа, а не <label>, чтобы кнопки не получали чужое название */
export function Field({ label, children, hint, group }: { label: string; children: ReactNode; hint?: string; group?: boolean }) {
  const inner = (
    <>
      <span className="label">{label}</span>
      {children}
      {hint && <span className="note">{hint}</span>}
    </>
  );
  return group
    ? <div className="stack" role="group" aria-label={label} style={{ gap: 6 }}>{inner}</div>
    : <label className="stack" style={{ gap: 6 }}>{inner}</label>;
}

/** Ввод рублей, наружу — копейки */
export function RubInput({ value, onChange, placeholder }: { value: number | null; onChange: (k: number | null) => void; placeholder?: string }) {
  return (
    <input className="field" inputMode="numeric" placeholder={placeholder ?? '0 ₽'}
      value={value == null ? '' : String(value / 100)}
      onChange={(e) => {
        const v = e.target.value.replace(/[^\d]/g, '');
        onChange(v === '' ? null : Number(v) * 100);
      }} />
  );
}

// Машина: марка → модель → год, всё выпадающими списками. Нет в списке — «Другая…» и вписать самому.
export type VehicleValue = {
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
export function VehicleFields({value,onChange,purpose='garage'}:{
  value:VehicleValue;onChange:(v:VehicleValue)=>void;purpose?:'garage'|'master'|'tow';
}){
  const {me}=useMe();
  const [category,setCategory]=useState<'truck'|'trailer'|'van'|'bus'|'passenger'>(value.catalogCategory??(purpose==='master'?'passenger':'truck'));
  const [makeQuery,setMakeQuery]=useState('');
  const [modelQuery,setModelQuery]=useState('');
  const [makes,setMakes]=useState<DirectoryMake[]>([]);
  const [models,setModels]=useState<DirectoryModel[]>([]);
  const [makeLoading,setMakeLoading]=useState(false);
  const [modelLoading,setModelLoading]=useState(false);
  const [loadError,setLoadError]=useState('');
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
    const timer=setTimeout(()=>{
      setMakeLoading(true);
      get('/api/vehicle-reference/makes?purpose='+purpose+'&category='+category+'&includeHeavy='+(purpose==='master')+'&q='+encodeURIComponent(makeQuery)).then((data:any)=>{
        if(alive){setMakes((data.items??[]).filter((x:DirectoryMake)=>x.category===category));
          setLoadError('');}
      }).catch((e:Error)=>{if(alive){setMakes([]);setLoadError(e.message)}})
        .finally(()=>{if(alive)setMakeLoading(false)});
    },180);
    return ()=>{alive=false;clearTimeout(timer)};
  },[category,makeQuery,purpose]);
  useEffect(()=>{
    if(!selectedMake){setModels([]);return;}
    let alive=true;
    const timer=setTimeout(()=>{
      setModelLoading(true);
      const url='/api/vehicle-reference/models?purpose='+purpose+
        '&category='+category+'&brandKey='+encodeURIComponent(selectedMake)+'&includeHeavy='+(purpose==='master')+'&q='+encodeURIComponent(modelQuery);
      get(url).then((data:any)=>{if(alive){setModels(data.items??[]);setLoadError('')}})
        .catch((e:Error)=>{if(alive){setModels([]);setLoadError(e.message)}})
        .finally(()=>{if(alive)setModelLoading(false)});
    },180);
    return ()=>{alive=false;clearTimeout(timer)};
  },[category,selectedMake,modelQuery,purpose]);
  useEffect(()=>{
    if(category!=='truck'||!selectedMake||!selectedModel){setTruckEvidence(null);return;}
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
      catalogCategory:choice?.category??category,catalogBrandKey:key||undefined,catalogModelKey:undefined});
  };
  const chooseModel=(key:string)=>{
    const choice=models.find(x=>x.key===key);
    onChange({...value,model:choice?.name??'',catalogModelKey:key||undefined});
  };
  const submitMissing=async()=>{
    setSending(true);setSent('');
    try {
      const r:any=await post('/api/vehicle-reference/missing',{
        category,purpose,make:missingMake.trim(),model:missingModel.trim(),
        year:value.year?Number(value.year):undefined,note:missingNote.trim()});
      setSent(r.message||'Заявка направлена на модерацию');
      setMissing(false);setMissingMake('');setMissingModel('');setMissingNote('');
    }catch(e:any){setSent(e.message??'Не удалось отправить запрос')}
    finally{setSending(false)}
  };
  return <div className="stack" style={{gap:8}}>
    <label className="label">Категория транспорта</label>
    <select className="field" aria-label="Категория транспорта" value={category}
      onChange={(e)=>{
        const c=e.target.value as typeof category;setCategory(c);setMakeQuery('');setModelQuery('');
        onChange({...value,brand:'',model:'',catalogCategory:c,
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
      onChange={e=>chooseMake(e.target.value)}>
      <option value="">{makeLoading?'Поиск марок…':'Выберите марку'}</option>
      {makes.map(x=><option key={x.key} value={x.key}>{x.name}</option>)}
      {selectedMake&&!makes.some(x=>x.key===selectedMake)&&<option value={selectedMake}>{value.brand}</option>}
    </select>
    {selectedMake&&<>
      <input className="field" aria-label="Поиск модели" placeholder="Поиск модели или серии"
        value={modelQuery} onChange={e=>setModelQuery(e.target.value)} maxLength={80}/>
      <select className="field" aria-label="Модель" value={selectedModel}
        onChange={e=>chooseModel(e.target.value)}>
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
    {loadError&&<span className="note" role="alert">Каталог временно недоступен: {loadError}. Свободный ввод не включается.</span>}
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

// «Сейчас в TrakSOS» — просто факт, не кнопка: сколько на линии и сколько заявок за сутки. Обновляется раз в минуту.
export function LiveStrip({ who }: { who: 'client' | 'master' | 'tow' }) {
  const [d, setD] = useState<any>(null);
  useEffect(() => {
    let alive = true;
    const load = () => import('./api.ts').then(({ get }) => get('/api/live')).then((x) => alive && setD(x)).catch(() => {});
    load();
    const t = setInterval(load, 60_000);
    return () => { alive = false; clearInterval(t); };
  }, []);
  if (!d) return null;
  const pl = (n: number, one: string, few: string, many: string) => {
    const m10 = n % 10, m100 = n % 100;
    return `${n} ${m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many}`;
  };
  const items = [
    who === 'tow' ? `на линии ${pl(d.tow_online, 'эвакуатор', 'эвакуатора', 'эвакуаторов')}` : `на линии ${pl(d.masters_online, 'мастер', 'мастера', 'мастеров')}`,
    who === 'client' ? `в работе ${pl(d.in_work, 'заявка', 'заявки', 'заявок')}` : `за сутки ${pl(d.orders_24h, 'заявка', 'заявки', 'заявок')}`,
    `выполнено ${d.done_24h}`,
  ];
  return (
    <div className="live-strip" aria-label="Сейчас в TrakSOS">
      <span className="live-dot" />
      <span>Сейчас в TrakSOS: {items.join(' · ')}</span>
    </div>
  );
}
