// Связь с сервером: HTTP + WebSocket. Токен хранится в localStorage (в Android — тоже, внутри WebView).
import {currentPreviewRole,rolePreviewApi} from './demo/fullRolePreview.ts';

declare const __API_URL__: string;
export const API_URL = (window as any).TRAKSOS_API ?? (__API_URL__ || '');

const store = {
  get(k: string) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k: string, v: string | null) { try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* приватный режим */ } },
};

let token: string | null = store.get('traksos.token');
export const getToken = () => token;
export function setToken(t: string | null) {
  if (token !== t) store.set('traksos.offlineIdentity', null);
  token = t;
  store.set('traksos.token', t);
}

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public data?: any) { super(message); }
}

export async function api<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  // Fake roles use only in-memory data, never live calls. /api/me refreshes the real admin session.
  if(currentPreviewRole() && path.startsWith('/api/') && !(method === 'GET' && path.split('?')[0] === '/api/me'))
    return rolePreviewApi(method,path,body) as Promise<T>;
  let r: Response;
  try {
    // Bounded waits are crucial on unstable mobile data. Never retry writes silently.
    // A POST may have been accepted even if the client lost the response.
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), method === 'GET' ? 12_000 : 30_000);
    try {
      r = await fetch(API_URL + path, {
        method,
        headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
        cache: 'no-store',
        signal: timeout.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  } catch {
    window.dispatchEvent(new CustomEvent('traksos-connection', { detail: { online: false } }));
    throw new ApiError(0, 'network', 'Нет связи с сервером. Проверьте интернет.');
  }
  window.dispatchEvent(new CustomEvent('traksos-connection', { detail: { online: true } }));
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
  if (currentPreviewRole()) { disconnectWs(); return; }
  if (!token || !navigator.onLine || (ws && ws.readyState <= 1)) return;
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
    if (closedByUs || !token || !navigator.onLine) return;
    retry = Math.min(retry + 1, 6);
    setTimeout(connectWs, 500 * 2 ** retry);
  };
}

export function disconnectWs() {
  closedByUs = true;
  ws?.close();
  ws = null;
}

window.addEventListener('online', () => {
  if (token) connectWs();
});
window.addEventListener('hashchange', () => {
  // A real admin WS may exist before entering a synthetic account. Close it
  // immediately so no private notifications arrive inside the training UI.
  if (currentPreviewRole()) disconnectWs();
  else if (token) connectWs();
});
window.addEventListener('offline', () => {
  // Avoid reconnect churn and cellular battery usage when disconnected.
  ws?.close();
  ws = null;
});


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
  if (currentPreviewRole()) throw new ApiError(403,'preview_blocked','Реальные документы и фотографии недоступны в тестовом кабинете');
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
      try {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Не удалось обработать изображение');
        const initial = Math.min(1, max / Math.max(img.width, img.height));
        let scale = initial;
        let q = Math.min(0.90, Math.max(0.60, quality));
        let result = '';
        // Server accepts JSON up to 1 MB, base64 overhead included.
        // Target under 800k characters to leave space for request fields.
        for (let attempt = 0; attempt < 12; attempt++) {
          canvas.width = Math.max(1, Math.round(img.width * scale));
          canvas.height = Math.max(1, Math.round(img.height * scale));
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          result = canvas.toDataURL('image/jpeg', q);
          if (result.length <= 800_000) break;
          if (q > 0.63) q = Math.max(0.62, q - 0.10);
          else scale *= 0.79;
        }
        if (result.length > 800_000) throw new Error('Фотография слишком большая. Выберите другое фото.');
        resolve(result);
      } catch (error) {
        reject(error);
      } finally {
        URL.revokeObjectURL(url);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Не удалось открыть фото'));
    };
    img.src = url;
  });
}
