// Минимальный клиент PostgreSQL (протокол v3) для офлайн-разработки и тестов.
// Только аутентификация trust/password, одно соединение, текстовый формат.
// Типы приводятся так же, как в `pg`: int8/numeric → string, timestamptz → Date, json → объект.
// В production не используется — там пакет `pg`.

import net from 'node:net';
import { createHash } from 'node:crypto';

type Pending = {
  resolve: (rows: any[]) => void;
  reject: (e: Error) => void;
  rows: any[];
  fields: { name: string; oid: number }[];
  error: Error | null;
};

export class MiniPg {
  private sock!: net.Socket;
  private buf: Buffer = Buffer.alloc(0);
  private queue: Pending[] = [];
  private chain: Promise<unknown> = Promise.resolve();
  private ready!: () => void;
  private fail!: (e: Error) => void;

  static async connect(url: string): Promise<MiniPg> {
    const u = new URL(url);
    const c = new MiniPg();
    c.url = url;
    await c.open(u.hostname || '127.0.0.1', Number(u.port || 5432), decodeURIComponent(u.username || 'postgres'),
      decodeURIComponent(u.password || ''), u.pathname.slice(1) || 'postgres');
    return c;
  }

  private open(host: string, port: number, user: string, password: string, database: string) {
    return new Promise<void>((resolve, reject) => {
      this.ready = resolve;
      this.fail = reject;
      this.sock = net.connect(port, host);
      this.sock.on('error', (e) => this.onError(e));
      this.sock.on('data', (d: Buffer) => this.onData(d, user, password));
      this.sock.on('connect', () => {
        const params = Buffer.from(`user\0${user}\0database\0${database}\0client_encoding\0UTF8\0\0`);
        const head = Buffer.alloc(8);
        head.writeInt32BE(8 + params.length, 0);
        head.writeInt32BE(196608, 4);
        this.sock.write(Buffer.concat([head, params]));
      });
    });
  }

  private onError(e: Error) {
    this.fail?.(e);
    for (const p of this.queue.splice(0)) p.reject(e);
  }

  private msg(type: string, body: Buffer) {
    const h = Buffer.alloc(5);
    h.write(type, 0);
    h.writeInt32BE(body.length + 4, 1);
    return Buffer.concat([h, body]);
  }

  private cstr(s: string) {
    return Buffer.from(s + '\0');
  }

  private salt: Buffer = Buffer.alloc(0);
  private url = '';

  private onData(d: Buffer, user: string, password: string) {
    this.buf = Buffer.concat([this.buf, d]);
    while (this.buf.length >= 5) {
      const type = String.fromCharCode(this.buf[0]);
      const len = this.buf.readInt32BE(1);
      if (this.buf.length < len + 1) break;
      const body = this.buf.subarray(5, len + 1);
      this.buf = this.buf.subarray(len + 1);
      this.handle(type, body, user, password);
    }
  }

  private handle(type: string, body: Buffer, user: string, password: string) {
    const cur = this.queue[0];
    switch (type) {
      case 'R': {
        const code = body.readInt32BE(0);
        if (code === 0) return;
        if (code === 3) return void this.sock.write(this.msg('p', this.cstr(password)));
        if (code === 5) {
          this.salt = body.subarray(4, 8);
          const inner = createHash('md5').update(password + user).digest('hex');
          const outer = createHash('md5').update(Buffer.concat([Buffer.from(inner), this.salt])).digest('hex');
          return void this.sock.write(this.msg('p', this.cstr('md5' + outer)));
        }
        return this.onError(new Error(`miniPg: метод аутентификации ${code} не поддержан (нужен trust/password/md5)`));
      }
      case 'Z':
        if (this.ready) {
          const r = this.ready;
          (this as any).ready = null;
          r();
          return;
        }
        if (cur) {
          this.queue.shift();
          cur.error ? cur.reject(cur.error) : cur.resolve(cur.rows);
        }
        return;
      case 'T': {
        if (!cur) return;
        const n = body.readInt16BE(0);
        let off = 2;
        cur.fields = [];
        for (let i = 0; i < n; i++) {
          const end = body.indexOf(0, off);
          const name = body.toString('utf8', off, end);
          off = end + 1;
          const oid = body.readInt32BE(off + 6);
          off += 18;
          cur.fields.push({ name, oid });
        }
        return;
      }
      case 'D': {
        if (!cur) return;
        const n = body.readInt16BE(0);
        let off = 2;
        const row: any = {};
        for (let i = 0; i < n; i++) {
          const l = body.readInt32BE(off);
          off += 4;
          const f = cur.fields[i];
          if (l === -1) row[f.name] = null;
          else {
            row[f.name] = parseValue(body.toString('utf8', off, off + l), f.oid);
            off += l;
          }
        }
        cur.rows.push(row);
        return;
      }
      case 'E': {
        const fields: Record<string, string> = {};
        let off = 0;
        while (off < body.length && body[off] !== 0) {
          const code = String.fromCharCode(body[off]);
          const end = body.indexOf(0, off + 1);
          fields[code] = body.toString('utf8', off + 1, end);
          off = end + 1;
        }
        const err: any = new Error(fields.M || 'postgres error');
        err.code = fields.C;
        err.detail = fields.D;
        if (cur) cur.error = err;
        else this.onError(err);
        return;
      }
      default:
        return; // S, K, C, 1, 2, n, N, I — не нужны
    }
  }

  private send(buf: Buffer): Promise<any[]> {
    return new Promise((resolve, reject) => {
      this.queue.push({ resolve, reject, rows: [], fields: [], error: null });
      this.sock.write(buf);
    });
  }

  private rawQuery = (sql: string, params: unknown[] = []): Promise<any[]> => {
    const parts: Buffer[] = [];
    parts.push(this.msg('P', Buffer.concat([this.cstr(''), this.cstr(sql), Buffer.from([0, 0])])));
    const bind: Buffer[] = [this.cstr(''), this.cstr(''), Buffer.from([0, 0])];
    const n = Buffer.alloc(2);
    n.writeInt16BE(params.length);
    bind.push(n);
    for (const p of params) {
      const v = serialize(p);
      const l = Buffer.alloc(4);
      if (v === null) {
        l.writeInt32BE(-1);
        bind.push(l);
      } else {
        const b = Buffer.from(v);
        l.writeInt32BE(b.length);
        bind.push(l, b);
      }
    }
    bind.push(Buffer.from([0, 0]));
    parts.push(this.msg('B', Buffer.concat(bind)));
    parts.push(this.msg('D', Buffer.concat([Buffer.from('P'), this.cstr('')])));
    parts.push(this.msg('E', Buffer.concat([this.cstr(''), Buffer.from([0, 0, 0, 0])])));
    parts.push(this.msg('S', Buffer.alloc(0)));
    return this.send(Buffer.concat(parts));
  };

  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn, fn);
    this.chain = run.catch(() => {});
    return run;
  }

  query(sql: string, params?: unknown[]) {
    return this.serial(() => this.rawQuery(sql, params));
  }

  exec(sql: string) {
    return this.serial(async () => {
      await this.send(this.msg('Q', this.cstr(sql)));
    });
  }

  /** Транзакция — на отдельном соединении, как в пуле pg, чтобы остальные запросы не ждали её */
  async transaction<T>(fn: (q: (sql: string, params?: unknown[]) => Promise<any[]>) => Promise<T>): Promise<T> {
    const c = await MiniPg.connect(this.url);
    try {
      await c.rawQuery('begin');
      try {
        const r = await fn(c.rawQuery);
        await c.rawQuery('commit');
        return r;
      } catch (e) {
        await c.rawQuery('rollback').catch(() => {});
        throw e;
      }
    } finally {
      await c.close();
    }
  }

  async close() {
    this.sock.end(this.msg('X', Buffer.alloc(0)));
  }
}

function serialize(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  if (Array.isArray(v)) return '{' + v.map((x) => (x === null ? 'NULL' : '"' + String(x).replace(/(["\\])/g, '\\$1') + '"')).join(',') + '}';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

function parseValue(s: string, oid: number): unknown {
  switch (oid) {
    case 16: return s === 't';
    case 21: case 23: case 26: return Number(s);
    case 700: case 701: return Number(s);
    case 114: case 3802: return JSON.parse(s);
    case 1082: return s;
    case 1114: case 1184: return new Date(s.includes('T') ? s : s.replace(' ', 'T').replace(/([+-]\d\d)$/, '$1:00'));
    case 1009: case 1015: case 1182: return parseTextArray(s);
    default: return s; // int8, numeric, text, uuid → строка, как в pg
  }
}

function parseTextArray(s: string): string[] {
  if (s === '{}') return [];
  const out: string[] = [];
  let i = 1;
  while (i < s.length - 1) {
    if (s[i] === '"') {
      let v = '';
      i++;
      while (s[i] !== '"') {
        if (s[i] === '\\') i++;
        v += s[i++];
      }
      out.push(v);
      i += 2;
    } else {
      const end = s.indexOf(',', i);
      const stop = end === -1 ? s.length - 1 : end;
      out.push(s.slice(i, stop));
      i = stop + 1;
    }
  }
  return out;
}
