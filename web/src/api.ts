// Связь с сервером: HTTP + WebSocket. Токен хранится в localStorage (в Android — тоже, внутри WebView).

declare const __API_URL__: string;
export const API_URL = (window as any).TRAKSOS_API ?? (__API_URL__ || '');

const store = {
  get(k: string) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k: string, v: string | null) { try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* приватный режим */ } },
};

let token: string | null = store.get('traksos.token');
export const getToken = () => token;
export function setToken(t: string | null) {
  token = t;
  store.set('traksos.token', t);
}

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public data?: any) { super(message); }
}

export async function api<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  let r: Response;
  try {
    r = await fetch(API_URL + path, {
      method,
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'network', 'Нет связи с сервером. Проверьте интернет.');
  }
  const j = await r.json().catch(() => null);
  if (r.status === 401 && token) {
    setToken(null);
    location.hash = '#/login';
  }
  if (!r.ok) throw new ApiError(r.status, j?.error ?? 'error', j?.message ?? 'Ошибка', j?.data);
  return j as T;
}

export const get = <T = any>(p: string) => api<T>('GET', p);
export const post = <T = any>(p: string, b: unknown = {}) => api<T>('POST', p, b);
export const put = <T = any>(p: string, b: unknown = {}) => api<T>('PUT', p, b);
export const patch = <T = any>(p: string, b: unknown = {}) => api<T>('PATCH', p, b);
export const del = <T = any>(p: string) => api<T>('DELETE', p);

// WebSocket с переподключением ---------------------------------------------

type Listener = (e: any) => void;
const listeners = new Set<Listener>();
let ws: WebSocket | null = null;
let retry = 0;
let closedByUs = false;

export function onEvent(fn: Listener) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function connectWs() {
  if (!token || (ws && ws.readyState <= 1)) return;
  closedByUs = false;
  const base = API_URL || location.origin;
  const url = base.replace(/^http/, 'ws') + '/ws?token=' + encodeURIComponent(token);
  ws = new WebSocket(url);
  ws.onopen = () => { retry = 0; };
  ws.onmessage = (m) => {
    let e: any;
    try { e = JSON.parse(m.data); } catch { return; }
    listeners.forEach((l) => l(e));
  };
  ws.onclose = () => {
    ws = null;
    if (closedByUs || !token) return;
    retry = Math.min(retry + 1, 6);
    setTimeout(connectWs, 500 * 2 ** retry);
  };
}

export function disconnectWs() {
  closedByUs = true;
  ws?.close();
  ws = null;
}

// Форматирование -----------------------------------------------------------

export function rub(kopecks: number | null | undefined) {
  if (kopecks == null) return '—';
  return (kopecks / 100).toLocaleString('ru-RU', { maximumFractionDigits: 2 }) + ' ₽';
}

export function fmtPhone(p: string) {
  const d = p.replace(/\D/g, '').slice(-10);
  if (d.length < 10) return p;
  return `+7 ${d.slice(0, 3)} ${d.slice(3, 6)}-${d.slice(6, 8)}-${d.slice(8)}`;
}

export function fmtTime(iso: string) {
  const d = new Date(iso);
  const today = new Date().toDateString() === d.toDateString();
  return today
    ? d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

/** Картинка, которую отдают только с токеном (фото документов) → адрес для <img> */
export async function authedImage(path: string) {
  const r = await fetch(API_URL + path, { headers: token ? { authorization: `Bearer ${token}` } : {} });
  if (!r.ok) throw new ApiError(r.status, 'image', 'Не удалось загрузить фото');
  return URL.createObjectURL(await r.blob());
}

/** Сжать фото с камеры: по длинной стороне до 1600 px, JPEG — чтобы грузилось и по слабому интернету */
export function compressImage(file: File, max = 1600, quality = 0.82): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k);
      c.height = Math.round(img.height * k);
      c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Не удалось открыть фото')); };
    img.src = url;
  });
}
