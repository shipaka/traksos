import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { ApiError, onEvent } from './api.ts';

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
export const MeCtx = createContext<{ me: Me | null; reload: () => Promise<void>; mode: 'client' | 'performer' | 'admin'; setMode: (m: 'client' | 'performer' | 'admin') => void }>(null as any);
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
  const run = useCallback(async <T,>(fn: () => Promise<T>, okText?: string): Promise<T | undefined> => {
    setBusy(true);
    try {
      const r = await fn();
      if (okText) toast(okText);
      return r;
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Что-то пошло не так');
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

export function Back({ to, label = 'Назад' }: { to: string; label?: string }) {
  return <a href={'#/' + to} className="note" style={{ textDecoration: 'none' }}>← {label}</a>;
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
