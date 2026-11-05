// Доступ к PostgreSQL. В работе — драйвер `pg` (пул соединений).
// Если `pg` не установлен (офлайн-разработка), используется встроенный miniPg.

export type Row = Record<string, any>;

export interface Queryable {
  query<T = Row>(sql: string, params?: unknown[]): Promise<T[]>;
  one<T = Row>(sql: string, params?: unknown[]): Promise<T | null>;
}

export interface Db extends Queryable {
  tx<T>(fn: (q: Queryable) => Promise<T>): Promise<T>;
  exec(sql: string): Promise<void>;
  close(): Promise<void>;
  driver: 'pg' | 'mini';
}

function withOne(query: Queryable['query']): Queryable {
  return {
    query,
    async one(sql, params) {
      const rows = await query(sql, params);
      return (rows[0] as any) ?? null;
    },
  };
}

export async function createDb(url: string): Promise<Db> {
  let pg: any = null;
  try {
    pg = (await import('pg')).default;
  } catch {
    pg = null;
  }
  if (pg) return createPgDb(pg, url);
  const { MiniPg } = await import('./miniPg.ts');
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Пакет pg не установлен: в production нужен настоящий драйвер');
  }
  const mini = await MiniPg.connect(url);
  const base = withOne((sql, params) => mini.query(sql, params));
  return {
    ...base,
    driver: 'mini',
    exec: (sql) => mini.exec(sql),
    tx: (fn) => mini.transaction((raw) => fn(withOne(raw))),
    close: () => mini.close(),
  };
}

function createPgDb(pg: any, url: string): Db {
  const pool = new pg.Pool({ connectionString: url, max: 10 });
  const base = withOne(async (sql, params) => (await pool.query(sql, params)).rows);
  return {
    ...base,
    driver: 'pg',
    async exec(sql) {
      await pool.query(sql);
    },
    async tx(fn) {
      // Взаимная блокировка (два выбора одновременно трогают одни и те же отклики в разном порядке):
      // Postgres откатывает одну из транзакций — повторяем её целиком, до трёх раз
      for (let attempt = 1; ; attempt++) {
        const client = await pool.connect();
        try {
          await client.query('begin');
          const r = await fn(withOne(async (sql, params) => (await client.query(sql, params)).rows));
          await client.query('commit');
          return r;
        } catch (e: any) {
          await client.query('rollback').catch(() => {});
          if ((e?.code === '40P01' || e?.code === '40001') && attempt < 4) {
            await new Promise((ok) => setTimeout(ok, 5 + Math.random() * 30 * attempt));
            continue;
          }
          throw e;
        } finally {
          client.release();
        }
      }
    },
    close: () => pool.end(),
  };
}
