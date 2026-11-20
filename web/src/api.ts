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
  if (token !== t) { disconnectWs(); store.set('traksos.offlineIdentity', null); try { sessionStorage.removeItem('traksos.pendingOrder'); } catch { /* unavailable */ } store.set('traksos.savedOrderDraft.v1', null); }
  token = t;
  store.set('traksos.token', t);
}

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public data?: any) { super(message); }
}

export async function api<T = any>(method: string, path: string, body?: unknown, options?: { idempotencyKey?: string }): Promise<T> {
  // The sandbox is the exact same frontend served from another origin.
  // Fail closed if a bundle was accidentally built with a remote production API.
  if (sessionStorage.getItem('traksos.sandboxMode') === '1' &&
      new URL(API_URL || location.origin, location.origin).origin !== location.origin)
    throw new ApiError(403, 'sandbox_wrong_origin', 'Тестовые запросы не могут обращаться к другому серверу');
  let r: Response;
  try {
    // Bounded waits are crucial on unstable mobile data. Never retry writes silently.
    // A POST may have been accepted even if the client lost the response.
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), method === 'GET' ? 12_000 : 30_000);
    try {
      r = await fetch(API_URL + path, {
        method,
        headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...(options?.idempotencyKey ? { 'idempotency-key': options.idempotencyKey } : {}) },
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
  if (!r.ok) throw new ApiError(r.status, j?.error ?? 'error', j?.message ?? 'Ошибка', { ...(j?.data ?? {}), requestId: j?.requestId ?? r.headers.get('x-request-id') });
  return j as T;
}


/**
 * Explicit retry for the *same* new order after an ambiguous mobile response.
 * No automatic POST replay. Server verifies key + canonical request payload,
 * and returns the existing order instead of creating another bank hold.
 * Only a hash and random key (no address, vehicle or description) are persisted.
 */
type PendingOrderKey = { fingerprint: string; key: string; createdAt: number };
let fallbackPending: PendingOrderKey | null = null;

async function fingerprintOrder(body: unknown): Promise<string> {
  const message = new TextEncoder().encode(JSON.stringify(body));
  if (!globalThis.crypto?.subtle) return 'memory:' + JSON.stringify(body);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', message);
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}
function newOrderRequestKey() {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return 'web-' + Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}
export async function postOrder<T = any>(body: unknown): Promise<T> {
  const fingerprint = await fingerprintOrder(body);
  const now = Date.now();
  let saved = fallbackPending;
  if (!fingerprint.startsWith('memory:')) {
    try {
      const item = sessionStorage.getItem('traksos.pendingOrder');
      if (item) saved = JSON.parse(item) as PendingOrderKey;
    } catch { /* private storage: retain the in-memory request identity */ }
  }
  const same = saved && saved.fingerprint === fingerprint &&
    now - saved.createdAt >= 0 && now - saved.createdAt < 24 * 60 * 60 * 1000;
  const pending: PendingOrderKey = same ? saved : { fingerprint, key: newOrderRequestKey(), createdAt: now };
  fallbackPending = pending;
  if (!fingerprint.startsWith('memory:')) {
    try { sessionStorage.setItem('traksos.pendingOrder', JSON.stringify(pending)); } catch { /* private mode */ }
  }
  // A timeout can mean the server already created the order. Keep the key on
  // *every* error until the user retries this exact unchanged form.
  const result = await api<T>('POST', '/api/orders', body, { idempotencyKey: pending.key });
  if (fallbackPending?.key === pending.key) fallbackPending = null;
  try {
    const item = sessionStorage.getItem('traksos.pendingOrder');
    if (item && (JSON.parse(item) as PendingOrderKey).key === pending.key)
      sessionStorage.removeItem('traksos.pendingOrder');
  } catch { /* private mode */ }
  return result;
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
let wsConnectingGeneration: number | null = null;
let wsGeneration = 0;
let wsRetryTimer: ReturnType<typeof setTimeout> | null = null;

export function onEvent(fn: Listener) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
function scheduleWsRetry() {
  if(closedByUs || !token || !navigator.onLine || wsRetryTimer !== null)return;
  retry=Math.min(retry+1,6);
  wsRetryTimer=setTimeout(()=>{
    wsRetryTimer=null;
    connectWs();
  },500*2**retry);
}

export function connectWs() {
  if (!token || !navigator.onLine || wsConnectingGeneration===wsGeneration || (ws && ws.readyState <= 1)) return;
  closedByUs=false;
  const sessionToken=token;
  const generation=wsGeneration;
  wsConnectingGeneration=generation;
  // A short-lived one-use ticket replaces putting the 90-day bearer token
  // in /ws URLs, which reverse proxies might log.
  void post<{ticket:string}>('/api/auth/realtime-ticket').then(({ticket})=>{
    if(closedByUs || generation!==wsGeneration || token!==sessionToken || !navigator.onLine)return;
    const base=API_URL || location.origin;
    const url=base.replace(/^http/,'ws')+'/ws?ticket='+encodeURIComponent(ticket);
    const socket=new WebSocket(url);
    ws=socket;
    socket.onopen=()=>{
      if(closedByUs || generation!==wsGeneration || token!==sessionToken){
        socket.close();return;
      }
      retry=0;
      if(wsRetryTimer!==null){clearTimeout(wsRetryTimer);wsRetryTimer=null;}
      // Do not wait 12 seconds to reconcile an offline Air backlog.
      listeners.forEach(l=>l({type:'connection_restored'}));
    };
    socket.onmessage=(m)=>{
      if(generation!==wsGeneration || token!==sessionToken)return;
      let e:any;
      try{e=JSON.parse(m.data);}catch{return;}
      listeners.forEach(l=>l(e));
    };
    socket.onclose=()=>{
      if(ws===socket)ws=null;
      if(generation!==wsGeneration)return;
      scheduleWsRetry();
    };
    socket.onerror=()=>{ /* onclose schedules a bounded reconnect */ };
  }).catch(()=>{
    if(generation===wsGeneration)scheduleWsRetry();
  }).finally(()=>{
    if(wsConnectingGeneration===generation)wsConnectingGeneration=null;
  });
}

export function disconnectWs() {
  wsGeneration++;
  closedByUs=true;
  if(wsRetryTimer!==null){clearTimeout(wsRetryTimer);wsRetryTimer=null;}
  ws?.close();
  ws=null;
}

window.addEventListener('online',()=>{
  if(token)connectWs();
});
window.addEventListener('offline',()=>{
  // Prevent cellular battery use and reconnect storms while disconnected.
  ws?.close();
  ws=null;
  if(wsRetryTimer!==null){clearTimeout(wsRetryTimer);wsRetryTimer=null;}
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
