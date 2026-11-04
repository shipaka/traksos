import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { Db } from './index.ts';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../migrations');

export async function migrate(db: Db): Promise<string[]> {
  await db.exec(`create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())`);
  const done = new Set((await db.query<{ name: string }>('select name from schema_migrations')).map((r) => r.name));
  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
  const applied: string[] = [];
  for (const f of files) {
    if (done.has(f)) continue;
    const sql = await readFile(path.join(dir, f), 'utf8');
    try {
      await db.exec(`begin;\n${sql}\ninsert into schema_migrations(name) values ('${f.replace(/'/g, "''")}');\ncommit;`);
    } catch (e) {
      await db.exec('rollback').catch(() => {});
      throw new Error(`Миграция ${f} не применилась: ${(e as Error).message}`);
    }
    applied.push(f);
  }
  return applied;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const { createDb } = await import('./index.ts');
  const { config } = await import('../config.ts');
  const db = await createDb(config.databaseUrl);
  const applied = await migrate(db);
  console.log(applied.length ? `Применены миграции: ${applied.join(', ')}` : 'Миграции уже применены');
  await db.close();
}
