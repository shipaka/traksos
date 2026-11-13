// Lightweight part-title/article search, stored locally in IndexedDB.
// Never cache private history, VIN, stock, supplier credentials or prices.
import { get } from './api.ts';

export interface OfflinePart {
  id: string;
  category: string;
  brand: string | null;
  article: string | null;
  name: string;
  aliases: string | null;
}

interface IndexMeta {
  key: 'index';
  schema: 2;
  revision: string;      // database change sequence, not a timestamp
  cursor: string | null; // UUID during initial snapshot, null after completion
  complete: boolean;
  count: number;
}
export interface SyncSummary {
  added: number;
  removed: number;
  total: number;
  complete: boolean;
  unchanged: boolean;
  incremental: boolean;
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) {
      reject(new Error('Локальный каталог не поддерживается устройством'));
      return;
    }
    // Version 2 keeps the same stores. The metadata schema changes from timestamps to
    // change sequence numbers; old caches are rebuilt once rather than trusted.
    const req = indexedDB.open('traksos-parts-index', 2);
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

/** Save a batch and its position in one IDB transaction. Interruption can never
 * leave the cursor ahead of stored records or behind removed tombstones. */
function storeBatch(db: IDBDatabase, rows: unknown[][], meta: IndexMeta,
  reset: boolean, delta: boolean): Promise<number> {
  return new Promise((resolve, reject) => {
    let removed = 0;
    const tx = db.transaction(['parts', 'meta'], 'readwrite');
    const parts = tx.objectStore('parts');
    if (reset) parts.clear();
    for (const line of rows) {
      const record = delta ? line.slice(1) : line;
      const [id, category, brand, article, name, aliases] = record;
      if (typeof id !== 'string') continue;
      if (delta && record.length === 1) { parts.delete(id); removed++; continue; }
      if (typeof name !== 'string') continue;
      parts.put({ id, category, brand, article, name, aliases } satisfies OfflinePart);
    }
    tx.objectStore('meta').put(meta);
    tx.oncomplete = () => resolve(removed);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/** Per tap: at most four requests of <=750 compact rows; resume on next tap.
 * Once seeded, only changed/deleted articles travel over the network. */
export async function syncOfflineParts(): Promise<SyncSummary> {
  const manifest = await get<{ enabled: boolean; revision: string; count: number }>(
    '/api/shop/index/manifest');
  if (!manifest.enabled) throw new Error('Магазин пока в разработке');
  const db = await open();
  try {
    const prev = await readMeta(db);
    const valid = prev?.schema === 2 && /^\d+$/.test(prev.revision);
    const continuingSnapshot = !!valid && !prev!.complete;
    // Initial bootstrap (or migration from the old timestamp scheme).
    if (!valid || continuingSnapshot) {
      const initialRevision = continuingSnapshot ? prev!.revision : manifest.revision;
      let cursor = continuingSnapshot ? prev!.cursor : null;
      let added = 0;
      for (let page = 0; page < 4; page++) {
        const response = await get<{ enabled: boolean; rows: unknown[][]; next: string | null }>(
          '/api/shop/index/page?limit=750' + (cursor ? '&after=' + encodeURIComponent(cursor) : ''));
        if (!response.enabled) throw new Error('Магазин пока закрыт');
        const complete = !response.next;
        await storeBatch(db, response.rows, {
          key: 'index', schema: 2, revision: initialRevision,
          cursor: response.next, complete, count: manifest.count,
        }, !continuingSnapshot && page === 0, false);
        added += response.rows.length;
        cursor = response.next;
        if (complete) return { added, removed: 0, total: manifest.count, complete: true, unchanged: false, incremental: false };
      }
      return { added, removed: 0, total: manifest.count, complete: false, unchanged: false, incremental: false };
    }
    if (prev!.revision === manifest.revision)
      return { added: 0, removed: 0, total: manifest.count, complete: true, unchanged: true, incremental: true };

    // Durable incremental feed. We can apply <=3,000 changes per action and resume
    // from the last applied sequence, without ever redownloading the entire catalog.
    let after = prev!.revision;
    let added = 0;
    let removed = 0;
    for (let page = 0; page < 4; page++) {
      const response = await get<{
        enabled: boolean; rows: unknown[][]; next: string | null; revision: string;
      }>('/api/shop/index/changes?limit=750&after=' + encodeURIComponent(after));
      if (!response.enabled) throw new Error('Магазин пока закрыт');
      const complete = response.next === null;
      const rev = complete ? response.revision : response.next!;
      removed += await storeBatch(db, response.rows, {
        key: 'index', schema: 2, revision: rev, cursor: null,
        complete: true, count: manifest.count,
      }, false, true);
      added += response.rows.length;
      after = rev;
      if (complete) return { added, removed, total: manifest.count, complete: true, unchanged: false, incremental: true };
    }
    return { added, removed, total: manifest.count, complete: false, unchanged: false, incremental: true };
  } finally {
    db.close();
  }
}

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
        const part = cursor.value as OfflinePart;
        const searchable = [part.name, part.article, part.brand, part.aliases]
          .filter(Boolean).join(' ').toLocaleLowerCase('ru-RU');
        if ((category === 'all' || part.category === category) &&
            terms.every((term) => searchable.includes(term))) found.push(part);
        cursor.continue();
      };
      req.onerror = () => reject(req.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
