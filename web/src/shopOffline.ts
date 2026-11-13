// Text-only offline lookup for part names and article numbers.
// No private history, VINs, prices, inventory or authentication tokens are stored.
import { get } from './api.ts';

export interface OfflinePart {
  id: string;
  category: string;
  brand: string | null;
  article: string | null;
  name: string;
  aliases: string | null;
}

interface IndexMeta { key: string; revision: string | null; cursor: string | null; complete: boolean; count: number }
export interface SyncSummary { added: number; total: number; complete: boolean; unchanged: boolean }

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) { reject(new Error('Локальный справочник не поддерживается этим браузером')); return; }
    const req = indexedDB.open('traksos-parts-index', 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('parts')) db.createObjectStore('parts', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function readMeta(db: IDBDatabase): Promise<IndexMeta | null> {
  return new Promise((resolve, reject) => {
    const req = db.transaction('meta', 'readonly').objectStore('meta').get('index');
    req.onsuccess = () => resolve((req.result as IndexMeta | undefined) ?? null);
    req.onerror = () => reject(req.error);
  });
}

function commitPage(db: IDBDatabase, rows: unknown[][], meta: IndexMeta, reset: boolean): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['parts', 'meta'], 'readwrite');
    const parts = tx.objectStore('parts');
    if (reset) parts.clear();
    for (const line of rows) {
      const [id, category, brand, article, name, aliases] = line;
      if (typeof id !== 'string' || typeof name !== 'string') continue;
      parts.put({ id, category, brand, article, name, aliases });
    }
    tx.objectStore('meta').put(meta);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/** One deliberate sync fetches at most ~3,000 compact records, not an entire huge catalog.
 * Repeated sync resumes from the saved cursor; unchanged completed catalogs cost one small manifest request. */
export async function syncOfflineParts(): Promise<SyncSummary> {
  const manifest = await get<{ enabled: boolean; revision: string | null; count: number }>('/api/shop/index/manifest');
  if (!manifest.enabled) throw new Error('Каталог пока в разработке');
  const db = await open();
  try {
    const prev = await readMeta(db);
    const reset = prev?.revision !== manifest.revision;
    if (!reset && prev?.complete) return { added: 0, total: manifest.count, complete: true, unchanged: true };
    let cursor: string | null = reset ? null : (prev?.cursor ?? null);
    let added = 0;
    for (let page = 0; page < 4; page += 1) {
      const args = `?limit=750${cursor ? '&after=' + encodeURIComponent(cursor) : ''}`;
      const result = await get<{ enabled: boolean; rows: unknown[][]; next: string | null }>(
        '/api/shop/index/page' + args);
      if (!result.enabled) throw new Error('Каталог пока закрыт');
      const complete = result.next === null;
      await commitPage(db, result.rows, {
        key: 'index', revision: manifest.revision, cursor: result.next,
        complete, count: manifest.count,
      }, reset && page === 0);
      added += result.rows.length;
      cursor = result.next;
      if (complete) return { added, total: manifest.count, complete: true, unchanged: false };
    }
    return { added, total: manifest.count, complete: false, unchanged: false };
  } finally {
    db.close();
  }
}

/** Cursor scan keeps memory bounded even for large catalogs. Never shows offline prices. */
export async function searchOfflineParts(query: string, category = 'all', limit = 24): Promise<OfflinePart[]> {
  let db: IDBDatabase;
  try { db = await open(); } catch { return []; }
  const terms = query.trim().toLocaleLowerCase('ru-RU').split(/\s+/).filter(Boolean);
  try {
    return await new Promise((resolve, reject) => {
      const found: OfflinePart[] = [];
      const tx = db.transaction('parts', 'readonly');
      const req = tx.objectStore('parts').openCursor();
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor || found.length >= limit) { resolve(found); return; }
        const p = cursor.value as OfflinePart;
        const text = [p.name, p.article, p.brand, p.aliases].filter(Boolean).join(' ').toLocaleLowerCase('ru-RU');
        if ((category === 'all' || p.category === category) && terms.every((term) => text.includes(term))) found.push(p);
        cursor.continue();
      };
      req.onerror = () => reject(req.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
