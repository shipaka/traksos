import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { ApiError, onEvent } from './api.ts';
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
export const MeCtx = createContext<{ me: Me | null; reload: () => Promise<void>; mode: 'client' | 'performer' | 'admin' | 'service' | 'insurer'; setMode: (m: 'client' | 'performer' | 'admin' | 'service' | 'insurer') => void }>(null as any);
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
export type VehicleValue = { brand: string; model: string; year: string };
export function VehicleFields({ value, onChange }: { value: VehicleValue; onChange: (v: VehicleValue) => void }) {
  const knownBrand = !value.brand || BRANDS.includes(value.brand);
  const [ownBrand, setOwnBrand] = useState(!knownBrand);
  const models = MODELS[value.brand] ?? [];
  const knownModel = !value.model || models.includes(value.model);
  const [ownModel, setOwnModel] = useState(!knownModel);
  const OTHER = '__other';
  return (
    <div className="stack" style={{ gap: 8 }}>
      <select className="field" aria-label="Марка" value={ownBrand ? OTHER : value.brand}
        onChange={(e) => { const b = e.target.value; if (b === OTHER) { setOwnBrand(true); onChange({ ...value, brand: '', model: '' }); } else { setOwnBrand(false); setOwnModel(false); onChange({ ...value, brand: b, model: '' }); } }}>
        <option value="">Марка</option>
        {BRANDS.filter((b) => b !== 'Прочие').map((b) => <option key={b} value={b}>{b}</option>)}
        <option value={OTHER}>Другая марка…</option>
      </select>
      {ownBrand && <input className="field" autoFocus placeholder="Как называется марка" value={value.brand} onChange={(e) => onChange({ ...value, brand: e.target.value })} />}
      <div className="grid2">
        {!ownBrand && models.length > 0 && !ownModel ? (
          <select className="field" aria-label="Модель" value={value.model}
            onChange={(e) => { if (e.target.value === OTHER) { setOwnModel(true); onChange({ ...value, model: '' }); } else onChange({ ...value, model: e.target.value }); }}>
            <option value="">Модель</option>
            {models.map((m) => <option key={m} value={m}>{m}</option>)}
            <option value={OTHER}>Другая модель…</option>
          </select>
        ) : (
          <input className="field" placeholder="Модель" value={value.model} onChange={(e) => onChange({ ...value, model: e.target.value })} />
        )}
        <select className="field" aria-label="Год выпуска" value={value.year} onChange={(e) => onChange({ ...value, year: e.target.value })}>
          <option value="">Год выпуска</option>
          {YEARS.map((y) => <option key={y} value={String(y)}>{y}</option>)}
        </select>
      </div>
    </div>
  );
}

// «Сейчас в ТракSOS» — просто факт, не кнопка: сколько на линии и сколько заявок за сутки. Обновляется раз в минуту.
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
    <div className="live-strip" aria-label="Сейчас в ТракSOS">
      <span className="live-dot" />
      <span>Сейчас в ТракSOS: {items.join(' · ')}</span>
    </div>
  );
}
