import type { Db } from '../db/index.ts';
import { defaultSettings, type Settings, type SettingsKey } from '../domain/defaults.ts';

/** Настройки площадки: значения по умолчанию + то, что поменял админ. Кэш на 5 секунд. */
export class SettingsService {
  private cache: { at: number; value: Settings } | null = null;
  constructor(private db: Db) {}

  async all(): Promise<Settings> {
    if (this.cache && Date.now() - this.cache.at < 5_000) return this.cache.value;
    const rows = await this.db.query<{ key: string; value: any }>('select key, value from settings');
    const merged: any = structuredClone(defaultSettings);
    for (const r of rows) {
      if (r.key in merged && typeof merged[r.key] === 'object' && !Array.isArray(merged[r.key])) {
        merged[r.key] = { ...merged[r.key], ...r.value };
      }
    }
    this.cache = { at: Date.now(), value: merged };
    return merged;
  }

  async get<K extends SettingsKey>(key: K): Promise<Settings[K]> {
    return (await this.all())[key];
  }

  async set<K extends SettingsKey>(key: K, patch: Partial<Settings[K]>, actorId: string | null) {
    if (!(key in defaultSettings)) throw new Error(`Нет такой настройки: ${key}`);
    const current = (await this.db.one<{ value: any }>('select value from settings where key=$1', [key]))?.value ?? {};
    const value = { ...current, ...patch };
    await this.db.query(
      `insert into settings(key, value, updated_by) values ($1,$2,$3)
       on conflict (key) do update set value = excluded.value, updated_at = now(), updated_by = excluded.updated_by`,
      [key, value, actorId],
    );
    await this.db.query('insert into audit_log(actor_id, action, target, data) values ($1,$2,$3,$4)', [
      actorId, 'settings.update', key, patch,
    ]);
    this.cache = null;
    return (await this.all())[key];
  }
}
